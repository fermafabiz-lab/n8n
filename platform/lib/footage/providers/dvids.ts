/**
 * DVIDS — the Defense Visual Information Distribution Service, through its
 * official API at `api.dvidshub.net`. Needs `DVIDS_API_KEY` (free, from
 * dvidshub.net/about/api); without it the provider is listed as disabled
 * and the router skips it, so a missing key costs DVIDS results and nothing
 * else.
 *
 * `GET /search?q=…&type[]=video&type[]=image&max_results=…&api_key=…` answers
 * `results[]` with `id` ("video:812345" / "image:7654321"), `title`,
 * `description`, `date` (shot), `date_published`, `unit_name`, `branch`,
 * `credit`, `thumbnail`, `url` (the public page), `keywords`, `city`,
 * `state`, `country`, `duration`, `aspect_ratio`, `virin`. The file
 * renditions come from `GET /asset?id=…`, whose `files[]` carry `url`,
 * `width`, `height`, `format`, `size`.
 *
 * Rights. DVIDS material is produced by US Department of Defense personnel in
 * the course of their duties, which makes it public domain — with a credit
 * line the service asks for — UNLESS the asset is third-party material DVIDS
 * is distributing, which its metadata flags through the credit and, on some
 * assets, a `copyright` / `restrictions` field. The adapter reads those and
 * hands the central validator the text; "courtesy", "©", a non-DoD credit,
 * or a stated restriction all land in manual review, and an explicit
 * "restricted" / "not releasable" lands in restricted.
 */

import { classifyLicense } from "@/lib/archive/rights";
import { qualityScoreOf, searchable, stripHtml, yearsIn } from "@/lib/archive/text";
import { generateSearchQueries, describeHttpError } from "../request";
import { validateRights } from "../rights";
import type { FootageFormat, FootageProvider, FootageSearchRequest, NormalizedFootageAsset, ProviderSearchOptions } from "../types";

const API = "https://api.dvidshub.net";
const UA = "HouseOfVideos/1.0 (https://house-of-videos.com; documentary archive research)";

const key = () => (process.env.DVIDS_API_KEY ?? "").trim();

export interface DvidsResult {
  id?: string;
  type?: string;
  title?: string;
  description?: string;
  date?: string;
  date_published?: string;
  timestamp?: string;
  unit_name?: string;
  unit?: string;
  branch?: string;
  credit?: string;
  thumbnail?: string;
  image?: string;
  url?: string;
  keywords?: string | string[];
  city?: string;
  state?: string;
  country?: string;
  duration?: number | string;
  aspect_ratio?: string;
  virin?: string;
  copyright?: string;
  restrictions?: string;
  category?: string;
  files?: Array<{ url?: string; width?: number; height?: number; format?: string; size?: number; bitrate?: number }>;
}

const DOD_BRANCHES = /\b(army|navy|air force|marine|marines|space force|coast guard|joint|national guard|dod|defense|defence)\b/i;
const RESTRICTED = /\bnot\s+releasable\b|\brestricted\b|\bfouo\b|\bno\s+reuse\b/i;

const formatFor = (r: DvidsResult): FootageFormat => {
  const t = `${r.category ?? ""} ${r.title ?? ""}`.toLowerCase();
  if (/b-?roll|broll|stock footage/.test(t)) return "broll";
  if (/press (?:conference|briefing)|briefing/.test(t)) return "press_conference";
  if (/interview/.test(t)) return "interview";
  if (/speech|remarks|address/.test(t)) return "speech";
  if (/package|news/.test(t)) return "news_package";
  return "broll";
};

export function normalizeDvidsResult(r: DvidsResult): NormalizedFootageAsset | null {
  if (!r.id || !r.title) return null;
  const kind = (r.type ?? r.id.split(":")[0] ?? "").toLowerCase();
  const mediaType = kind === "video" ? "video" : kind === "image" ? "image" : null;
  if (!mediaType) return null;
  const id = r.id.includes(":") ? r.id : `${kind}:${r.id}`;
  const description = stripHtml(r.description);
  const credit = stripHtml(r.credit);
  const unit = stripHtml(r.unit_name ?? r.unit);
  const keywords = Array.isArray(r.keywords)
    ? r.keywords.map(String)
    : String(r.keywords ?? "").split(",").map((k) => k.trim()).filter(Boolean);
  const place = [r.city, r.state, r.country].map((v) => stripHtml(v)).filter(Boolean).join(", ") || null;
  const files = r.files ?? [];
  const best = files
    .filter((f) => f.url)
    .sort((a, b) => (b.width ?? 0) * (b.height ?? 0) - (a.width ?? 0) * (a.height ?? 0))[0];
  const sourceUrl = r.url ?? `https://www.dvidshub.net/${mediaType}/${id.split(":")[1]}`;
  const rightsText = [
    // Worded so the validator's own third-party test does not fire on the
    // notice itself — it reads the credit line, and this is not one.
    "DVIDS: work of the U.S. Department of Defense, public domain with credit; a credit naming another organisation is left to review.",
    r.copyright ? `Copyright: ${stripHtml(r.copyright)}` : "",
    r.restrictions ? `Restrictions: ${stripHtml(r.restrictions)}` : "",
  ].filter(Boolean).join(" ");
  // The branch says who made it; a DoD branch is the public-domain case, and
  // anything else (or nothing) is left for the validator's third-party test.
  const dod = DOD_BRANCHES.test(r.branch ?? "") || DOD_BRANCHES.test(unit ?? "");
  const hardRestricted = RESTRICTED.test(`${r.copyright ?? ""} ${r.restrictions ?? ""}`);
  const rights = hardRestricted
    ? classifyLicense("nd", "Restricted by DVIDS", true)
    : classifyLicense("pd", dod ? "Public domain (U.S. DoD, credit requested)" : "DVIDS-hosted, rights per credit line", true);
  const date = r.date ?? r.timestamp ?? null;
  const duration = r.duration === undefined || r.duration === null ? null : Number(r.duration);
  const width = best?.width ?? null;
  const height = best?.height ?? null;
  return {
    provider: "dvids",
    providerAssetId: id,
    mediaType,
    title: stripHtml(r.title) ?? r.title,
    description,
    sourceUrl,
    downloadUrl: best?.url ?? (mediaType === "image" ? r.image ?? r.thumbnail ?? sourceUrl : sourceUrl),
    thumbnailUrl: r.thumbnail ?? r.image ?? null,
    previewUrl: r.thumbnail ?? null,
    width,
    height,
    durationSeconds: Number.isFinite(duration) ? duration : null,
    mimeType: best?.format ? (mediaType === "video" ? `video/${best.format}` : `image/${best.format}`) : null,
    sizeBytes: best?.size ?? null,
    dateOriginal: date,
    yearsMentioned: yearsIn(r.title, description, date),
    creator: credit,
    credit: credit ?? unit,
    licenseOriginal: hardRestricted ? "Restricted (DVIDS)" : "Public domain (U.S. DoD)",
    licenseCode: hardRestricted ? null : "pd",
    licenseUrl: "https://www.dvidshub.net/about/copyright",
    ...rights,
    categories: keywords,
    searchableText: searchable(r.title, description, keywords, credit, unit, place),
    qualityScore: qualityScoreOf(width, height, Number.isFinite(duration) ? duration : null, mediaType),
    footageFormat: mediaType === "video" ? formatFor(r) : "unknown",
    origin: "official_media",
    filmingDate: r.date ?? null,
    publicationDate: r.date_published ?? null,
    location: place,
    country: stripHtml(r.country),
    eventName: null,
    people: [],
    organizations: [unit, r.branch].map((v) => stripHtml(v)).filter((v): v is string => Boolean(v)),
    rightsText,
    provenance: mediaType === "video" ? "archival_footage" : "archival_photo",
    provenanceConfidence: 80,
  };
}

async function call(path: string, params: Record<string, string | string[]>, signal?: AbortSignal): Promise<unknown> {
  const k = key();
  if (!k) throw new Error("DVIDS_API_KEY is not set");
  const url = new URL(`${API}${path}`);
  for (const [name, v] of Object.entries(params)) {
    if (Array.isArray(v)) for (const x of v) url.searchParams.append(name, x);
    else url.searchParams.set(name, v);
  }
  url.searchParams.set("api_key", k);
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: signal ?? AbortSignal.timeout(15_000) });
  if (res.status === 429) throw new Error("DVIDS rate limit reached");
  if (!res.ok) throw new Error(`DVIDS answered HTTP ${res.status}` + (await describeHttpError(res)));
  return res.json();
}

export const dvidsProvider: FootageProvider = {
  id: "dvids",
  displayName: "DVIDS",
  get enabled() {
    return Boolean(key());
  },
  get disabledReason() {
    return key() ? null : "needs DVIDS_API_KEY (free, dvidshub.net/about/api)";
  },
  priority: 90,
  tier: "official",
  categories: ["military", "war", "aviation", "humanitarian", "disaster", "geopolitics", "government"],
  searchCapabilities: { video: true, image: true, recentNews: true, historical: false, directDownload: true },

  async search(request: FootageSearchRequest, opts: ProviderSearchOptions) {
    const queries = generateSearchQueries(request).slice(0, 3);
    const types = request.preferredMediaType === "image" ? ["image"] : ["video", "image"];
    const seen = new Set<string>();
    const out: NormalizedFootageAsset[] = [];
    for (const q of queries) {
      const params: Record<string, string | string[]> = {
        q,
        "type[]": types,
        max_results: String(Math.min(Math.max(opts.limit, 1), 50)),
        sort: "relevance",
        // DVIDS filters by date natively; hand it the window when the
        // request has one, and only then — a guessed window would hide the
        // right clip.
        ...(request.dateFrom && /^\d{4}/.test(request.dateFrom) ? { from_date: `${request.dateFrom.slice(0, 10)}${request.dateFrom.length === 4 ? "-01-01" : ""}` } : {}),
        ...(request.dateTo && /^\d{4}/.test(request.dateTo) ? { to_date: `${request.dateTo.slice(0, 10)}${request.dateTo.length === 4 ? "-12-31" : ""}` } : {}),
      };
      const body = (await call("/search", params, opts.signal)) as { results?: DvidsResult[] };
      for (const r of body.results ?? []) {
        const a = normalizeDvidsResult(r);
        if (!a || seen.has(a.providerAssetId)) continue;
        seen.add(a.providerAssetId);
        out.push(a);
      }
    }
    return out;
  },

  async getAssetDetails(id, opts) {
    const body = (await call("/asset", { id }, opts?.signal)) as { results?: DvidsResult | DvidsResult[] };
    const r = Array.isArray(body.results) ? body.results[0] : body.results;
    return r ? normalizeDvidsResult(r) : null;
  },

  async checkRights(asset) {
    return validateRights(asset);
  },

  async resolveDownload(asset) {
    const fresh = await this.getAssetDetails!(asset.providerAssetId);
    if (!fresh) throw new Error("DVIDS no longer lists this asset");
    return { url: fresh.downloadUrl, mimeType: fresh.mimeType, seekable: true };
  },

  matchesUrl(url) {
    return /(^|\.)dvidshub\.net$/i.test(url.hostname) && /^\/(video|image)\/\d+/.test(url.pathname);
  },

  async importFromUrl(url, opts) {
    const m = /^\/(video|image)\/(\d+)/.exec(url.pathname);
    return m ? this.getAssetDetails!(`${m[1]}:${m[2]}`, opts) : null;
  },
};
