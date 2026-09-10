/**
 * The EU Audiovisual Service — `audiovisual.ec.europa.eu`, the Commission's
 * own footage library: stockshots of institutions and cities, B-roll of
 * summits and border operations, press conferences, speeches.
 *
 * OPT-IN, off until `EU_AV_API_BASE` names a public JSON search endpoint.
 * Checked 2026-09-10 (docs/footage-sources.md): the service publishes no
 * developer API. Its website is an Angular app talking to an internal AWS
 * API Gateway with a bearer token embedded in the app's own bundle — an
 * access control, not an offer, and the spec is explicit that this engine
 * never goes around one. So the adapter stays (the reader is defensive:
 * every field it uses is looked up under the two or three names such
 * services use, and anything it cannot make sense of is an empty answer,
 * never an exception), but it is not routed until a person sets the base
 * URL of an endpoint the Commission actually offers. Until then an EU AV
 * PAGE still enters through the URL-import door like any other page, with
 * the rights the page states.
 *
 * Rights. The Commission's reuse decision (2011/833/EU) makes its own
 * material reusable with attribution — "© European Union, <year>" — unless
 * the asset states otherwise, and the service marks material it holds under
 * third-party rights, and material for editorial use only, per asset. So
 * each asset's own `copyright` / `rights` / `usage` text is kept verbatim
 * and read by the central validator: "© European Union" alone is
 * attribution-required; "editorial use only" is editorial-only; a
 * third-party credit is manual review. Nothing here assumes one rule for
 * the whole service.
 */

import { classifyLicense } from "@/lib/archive/rights";
import { qualityScoreOf, searchable, stripHtml, yearsIn } from "@/lib/archive/text";
import { generateSearchQueries } from "../request";
import { validateRights } from "../rights";
import type { FootageFormat, FootageProvider, FootageSearchRequest, NormalizedFootageAsset, ProviderSearchOptions } from "../types";

const UA = "HouseOfVideos/1.0 (https://house-of-videos.com; documentary archive research)";
const base = () => (process.env.EU_AV_API_BASE ?? "").trim().replace(/\/+$/, "");
const SITE = "https://audiovisual.ec.europa.eu";

/** One item as the service's search answers it — every spelling we have seen or expect. */
export interface EuAvItem {
  id?: string | number;
  ref?: string;
  reference?: string;
  title?: string | Record<string, string>;
  description?: string | Record<string, string>;
  summary?: string;
  type?: string;
  mediaType?: string;
  media_type?: string;
  kind?: string;
  genre?: string;
  category?: string;
  date?: string;
  shootingDate?: string;
  shooting_date?: string;
  filmingDate?: string;
  publicationDate?: string;
  publication_date?: string;
  location?: string | { name?: string; city?: string; country?: string };
  city?: string;
  country?: string;
  speakers?: Array<string | { name?: string }>;
  persons?: Array<string | { name?: string }>;
  copyright?: string;
  rights?: string;
  usage?: string;
  credit?: string;
  duration?: number | string;
  url?: string;
  pageUrl?: string;
  thumbnail?: string;
  thumbnailUrl?: string;
  poster?: string;
  preview?: string;
  previewUrl?: string;
  downloadUrl?: string;
  files?: Array<{ url?: string; width?: number; height?: number; type?: string; format?: string; size?: number }>;
  width?: number;
  height?: number;
  event?: string | { title?: string; name?: string };
  keywords?: string[] | string;
}

const text = (v: string | Record<string, string> | undefined): string | null => {
  if (!v) return null;
  if (typeof v === "string") return stripHtml(v);
  return stripHtml(v.en ?? v.EN ?? Object.values(v)[0] ?? "");
};
const names = (v: Array<string | { name?: string }> | undefined): string[] =>
  (v ?? []).map((x) => (typeof x === "string" ? x : x?.name ?? "")).map((s) => s.trim()).filter(Boolean);

const formatFor = (it: EuAvItem): FootageFormat => {
  const t = `${it.type ?? ""} ${it.kind ?? ""} ${it.genre ?? ""} ${it.category ?? ""}`.toLowerCase();
  if (/stock ?shot/.test(t)) return "stockshots";
  if (/b-?roll|broll|rushes|footage/.test(t)) return "broll";
  if (/press (?:conference|briefing)|midday|briefing|point de presse/.test(t)) return "press_conference";
  if (/interview/.test(t)) return "interview";
  if (/speech|statement|address|declaration|remarks/.test(t)) return "speech";
  if (/live/.test(t)) return "live_stream";
  if (/news|package|edited/.test(t)) return "news_package";
  return "broll";
};

export function normalizeEuAvItem(it: EuAvItem): NormalizedFootageAsset | null {
  const id = String(it.ref ?? it.reference ?? it.id ?? "").trim();
  const title = text(it.title);
  if (!id || !title) return null;
  const kindRaw = `${it.mediaType ?? it.media_type ?? it.type ?? ""}`.toLowerCase();
  const mediaType = /photo|image|still/.test(kindRaw) ? "image" : "video";
  const description = text(it.description) ?? stripHtml(it.summary);
  const loc = typeof it.location === "string" ? it.location : it.location ? [it.location.name, it.location.city, it.location.country].filter(Boolean).join(", ") : null;
  const country = typeof it.location === "object" && it.location?.country ? it.location.country : it.country ?? null;
  const location = [loc, it.city].filter(Boolean).join(", ") || country;
  const speakers = [...names(it.speakers), ...names(it.persons)];
  const filming = it.shootingDate ?? it.shooting_date ?? it.filmingDate ?? it.date ?? null;
  const published = it.publicationDate ?? it.publication_date ?? null;
  const rightsText = [it.copyright, it.rights, it.usage].map((v) => stripHtml(v)).filter(Boolean).join(" · ") || "© European Union";
  const files = it.files ?? [];
  const best = files.filter((f) => f.url).sort((a, b) => (b.width ?? 0) * (b.height ?? 0) - (a.width ?? 0) * (a.height ?? 0))[0];
  const sourceUrl = it.pageUrl ?? it.url ?? `${SITE}/en/${mediaType}/${encodeURIComponent(id)}`;
  const thumb = it.thumbnailUrl ?? it.thumbnail ?? it.poster ?? null;
  const eventName = typeof it.event === "string" ? it.event : it.event?.title ?? it.event?.name ?? null;
  const keywords = Array.isArray(it.keywords) ? it.keywords.map(String) : String(it.keywords ?? "").split(",").map((k) => k.trim()).filter(Boolean);
  // "© European Union" is the attribution-required case; the validator reads
  // the rest of the text for third-party and editorial-only statements.
  const rights = classifyLicense("cc-by", rightsText, true);
  const duration = it.duration === undefined || it.duration === null ? null : Number(it.duration);
  const width = best?.width ?? it.width ?? null;
  const height = best?.height ?? it.height ?? null;
  return {
    provider: "eu_av",
    providerAssetId: id,
    mediaType,
    title,
    description,
    sourceUrl,
    downloadUrl: best?.url ?? it.downloadUrl ?? it.previewUrl ?? it.preview ?? sourceUrl,
    thumbnailUrl: thumb,
    previewUrl: it.previewUrl ?? it.preview ?? null,
    width,
    height,
    durationSeconds: Number.isFinite(duration) ? duration : null,
    mimeType: best?.type ?? null,
    sizeBytes: best?.size ?? null,
    dateOriginal: filming,
    yearsMentioned: yearsIn(title, description, filming, published),
    creator: stripHtml(it.credit) ?? "European Union",
    credit: stripHtml(it.credit) ?? "© European Union",
    licenseOriginal: "© European Union (reuse with attribution, Decision 2011/833/EU)",
    licenseCode: null,
    licenseUrl: `${SITE}/en/copyright`,
    ...rights,
    categories: keywords,
    searchableText: searchable(title, description, keywords, location, speakers, eventName),
    qualityScore: qualityScoreOf(width, height, Number.isFinite(duration) ? duration : null, mediaType),
    footageFormat: mediaType === "video" ? formatFor(it) : "unknown",
    origin: "official_media",
    filmingDate: filming,
    publicationDate: published,
    location,
    country,
    eventName,
    people: speakers,
    organizations: ["European Union"],
    rightsText,
    provenance: mediaType === "video" ? "archival_footage" : "archival_photo",
    provenanceConfidence: 80,
  };
}

async function call(path: string, params: Record<string, string>, signal?: AbortSignal): Promise<unknown> {
  if (!base()) throw new Error("EU_AV_API_BASE is not set");
  const url = new URL(`${base()}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: signal ?? AbortSignal.timeout(15_000) });
  if (res.status === 429) throw new Error("EU AV rate limit reached");
  if (!res.ok) throw new Error(`EU AV answered HTTP ${res.status}`);
  const ct = res.headers.get("content-type") ?? "";
  if (!/json/.test(ct)) throw new Error("EU AV answered with something other than JSON — check EU_AV_API_BASE");
  return res.json();
}

/** The items, wherever the service put them in the envelope. */
export function euAvItems(body: unknown): EuAvItem[] {
  if (Array.isArray(body)) return body as EuAvItem[];
  const b = (body ?? {}) as Record<string, unknown>;
  for (const k of ["items", "results", "hits", "data", "content"]) {
    const v = b[k];
    if (Array.isArray(v)) return v as EuAvItem[];
    if (v && typeof v === "object") {
      const inner = (v as Record<string, unknown>).items ?? (v as Record<string, unknown>).results;
      if (Array.isArray(inner)) return inner as EuAvItem[];
    }
  }
  return [];
}

export const euAvProvider: FootageProvider = {
  id: "eu_av",
  displayName: "EU Audiovisual Service",
  get enabled() {
    return Boolean(base());
  },
  get disabledReason() {
    return base() ? null : "no public API (the site's own backend is behind an embedded credential) — set EU_AV_API_BASE if the Commission offers one; its pages still import by URL";
  },
  priority: 90,
  tier: "official",
  categories: ["europe", "politics", "migration", "government", "eu", "geopolitics", "humanitarian"],
  searchCapabilities: { video: true, image: true, recentNews: true, historical: false, directDownload: true },

  async search(request: FootageSearchRequest, opts: ProviderSearchOptions) {
    const queries = generateSearchQueries(request).slice(0, 3);
    // Prefer pictures for narration: the service classifies every item, so
    // asking for stockshots and B-roll first keeps the twenty-minute press
    // conference out of a scene that wants eight seconds of a border.
    const wantsSpeech = request.preferredFootageType === "speech" || request.preferredFootageType === "interview";
    const seen = new Set<string>();
    const out: NormalizedFootageAsset[] = [];
    for (const q of queries) {
      const body = await call("/search", {
        q,
        type: request.preferredMediaType === "image" ? "photo" : "video",
        ...(wantsSpeech ? {} : { genre: "stockshot,broll" }),
        size: String(Math.min(Math.max(opts.limit, 1), 50)),
        ...(request.dateFrom && /^\d{4}/.test(request.dateFrom) ? { from: request.dateFrom.slice(0, 10) } : {}),
        ...(request.dateTo && /^\d{4}/.test(request.dateTo) ? { to: request.dateTo.slice(0, 10) } : {}),
      }, opts.signal);
      for (const it of euAvItems(body)) {
        const a = normalizeEuAvItem(it);
        if (!a || seen.has(a.providerAssetId)) continue;
        seen.add(a.providerAssetId);
        out.push(a);
      }
    }
    return out;
  },

  async getAssetDetails(id, opts) {
    const body = (await call(`/item/${encodeURIComponent(id)}`, {}, opts?.signal)) as EuAvItem | { item?: EuAvItem };
    const it = (body as { item?: EuAvItem }).item ?? (body as EuAvItem);
    return it ? normalizeEuAvItem(it) : null;
  },

  async checkRights(asset) {
    return validateRights(asset);
  },

  matchesUrl(url) {
    return /(^|\.)audiovisual\.ec\.europa\.eu$/i.test(url.hostname);
  },

  async importFromUrl(url, opts) {
    const m = /\/(?:video|photo|image)\/([A-Za-z0-9-]+)/i.exec(url.pathname);
    if (!m) return null;
    return this.getAssetDetails!(m[1], opts).catch(() => null);
  },
};
