/**
 * Pexels — `api.pexels.com`, modern stock video and photographs under the
 * Pexels License: free for commercial use, no attribution required, no
 * permission needed. Generic B-roll — a city at night, a hospital corridor,
 * a border fence somewhere — never footage OF an event, which is why the
 * router asks it only for scenes that name no event (`tier: stock`).
 *
 * KEYED: `PEXELS_API_KEY` (free, pexels.com/api). Off without it. Written
 * against the documented shape (NOT verified live here — no key):
 *
 *   GET /videos/search?query=…&per_page=…&orientation=landscape   (Authorization: KEY)
 *     → { videos: [{ id, width, height, duration, url, image, user: { name, url },
 *         video_files: [{ id, quality ("hd"|"sd"|"uhd"), file_type, width, height, fps, link }],
 *         video_pictures: [{ picture }] }] }
 *   GET /v1/search?query=…&per_page=…
 *     → { photos: [{ id, width, height, url, photographer, photographer_url, alt,
 *         src: { original, large2x, large, medium, small, landscape, portrait, tiny } }] }
 *
 * The licence forbids selling unaltered copies, implying endorsement by a
 * pictured person or brand, and use of identifiable people in a bad light;
 * that text rides on every row as `rightsText`.
 */

import { searchable, stripHtml } from "@/lib/archive/text";
import { qualityScoreOf } from "@/lib/archive/text";
import { generateSearchQueries, describeHttpError } from "../request";
import { validateRights } from "../rights";
import type { FootageProvider, FootageSearchRequest, NormalizedFootageAsset, ProviderSearchOptions } from "../types";

const API = "https://api.pexels.com";
const UA = "HouseOfVideos/1.0 (https://house-of-videos.com; documentary archive research)";
const key = () => (process.env.PEXELS_API_KEY ?? "").trim();

export const PEXELS_RIGHTS =
  "Pexels License: free to use for commercial and personal purposes, no attribution required. Not permitted: selling unaltered copies, " +
  "implying endorsement by identifiable people or brands, or portraying identifiable people in a bad light.";

const STOCK_RIGHTS = {
  rightsStatus: "other_free" as const,
  commercialUse: "allowed" as const,
  modifications: "allowed" as const,
  attributionRequired: false,
  reviewStatus: "auto_approved" as const,
  reviewReason: null,
};

export interface PexelsVideo {
  id?: number | string;
  width?: number;
  height?: number;
  duration?: number;
  url?: string;
  image?: string;
  user?: { name?: string; url?: string };
  video_files?: Array<{ id?: number; quality?: string; file_type?: string; width?: number; height?: number; fps?: number; link?: string }>;
}
export interface PexelsPhoto {
  id?: number | string;
  width?: number;
  height?: number;
  url?: string;
  photographer?: string;
  photographer_url?: string;
  alt?: string;
  src?: { original?: string; large2x?: string; large?: string; medium?: string; landscape?: string };
}

/** The largest mp4 rendition that is still an HD file, never the 4K one: a scene is 1280 or 1920 wide. */
export function pickPexelsFile(files: PexelsVideo["video_files"]): NonNullable<PexelsVideo["video_files"]>[number] | null {
  const mp4 = (files ?? []).filter((f) => f.link && /mp4/i.test(f.file_type ?? "video/mp4"));
  const hd = mp4.filter((f) => (f.width ?? 0) <= 1920 && (f.height ?? 0) <= 1920);
  const pool = hd.length ? hd : mp4;
  pool.sort((a, b) => (b.width ?? 0) * (b.height ?? 0) - (a.width ?? 0) * (a.height ?? 0));
  return pool[0] ?? null;
}

export function normalizePexelsVideo(v: PexelsVideo): NormalizedFootageAsset | null {
  const id = String(v.id ?? "").trim();
  const file = pickPexelsFile(v.video_files);
  if (!id || !file?.link) return null;
  const who = stripHtml(v.user?.name);
  const title = `Stock video ${id}${who ? ` by ${who}` : ""}`;
  return {
    provider: "pexels",
    providerAssetId: `video:${id}`,
    mediaType: "video",
    title,
    description: null,
    sourceUrl: v.url ?? `https://www.pexels.com/video/${id}/`,
    downloadUrl: file.link,
    thumbnailUrl: v.image ?? null,
    previewUrl: null,
    width: file.width ?? v.width ?? null,
    height: file.height ?? v.height ?? null,
    durationSeconds: v.duration ?? null,
    mimeType: "video/mp4",
    sizeBytes: null,
    dateOriginal: null,
    yearsMentioned: [],
    creator: who,
    credit: who ? `${who} / Pexels` : "Pexels",
    licenseOriginal: "Pexels License",
    licenseCode: null,
    licenseUrl: "https://www.pexels.com/license/",
    ...STOCK_RIGHTS,
    categories: [],
    searchableText: searchable(title, who, "pexels stock video"),
    qualityScore: qualityScoreOf(file.width ?? null, file.height ?? null, v.duration ?? null, "video"),
    footageFormat: "stockshots",
    origin: "generic",
    filmingDate: null,
    publicationDate: null,
    location: null,
    country: null,
    eventName: null,
    people: [],
    organizations: [],
    rightsText: PEXELS_RIGHTS,
    provenance: "real_stock",
    provenanceConfidence: 70,
  };
}

export function normalizePexelsPhoto(p: PexelsPhoto): NormalizedFootageAsset | null {
  const id = String(p.id ?? "").trim();
  const file = p.src?.large2x ?? p.src?.original ?? p.src?.large ?? null;
  if (!id || !file) return null;
  const who = stripHtml(p.photographer);
  const title = stripHtml(p.alt) || `Stock photo ${id}${who ? ` by ${who}` : ""}`;
  return {
    provider: "pexels",
    providerAssetId: `photo:${id}`,
    mediaType: "image",
    title,
    description: null,
    sourceUrl: p.url ?? `https://www.pexels.com/photo/${id}/`,
    downloadUrl: file,
    thumbnailUrl: p.src?.medium ?? p.src?.landscape ?? file,
    previewUrl: null,
    width: p.width ?? null,
    height: p.height ?? null,
    durationSeconds: null,
    mimeType: "image/jpeg",
    sizeBytes: null,
    dateOriginal: null,
    yearsMentioned: [],
    creator: who,
    credit: who ? `${who} / Pexels` : "Pexels",
    licenseOriginal: "Pexels License",
    licenseCode: null,
    licenseUrl: "https://www.pexels.com/license/",
    ...STOCK_RIGHTS,
    categories: [],
    searchableText: searchable(title, who, "pexels stock photo"),
    qualityScore: qualityScoreOf(p.width ?? null, p.height ?? null, null, "image"),
    footageFormat: "unknown",
    origin: "generic",
    filmingDate: null,
    publicationDate: null,
    location: null,
    country: null,
    eventName: null,
    people: [],
    organizations: [],
    rightsText: PEXELS_RIGHTS,
    provenance: "real_stock",
    provenanceConfidence: 70,
  };
}

async function call(path: string, params: Record<string, string>, signal?: AbortSignal): Promise<unknown> {
  const k = key();
  if (!k) throw new Error("PEXELS_API_KEY is not set");
  const url = new URL(`${API}${path}`);
  for (const [n, v] of Object.entries(params)) url.searchParams.set(n, v);
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json", Authorization: k }, signal: signal ?? AbortSignal.timeout(20_000) });
  if (res.status === 429) throw new Error("Pexels rate limit reached");
  if (!res.ok) throw new Error(`Pexels answered HTTP ${res.status}` + (await describeHttpError(res)));
  return res.json();
}

export const pexelsProvider: FootageProvider = {
  id: "pexels",
  displayName: "Pexels",
  get enabled() {
    return Boolean(key());
  },
  get disabledReason() {
    return key() ? null : "needs PEXELS_API_KEY (free, pexels.com/api)";
  },
  priority: 50,
  tier: "stock",
  categories: ["stock"],
  searchCapabilities: { video: true, image: true, recentNews: false, historical: false, directDownload: true },

  async search(request: FootageSearchRequest, opts: ProviderSearchOptions) {
    // Stock wants a subject, not a sentence: the keywords, two queries at most.
    const queries = generateSearchQueries(request).slice(0, 2);
    const per = String(Math.min(Math.max(opts.limit, 1), 40));
    const seen = new Set<string>();
    const out: NormalizedFootageAsset[] = [];
    for (const q of queries) {
      if (request.preferredMediaType !== "image") {
        const body = (await call("/videos/search", { query: q, per_page: per, orientation: "landscape" }, opts.signal)) as { videos?: PexelsVideo[] };
        for (const v of body.videos ?? []) {
          const a = normalizePexelsVideo(v);
          if (a && !seen.has(a.providerAssetId)) {
            seen.add(a.providerAssetId);
            out.push(a);
          }
        }
      }
      const body = (await call("/v1/search", { query: q, per_page: per, orientation: "landscape" }, opts.signal)) as { photos?: PexelsPhoto[] };
      for (const p of body.photos ?? []) {
        const a = normalizePexelsPhoto(p);
        if (a && !seen.has(a.providerAssetId)) {
          seen.add(a.providerAssetId);
          out.push(a);
        }
      }
    }
    return out;
  },

  async getAssetDetails(id, opts) {
    const [kind, n] = id.split(":");
    if (kind === "video") return normalizePexelsVideo((await call(`/videos/videos/${encodeURIComponent(n)}`, {}, opts?.signal)) as PexelsVideo);
    return normalizePexelsPhoto((await call(`/v1/photos/${encodeURIComponent(n)}`, {}, opts?.signal)) as PexelsPhoto);
  },

  async checkRights(asset) {
    return validateRights(asset);
  },

  matchesUrl(url) {
    return /(^|\.)pexels\.com$/i.test(url.hostname) && /^\/(video|photo)\//.test(url.pathname);
  },

  async importFromUrl(url, opts) {
    const m = /^\/(video|photo)\/(?:[^/]*-)?(\d+)\/?$/.exec(url.pathname);
    return m ? this.getAssetDetails!(`${m[1]}:${m[2]}`, opts) : null;
  },
};
