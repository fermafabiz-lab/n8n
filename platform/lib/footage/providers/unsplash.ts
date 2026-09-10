/**
 * Unsplash — `api.unsplash.com`, stock photographs under the Unsplash
 * License: free for commercial use, no permission needed. Photographs only,
 * generic by nature, routed as `tier: stock`.
 *
 * KEYED: `UNSPLASH_ACCESS_KEY` (free, unsplash.com/developers; 50 requests
 * an hour in demo mode). Off without it. Written against the documented
 * shape (NOT verified live here — no key):
 *
 *   GET /search/photos?query=…&per_page=…&orientation=landscape&content_filter=high
 *       (Authorization: Client-ID KEY, Accept-Version: v1)
 *     → { results: [{ id, description, alt_description, width, height, created_at,
 *         urls: { raw, full, regular, small, thumb }, links: { html, download, download_location },
 *         user: { name, username, links: { html } }, location?: { name, city, country },
 *         tags?: [{ title }] }] }
 *
 * Two of Unsplash's API guidelines are rules here, not courtesies: a
 * displayed photo is credited "Photo by <name> on Unsplash" (so
 * `attributionRequired` is true, and the render prints it), and using one
 * means calling its `download_location` first — `resolveDownload` does,
 * and returns the URL that call answers with.
 */

import { qualityScoreOf, searchable, stripHtml, yearsIn } from "@/lib/archive/text";
import { generateSearchQueries, describeHttpError } from "../request";
import { validateRights } from "../rights";
import type { FootageProvider, FootageSearchRequest, NormalizedFootageAsset, ProviderSearchOptions } from "../types";

const API = "https://api.unsplash.com";
const UA = "HouseOfVideos/1.0 (https://house-of-videos.com; documentary archive research)";
const key = () => (process.env.UNSPLASH_ACCESS_KEY ?? "").trim();

export const UNSPLASH_RIGHTS =
  "Unsplash License: free to use for commercial and non-commercial purposes; credit the photographer and Unsplash. " +
  "Not permitted: selling unaltered copies, or compiling photos to replicate a similar service.";

export interface UnsplashPhoto {
  id?: string;
  description?: string | null;
  alt_description?: string | null;
  width?: number;
  height?: number;
  created_at?: string;
  urls?: { raw?: string; full?: string; regular?: string; small?: string; thumb?: string };
  links?: { html?: string; download?: string; download_location?: string };
  user?: { name?: string; username?: string; links?: { html?: string } };
  location?: { name?: string | null; city?: string | null; country?: string | null };
  tags?: Array<{ title?: string }>;
}

export function normalizeUnsplashPhoto(p: UnsplashPhoto): NormalizedFootageAsset | null {
  const id = String(p.id ?? "").trim();
  const file = p.urls?.full ?? p.urls?.raw ?? p.urls?.regular ?? null;
  if (!id || !file) return null;
  const who = stripHtml(p.user?.name);
  const title = stripHtml(p.description) ?? stripHtml(p.alt_description) ?? `Stock photo ${id}${who ? ` by ${who}` : ""}`;
  const tags = (p.tags ?? []).map((t) => String(t.title ?? "")).filter(Boolean).slice(0, 20);
  const place = [p.location?.name, p.location?.city, p.location?.country].filter((v): v is string => Boolean(v)).join(", ") || null;
  const years = yearsIn(title, tags.join(" "));
  return {
    provider: "unsplash",
    providerAssetId: id,
    mediaType: "image",
    title,
    description: null,
    sourceUrl: p.links?.html ?? `https://unsplash.com/photos/${id}`,
    downloadUrl: file,
    thumbnailUrl: p.urls?.small ?? p.urls?.regular ?? file,
    previewUrl: null,
    width: p.width ?? null,
    height: p.height ?? null,
    durationSeconds: null,
    mimeType: "image/jpeg",
    sizeBytes: null,
    dateOriginal: p.created_at ?? null,
    yearsMentioned: years,
    creator: who,
    credit: who ? `Photo by ${who} on Unsplash` : "Unsplash",
    licenseOriginal: "Unsplash License",
    licenseCode: null,
    licenseUrl: "https://unsplash.com/license",
    rightsStatus: "other_free",
    commercialUse: "allowed",
    modifications: "allowed",
    attributionRequired: true,
    reviewStatus: "auto_approved",
    reviewReason: null,
    categories: tags,
    searchableText: searchable(title, tags, who, place, "unsplash stock photo"),
    qualityScore: qualityScoreOf(p.width ?? null, p.height ?? null, null, "image"),
    footageFormat: "unknown",
    origin: "generic",
    filmingDate: null,
    publicationDate: p.created_at ? p.created_at.slice(0, 10) : null,
    location: place,
    country: p.location?.country ?? null,
    eventName: null,
    people: [],
    organizations: [],
    rightsText: UNSPLASH_RIGHTS,
    provenance: "real_stock",
    provenanceConfidence: 70,
  };
}

async function call(path: string, params: Record<string, string>, signal?: AbortSignal): Promise<unknown> {
  const k = key();
  if (!k) throw new Error("UNSPLASH_ACCESS_KEY is not set");
  const url = path.startsWith("http") ? new URL(path) : new URL(`${API}${path}`);
  for (const [n, v] of Object.entries(params)) url.searchParams.set(n, v);
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json", "Accept-Version": "v1", Authorization: `Client-ID ${k}` }, signal: signal ?? AbortSignal.timeout(20_000) });
  if (res.status === 429 || res.status === 403) throw new Error(`Unsplash rate limit reached (HTTP ${res.status})`);
  if (!res.ok) throw new Error(`Unsplash answered HTTP ${res.status}` + (await describeHttpError(res)));
  return res.json();
}

export const unsplashProvider: FootageProvider = {
  id: "unsplash",
  displayName: "Unsplash",
  get enabled() {
    return Boolean(key());
  },
  get disabledReason() {
    return key() ? null : "needs UNSPLASH_ACCESS_KEY (free, unsplash.com/developers)";
  },
  priority: 40,
  tier: "stock",
  categories: ["stock"],
  searchCapabilities: { video: false, image: true, recentNews: false, historical: false, directDownload: true },

  async search(request: FootageSearchRequest, opts: ProviderSearchOptions) {
    const queries = generateSearchQueries(request).slice(0, 2);
    const seen = new Set<string>();
    const out: NormalizedFootageAsset[] = [];
    for (const q of queries) {
      const body = (await call("/search/photos", { query: q, per_page: String(Math.min(Math.max(opts.limit, 1), 30)), orientation: "landscape", content_filter: "high" }, opts.signal)) as { results?: UnsplashPhoto[] };
      for (const p of body.results ?? []) {
        const a = normalizeUnsplashPhoto(p);
        if (a && !seen.has(a.providerAssetId)) {
          seen.add(a.providerAssetId);
          out.push(a);
        }
      }
    }
    return out;
  },

  async getAssetDetails(id, opts) {
    return normalizeUnsplashPhoto((await call(`/photos/${encodeURIComponent(id)}`, {}, opts?.signal)) as UnsplashPhoto);
  },

  async checkRights(asset) {
    return validateRights(asset);
  },

  async resolveDownload(asset) {
    // The guideline: tell Unsplash a photo is being used, through the
    // photo's own download endpoint, and take the URL it answers with.
    const p = (await call(`/photos/${encodeURIComponent(asset.providerAssetId)}`, {})) as UnsplashPhoto;
    const loc = p.links?.download_location;
    if (loc) {
      const d = (await call(loc, {})) as { url?: string };
      if (d.url) return { url: d.url, mimeType: "image/jpeg", seekable: true };
    }
    return { url: asset.downloadUrl, mimeType: "image/jpeg", seekable: true };
  },

  matchesUrl(url) {
    return /(^|\.)unsplash\.com$/i.test(url.hostname) && /^\/photos\/[^/]+/.test(url.pathname);
  },

  async importFromUrl(url, opts) {
    const m = /^\/photos\/(?:[^/]*-)?([A-Za-z0-9_-]{8,})\/?$/.exec(url.pathname);
    return m ? this.getAssetDetails!(m[1], opts) : null;
  },
};
