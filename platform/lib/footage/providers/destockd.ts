/**
 * Destockd — https://destockd.com, an independent project by Elroddd.
 *
 * It is not a stock library of its own. It takes the **FedFlix** collection
 * on the Internet Archive — the U.S. government films Public.Resource.Org
 * digitised with the NTIS — cuts every film into individual SHOTS, and
 * indexes each shot with CLIP so a search reads the picture instead of the
 * title. Its own About page: *"A single archival file might contain twenty
 * or thirty minutes of footage with no easy way to know what is inside."*
 * 41,000+ shots at the time of writing, free, no account, no watermark, and
 * no attribution required by Destockd itself.
 *
 * **This provider never searches Destockd, and that is deliberate.** Every
 * data endpoint the site has lives under `/api/`, and its robots.txt says:
 *
 *     User-agent: *
 *     Allow: /
 *     Disallow: /api/
 *
 * Read on 2026-09-14. Whatever the intent (keeping crawlers out of JSON is
 * the common reason), it is the operator's stated instruction to automated
 * clients about exactly the endpoints an adapter would call, and this engine
 * does not argue with a stated policy — the same rule that keeps URL import
 * away from logins, paywalls and signed URLs. Asking is cheap and the
 * address is published (contact@destockd.com); until someone has asked, the
 * router must not route this provider, so it carries `localOnly`.
 *
 * What it DOES do is turn a producer's own browsing into a usable asset,
 * through the two doors that already exist:
 *
 *   1. **A clip file** — the address behind "Download clip", or the file
 *      itself dropped into Upload. Filed under `destockd`, with the FedFlix
 *      rights basis and the site's own disclaimer attached.
 *   2. **A shot or film page** — `https://www.destockd.com/#/shot/<film>/<shot>`.
 *      The identity of a Destockd page lives after the `#`, which a browser
 *      never sends to a server, so there is no page to read: the fragment is
 *      parsed here instead. The film is then looked up in FedFlix ON THE
 *      INTERNET ARCHIVE, which this engine already searches, and the
 *      Archive's own item comes back — correct identity, correct rights,
 *      and a file our render can fetch. The producer trims the shot they saw
 *      with the start/length controls the picker already has.
 *
 * So a Destockd browse becomes archive.org material without one request to
 * a disallowed path.
 */

import { classifyLicense } from "@/lib/archive/rights";
import { qualityScoreOf, searchable } from "@/lib/archive/text";
import { createHash } from "node:crypto";
import { searchStockLibrary } from "@/lib/data/stock";
import { generateSearchQueries } from "../request";
import { validateRights } from "../rights";
import { internetArchiveProvider } from "./internetArchive";
import type { FootageProvider, FootageSearchRequest, NormalizedFootageAsset, ProviderSearchOptions } from "../types";

const UA = "HouseOfVideos/1.0 (https://house-of-videos.com; documentary archive research)";
const IA = "https://archive.org";

/**
 * Destockd's own rights basis, quoted rather than paraphrased — it is what
 * the card shows and what a producer accepts when they press Use.
 */
export const DESTOCKD_RIGHTS_TEXT =
  "Sourced from the FedFlix collection (Public.Resource.Org / NTIS) on the Internet Archive. " +
  "Destockd believes all hosted footage to be in the public domain in the United States or otherwise " +
  "unrestricted for reuse based on its FedFlix/government-production origin, and requires no attribution " +
  "of its own. It has NOT independently verified individual clips or embedded elements: public-domain " +
  "status does not clear music, third-party footage, or model, property, trademark or publicity rights. " +
  "Verify the source film before commercial use.";

const DESTOCKD_REVIEW_REASON =
  "Destockd states a collection-wide public-domain basis, not a licence for this clip — its own disclaimer " +
  "puts verification on the user. Check the source film on archive.org before rendering.";

export const isDestockdHost = (url: URL): boolean => /(^|\.)destockd\.com$/i.test(url.hostname);

const MEDIA_EXT = /\.(mp4|webm|mov|m4v|jpg|jpeg|png|webp)$/i;

/** `Film Title - shot_0042.mp4` is how the site names a download. */
export function splitClipFilename(name: string): { film: string; shot: string | null } {
  const base = decodeURIComponent(name).replace(MEDIA_EXT, "").trim();
  const m = /^(.*\S)\s+-\s+(\S.*)$/.exec(base);
  return m ? { film: m[1].trim(), shot: m[2].trim() } : { film: base, shot: null };
}

/**
 * `#/shot/<film>/<shot>`, `#/film/<film>`, `#/similar/<film>/<shot>`.
 *
 * The hash is the whole address here. `new URL()` keeps it in `.hash`, which
 * is the only reason this is recoverable at all — it never reached the
 * server, so nothing could have been read from the page.
 */
export function parseDestockdHash(url: URL): { film: string; shot: string | null } | null {
  const parts = url.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  if (!parts.length) return null;
  const kind = parts[0].toLowerCase();
  if ((kind === "shot" || kind === "similar") && parts.length >= 3) {
    return { film: decodeURIComponent(parts[1]), shot: decodeURIComponent(parts[2]) };
  }
  if (kind === "film" && parts.length >= 2) return { film: decodeURIComponent(parts[1]), shot: null };
  return null;
}

/** Solr wants its quotes and backslashes escaped; a film title is full of both. */
const escapeSolr = (s: string): string => s.replace(/([\\"])/g, "\\$1");

/**
 * Find the FedFlix item a Destockd film came from.
 *
 * Restricted to `collection:FedFlix` on purpose: Destockd says in as many
 * words that every clip it holds comes from there, so a title that matches
 * something else is a different film with the same name, not a better hit.
 */
export async function findFedflixItem(film: string, signal?: AbortSignal): Promise<string | null> {
  const url = new URL(`${IA}/advancedsearch.php`);
  url.searchParams.set("q", `collection:FedFlix AND title:("${escapeSolr(film)}")`);
  url.searchParams.append("fl[]", "identifier");
  url.searchParams.append("fl[]", "title");
  url.searchParams.set("rows", "5");
  url.searchParams.set("output", "json");
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal: signal ?? AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Internet Archive answered HTTP ${res.status} while resolving the Destockd film`);
  const body = (await res.json()) as { response?: { docs?: Array<{ identifier?: string; title?: string }> } };
  const docs = (body.response?.docs ?? []).filter((d) => d.identifier);
  if (!docs.length) return null;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const exact = docs.find((d) => norm(String(d.title ?? "")) === norm(film));
  return String((exact ?? docs[0]).identifier);
}

/** A clip served by Destockd itself. */
export function normalizeDestockdClip(
  fileUrl: string,
  opts: { mimeType?: string | null; sizeBytes?: number | null } = {},
): NormalizedFootageAsset {
  const u = new URL(fileUrl);
  const name = u.pathname.split("/").pop() ?? "clip.mp4";
  const { film, shot } = splitClipFilename(name);
  const mediaType: "video" | "image" = /\.(jpg|jpeg|png|webp)$/i.test(name) ? "image" : "video";
  const rights = classifyLicense("pd", DESTOCKD_RIGHTS_TEXT, false);
  const title = shot ? `${film} — ${shot}` : film;
  return {
    provider: "destockd",
    providerAssetId: createHash("sha256").update(u.toString()).digest("hex").slice(0, 24),
    mediaType,
    title,
    description: shot ? `Shot ${shot} of the FedFlix film "${film}", cut by Destockd.` : null,
    sourceUrl: u.toString(),
    downloadUrl: u.toString(),
    thumbnailUrl: mediaType === "image" ? u.toString() : null,
    previewUrl: null,
    width: null,
    height: null,
    durationSeconds: null,
    mimeType: opts.mimeType ?? (mediaType === "video" ? "video/mp4" : "image/jpeg"),
    sizeBytes: opts.sizeBytes ?? null,
    // The catalogue date would be the day Destockd cut the shot, never the
    // day the film was shot. Absent beats wrong: the matcher treats an
    // unknown date as unknown and a wrong one as a mismatch.
    dateOriginal: null,
    yearsMentioned: [],
    creator: null,
    credit: "FedFlix / Public.Resource.Org, via Destockd",
    licenseOriginal: "Public domain / unrestricted (FedFlix)",
    licenseCode: "pd",
    licenseUrl: "https://archive.org/details/FedFlix",
    ...rights,
    // A site-wide policy is never auto-cleared — the same rule URL import
    // applies to a domain default. One press of "Use — I accept the rights"
    // is the producer taking that decision, and it is recorded.
    reviewStatus: "manual_review" as const,
    reviewReason: DESTOCKD_REVIEW_REASON,
    categories: ["fedflix", "archival", "public domain"],
    searchableText: searchable(title, film, shot, "FedFlix archival government film"),
    qualityScore: qualityScoreOf(null, null, null, mediaType),
    footageFormat: mediaType === "video" ? "documentary" : "unknown",
    origin: "historical",
    filmingDate: null,
    publicationDate: null,
    location: null,
    country: null,
    eventName: null,
    people: [],
    organizations: [],
    rightsText: DESTOCKD_RIGHTS_TEXT,
    provenance: mediaType === "video" ? "archival_footage" : "archival_photo",
    // Below ACTUAL_FOOTAGE_MIN_CONFIDENCE by construction: a filename is not
    // evidence of what the picture shows.
    provenanceConfidence: 70,
  };
}

export const destockdProvider: FootageProvider = {
  id: "destockd",
  displayName: "Destockd",
  enabled: true,
  disabledReason: null,
  notice: "not searched — its data endpoints are Disallow: /api/ in robots.txt; paste a clip or a shot page instead",
  priority: 60,
  tier: "library",
  categories: ["general", "history", "events", "places", "people", "war", "science", "technology", "aviation", "space"],
  searchCapabilities: { video: true, image: true, recentNews: false, historical: true, directDownload: true, localOnly: true },

  /** The library rows a producer has already brought in, nothing else. */
  async search(request: FootageSearchRequest, opts: ProviderSearchOptions) {
    const out: NormalizedFootageAsset[] = [];
    const seen = new Set<string>();
    for (const q of generateSearchQueries(request).slice(0, 3)) {
      const rows = await searchStockLibrary(q, { mediaType: "any", limit: opts.limit, provider: "destockd" });
      for (const r of rows) {
        if (seen.has(r.providerAssetId)) continue;
        seen.add(r.providerAssetId);
        out.push(r);
      }
    }
    return out;
  },

  async checkRights(asset) {
    return validateRights(asset);
  },

  matchesUrl(url) {
    return isDestockdHost(url);
  },

  async importFromUrl(url, opts) {
    // A clip, a keyframe or a preview: the file is the asset.
    if (MEDIA_EXT.test(url.pathname)) {
      const res = await fetch(url, {
        method: "GET",
        headers: { "User-Agent": UA, Range: "bytes=0-0" },
        signal: opts?.signal ?? AbortSignal.timeout(15_000),
      });
      if (res.status === 401 || res.status === 403) {
        throw new Error(`Destockd answered HTTP ${res.status} for that file — nothing behind an access control is imported.`);
      }
      if (!res.ok && res.status !== 206) throw new Error(`Destockd answered HTTP ${res.status} for that file.`);
      const range = res.headers.get("content-range");
      const total = range ? Number(range.split("/").pop()) : Number(res.headers.get("content-length"));
      return normalizeDestockdClip(res.url || url.toString(), {
        mimeType: (res.headers.get("content-type") ?? "").split(";")[0] || null,
        sizeBytes: Number.isFinite(total) && total > 1 ? total : null,
      });
    }

    // A page. Its identity is in the fragment, and the film is on archive.org.
    const hash = parseDestockdHash(url);
    if (!hash) return null;
    const identifier = await findFedflixItem(hash.film, opts?.signal);
    if (!identifier) return null;
    const asset = await internetArchiveProvider.getAssetDetails!(identifier, opts);
    if (!asset) return null;
    // The Archive's own item, said out loud: the producer pasted a shot and
    // gets the film it was cut from, which is the thing we can legitimately
    // fetch and the thing the watermark can name.
    const note = hash.shot
      ? `Found from Destockd shot "${hash.shot}" of "${hash.film}". Destockd cuts FedFlix films into shots; this is the full film on the Internet Archive — set the start and length to the shot you saw.`
      : `Found from the Destockd film page for "${hash.film}".`;
    return {
      ...asset,
      description: [asset.description, note].filter(Boolean).join("\n\n"),
      searchableText: searchable(asset.searchableText, hash.film, hash.shot),
    };
  },
};
