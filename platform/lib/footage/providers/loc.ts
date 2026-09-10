/**
 * Library of Congress — `www.loc.gov`'s JSON API, keyless. The National
 * Screening Room, the Prints & Photographs division, early newsreels,
 * presidential and congressional material: American history with a rights
 * statement per item.
 *
 * OFF BY DEFAULT — `FOOTAGE_ENABLE_LOC=1` switches it on. Measured
 * 2026-09-10: from the Hetzner box every `?fo=json` request is answered with
 * Cloudflare's "Just a moment…" challenge (HTTP 403), which no header can
 * pass. The adapter is written against the documented shape
 * (loc.gov/apis/json-and-yaml) and has NOT been verified on a live response;
 * it exists so the day the block lifts, or the site runs from an address
 * the Library admits, one variable turns it on and the health strip reports
 * whether the shape held.
 *
 * Documented shape:
 *   GET /search/?q=…&fo=json&c=…&fa=original-format:film,+video  (or photo,+print,+drawing)
 *     → { results: [{ id (item URL), title, date, dates[], description[],
 *         image_url[], original_format[], online_format[], partof[], subject[],
 *         contributor[], item: { rights?, rights_advisory?, created_published?,
 *         notes[], location[], contributors[] }, resources: [{ files?, url?,
 *         image?, video? }], url, mime_type[] }], pagination }
 *   GET {item url}?fo=json → { item, resources: [{ files: [[{ url, mimetype,
 *         size, width, height, duration }]] }] }
 *
 * Rights: the Library states them per item and in prose. Only "no known
 * restrictions" / "public domain" is read as public domain; everything else
 * is manual review with the Library's own sentence attached.
 */

import { classifyLicense } from "@/lib/archive/rights";
import { qualityScoreOf, searchable, stripHtml, yearsIn } from "@/lib/archive/text";
import { generateSearchQueries } from "../request";
import { validateRights } from "../rights";
import type { FootageProvider, FootageSearchRequest, NormalizedFootageAsset, ProviderSearchOptions } from "../types";

const SITE = "https://www.loc.gov";
const UA = "HouseOfVideos/1.0 (https://house-of-videos.com; documentary archive research)";
const enabled = () => /^(1|true|yes)$/i.test((process.env.FOOTAGE_ENABLE_LOC ?? "").trim());

interface LocFile {
  url?: string;
  mimetype?: string;
  size?: number;
  width?: number;
  height?: number;
  duration?: number;
}
interface LocResource {
  files?: LocFile[][] | LocFile[];
  url?: string;
  image?: string;
  video?: string;
  pdf?: string;
}
export interface LocResult {
  id?: string;
  url?: string;
  title?: string;
  date?: string;
  dates?: string[];
  description?: string[] | string;
  image_url?: string[];
  original_format?: string[];
  online_format?: string[];
  partof?: string[];
  subject?: string[];
  contributor?: string[];
  mime_type?: string[];
  item?: {
    rights?: string | string[];
    rights_advisory?: string | string[];
    created_published?: string | string[];
    notes?: string[];
    location?: string[];
    contributors?: string[];
    summary?: string | string[];
    date?: string;
  };
  resources?: LocResource[];
}

const joined = (v: string | string[] | undefined): string | null => {
  const s = (Array.isArray(v) ? v : v ? [v] : []).map((x) => stripHtml(String(x)) ?? "").filter(Boolean).join(" ");
  return s || null;
};

const PD = /no known restrictions|no known copyright|public domain|not copyrighted/i;

/** Every file object under `resources`, however nested the Library lists them. */
export function locFiles(resources: LocResource[] | undefined): LocFile[] {
  const out: LocFile[] = [];
  for (const r of resources ?? []) {
    const files = r.files ?? [];
    for (const f of files) {
      if (Array.isArray(f)) out.push(...f);
      else if (f && typeof f === "object") out.push(f as LocFile);
    }
    if (r.video) out.push({ url: r.video, mimetype: "video/mp4" });
    if (r.image) out.push({ url: r.image, mimetype: "image/jpeg" });
    if (r.url && /\.(mp4|jpe?g|png|tiff?)(\?|$)/i.test(r.url)) out.push({ url: r.url });
  }
  return out.filter((f) => f.url);
}

export function pickLocFile(files: LocFile[], mediaType: "video" | "image"): LocFile | null {
  const want = mediaType === "video" ? /video\/mp4|\.mp4(\?|$)/i : /image\/(jpeg|png|tiff)|\.(jpe?g|png|tiff?)(\?|$)/i;
  const c = files.filter((f) => want.test(`${f.mimetype ?? ""} ${f.url ?? ""}`));
  c.sort((a, b) => (b.width ?? 0) * (b.height ?? 0) - (a.width ?? 0) * (a.height ?? 0) || (b.size ?? 0) - (a.size ?? 0));
  return c[0] ?? null;
}

export function normalizeLocResult(r: LocResult): NormalizedFootageAsset | null {
  const id = String(r.id ?? r.url ?? "").trim();
  const title = stripHtml(r.title);
  if (!id || !title) return null;
  const formats = `${(r.original_format ?? []).join(" ")} ${(r.online_format ?? []).join(" ")} ${(r.mime_type ?? []).join(" ")}`.toLowerCase();
  const mediaType = /film|video|moving image|mp4/.test(formats) ? "video" : /photo|print|drawing|image|jpeg|tiff/.test(formats) ? "image" : null;
  if (!mediaType) return null;
  const description = joined(r.description) ?? joined(r.item?.summary);
  const rightsStated = joined(r.item?.rights) ?? joined(r.item?.rights_advisory);
  const rights = rightsStated && PD.test(rightsStated)
    ? classifyLicense("pd", rightsStated, false)
    : classifyLicense(null, rightsStated, null);
  const date = r.date ?? r.dates?.[0] ?? r.item?.date ?? null;
  const years = yearsIn(title, description, date);
  const latest = years.length ? years[years.length - 1] : null;
  const creator = stripHtml(r.contributor?.[0] ?? r.item?.contributors?.[0]);
  const file = pickLocFile(locFiles(r.resources), mediaType);
  const key = id.replace(/^https?:\/\/www\.loc\.gov\//, "").replace(/\/+$/, "");
  return {
    provider: "loc",
    providerAssetId: key,
    mediaType,
    title,
    description,
    sourceUrl: id.startsWith("http") ? id : `${SITE}/${key}/`,
    downloadUrl: file?.url ?? (id.startsWith("http") ? id : `${SITE}/${key}/`),
    thumbnailUrl: r.image_url?.[0] ?? null,
    previewUrl: null,
    width: file?.width ?? null,
    height: file?.height ?? null,
    durationSeconds: file?.duration ?? null,
    mimeType: file?.mimetype ?? null,
    sizeBytes: file?.size ?? null,
    dateOriginal: date,
    yearsMentioned: years,
    creator,
    credit: creator ? `${creator} / Library of Congress` : "Library of Congress",
    licenseOriginal: rightsStated,
    licenseCode: rightsStated && PD.test(rightsStated) ? "pd" : null,
    licenseUrl: null,
    ...rights,
    categories: (r.subject ?? []).map(String).slice(0, 20),
    searchableText: searchable(title, description, r.subject, creator, r.partof),
    qualityScore: qualityScoreOf(file?.width ?? null, file?.height ?? null, file?.duration ?? null, mediaType),
    footageFormat: mediaType === "video" ? (/newsreel/i.test(title) ? "news_package" : "documentary") : "unknown",
    origin: latest !== null && latest < 1995 ? "historical" : "generic",
    filmingDate: date,
    publicationDate: null,
    location: joined(r.item?.location),
    country: null,
    eventName: null,
    people: [],
    organizations: ["Library of Congress"],
    rightsText: rightsStated,
    provenance: mediaType === "video" ? "archival_footage" : "archival_photo",
    provenanceConfidence: 75,
  };
}

async function getJson(url: URL | string, signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: signal ?? AbortSignal.timeout(20_000) });
  if (res.status === 429) throw new Error("Library of Congress rate limit reached");
  if (!res.ok) throw new Error(`Library of Congress answered HTTP ${res.status}${res.status === 403 ? " (Cloudflare challenge — the box's address is not admitted)" : ""}`);
  const ct = res.headers.get("content-type") ?? "";
  if (!/json/.test(ct)) throw new Error("Library of Congress answered with something other than JSON");
  return res.json();
}

async function searchOne(q: string, mediaType: "video" | "image", limit: number, signal?: AbortSignal): Promise<NormalizedFootageAsset[]> {
  const url = new URL(`${SITE}/search/`);
  url.searchParams.set("q", q);
  url.searchParams.set("fo", "json");
  url.searchParams.set("c", String(Math.min(Math.max(limit, 1), 50)));
  url.searchParams.set("fa", mediaType === "video" ? "original-format:film, video" : "original-format:photo, print, drawing");
  url.searchParams.set("at", "results");
  const body = (await getJson(url, signal)) as { results?: LocResult[] };
  return (body.results ?? []).map(normalizeLocResult).filter((a): a is NormalizedFootageAsset => a !== null);
}

export const locProvider: FootageProvider = {
  id: "loc",
  displayName: "Library of Congress",
  get enabled() {
    return enabled();
  },
  get disabledReason() {
    return enabled() ? null : "off — loc.gov answers the box with a Cloudflare challenge (measured 2026-09-10); set FOOTAGE_ENABLE_LOC=1 to try again";
  },
  priority: 80,
  tier: "archive",
  categories: ["history", "politics", "people", "places", "events", "war", "government", "science"],
  searchCapabilities: { video: true, image: true, recentNews: false, historical: true, directDownload: true },

  async search(request: FootageSearchRequest, opts: ProviderSearchOptions) {
    const queries = generateSearchQueries(request).slice(0, 3);
    const types: Array<"video" | "image"> = request.preferredMediaType === "image" ? ["image"] : ["video", "image"];
    const seen = new Set<string>();
    const out: NormalizedFootageAsset[] = [];
    for (const q of queries) {
      for (const t of types) {
        for (const h of await searchOne(q, t, opts.limit, opts.signal)) {
          if (seen.has(h.providerAssetId)) continue;
          seen.add(h.providerAssetId);
          out.push(h);
        }
      }
    }
    return out;
  },

  async getAssetDetails(id, opts) {
    const url = new URL(`${SITE}/${id.replace(/^\/+/, "")}/`);
    url.searchParams.set("fo", "json");
    const body = (await getJson(url, opts?.signal)) as { item?: LocResult["item"] & { id?: string; title?: string; date?: string; description?: string[] | string; image_url?: string[]; original_format?: string[]; online_format?: string[]; subject?: string[] }; resources?: LocResource[] };
    if (!body.item) return null;
    return normalizeLocResult({ ...body.item, item: body.item, resources: body.resources, id: body.item.id ?? url.origin + url.pathname });
  },

  async checkRights(asset) {
    return validateRights(asset);
  },

  async resolveDownload(asset) {
    const fresh = await this.getAssetDetails!(asset.providerAssetId);
    if (!fresh) throw new Error("Library of Congress no longer lists this item");
    if (!/\.(mp4|jpe?g|png|tiff?)(\?|$)/i.test(fresh.downloadUrl) && !fresh.mimeType) throw new Error("Library of Congress lists no downloadable file for this item");
    return { url: fresh.downloadUrl, mimeType: fresh.mimeType, seekable: true };
  },

  matchesUrl(url) {
    return /(^|\.)loc\.gov$/i.test(url.hostname) && /^\/(item|resource)\/[^/]+/.test(url.pathname);
  },

  async importFromUrl(url, opts) {
    const m = /^\/(item|resource)\/([^/?#]+)/.exec(url.pathname);
    return m ? this.getAssetDetails!(`${m[1]}/${m[2]}`, opts) : null;
  },
};
