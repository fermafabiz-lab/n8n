/**
 * Flickr — `api.flickr.com`, the largest pool of openly licensed
 * PHOTOGRAPHS of recent events there is: protests, disasters, summits,
 * cities on the day, shot by people who were there and licensed CC BY /
 * CC BY-SA / CC0 — plus "The Commons", where national libraries and
 * archives publish photographs with no known copyright restrictions.
 *
 * KEYED: `FLICKR_API_KEY` (free, flickr.com/services/apps/create). Off
 * without it. Written against the documented `flickr.photos.search` shape
 * (NOT verified live from this session — no key here):
 *
 *   GET /services/rest/?method=flickr.photos.search&api_key=…&text=…
 *       &license=4,5,7,8,9,10&media=photos&content_type=1&safe_search=1
 *       &extras=license,date_taken,owner_name,description,tags,geo,url_l,url_o,url_c,path_alias
 *       &format=json&nojsoncallback=1&per_page=…
 *     → { photos: { page, pages, total, photo: [{ id, owner, title, license,
 *         description: { _content }, datetaken, ownername, pathalias, tags,
 *         url_o?, width_o?, height_o?, url_l?, width_l?, height_l?, url_c?,
 *         latitude?, longitude? }] } }
 *
 * Only the reusable licence ids are asked for: 4 CC BY, 5 CC BY-SA, 7 no
 * known copyright restrictions (The Commons), 8 US Government work, 9 CC0,
 * 10 Public Domain Mark. NC and ND never come back at all.
 */

import { classifyLicense } from "@/lib/archive/rights";
import { qualityScoreOf, searchable, stripHtml, yearsIn } from "@/lib/archive/text";
import { generateSearchQueries } from "../request";
import { validateRights } from "../rights";
import type { FootageProvider, FootageSearchRequest, NormalizedFootageAsset, ProviderSearchOptions } from "../types";

const API = "https://api.flickr.com/services/rest/";
const UA = "HouseOfVideos/1.0 (https://house-of-videos.com; documentary archive research)";
const key = () => (process.env.FLICKR_API_KEY ?? "").trim();

/** Flickr licence ids → (code, label, credit owed). */
export const FLICKR_LICENSES: Record<string, { code: string; label: string; attribution: boolean }> = {
  "4": { code: "cc-by", label: "CC BY 2.0", attribution: true },
  "5": { code: "cc-by-sa", label: "CC BY-SA 2.0", attribution: true },
  "7": { code: "pd", label: "No known copyright restrictions (Flickr Commons)", attribution: false },
  "8": { code: "pd", label: "United States Government Work", attribution: false },
  "9": { code: "cc0", label: "CC0 1.0", attribution: false },
  "10": { code: "pd", label: "Public Domain Mark 1.0", attribution: false },
};

export interface FlickrPhoto {
  id?: string;
  owner?: string;
  title?: string;
  license?: string | number;
  description?: { _content?: string };
  datetaken?: string;
  ownername?: string;
  pathalias?: string;
  tags?: string;
  url_o?: string;
  width_o?: number | string;
  height_o?: number | string;
  url_l?: string;
  width_l?: number | string;
  height_l?: number | string;
  url_c?: string;
  latitude?: number | string;
  longitude?: number | string;
}

export function normalizeFlickrPhoto(p: FlickrPhoto): NormalizedFootageAsset | null {
  const id = String(p.id ?? "").trim();
  const title = stripHtml(p.title) ?? "";
  const lic = FLICKR_LICENSES[String(p.license ?? "")];
  const file = p.url_o ?? p.url_l ?? p.url_c ?? null;
  if (!id || !lic || !file) return null;
  const description = stripHtml(p.description?._content);
  const width = Number(p.url_o ? p.width_o : p.width_l) || null;
  const height = Number(p.url_o ? p.height_o : p.height_l) || null;
  const tags = String(p.tags ?? "").split(/\s+/).filter(Boolean).slice(0, 20);
  const taken = p.datetaken ? p.datetaken.slice(0, 10) : null;
  const years = yearsIn(title, description, taken);
  const latest = years.length ? years[years.length - 1] : null;
  const rights = classifyLicense(lic.code, lic.label, lic.attribution);
  const owner = stripHtml(p.ownername) ?? null;
  const commons = String(p.license) === "7";
  return {
    provider: "flickr",
    providerAssetId: id,
    mediaType: "image",
    title: title || `Flickr photo ${id}`,
    description,
    sourceUrl: `https://www.flickr.com/photos/${encodeURIComponent(p.pathalias || p.owner || "")}/${id}`,
    downloadUrl: file,
    thumbnailUrl: p.url_c ?? p.url_l ?? file,
    previewUrl: null,
    width,
    height,
    durationSeconds: null,
    mimeType: "image/jpeg",
    sizeBytes: null,
    dateOriginal: p.datetaken ?? null,
    yearsMentioned: years,
    creator: owner,
    credit: owner ? `${owner} (Flickr)` : "Flickr",
    licenseOriginal: lic.label,
    licenseCode: lic.code,
    licenseUrl: null,
    ...rights,
    categories: tags,
    searchableText: searchable(title, description, tags, owner),
    qualityScore: qualityScoreOf(width, height, null, "image"),
    footageFormat: "unknown",
    // A Commons photograph is the archive's; a user's photo is of the day it says.
    origin: commons || (latest !== null && latest < 1995) ? "historical" : "recent_news",
    filmingDate: taken,
    publicationDate: null,
    location: null,
    country: null,
    eventName: null,
    people: [],
    organizations: [],
    rightsText: `Flickr licence ${p.license}: ${lic.label}`,
    provenance: "archival_photo",
    provenanceConfidence: commons ? 70 : 55,
  };
}

async function call(params: Record<string, string>, signal?: AbortSignal): Promise<unknown> {
  const k = key();
  if (!k) throw new Error("FLICKR_API_KEY is not set");
  const url = new URL(API);
  for (const [n, v] of Object.entries(params)) url.searchParams.set(n, v);
  url.searchParams.set("api_key", k);
  url.searchParams.set("format", "json");
  url.searchParams.set("nojsoncallback", "1");
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: signal ?? AbortSignal.timeout(20_000) });
  if (res.status === 429) throw new Error("Flickr rate limit reached");
  if (!res.ok) throw new Error(`Flickr answered HTTP ${res.status}`);
  const body = (await res.json()) as { stat?: string; message?: string };
  if (body.stat && body.stat !== "ok") throw new Error(`Flickr: ${body.message ?? body.stat}`);
  return body;
}

const EXTRAS = "license,date_taken,owner_name,description,tags,geo,url_l,url_o,url_c,path_alias";

async function searchOne(request: FootageSearchRequest, q: string, limit: number, signal?: AbortSignal): Promise<NormalizedFootageAsset[]> {
  const params: Record<string, string> = {
    method: "flickr.photos.search",
    text: q,
    license: "4,5,7,8,9,10",
    media: "photos",
    content_type: "1",
    safe_search: "1",
    sort: "relevance",
    per_page: String(Math.min(Math.max(limit, 1), 50)),
    extras: EXTRAS,
  };
  // Flickr filters by the date TAKEN natively; the request's window is the
  // scene's own, so it is handed over as is and only when it exists.
  if (request.dateFrom && /^\d{4}/.test(request.dateFrom)) params.min_taken_date = request.dateFrom.length === 4 ? `${request.dateFrom}-01-01` : request.dateFrom.slice(0, 10);
  if (request.dateTo && /^\d{4}/.test(request.dateTo)) params.max_taken_date = request.dateTo.length === 4 ? `${request.dateTo}-12-31` : request.dateTo.slice(0, 10);
  const body = (await call(params, signal)) as { photos?: { photo?: FlickrPhoto[] } };
  return (body.photos?.photo ?? []).map(normalizeFlickrPhoto).filter((a): a is NormalizedFootageAsset => a !== null);
}

export const flickrProvider: FootageProvider = {
  id: "flickr",
  displayName: "Flickr",
  get enabled() {
    return Boolean(key());
  },
  get disabledReason() {
    return key() ? null : "needs FLICKR_API_KEY (free, flickr.com/services/apps/create)";
  },
  priority: 70,
  tier: "community",
  categories: ["events", "places", "people", "politics", "disaster", "humanitarian", "migration", "history"],
  searchCapabilities: { video: false, image: true, recentNews: true, historical: true, directDownload: true },

  async search(request: FootageSearchRequest, opts: ProviderSearchOptions) {
    const queries = generateSearchQueries(request).slice(0, 3);
    const seen = new Set<string>();
    const out: NormalizedFootageAsset[] = [];
    for (const q of queries) {
      for (const h of await searchOne(request, q, opts.limit, opts.signal)) {
        if (seen.has(h.providerAssetId)) continue;
        seen.add(h.providerAssetId);
        out.push(h);
      }
    }
    return out;
  },

  async getAssetDetails(id, opts) {
    const body = (await call({ method: "flickr.photos.getInfo", photo_id: id }, opts?.signal)) as {
      photo?: { id?: string; owner?: { nsid?: string; username?: string; path_alias?: string }; title?: { _content?: string }; description?: { _content?: string }; license?: string; dates?: { taken?: string }; tags?: { tag?: Array<{ raw?: string }> } };
    };
    const p = body.photo;
    if (!p?.id) return null;
    const sizes = (await call({ method: "flickr.photos.getSizes", photo_id: id }, opts?.signal)) as { sizes?: { size?: Array<{ label?: string; source?: string; width?: number | string; height?: number | string }> } };
    const list = sizes.sizes?.size ?? [];
    const by = (label: string) => list.find((s) => s.label === label);
    const o = by("Original") ?? by("Large 2048") ?? by("Large 1600") ?? by("Large");
    const c = by("Medium 800") ?? by("Medium");
    return normalizeFlickrPhoto({
      id: p.id,
      owner: p.owner?.nsid,
      pathalias: p.owner?.path_alias,
      ownername: p.owner?.username,
      title: p.title?._content,
      description: { _content: p.description?._content },
      license: p.license,
      datetaken: p.dates?.taken,
      tags: (p.tags?.tag ?? []).map((t) => t.raw ?? "").join(" "),
      url_o: o?.source,
      width_o: o?.width,
      height_o: o?.height,
      url_c: c?.source,
    });
  },

  async checkRights(asset) {
    return validateRights(asset);
  },

  matchesUrl(url) {
    return /(^|\.)flickr\.com$/i.test(url.hostname) && /^\/photos\/[^/]+\/\d+/.test(url.pathname);
  },

  async importFromUrl(url, opts) {
    const m = /^\/photos\/[^/]+\/(\d+)/.exec(url.pathname);
    return m ? this.getAssetDetails!(m[1], opts) : null;
  },
};
