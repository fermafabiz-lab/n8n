/**
 * Internet Archive — `archive.org`, keyless. The largest open moving-image
 * archive there is: Universal Newsreels (1929–1967, donated to the public
 * domain), the Prelinger Archives (industrial, educational and amateur film),
 * FedFlix / US government films, NASA, and a vast community upload area.
 *
 * Read off real responses (execution 11839/11840, 2026-09-10):
 *
 *   GET /advancedsearch.php?q=…&fl[]=identifier&fl[]=title…&rows=…&output=json
 *     → { response: { numFound, docs: [{ identifier, title, description, date
 *         ("1961-08-14T00:00:00Z"), year, creator, collection[], subject[],
 *         mediatype ("movies" | "image"), licenseurl?, downloads, item_size }] } }
 *   GET /metadata/{identifier}
 *     → { metadata: {…same fields…}, files: [{ name, format ("h.264", "MPEG4",
 *         "512Kb MPEG4", "Thumbnail", "JPEG"…), size, width, height, length,
 *         source ("original" | "derivative") }], server, dir }
 *   files download from  https://archive.org/download/{identifier}/{name}
 *   thumbnail            https://archive.org/services/img/{identifier}
 *
 * The trap, measured on the first query: "moon landing" answered a YouTube
 * mirror from the `altcensored` / `fringe` / `deemphasize` collections — a
 * hoax video with no licence, uploaded by nobody in particular. The community
 * area is unlicensed by default, so this adapter never searches it blind: an
 * item is asked for only when it sits in a collection whose POLICY is public
 * domain (`PD_COLLECTIONS`) or carries a `licenseurl` of its own, and the
 * collections the Archive itself flags are excluded outright. The same
 * "berlin wall" query, so filtered, answered a 1961 US Army film of the
 * Brandenburg Gate under a public-domain mark — and a 2025 concert clip under
 * CC BY-NC-ND, which the central classifier refuses.
 */

import { classifyLicense } from "@/lib/archive/rights";
import { searchable, stripHtml, yearsIn } from "@/lib/archive/text";
import { generateSearchQueries } from "../request";
import { validateRights } from "../rights";
import type { FootageFormat, FootageProvider, FootageSearchRequest, NormalizedFootageAsset, ProviderSearchOptions } from "../types";

const SITE = "https://archive.org";
const UA = "HouseOfVideos/1.0 (https://house-of-videos.com; documentary archive research)";

/** Collections whose stated policy is public domain. Case matters: Solr string fields. */
export const PD_COLLECTIONS: readonly string[] = ["prelinger", "universal_newsreels", "FedFlix", "usgovfilms", "nasa"];
/** Collections the Archive itself marks as fringe or de-emphasised. Never searched. */
const EXCLUDED_COLLECTIONS: readonly string[] = ["altcensored", "fringe", "deemphasize"];
/** A creator that is an institution, whose licence statement stands on its own. */
const INSTITUTIONAL =
  /\b(united states|u\.s\.|army|navy|air force|marine corps|national guard|archives|library|museum|university|government|ministry|department|bundesarchiv|nasa|noaa|usgs|pathe|newsreel)\b/i;

export interface IaDoc {
  identifier?: string;
  title?: string | string[];
  description?: string | string[];
  date?: string | string[];
  year?: number | string;
  creator?: string | string[];
  collection?: string | string[];
  subject?: string | string[];
  mediatype?: string;
  licenseurl?: string | string[];
  rights?: string | string[];
  downloads?: number;
  item_size?: number;
  publicdate?: string;
}

export interface IaFile {
  name?: string;
  format?: string;
  size?: string | number;
  width?: string | number | null;
  height?: string | number | null;
  length?: string | number | null;
  source?: string;
}

const first = (v: string | string[] | undefined | null): string | null => {
  if (Array.isArray(v)) return v.length ? String(v[0]) : null;
  return v === undefined || v === null ? null : String(v);
};
const list = (v: string | string[] | undefined | null): string[] => (Array.isArray(v) ? v.map(String) : v ? [String(v)] : []);
const num = (v: string | number | null | undefined): number | null => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** Solr special characters, escaped so a query is words and never syntax. */
export function solrEscape(s: string): string {
  return s.replace(/[+\-&|!(){}[\]^"~*?:\\/]/g, " ").replace(/\s+/g, " ").trim();
}

const formatFor = (title: string, collections: string[]): FootageFormat => {
  if (/newsreel/i.test(title) || collections.includes("universal_newsreels")) return "news_package";
  if (collections.some((c) => c === "prelinger" || c === "FedFlix" || c === "usgovfilms")) return "documentary";
  return "broll";
};

export function normalizeIaDoc(d: IaDoc): NormalizedFootageAsset | null {
  const id = String(d.identifier ?? "").trim();
  const title = stripHtml(first(d.title));
  if (!id || !title) return null;
  const mediaType = d.mediatype === "movies" ? "video" : d.mediatype === "image" ? "image" : null;
  if (!mediaType) return null;
  const collections = list(d.collection).filter((c) => !/^fav-/.test(c));
  if (collections.some((c) => EXCLUDED_COLLECTIONS.includes(c))) return null;
  const description = stripHtml(list(d.description).join(" ")) || null;
  const creator = stripHtml(first(d.creator));
  const licenseUrl = first(d.licenseurl);
  const pdCollection = collections.find((c) => PD_COLLECTIONS.includes(c)) ?? null;
  const rightsStated = stripHtml(list(d.rights).join(" ")) || null;
  const institutional = INSTITUTIONAL.test(creator ?? "");
  let rights = licenseUrl
    ? classifyLicense(null, licenseUrl, null)
    : pdCollection
      ? classifyLicense("pd", `Public domain (Internet Archive collection "${pdCollection}")`, false)
      : classifyLicense(null, rightsStated, null);
  // A licence on a community upload is the UPLOADER's claim — measured:
  // game screenshots under a public-domain mark, a TV programme mirrored
  // with none. Outside the curated collections and without an institution
  // as creator, the class is kept (NC/ND still refuse) but a person decides.
  if (licenseUrl && !pdCollection && !institutional && rights.reviewStatus === "auto_approved") {
    rights = { ...rights, reviewStatus: "manual_review", reviewReason: "Licence declared by the uploader, not by an institution — check the item before use." };
  }
  const dateRaw = first(d.date);
  const date = dateRaw ? dateRaw.slice(0, 10) : d.year ? String(d.year) : null;
  const years = yearsIn(title, description, date);
  const latest = years.length ? years[years.length - 1] : null;
  const subjects = list(d.subject).flatMap((s) => s.split(";")).map((s) => s.trim()).filter(Boolean);
  return {
    provider: "internet_archive",
    providerAssetId: id,
    mediaType,
    title,
    description,
    sourceUrl: `${SITE}/details/${encodeURIComponent(id)}`,
    // The item, not a file: `resolveDownload` reads the file list at use time.
    downloadUrl: `${SITE}/download/${encodeURIComponent(id)}`,
    thumbnailUrl: `${SITE}/services/img/${encodeURIComponent(id)}`,
    previewUrl: null,
    width: null,
    height: null,
    durationSeconds: null,
    mimeType: null,
    sizeBytes: null,
    dateOriginal: dateRaw,
    yearsMentioned: years,
    creator,
    credit: creator ?? "Internet Archive",
    licenseOriginal: licenseUrl ?? (pdCollection ? `Public domain (${pdCollection})` : rightsStated),
    licenseCode: pdCollection && !licenseUrl ? "pd" : null,
    licenseUrl,
    ...rights,
    categories: [...subjects, ...collections].slice(0, 20),
    searchableText: searchable(title, description, subjects, creator, collections),
    qualityScore: mediaType === "video" ? 0.55 : 0.5,
    footageFormat: mediaType === "video" ? formatFor(title, collections) : "unknown",
    origin: latest !== null && latest < 1995 ? "historical" : "generic",
    filmingDate: date,
    publicationDate: d.publicdate ? String(d.publicdate).slice(0, 10) : null,
    location: null,
    country: null,
    eventName: null,
    people: [],
    organizations: [],
    rightsText: [licenseUrl ? `Licence: ${licenseUrl}` : null, pdCollection ? `Collection "${pdCollection}" (public domain policy)` : null, rightsStated].filter(Boolean).join(" · ") || null,
    provenance: mediaType === "video" ? "archival_footage" : "archival_photo",
    provenanceConfidence: pdCollection || licenseUrl ? 75 : 60,
  };
}

const VIDEO_FORMATS = ["h.264", "MPEG4", "512Kb MPEG4", "HiRes MPEG4", "h.264 HD", "Ogg Video"];
const IMAGE_FORMATS = ["JPEG", "PNG", "TIFF", "JPEG Thumb"];

/** The best file for the media type: the preferred format, largest first. */
export function pickIaFile(files: IaFile[], mediaType: "video" | "image"): IaFile | null {
  const order = mediaType === "video" ? VIDEO_FORMATS : IMAGE_FORMATS;
  const usable = files.filter((f) => f.name && f.format && order.includes(f.format));
  usable.sort((a, b) => {
    const ra = order.indexOf(a.format!);
    const rb = order.indexOf(b.format!);
    if (ra !== rb) return ra - rb;
    return Number(b.size ?? 0) - Number(a.size ?? 0);
  });
  return usable[0] ?? null;
}

export function iaFileUrl(id: string, name: string): string {
  return `${SITE}/download/${encodeURIComponent(id)}/${name.split("/").map(encodeURIComponent).join("/")}`;
}

async function getJson(url: URL | string, signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: signal ?? AbortSignal.timeout(20_000) });
  if (res.status === 429) throw new Error("Internet Archive rate limit reached");
  if (!res.ok) throw new Error(`Internet Archive answered HTTP ${res.status}`);
  return res.json();
}

const FIELDS = ["identifier", "title", "description", "date", "year", "creator", "collection", "subject", "mediatype", "licenseurl", "rights", "downloads", "item_size", "publicdate"];

/**
 * The Solr query. Film may come from a public-domain collection OR carry a
 * licence of its own; still images only from the public-domain collections
 * — measured, the community image area's self-declared licences are game
 * screenshots and cartoons, and nothing a documentary wants.
 */
export function iaQuery(q: string, mediaType: "video" | "image" | "any"): string {
  const pd = PD_COLLECTIONS.join(" OR ");
  const excluded = EXCLUDED_COLLECTIONS.join(" OR ");
  const film = `(mediatype:movies AND (collection:(${pd}) OR licenseurl:[* TO *]))`;
  const still = `(mediatype:image AND collection:(${pd}))`;
  const media = mediaType === "video" ? film : mediaType === "image" ? still : `(${film} OR ${still})`;
  return `(${solrEscape(q)}) AND ${media} AND NOT collection:(${excluded}) AND NOT identifier:youtube*`;
}

async function searchOne(q: string, mediaType: "video" | "image" | "any", limit: number, signal?: AbortSignal): Promise<NormalizedFootageAsset[]> {
  const url = new URL(`${SITE}/advancedsearch.php`);
  url.searchParams.set("q", iaQuery(q, mediaType));
  for (const f of FIELDS) url.searchParams.append("fl[]", f);
  url.searchParams.set("rows", String(Math.min(Math.max(limit, 1), 50)));
  url.searchParams.set("output", "json");
  const body = (await getJson(url, signal)) as { response?: { docs?: IaDoc[] } };
  return (body.response?.docs ?? []).map(normalizeIaDoc).filter((a): a is NormalizedFootageAsset => a !== null);
}

async function metadata(id: string, signal?: AbortSignal): Promise<{ metadata?: IaDoc; files?: IaFile[] }> {
  return (await getJson(`${SITE}/metadata/${encodeURIComponent(id)}`, signal)) as { metadata?: IaDoc; files?: IaFile[] };
}

/** An asset with its file resolved from the item's file list. */
function withFile(a: NormalizedFootageAsset, files: IaFile[]): NormalizedFootageAsset {
  const f = pickIaFile(files, a.mediaType);
  if (!f?.name) return a;
  return {
    ...a,
    downloadUrl: iaFileUrl(a.providerAssetId, f.name),
    width: num(f.width),
    height: num(f.height),
    durationSeconds: a.mediaType === "video" ? num(f.length) : null,
    sizeBytes: num(f.size),
    mimeType: a.mediaType === "video" ? (/ogg/i.test(f.format ?? "") ? "video/ogg" : "video/mp4") : /png/i.test(f.format ?? "") ? "image/png" : /tif/i.test(f.format ?? "") ? "image/tiff" : "image/jpeg",
  };
}

export const internetArchiveProvider: FootageProvider = {
  id: "internet_archive",
  displayName: "Internet Archive",
  enabled: true,
  disabledReason: null,
  priority: 85,
  tier: "archive",
  categories: ["general", "history", "war", "politics", "events", "places", "people", "science", "technology", "aviation", "space"],
  searchCapabilities: { video: true, image: true, recentNews: false, historical: true, directDownload: true },

  async search(request: FootageSearchRequest, opts: ProviderSearchOptions) {
    const queries = generateSearchQueries(request).slice(0, 3);
    const seen = new Set<string>();
    const out: NormalizedFootageAsset[] = [];
    for (const q of queries) {
      const hits = await searchOne(q, request.preferredMediaType === "image" ? "image" : "any", opts.limit, opts.signal);
      for (const h of hits) {
        if (seen.has(h.providerAssetId)) continue;
        seen.add(h.providerAssetId);
        out.push(h);
      }
    }
    return out;
  },

  async getAssetDetails(id, opts) {
    const m = await metadata(id, opts?.signal);
    if (!m.metadata) return null;
    const a = normalizeIaDoc({ ...m.metadata, identifier: m.metadata.identifier ?? id });
    return a ? withFile(a, m.files ?? []) : null;
  },

  async checkRights(asset) {
    return validateRights(asset);
  },

  async resolveDownload(asset) {
    const m = await metadata(asset.providerAssetId);
    const f = pickIaFile(m.files ?? [], asset.mediaType);
    if (!f?.name) throw new Error("Internet Archive lists no usable file for this item");
    const resolved = withFile(asset, m.files ?? []);
    return { url: iaFileUrl(asset.providerAssetId, f.name), mimeType: resolved.mimeType, seekable: true };
  },

  matchesUrl(url) {
    return /(^|\.)archive\.org$/i.test(url.hostname) && /^\/details\/[^/]+/.test(url.pathname);
  },

  async importFromUrl(url, opts) {
    const m = /^\/details\/([^/?#]+)/.exec(url.pathname);
    return m ? this.getAssetDetails!(decodeURIComponent(m[1]), opts) : null;
  },
};
