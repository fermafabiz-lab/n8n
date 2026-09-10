/**
 * NASA Image and Video Library — `images-api.nasa.gov`, keyless.
 *
 * Documented and stable: `GET /search?q=…&media_type=video,image` answers a
 * `collection.items[]` where each item carries `data[0]` (nasa_id, title,
 * description, date_created, keywords, center, media_type, photographer or
 * secondary_creator, location) and `links[]` (a `preview` thumbnail); the
 * files themselves are one call further, `GET /asset/{nasa_id}`, which lists
 * every rendition (`~orig.mp4`, `~medium.mp4`, `~orig.jpg`…). The search is
 * paged at 100 and rate-limited; the engine asks for a page per query and
 * never walks further.
 *
 * Rights. NASA's own guidance: its material is generally not copyrighted and
 * may be used with a credit line, EXCEPT where the description or credit
 * names a third party, and except logos and identifiable people in some
 * uses. So every asset starts as public domain with credit ("NASA" plus the
 * photographer or center), and the central validator's third-party test
 * downgrades anything whose text says "courtesy of", "©" or a named agency
 * to manual review. The original text is kept on the row as the evidence.
 */

import { classifyLicense } from "@/lib/archive/rights";
import { qualityScoreOf, searchable, stripHtml, yearsIn } from "@/lib/archive/text";
import { generateSearchQueries, describeHttpError } from "../request";
import { validateRights } from "../rights";
import type { FootageProvider, FootageSearchRequest, NormalizedFootageAsset, ProviderSearchOptions } from "../types";

const API = "https://images-api.nasa.gov";
const UA = "HouseOfVideos/1.0 (https://house-of-videos.com; documentary archive research)";

interface NasaData {
  nasa_id?: string;
  title?: string;
  description?: string;
  date_created?: string;
  keywords?: string[];
  center?: string;
  media_type?: string;
  photographer?: string;
  secondary_creator?: string;
  location?: string;
  album?: string[];
}
interface NasaItem {
  href?: string;
  data?: NasaData[];
  links?: Array<{ href?: string; rel?: string; render?: string }>;
}

const RIGHTS_TEXT =
  "NASA content is generally not copyrighted and may be used for educational or informational purposes without explicit permission; " +
  "credit NASA. Material credited to a third party, NASA logos/insignia, and identifiable persons may require separate permission.";

export function normalizeNasaItem(item: NasaItem, fileUrl?: string | null): NormalizedFootageAsset | null {
  const d = item.data?.[0];
  if (!d?.nasa_id || !d.title) return null;
  const mediaType = d.media_type === "video" ? "video" : d.media_type === "image" ? "image" : null;
  if (!mediaType) return null;
  const preview = item.links?.find((l) => l.rel === "preview")?.href ?? null;
  const description = stripHtml(d.description);
  const creatorRaw = d.photographer ?? d.secondary_creator ?? null;
  const creator = creatorRaw ? stripHtml(creatorRaw) : null;
  const credit = creator ? `NASA/${creator}` : d.center ? `NASA/${d.center}` : "NASA";
  const sourceUrl = `https://images.nasa.gov/details/${encodeURIComponent(d.nasa_id)}`;
  const rights = classifyLicense("pd", "Public domain (NASA)", true);
  const date = d.date_created ?? null;
  const keywords = (d.keywords ?? []).map((k) => String(k)).filter(Boolean);
  const orgs = ["NASA", ...(d.center ? [d.center] : [])];
  return {
    provider: "nasa",
    providerAssetId: d.nasa_id,
    mediaType,
    title: stripHtml(d.title) ?? d.title,
    description,
    sourceUrl,
    // The rendition list needs a second call; until then the preview is the
    // only URL we hold, and `resolveDownload` fetches the manifest at use time.
    downloadUrl: fileUrl ?? preview ?? sourceUrl,
    thumbnailUrl: preview,
    previewUrl: preview,
    width: null,
    height: null,
    durationSeconds: null,
    mimeType: null,
    sizeBytes: null,
    dateOriginal: date,
    yearsMentioned: yearsIn(d.title, description, date),
    creator,
    credit,
    licenseOriginal: "Public domain (NASA)",
    licenseCode: "pd",
    licenseUrl: "https://www.nasa.gov/nasa-brand-center/images-and-media/",
    ...rights,
    categories: keywords,
    searchableText: searchable(d.title, description, keywords, creator, d.center),
    qualityScore: mediaType === "video" ? 0.7 : 0.6,
    footageFormat: mediaType === "video" ? "broll" : "unknown",
    origin: "official_media",
    filmingDate: date,
    publicationDate: date,
    location: d.location ?? null,
    country: null,
    eventName: null,
    people: [],
    organizations: orgs,
    rightsText: RIGHTS_TEXT,
    provenance: mediaType === "video" ? "archival_footage" : "archival_photo",
    provenanceConfidence: 80,
  };
}

async function searchOne(q: string, mediaType: "video" | "image" | "any", limit: number, signal?: AbortSignal) {
  const url = new URL(`${API}/search`);
  url.searchParams.set("q", q);
  url.searchParams.set("media_type", mediaType === "any" ? "video,image" : mediaType);
  url.searchParams.set("page_size", String(Math.min(Math.max(limit, 1), 100)));
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: signal ?? AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`NASA answered HTTP ${res.status}` + (await describeHttpError(res)));
  const body = (await res.json()) as { collection?: { items?: NasaItem[] } };
  return (body.collection?.items ?? []).map((it) => normalizeNasaItem(it)).filter((a): a is NormalizedFootageAsset => a !== null);
}

/** The best rendition from an asset manifest: largest mp4 for video, original for images. */
export function pickRendition(hrefs: string[], mediaType: "video" | "image"): string | null {
  const list = hrefs.map((h) => h.replace(/^http:/, "https:"));
  if (mediaType === "video") {
    return list.find((h) => /~orig\.mp4$/i.test(h)) ?? list.find((h) => /~large\.mp4$/i.test(h)) ?? list.find((h) => /~medium\.mp4$/i.test(h)) ?? list.find((h) => /\.mp4$/i.test(h)) ?? null;
  }
  return list.find((h) => /~orig\.(jpe?g|png|tiff?)$/i.test(h)) ?? list.find((h) => /~large\.(jpe?g|png)$/i.test(h)) ?? list.find((h) => /\.(jpe?g|png)$/i.test(h)) ?? null;
}

async function manifest(id: string, signal?: AbortSignal): Promise<string[]> {
  const res = await fetch(`${API}/asset/${encodeURIComponent(id)}`, { headers: { "User-Agent": UA }, signal: signal ?? AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`NASA asset manifest answered HTTP ${res.status}` + (await describeHttpError(res)));
  const body = (await res.json()) as { collection?: { items?: Array<{ href?: string }> } };
  return (body.collection?.items ?? []).map((i) => i.href).filter((h): h is string => Boolean(h));
}

export const nasaProvider: FootageProvider = {
  id: "nasa",
  displayName: "NASA",
  enabled: true,
  disabledReason: null,
  priority: 90,
  tier: "official",
  categories: ["space", "science", "technology", "earth", "missions", "aviation"],
  searchCapabilities: { video: true, image: true, recentNews: true, historical: true, directDownload: true },

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
    const url = new URL(`${API}/search`);
    url.searchParams.set("nasa_id", id);
    const res = await fetch(url, { headers: { "User-Agent": UA }, signal: opts?.signal ?? AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`NASA answered HTTP ${res.status}` + (await describeHttpError(res)));
    const body = (await res.json()) as { collection?: { items?: NasaItem[] } };
    const item = body.collection?.items?.find((it) => it.data?.[0]?.nasa_id === id) ?? body.collection?.items?.[0];
    if (!item) return null;
    const a = normalizeNasaItem(item);
    if (!a) return null;
    const files = await manifest(id, opts?.signal).catch(() => []);
    const best = pickRendition(files, a.mediaType);
    return best ? { ...a, downloadUrl: best } : a;
  },

  async checkRights(asset) {
    return validateRights(asset);
  },

  async resolveDownload(asset) {
    const files = await manifest(asset.providerAssetId);
    const best = pickRendition(files, asset.mediaType);
    if (!best) throw new Error("NASA lists no downloadable rendition for this asset");
    return { url: best, mimeType: asset.mediaType === "video" ? "video/mp4" : "image/jpeg", seekable: true };
  },

  matchesUrl(url) {
    return /(^|\.)images\.nasa\.gov$/i.test(url.hostname) && /^\/details\//.test(url.pathname);
  },

  async importFromUrl(url, opts) {
    const id = decodeURIComponent(url.pathname.replace(/^\/details\//, "").replace(/\/+$/, ""));
    return id ? this.getAssetDetails!(id, opts) : null;
  },
};
