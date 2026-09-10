/**
 * Pixabay — `pixabay.com/api`, stock video and photographs under the
 * Pixabay Content License: free for commercial use, no attribution
 * required. Generic B-roll, like Pexels, and routed the same way (`tier:
 * stock` — only for scenes that name no event).
 *
 * KEYED: `PIXABAY_API_KEY` (free, pixabay.com/api/docs). Off without it.
 * Written against the documented shape (NOT verified live here — no key):
 *
 *   GET /api/videos/?key=…&q=…&per_page=…&safesearch=true
 *     → { hits: [{ id, pageURL, type, tags, duration, user, user_id,
 *         videos: { large: { url, width, height, size, thumbnail }, medium, small, tiny } }] }
 *   GET /api/?key=…&q=…&per_page=…&safesearch=true&image_type=photo
 *     → { hits: [{ id, pageURL, type, tags, previewURL, webformatURL, largeImageURL,
 *         imageWidth, imageHeight, imageSize, user, user_id }] }
 *
 * Pixabay's licence forbids redistributing the content as stock and selling
 * unaltered copies; that text rides on every row.
 */

import { qualityScoreOf, searchable, stripHtml } from "@/lib/archive/text";
import { generateSearchQueries, describeHttpError } from "../request";
import { validateRights } from "../rights";
import type { FootageProvider, FootageSearchRequest, NormalizedFootageAsset, ProviderSearchOptions } from "../types";

const API = "https://pixabay.com/api";
const UA = "HouseOfVideos/1.0 (https://house-of-videos.com; documentary archive research)";
const key = () => (process.env.PIXABAY_API_KEY ?? "").trim();

export const PIXABAY_RIGHTS =
  "Pixabay Content License: free for commercial and non-commercial use, no attribution required. Not permitted: redistributing as stock, " +
  "selling unaltered copies, or use of identifiable people in a misleading or defamatory way.";

const STOCK_RIGHTS = {
  rightsStatus: "other_free" as const,
  commercialUse: "allowed" as const,
  modifications: "allowed" as const,
  attributionRequired: false,
  reviewStatus: "auto_approved" as const,
  reviewReason: null,
};

interface Rendition {
  url?: string;
  width?: number;
  height?: number;
  size?: number;
  thumbnail?: string;
}
export interface PixabayVideo {
  id?: number | string;
  pageURL?: string;
  tags?: string;
  duration?: number;
  user?: string;
  videos?: { large?: Rendition; medium?: Rendition; small?: Rendition; tiny?: Rendition };
}
export interface PixabayImage {
  id?: number | string;
  pageURL?: string;
  tags?: string;
  previewURL?: string;
  webformatURL?: string;
  largeImageURL?: string;
  imageWidth?: number;
  imageHeight?: number;
  imageSize?: number;
  user?: string;
}

const tagsOf = (s: string | undefined) => String(s ?? "").split(",").map((t) => t.trim()).filter(Boolean).slice(0, 20);

export function normalizePixabayVideo(v: PixabayVideo): NormalizedFootageAsset | null {
  const id = String(v.id ?? "").trim();
  const r = v.videos?.large?.url && (v.videos.large.width ?? 0) <= 1920 ? v.videos.large : v.videos?.medium ?? v.videos?.large ?? v.videos?.small;
  if (!id || !r?.url) return null;
  const tags = tagsOf(v.tags);
  const who = stripHtml(v.user);
  const title = tags.length ? `Stock video: ${tags.slice(0, 4).join(", ")}` : `Stock video ${id}`;
  return {
    provider: "pixabay",
    providerAssetId: `video:${id}`,
    mediaType: "video",
    title,
    description: null,
    sourceUrl: v.pageURL ?? `https://pixabay.com/videos/id-${id}/`,
    downloadUrl: r.url,
    thumbnailUrl: r.thumbnail ?? v.videos?.medium?.thumbnail ?? null,
    previewUrl: v.videos?.tiny?.url ?? null,
    width: r.width ?? null,
    height: r.height ?? null,
    durationSeconds: v.duration ?? null,
    mimeType: "video/mp4",
    sizeBytes: r.size ?? null,
    dateOriginal: null,
    yearsMentioned: [],
    creator: who,
    credit: who ? `${who} / Pixabay` : "Pixabay",
    licenseOriginal: "Pixabay Content License",
    licenseCode: null,
    licenseUrl: "https://pixabay.com/service/license-summary/",
    ...STOCK_RIGHTS,
    categories: tags,
    searchableText: searchable(title, tags, who, "pixabay stock video"),
    qualityScore: qualityScoreOf(r.width ?? null, r.height ?? null, v.duration ?? null, "video"),
    footageFormat: "stockshots",
    origin: "generic",
    filmingDate: null,
    publicationDate: null,
    location: null,
    country: null,
    eventName: null,
    people: [],
    organizations: [],
    rightsText: PIXABAY_RIGHTS,
    provenance: "real_stock",
    provenanceConfidence: 70,
  };
}

export function normalizePixabayImage(p: PixabayImage): NormalizedFootageAsset | null {
  const id = String(p.id ?? "").trim();
  const file = p.largeImageURL ?? p.webformatURL ?? null;
  if (!id || !file) return null;
  const tags = tagsOf(p.tags);
  const who = stripHtml(p.user);
  const title = tags.length ? `Stock photo: ${tags.slice(0, 4).join(", ")}` : `Stock photo ${id}`;
  return {
    provider: "pixabay",
    providerAssetId: `photo:${id}`,
    mediaType: "image",
    title,
    description: null,
    sourceUrl: p.pageURL ?? `https://pixabay.com/photos/id-${id}/`,
    downloadUrl: file,
    thumbnailUrl: p.webformatURL ?? p.previewURL ?? file,
    previewUrl: null,
    width: p.imageWidth ?? null,
    height: p.imageHeight ?? null,
    durationSeconds: null,
    mimeType: "image/jpeg",
    sizeBytes: p.imageSize ?? null,
    dateOriginal: null,
    yearsMentioned: [],
    creator: who,
    credit: who ? `${who} / Pixabay` : "Pixabay",
    licenseOriginal: "Pixabay Content License",
    licenseCode: null,
    licenseUrl: "https://pixabay.com/service/license-summary/",
    ...STOCK_RIGHTS,
    categories: tags,
    searchableText: searchable(title, tags, who, "pixabay stock photo"),
    qualityScore: qualityScoreOf(p.imageWidth ?? null, p.imageHeight ?? null, null, "image"),
    footageFormat: "unknown",
    origin: "generic",
    filmingDate: null,
    publicationDate: null,
    location: null,
    country: null,
    eventName: null,
    people: [],
    organizations: [],
    rightsText: PIXABAY_RIGHTS,
    provenance: "real_stock",
    provenanceConfidence: 70,
  };
}

async function call(path: string, params: Record<string, string>, signal?: AbortSignal): Promise<unknown> {
  const k = key();
  if (!k) throw new Error("PIXABAY_API_KEY is not set");
  const url = new URL(`${API}${path}`);
  url.searchParams.set("key", k);
  for (const [n, v] of Object.entries(params)) url.searchParams.set(n, v);
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: signal ?? AbortSignal.timeout(20_000) });
  if (res.status === 429) throw new Error("Pixabay rate limit reached");
  if (!res.ok) throw new Error(`Pixabay answered HTTP ${res.status}` + (await describeHttpError(res)));
  return res.json();
}

export const pixabayProvider: FootageProvider = {
  id: "pixabay",
  displayName: "Pixabay",
  get enabled() {
    return Boolean(key());
  },
  get disabledReason() {
    return key() ? null : "needs PIXABAY_API_KEY (free, pixabay.com/api/docs)";
  },
  priority: 45,
  tier: "stock",
  categories: ["stock"],
  searchCapabilities: { video: true, image: true, recentNews: false, historical: false, directDownload: true },

  async search(request: FootageSearchRequest, opts: ProviderSearchOptions) {
    const queries = generateSearchQueries(request).slice(0, 2);
    // Pixabay's minimum per_page is 3.
    const per = String(Math.min(Math.max(opts.limit, 3), 50));
    const seen = new Set<string>();
    const out: NormalizedFootageAsset[] = [];
    for (const q of queries) {
      if (request.preferredMediaType !== "image") {
        const body = (await call("/videos/", { q: q.slice(0, 100), per_page: per, safesearch: "true" }, opts.signal)) as { hits?: PixabayVideo[] };
        for (const v of body.hits ?? []) {
          const a = normalizePixabayVideo(v);
          if (a && !seen.has(a.providerAssetId)) {
            seen.add(a.providerAssetId);
            out.push(a);
          }
        }
      }
      const body = (await call("/", { q: q.slice(0, 100), per_page: per, safesearch: "true", image_type: "photo" }, opts.signal)) as { hits?: PixabayImage[] };
      for (const p of body.hits ?? []) {
        const a = normalizePixabayImage(p);
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
    if (kind === "video") {
      const body = (await call("/videos/", { id: n }, opts?.signal)) as { hits?: PixabayVideo[] };
      return body.hits?.[0] ? normalizePixabayVideo(body.hits[0]) : null;
    }
    const body = (await call("/", { id: n }, opts?.signal)) as { hits?: PixabayImage[] };
    return body.hits?.[0] ? normalizePixabayImage(body.hits[0]) : null;
  },

  async checkRights(asset) {
    return validateRights(asset);
  },

  matchesUrl(url) {
    return /(^|\.)pixabay\.com$/i.test(url.hostname) && /^\/(videos|photos)\//.test(url.pathname);
  },

  async importFromUrl(url, opts) {
    const m = /^\/(videos|photos)\/(?:[^/]*-)?(\d+)\/?$/.exec(url.pathname);
    return m ? this.getAssetDetails!(`${m[1] === "videos" ? "video" : "photo"}:${m[2]}`, opts) : null;
  },
};
