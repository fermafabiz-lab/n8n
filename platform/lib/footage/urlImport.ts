/**
 * Universal URL import — a pasted address becomes a library row, with as
 * much of its provenance as the page is willing to state.
 *
 * Two doors. A URL on a domain one of the providers owns (a Commons File:
 * page, an images.nasa.gov details page, a DVIDS asset, an EU AV item) goes
 * to that provider's `importFromUrl`, which reads the provider's API and
 * files the same well-catalogued asset a search would have. Anything else
 * goes through the generic reader below: the page's own HTML, read for
 * OpenGraph, Twitter card, JSON-LD (`VideoObject`, `ImageObject`,
 * `NewsArticle`), Dublin Core, `<link rel="license">`, `<video>` and
 * `<source>` tags, and the plain `<title>` / description metas.
 *
 * What it is NOT, in as many words as the spec used: a downloader for
 * anybody's video. It never bypasses a login, a paywall, DRM, a signed URL
 * or a platform's protections, and it refuses to record a media URL at all
 * for hosts whose terms forbid re-use of their streams (YouTube, Vimeo,
 * TikTok, Facebook, Instagram, X, Dailymotion, Twitch): those imports keep
 * the page's metadata and the source link, mark rights MANUAL REVIEW, and
 * say why. An HLS/DASH manifest (`.m3u8`, `.mpd`) is never taken as a media
 * URL either — a stream is not a file, and the ones worth wanting are
 * protected.
 *
 * When rights cannot be established from the page, the asset is filed as
 * `manual_review` with the reason, and nothing about it reaches a render
 * until a person verifies it (§12, §18).
 */

import { classifyLicense } from "@/lib/archive/rights";
import { qualityScoreOf, searchable, stripHtml, yearsIn } from "@/lib/archive/text";
import { createHash } from "node:crypto";
import { canonicalUrl } from "./dedupe";
import { allProviders } from "./registry";
import type { NormalizedFootageAsset } from "./types";

const UA = "HouseOfVideos/1.0 (https://house-of-videos.com; documentary archive research)";
const MAX_HTML = 2 * 1024 * 1024;

/** Hosts whose streams are not ours to take. Metadata only, rights = manual review. */
const NO_RIP_HOSTS =
  /(^|\.)(youtube\.com|youtu\.be|vimeo\.com|tiktok\.com|facebook\.com|fb\.watch|instagram\.com|twitter\.com|x\.com|dailymotion\.com|twitch\.tv|netflix\.com|primevideo\.com|disneyplus\.com|hulu\.com)$/i;

/** Domains whose own policy settles the default rights when the page says nothing. */
const DOMAIN_RIGHTS: Array<{ test: RegExp; code: string; text: string; reason: string }> = [
  {
    test: /(^|\.)europa\.eu$/i,
    code: "cc-by",
    text: "© European Union — reuse authorised with attribution (Decision 2011/833/EU) unless the page states otherwise",
    reason: "",
  },
  {
    test: /(^|\.)(nasa|jpl\.nasa)\.gov$/i,
    code: "pd",
    text: "NASA material is generally not copyrighted; credit NASA. Third-party material excepted.",
    reason: "",
  },
  {
    test: /(^|\.)(defense|dvidshub|army|navy|af|marines|uscg|spaceforce)\.(gov|mil|net)$/i,
    code: "pd",
    text: "Work of the U.S. Department of Defense — public domain with credit unless the page credits a third party",
    reason: "",
  },
];

export interface ImportedFootage {
  asset: NormalizedFootageAsset;
  /** What the reader could not establish, in one line each. Shown before saving. */
  warnings: string[];
  /** Which door it came through. */
  via: "provider" | "page";
}

export class ImportRefused extends Error {}

function pick(html: string, res: RegExp[]): string | null {
  for (const re of res) {
    const m = re.exec(html);
    if (m?.[1]) return stripHtml(m[1]);
  }
  return null;
}

/** All `<meta property|name="…" content="…">` values for a key, in order. */
function metas(html: string, key: string): string[] {
  const out: string[] = [];
  const k = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    `<meta\\s+(?:[^>]*?\\s)?(?:property|name|itemprop)=["']${k}["'][^>]*?\\scontent=["']([^"']*)["']|<meta\\s+(?:[^>]*?\\s)?content=["']([^"']*)["'][^>]*?\\s(?:property|name|itemprop)=["']${k}["']`,
    "gi",
  );
  for (const m of html.matchAll(re)) {
    const v = (m[1] ?? m[2] ?? "").trim();
    if (v) out.push(v.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'"));
  }
  return out;
}

interface Ld {
  "@type"?: string | string[];
  name?: string;
  headline?: string;
  description?: string;
  thumbnailUrl?: string | string[];
  contentUrl?: string;
  embedUrl?: string;
  uploadDate?: string;
  dateCreated?: string;
  datePublished?: string;
  duration?: string;
  width?: number | string;
  height?: number | string;
  author?: { name?: string } | Array<{ name?: string }> | string;
  creator?: { name?: string } | string;
  publisher?: { name?: string } | string;
  copyrightHolder?: { name?: string } | string;
  copyrightNotice?: string;
  license?: string;
  contentLocation?: { name?: string; address?: { addressLocality?: string; addressCountry?: string } | string };
  keywords?: string | string[];
  about?: { name?: string } | string;
  video?: Ld;
  image?: Ld | string;
  "@graph"?: Ld[];
}

function jsonLd(html: string): Ld[] {
  const out: Ld[] = [];
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(m[1].trim()) as Ld | Ld[];
      const list = Array.isArray(parsed) ? parsed : [parsed];
      for (const x of list) {
        out.push(x);
        if (Array.isArray(x["@graph"])) out.push(...x["@graph"]);
      }
    } catch {
      /* a broken block is a block we did not read */
    }
  }
  return out;
}

const ldName = (v: Ld["author"]): string | null => {
  if (!v) return null;
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.map((x) => x?.name ?? "").filter(Boolean).join(", ") || null;
  return v.name ?? null;
};

/** ISO 8601 duration ("PT1M30S") → seconds. */
export function isoDurationSeconds(s: string | undefined | null): number | null {
  if (!s) return null;
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/i.exec(s.trim());
  if (!m) return null;
  const [, d, h, mi, sec] = m;
  const total = Number(d ?? 0) * 86400 + Number(h ?? 0) * 3600 + Number(mi ?? 0) * 60 + Number(sec ?? 0);
  return total > 0 ? total : null;
}

const isStream = (u: string) => /\.(m3u8|mpd)(\?|$)/i.test(u) || /^blob:/i.test(u);
const abs = (u: string | null | undefined, base: string): string | null => {
  if (!u) return null;
  try {
    return new URL(u, base).toString();
  } catch {
    return null;
  }
};

/**
 * Read one page. Exported so the test can hand it HTML without a network.
 * `url` is the page address (already fetched), `html` its body.
 */
export function readPage(url: string, html: string): ImportedFootage {
  const warnings: string[] = [];
  const u = new URL(url);
  const host = u.hostname.replace(/^www\./, "");
  const lds = jsonLd(html);
  const video = lds.find((l) => /VideoObject/i.test(String(l["@type"]))) ?? lds.find((l) => l.video)?.video ?? null;
  const image = lds.find((l) => /ImageObject|Photograph/i.test(String(l["@type"]))) ?? null;
  const article = lds.find((l) => /Article|NewsArticle|WebPage/i.test(String(l["@type"]))) ?? null;
  const ld = video ?? image ?? article ?? null;

  const title =
    stripHtml(metas(html, "og:title")[0]) ??
    stripHtml(video?.name ?? image?.name ?? article?.headline ?? article?.name) ??
    pick(html, [/<title[^>]*>([\s\S]*?)<\/title>/i]) ??
    host;
  const description =
    stripHtml(metas(html, "og:description")[0]) ??
    stripHtml(ld?.description) ??
    stripHtml(metas(html, "description")[0]) ??
    stripHtml(metas(html, "twitter:description")[0]);

  // Media. OpenGraph video first, then JSON-LD contentUrl, then a <video>/<source>.
  const noRip = NO_RIP_HOSTS.test(host);
  const candidates = [
    ...metas(html, "og:video:secure_url"),
    ...metas(html, "og:video:url"),
    ...metas(html, "og:video"),
    ...metas(html, "twitter:player:stream"),
    video?.contentUrl ?? "",
    ...[...html.matchAll(/<(?:video|source)[^>]+src=["']([^"']+)["'][^>]*>/gi)].map((m) => m[1]),
  ]
    .map((c) => abs(c, url))
    .filter((c): c is string => Boolean(c))
    .filter((c) => !/^(text\/html|https?:\/\/[^/]+\/?$)/.test(c));
  const videoFile = candidates.find((c) => /\.(mp4|webm|mov|m4v|ogv)(\?|$)/i.test(c) && !isStream(c)) ?? null;
  const streamOnly = !videoFile && candidates.some(isStream);
  const imageFile =
    abs(metas(html, "og:image:secure_url")[0] ?? metas(html, "og:image")[0] ?? (typeof image?.contentUrl === "string" ? image.contentUrl : null) ?? metas(html, "twitter:image")[0], url) ?? null;
  const thumb =
    abs(metas(html, "og:image")[0] ?? (typeof video?.thumbnailUrl === "string" ? video.thumbnailUrl : Array.isArray(video?.thumbnailUrl) ? video?.thumbnailUrl[0] : null), url) ?? null;

  const mediaType: "video" | "image" = videoFile || video || streamOnly || metas(html, "og:type")[0]?.startsWith("video") ? "video" : "image";
  let downloadUrl: string | null = mediaType === "video" ? videoFile : imageFile;
  if (noRip) {
    downloadUrl = null;
    warnings.push(`${host} does not permit its media to be re-used or downloaded — only the page's metadata and link were kept.`);
  } else if (mediaType === "video" && !videoFile) {
    warnings.push(
      streamOnly
        ? "The page serves a stream (HLS/DASH), not a file. Streams are not imported; the link was kept for manual handling."
        : "No video file is exposed by the page — only its metadata was read.",
    );
  } else if (mediaType === "image" && !imageFile) {
    warnings.push("No image file is exposed by the page — only its metadata was read.");
  }

  // Dates. Only what the page states about the CONTENT; never "today".
  const filmingDate = stripHtml(video?.dateCreated ?? image?.dateCreated ?? metas(html, "dcterms.created")[0] ?? metas(html, "DC.date")[0]);
  const publicationDate = stripHtml(
    video?.uploadDate ?? video?.datePublished ?? article?.datePublished ?? metas(html, "article:published_time")[0] ?? metas(html, "og:updated_time")[0],
  );

  // Who and where.
  const creator = stripHtml(ldName(ld?.author) ?? ldName(ld?.creator as Ld["author"]) ?? metas(html, "author")[0] ?? metas(html, "DC.creator")[0]);
  const publisher = stripHtml(ldName(ld?.publisher as Ld["author"]) ?? metas(html, "og:site_name")[0]);
  const loc = ld?.contentLocation;
  const location = stripHtml(
    typeof loc?.address === "string" ? loc.address : loc ? [loc.name, loc.address?.addressLocality, loc.address?.addressCountry].filter(Boolean).join(", ") : null,
  );
  const country = typeof loc?.address === "object" ? (loc.address?.addressCountry ?? null) : null;

  // Rights: the page's own words, then the domain's known policy, then unknown.
  const licenseUrl = pick(html, [/<link[^>]+rel=["']license["'][^>]+href=["']([^"']+)["']/i, /<a[^>]+rel=["']license["'][^>]+href=["']([^"']+)["']/i]);
  const ldLicense = stripHtml(typeof ld?.license === "string" ? ld.license : null);
  const notice = stripHtml(ld?.copyrightNotice ?? metas(html, "copyright")[0] ?? metas(html, "dcterms.rights")[0] ?? metas(html, "DC.rights")[0]);
  const holder = stripHtml(ldName(ld?.copyrightHolder as Ld["author"]));
  const domainRule = DOMAIN_RIGHTS.find((d) => d.test.test(host)) ?? null;
  // The page's rights words, verbatim. When it has none, the text says so
  // rather than staying empty: the validator reads an EMPTY rights text as
  // "nobody has looked" (`unknown`), and here somebody has — the page was
  // read and it states nothing, which is the spec's manual-review case.
  const NO_LICENCE = "No licence stated on the page.";
  const rightsText = [ldLicense, licenseUrl, notice, holder ? `Copyright holder: ${holder}` : null, !ldLicense && !licenseUrl && !notice && domainRule ? domainRule.text : null]
    .filter(Boolean)
    .join(" · ") || (noRip ? null : NO_LICENCE);

  let rights;
  if (noRip) {
    rights = classifyLicense(null, "platform terms of service", null);
    rights = { ...rights, reviewStatus: "manual_review" as const, reviewReason: `${host}: the platform's terms decide, not a licence on the page.` };
  } else if (ldLicense || licenseUrl) {
    rights = classifyLicense(null, `${ldLicense ?? ""} ${licenseUrl ?? ""}`, null);
  } else if (domainRule) {
    rights = classifyLicense(domainRule.code, domainRule.text, true);
    warnings.push(`Rights taken from ${host}'s published policy — the page itself states no licence. Verify before rendering.`);
    // A policy default is never auto-cleared: a person confirms it per asset.
    rights = { ...rights, reviewStatus: "manual_review" as const, reviewReason: `Rights inferred from ${host}'s general policy, not stated on the page.` };
  } else {
    rights = classifyLicense(null, notice, null);
    rights = { ...rights, reviewStatus: "manual_review" as const, reviewReason: rights.reviewReason ?? NO_LICENCE };
    warnings.push("The page states no licence. Rights are MANUAL REVIEW until someone establishes them.");
  }

  const w = Number(video?.width ?? image?.width ?? metas(html, "og:video:width")[0] ?? metas(html, "og:image:width")[0]) || null;
  const h = Number(video?.height ?? image?.height ?? metas(html, "og:video:height")[0] ?? metas(html, "og:image:height")[0]) || null;
  const duration = isoDurationSeconds(video?.duration) ?? (Number(metas(html, "video:duration")[0]) || null);
  const keywords = (Array.isArray(ld?.keywords) ? ld!.keywords : String(ld?.keywords ?? metas(html, "keywords")[0] ?? "").split(",")).map((k) => String(k).trim()).filter(Boolean);
  const canonical = canonicalUrl(abs(metas(html, "og:url")[0], url) ?? url);
  const id = createHash("sha256").update(canonical).digest("hex").slice(0, 24);

  const asset: NormalizedFootageAsset = {
    provider: "url_import",
    providerAssetId: id,
    mediaType,
    title,
    description,
    sourceUrl: canonical,
    downloadUrl: downloadUrl ?? canonical,
    thumbnailUrl: thumb ?? (mediaType === "image" ? imageFile : null),
    previewUrl: null,
    width: w,
    height: h,
    durationSeconds: duration,
    mimeType: downloadUrl ? (mediaType === "video" ? `video/${(downloadUrl.split("?")[0].split(".").pop() ?? "mp4").toLowerCase()}` : null) : null,
    sizeBytes: null,
    dateOriginal: filmingDate ?? publicationDate ?? null,
    yearsMentioned: yearsIn(title, description, filmingDate, publicationDate),
    creator: creator ?? publisher ?? null,
    credit: publisher ?? creator ?? host,
    licenseOriginal: ldLicense ?? licenseUrl ?? (domainRule && !noRip ? domainRule.text.split(" — ")[0] : null),
    licenseCode: null,
    licenseUrl,
    ...rights,
    categories: keywords.slice(0, 20),
    searchableText: searchable(title, description, keywords, creator, publisher, location),
    qualityScore: downloadUrl ? qualityScoreOf(w, h, duration, mediaType) : 0.2,
    footageFormat: "unknown",
    origin: /news|press|breaking/i.test(`${metas(html, "og:type")[0] ?? ""} ${String(article?.["@type"] ?? "")}`) ? "recent_news" : "generic",
    filmingDate,
    publicationDate,
    location,
    country,
    eventName: null,
    people: [],
    organizations: publisher ? [publisher] : [],
    rightsText,
    // Never authentic by import (§25): a person decides what it shows.
    provenance: "unknown",
    provenanceConfidence: 0,
  };
  if (!downloadUrl) asset.qualityScore = 0;
  return { asset, warnings, via: "page" };
}

/**
 * Import a URL. Provider door first, page door second.
 *
 * Refuses non-http(s) schemes, private/loopback hosts (this runs on the box
 * that holds the database — a pasted `http://postgres:5432` must not become
 * a request), and pages that answer with anything but HTML.
 */
export async function importFootageFromUrl(raw: string, opts: { signal?: AbortSignal } = {}): Promise<ImportedFootage> {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new ImportRefused("That is not a URL.");
  }
  if (!/^https?:$/.test(url.protocol)) throw new ImportRefused("Only http and https addresses can be imported.");
  if (/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.0\.0\.0|\[::1\]|web|postgres|n8n|caddy)(:|$)/i.test(url.hostname)) {
    throw new ImportRefused("That address is inside the box, not on the web.");
  }
  if (url.username || url.password) throw new ImportRefused("Addresses with embedded credentials are not imported.");

  for (const p of allProviders()) {
    if (p.matchesUrl?.(url) && p.importFromUrl) {
      // A provider that is off (no key, or opt-in and not opted in) cannot
      // answer from its catalogue — its importer would only throw about the
      // missing key. The page then goes through the generic reader below,
      // like any other page, with whatever rights it states.
      if (!p.enabled) break;
      const asset = await p.importFromUrl(url, opts);
      if (asset) return { asset, warnings: [], via: "provider" };
      break;
    }
  }

  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" },
    redirect: "follow",
    signal: opts.signal ?? AbortSignal.timeout(15_000),
  });
  if (res.status === 401 || res.status === 403) {
    throw new ImportRefused(`The page needs a login or is not public (HTTP ${res.status}) — nothing behind an access control is imported.`);
  }
  if (!res.ok) throw new ImportRefused(`The page answered HTTP ${res.status}.`);
  const ct = res.headers.get("content-type") ?? "";
  // A direct media URL: no page to read, but the file is public and named.
  if (/^(video|image)\//i.test(ct)) {
    const mediaType = ct.startsWith("video") ? "video" : "image";
    const canonical = canonicalUrl(res.url || url.toString());
    const rights = classifyLicense(null, null, null);
    return {
      asset: {
        provider: "url_import",
        providerAssetId: createHash("sha256").update(canonical).digest("hex").slice(0, 24),
        mediaType,
        title: decodeURIComponent(url.pathname.split("/").pop() ?? url.hostname),
        description: null,
        sourceUrl: canonical,
        downloadUrl: canonical,
        thumbnailUrl: mediaType === "image" ? canonical : null,
        previewUrl: null,
        width: null,
        height: null,
        durationSeconds: null,
        mimeType: ct.split(";")[0],
        sizeBytes: Number(res.headers.get("content-length")) || null,
        dateOriginal: null,
        yearsMentioned: [],
        creator: null,
        credit: url.hostname,
        licenseOriginal: null,
        licenseCode: null,
        licenseUrl: null,
        ...rights,
        categories: [],
        searchableText: searchable(url.pathname, url.hostname),
        qualityScore: 0.4,
        footageFormat: "unknown",
        origin: "generic",
        rightsText: null,
        provenance: "unknown",
        provenanceConfidence: 0,
      },
      warnings: ["A bare media file: no page to read a licence or a date from. Rights are MANUAL REVIEW."],
      via: "page",
    };
  }
  if (!/html/i.test(ct)) throw new ImportRefused(`The address is not a web page (${ct.split(";")[0] || "unknown type"}).`);
  const reader = res.body?.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  if (reader) {
    for (;;) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      chunks.push(value);
      total += value.length;
      if (total >= MAX_HTML) {
        await reader.cancel().catch(() => {});
        break;
      }
    }
  }
  const html = Buffer.concat(chunks).toString("utf8");
  return readPage(res.url || url.toString(), html);
}
