/**
 * Europeana — `api.europeana.eu`, the aggregator of ~3,000 European
 * libraries, archives, museums and broadcasters (EUscreen's television
 * archives among them). The deepest source there is for European history
 * before the newsroom era.
 *
 * Read off real responses (execution 11839, 2026-09-10):
 *
 *   GET /record/v2/search.json?wskey=…&query=…&media=true&reusability=open
 *       &profile=rich&rows=…&qf=TYPE:VIDEO|IMAGE
 *     → { success, totalResults, items: [{ id ("/247/…"), guid, title[],
 *         dcTitleLangAware{en[]}, dcDescription[], dcCreator[], dcContributor[],
 *         type ("VIDEO"|"IMAGE"), year[]?, edmTimespanLabel[{def:"1970/1989"}],
 *         edmPlaceLabel[{def}], dctermsSpatial[], country[], dataProvider[],
 *         provider[], rights[] (a licence URL), edmIsShownBy[] (the file),
 *         edmIsShownAt[] (the provider's page), edmPreview[] (thumbnail),
 *         edmConceptPrefLabelLangAware{en[]}, language[] }] }
 *
 * `reusability=open` is load-bearing: Europeana then returns ONLY items under
 * Public Domain Mark, CC0, CC BY or CC BY-SA, and `rights[0]` is the URL the
 * central classifier reads. `media=true` keeps items with a file. Keyed by
 * `EUROPEANA_API_KEY`; the documented demo key `api2demo` is the default and
 * is rate-limited, so a real key (free, pro.europeana.eu) is the thing to add
 * before a ninety-scene film asks three hundred times.
 */

import { classifyLicense } from "@/lib/archive/rights";
import { qualityScoreOf, searchable, stripHtml, yearsIn } from "@/lib/archive/text";
import { generateSearchQueries, describeHttpError } from "../request";
import { validateRights } from "../rights";
import type { FootageFormat, FootageProvider, FootageSearchRequest, NormalizedFootageAsset, ProviderSearchOptions } from "../types";

const API = "https://api.europeana.eu/record/v2";
const SITE = "https://www.europeana.eu";
const UA = "HouseOfVideos/1.0 (https://house-of-videos.com; documentary archive research)";
const key = () => (process.env.EUROPEANA_API_KEY ?? "").trim() || "api2demo";

type Lang = Record<string, string[]>;
type Labelled = Array<{ def?: string } | string>;

export interface EuropeanaItem {
  id?: string;
  guid?: string;
  link?: string;
  title?: string[];
  dcTitleLangAware?: Lang;
  dcDescription?: string[];
  dcDescriptionLangAware?: Lang;
  dcCreator?: string[];
  dcContributor?: string[];
  dcSubject?: string[];
  type?: string;
  year?: string[];
  edmTimespanLabel?: Labelled;
  edmPlaceLabel?: Labelled;
  dctermsSpatial?: string[];
  country?: string[];
  dataProvider?: string[];
  provider?: string[];
  rights?: string[];
  edmIsShownBy?: string[];
  edmIsShownAt?: string[];
  edmPreview?: string[];
  edmConceptPrefLabelLangAware?: Lang;
  edmConceptLabel?: Labelled;
  language?: string[];
  timestamp_created?: string;
}

const en = (l: Lang | undefined, fallback: string[] | undefined): string | null => {
  const v = l?.en?.[0] ?? l?.EN?.[0] ?? fallback?.[0] ?? (l ? Object.values(l)[0]?.[0] : undefined);
  return v ? stripHtml(v) : null;
};
const labels = (v: Labelled | undefined): string[] =>
  (v ?? []).map((x) => (typeof x === "string" ? x : x?.def ?? "")).map((s) => s.trim()).filter((s) => s && !/^https?:\/\//.test(s));
const nonUrl = (v: string[] | undefined): string[] => (v ?? []).map(String).filter((s) => !/^https?:\/\//.test(s));

const formatFor = (title: string, description: string | null): FootageFormat => {
  const t = `${title} ${description ?? ""}`.toLowerCase();
  if (/newsreel|journal|actualit|wochenschau|jurnal/.test(t)) return "news_package";
  if (/documentary|documentaire|dokumentar/.test(t)) return "documentary";
  if (/interview/.test(t)) return "interview";
  if (/speech|discours|rede\b|toespraak/.test(t)) return "speech";
  return "broll";
};

export function normalizeEuropeanaItem(it: EuropeanaItem): NormalizedFootageAsset | null {
  const id = String(it.id ?? "").trim();
  const title = en(it.dcTitleLangAware, it.title);
  if (!id || !title) return null;
  const mediaType = it.type === "VIDEO" ? "video" : it.type === "IMAGE" ? "image" : null;
  if (!mediaType) return null;
  const description = en(it.dcDescriptionLangAware, it.dcDescription);
  const file = it.edmIsShownBy?.[0] ?? null;
  if (!file) return null;
  const creator = stripHtml(it.dcCreator?.[0] ?? it.dcContributor?.[0]);
  const dataProvider = stripHtml(it.dataProvider?.[0]);
  const rightsUrl = it.rights?.[0] ?? null;
  const rights = classifyLicense(null, rightsUrl, null);
  const span = labels(it.edmTimespanLabel)[0] ?? null;
  const year = it.year?.[0] ?? null;
  const date = year ?? span;
  const years = yearsIn(title, description, date, span);
  const latest = years.length ? years[years.length - 1] : null;
  const place = labels(it.edmPlaceLabel)[0] ?? nonUrl(it.dctermsSpatial)[0] ?? null;
  const country = it.country?.[0] ?? null;
  const concepts = it.edmConceptPrefLabelLangAware?.en ?? labels(it.edmConceptLabel);
  const keywords = [...new Set([...concepts, ...nonUrl(it.dcSubject)])].slice(0, 20);
  const sourceUrl = it.edmIsShownAt?.[0] ?? (it.guid ? it.guid.replace(/\?utm_[^#]*$/, "") : `${SITE}/item${id}`);
  return {
    provider: "europeana",
    providerAssetId: id,
    mediaType,
    title,
    description,
    sourceUrl,
    downloadUrl: file,
    thumbnailUrl: it.edmPreview?.[0] ?? null,
    previewUrl: null,
    width: null,
    height: null,
    durationSeconds: null,
    mimeType: null,
    sizeBytes: null,
    dateOriginal: date,
    yearsMentioned: years,
    creator,
    credit: dataProvider ?? creator ?? "Europeana",
    licenseOriginal: rightsUrl,
    licenseCode: null,
    licenseUrl: rightsUrl,
    ...rights,
    categories: keywords,
    searchableText: searchable(title, description, keywords, creator, dataProvider, place, country),
    qualityScore: qualityScoreOf(null, null, null, mediaType),
    footageFormat: mediaType === "video" ? formatFor(title, description) : "unknown",
    origin: latest !== null && latest < 1995 ? "historical" : "generic",
    // A span like "1970/1989" is a period, not a day; it still dates the
    // asset for the ±1-year window the matcher applies.
    filmingDate: date,
    publicationDate: null,
    location: [place, country].filter(Boolean).join(", ") || null,
    country,
    eventName: null,
    people: [],
    organizations: dataProvider ? [dataProvider] : [],
    rightsText: rightsUrl,
    provenance: mediaType === "video" ? "archival_footage" : "archival_photo",
    provenanceConfidence: 75,
  };
}

async function call(params: Record<string, string | string[]>, signal?: AbortSignal): Promise<{ items?: EuropeanaItem[] }> {
  const url = new URL(`${API}/search.json`);
  url.searchParams.set("wskey", key());
  for (const [k, v] of Object.entries(params)) {
    if (Array.isArray(v)) for (const x of v) url.searchParams.append(k, x);
    else url.searchParams.set(k, v);
  }
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: signal ?? AbortSignal.timeout(20_000) });
  if (res.status === 429) throw new Error("Europeana rate limit reached");
  if (!res.ok) throw new Error(`Europeana answered HTTP ${res.status}` + (await describeHttpError(res)));
  return (await res.json()) as { items?: EuropeanaItem[] };
}

async function searchOne(q: string, type: "VIDEO" | "IMAGE", limit: number, signal?: AbortSignal): Promise<NormalizedFootageAsset[]> {
  const body = await call(
    {
      query: q,
      media: "true",
      reusability: "open",
      profile: "rich",
      rows: String(Math.min(Math.max(limit, 1), 50)),
      // A direct file for video, or the render has nothing to cut from.
      qf: type === "VIDEO" ? ["TYPE:VIDEO", "MIME_TYPE:video/mp4"] : ["TYPE:IMAGE"],
    },
    signal,
  );
  return (body.items ?? []).map(normalizeEuropeanaItem).filter((a): a is NormalizedFootageAsset => a !== null);
}

export const europeanaProvider: FootageProvider = {
  id: "europeana",
  displayName: "Europeana",
  enabled: true,
  disabledReason: null,
  priority: 85,
  tier: "archive",
  categories: ["history", "europe", "politics", "events", "places", "people", "war", "science", "eu"],
  searchCapabilities: { video: true, image: true, recentNews: false, historical: true, directDownload: true },

  async search(request: FootageSearchRequest, opts: ProviderSearchOptions) {
    const queries = generateSearchQueries(request).slice(0, 3);
    const types: Array<"VIDEO" | "IMAGE"> = request.preferredMediaType === "image" ? ["IMAGE"] : ["VIDEO", "IMAGE"];
    const seen = new Set<string>();
    const out: NormalizedFootageAsset[] = [];
    for (const q of queries) {
      for (const type of types) {
        const hits = await searchOne(q, type, opts.limit, opts.signal);
        for (const h of hits) {
          if (seen.has(h.providerAssetId)) continue;
          seen.add(h.providerAssetId);
          out.push(h);
        }
      }
    }
    return out;
  },

  async getAssetDetails(id, opts) {
    const body = await call({ query: `europeana_id:"${id}"`, profile: "rich", rows: "1" }, opts?.signal);
    const it = body.items?.[0];
    return it ? normalizeEuropeanaItem(it) : null;
  },

  async checkRights(asset) {
    return validateRights(asset);
  },

  matchesUrl(url) {
    return /(^|\.)europeana\.eu$/i.test(url.hostname) && /^\/(?:[a-z]{2}\/)?item\/[^/]+\/[^/]+/.test(url.pathname);
  },

  async importFromUrl(url, opts) {
    const m = /\/item\/([^/]+)\/([^/?#]+)/.exec(url.pathname);
    return m ? this.getAssetDetails!(`/${m[1]}/${m[2]}`, opts) : null;
  },
};
