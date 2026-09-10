/**
 * Wellcome Collection — `api.wellcomecollection.org`, keyless. The history
 * of medicine, science and health: epidemics, hospitals, laboratories,
 * public-health campaigns, anatomy — mostly images (paintings, prints,
 * photographs), under CC BY or public domain, served through IIIF.
 *
 * Read off a real response (execution 11839, 2026-09-10):
 *
 *   GET /catalogue/v2/images?query=…&pageSize=…&include=source.contributors
 *     → { totalResults, results: [{ id, type: "Image", aspectRatio,
 *         source: { id, title, contributors: [{ agent: { label } }] },
 *         thumbnail: { url: "https://iiif…/image/L0006896/info.json", credit,
 *                      license: { id: "cc-by", label, url } },
 *         locations: [{ url (info.json), license, accessConditions[…] }] }] }
 *
 * `include` accepts ONLY `source.contributors`, `source.languages`,
 * `source.genres` and `source.subjects` on the IMAGES endpoint — the API says
 * so itself, by name, in its 400 body. This adapter asked for
 * `source.production` as well (valid on the WORKS endpoint, not this one) and
 * was therefore refused on every single search from the day it was written
 * until 2026-09-10, behind a bare "Wellcome answered HTTP 400" that named
 * nothing. Losing production costs a date the classifier never trusted anyway
 * — a catalogue date is frequently the upload date, so it is not read for
 * matching (see §"The date field lies").
 *
 * A IIIF `info.json` is not a picture; the picture is
 * `…/full/{width},/0/default.jpg` on the same base, which is how both the
 * thumbnail and the download here are built. The licence comes per image
 * (`cc-by`, `pdm`, `cc0`, `cc-by-nc`…) and goes to the central classifier,
 * which refuses the NC ones like any other.
 */

import { classifyLicense } from "@/lib/archive/rights";
import { searchable, stripHtml, yearsIn } from "@/lib/archive/text";
import { generateSearchQueries, describeHttpError } from "../request";
import { validateRights } from "../rights";
import type { FootageProvider, FootageSearchRequest, NormalizedFootageAsset, ProviderSearchOptions } from "../types";

const API = "https://api.wellcomecollection.org/catalogue/v2";
const SITE = "https://wellcomecollection.org";
const UA = "HouseOfVideos/1.0 (https://house-of-videos.com; documentary archive research)";

interface WellcomeLicense {
  id?: string;
  label?: string;
  url?: string;
}
interface WellcomeLocation {
  url?: string;
  credit?: string;
  license?: WellcomeLicense;
}
export interface WellcomeImage {
  id?: string;
  aspectRatio?: number;
  // `production` is declared and never ASKED for: the images endpoint refuses
  // it (see the include note below), so it arrives only if Wellcome ever adds
  // it. The optional read below then costs nothing and gains a date for free.
  source?: { id?: string; title?: string; contributors?: Array<{ agent?: { label?: string } }>; production?: Array<{ dates?: Array<{ label?: string }> }> };
  thumbnail?: WellcomeLocation;
  locations?: WellcomeLocation[];
}

/** `…/info.json` → `…/full/{w},/0/default.jpg`. */
export function iiifImage(infoUrl: string, width: number): string {
  return infoUrl.replace(/\/info\.json$/i, "").replace(/\/+$/, "") + `/full/${width},/0/default.jpg`;
}

export function normalizeWellcomeImage(im: WellcomeImage): NormalizedFootageAsset | null {
  const id = String(im.id ?? "").trim();
  const title = stripHtml(im.source?.title);
  const loc = im.locations?.[0] ?? im.thumbnail;
  const info = loc?.url ?? im.thumbnail?.url ?? null;
  if (!id || !title || !info) return null;
  const licence = loc?.license ?? im.thumbnail?.license;
  const rights = classifyLicense(licence?.id ?? null, `${licence?.label ?? ""} ${licence?.url ?? ""}`.trim(), null);
  const creator = stripHtml(im.source?.contributors?.[0]?.agent?.label);
  const date = stripHtml(im.source?.production?.[0]?.dates?.[0]?.label);
  const years = yearsIn(title, date);
  const latest = years.length ? years[years.length - 1] : null;
  const workId = im.source?.id ?? null;
  return {
    provider: "wellcome",
    providerAssetId: id,
    mediaType: "image",
    title,
    description: null,
    sourceUrl: workId ? `${SITE}/works/${encodeURIComponent(workId)}/images?id=${encodeURIComponent(id)}` : `${SITE}/search/images?query=${encodeURIComponent(title)}`,
    downloadUrl: iiifImage(info, 2000),
    thumbnailUrl: iiifImage(info, 400),
    previewUrl: null,
    width: null,
    height: null,
    durationSeconds: null,
    mimeType: "image/jpeg",
    sizeBytes: null,
    dateOriginal: date,
    yearsMentioned: years,
    creator,
    credit: loc?.credit ?? "Wellcome Collection",
    licenseOriginal: licence?.label ?? licence?.id ?? null,
    licenseCode: licence?.id ?? null,
    licenseUrl: licence?.url ?? null,
    ...rights,
    categories: [],
    searchableText: searchable(title, creator, "wellcome collection medicine science history"),
    qualityScore: 0.6,
    footageFormat: "unknown",
    origin: latest !== null && latest < 1995 ? "historical" : "generic",
    filmingDate: date,
    publicationDate: null,
    location: null,
    country: null,
    eventName: null,
    people: [],
    organizations: ["Wellcome Collection"],
    rightsText: [licence?.label, licence?.url].filter(Boolean).join(" · ") || null,
    provenance: "archival_photo",
    provenanceConfidence: 70,
  };
}

async function searchOne(q: string, limit: number, signal?: AbortSignal): Promise<NormalizedFootageAsset[]> {
  const url = new URL(`${API}/images`);
  url.searchParams.set("query", q);
  url.searchParams.set("pageSize", String(Math.min(Math.max(limit, 1), 100)));
  url.searchParams.set("include", "source.contributors");
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: signal ?? AbortSignal.timeout(20_000) });
  if (res.status === 429) throw new Error("Wellcome rate limit reached");
  if (!res.ok) throw new Error(`Wellcome answered HTTP ${res.status}` + (await describeHttpError(res)));
  const body = (await res.json()) as { results?: WellcomeImage[] };
  return (body.results ?? []).map(normalizeWellcomeImage).filter((a): a is NormalizedFootageAsset => a !== null);
}

export const wellcomeProvider: FootageProvider = {
  id: "wellcome",
  displayName: "Wellcome Collection",
  enabled: true,
  disabledReason: null,
  priority: 70,
  tier: "archive",
  categories: ["medicine", "science", "history"],
  searchCapabilities: { video: false, image: true, recentNews: false, historical: true, directDownload: true },

  async search(request: FootageSearchRequest, opts: ProviderSearchOptions) {
    const queries = generateSearchQueries(request).slice(0, 3);
    const seen = new Set<string>();
    const out: NormalizedFootageAsset[] = [];
    for (const q of queries) {
      for (const h of await searchOne(q, opts.limit, opts.signal)) {
        if (seen.has(h.providerAssetId)) continue;
        seen.add(h.providerAssetId);
        out.push(h);
      }
    }
    return out;
  },

  async getAssetDetails(id, opts) {
    const url = new URL(`${API}/images/${encodeURIComponent(id)}`);
    url.searchParams.set("include", "source.contributors");
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: opts?.signal ?? AbortSignal.timeout(15_000) });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Wellcome answered HTTP ${res.status}` + (await describeHttpError(res)));
    return normalizeWellcomeImage((await res.json()) as WellcomeImage);
  },

  async checkRights(asset) {
    return validateRights(asset);
  },

  matchesUrl(url) {
    return /(^|\.)wellcomecollection\.org$/i.test(url.hostname) && /^\/works\/[^/]+\/images/.test(url.pathname) && url.searchParams.has("id");
  },

  async importFromUrl(url, opts) {
    const id = url.searchParams.get("id");
    return id ? this.getAssetDetails!(id, opts) : null;
  },
};
