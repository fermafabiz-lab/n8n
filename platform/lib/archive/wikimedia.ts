/**
 * Wikimedia Commons — the first archive, and the only keyless one.
 *
 * MediaWiki API, `generator=search` over the File namespace with
 * `prop=imageinfo|categories`. Everything here was read off real responses
 * (executions 10893, 10895, 10898 on wf7), not off the docs:
 *
 * - `filetype:video` finds both `.webm` (video/webm) and `.ogv`
 *   (application/ogg); `filemime:video/ogg` finds nothing, because the ogv's
 *   MIME is `application/ogg`. `filetype:bitmap` also returns animated GIFs,
 *   which carry a `duration` and are skipped here — neither a still nor a
 *   clip the pipeline can use.
 * - `formatversion=2` makes `query.pages` an ARRAY; v1 keys it by pageid.
 *   Both are tolerated below because the difference is one line.
 * - `extmetadata` is `{Key: {value, source, hidden?}}`. `License` is the
 *   machine code ("pd", "cc-by-sa-4.0") and can be ABSENT (a FAL image had
 *   only `LicenseShortName: "FAL"`); `Copyrighted: "False"` is the other
 *   public-domain signal. `AttributionRequired` is the string "true"/"false".
 * - `DateTimeOriginal` is whatever the uploader typed: "1969-07-16",
 *   "Taken on 16 July 1969", or the YouTube upload date of a 1969 clip.
 * - Videos are VP9/Opus or Theora — nothing the pipeline plays as-is — and
 *   a single file can be 500 MB. The download URL is stored; the cut to an
 *   8-second mp4 segment happens elsewhere and never fetches the whole file.
 */

import { classifyLicense } from "./rights";
import { qualityScoreOf, searchable, stripHtml, yearsIn } from "./text";
import type {
  ArchiveMediaType,
  ArchiveProviderAdapter,
  ArchiveSearchOptions,
  NormalizedArchiveAsset,
} from "./types";

const API = "https://commons.wikimedia.org/w/api.php";
/** Commons asks every API client to identify itself. No personal data in it. */
const USER_AGENT = "HouseOfVideos/1.0 (https://house-of-videos.com; documentary archive research)";
const EXT_FIELDS =
  "License|LicenseShortName|LicenseUrl|UsageTerms|Artist|Credit|ImageDescription|DateTimeOriginal|ObjectName|Categories|AttributionRequired|Copyrighted";

interface ExtValue {
  value?: string;
  hidden?: string;
}
interface ImageInfo {
  url?: string;
  descriptionurl?: string;
  thumburl?: string;
  size?: number;
  width?: number;
  height?: number;
  duration?: number;
  mime?: string;
  mediatype?: string;
  extmetadata?: Record<string, ExtValue>;
}
interface Page {
  pageid: number;
  title: string;
  missing?: boolean;
  imageinfo?: ImageInfo[];
  categories?: Array<{ title: string }>;
}

async function call(params: Record<string, string>, signal?: AbortSignal): Promise<Page[]> {
  const url = new URL(API);
  for (const [k, v] of Object.entries({ format: "json", formatversion: "2", ...params })) {
    url.searchParams.set(k, v);
  }
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    signal: signal ?? AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Commons answered HTTP ${res.status}`);
  const body = (await res.json()) as {
    error?: { info?: string };
    query?: { pages?: Page[] | Record<string, Page> };
  };
  if (body.error) throw new Error(`Commons: ${body.error.info ?? "error"}`);
  const pages = body.query?.pages;
  if (!pages) return [];
  return Array.isArray(pages) ? pages : Object.values(pages);
}

/** Drop the `?utm_source=…` Commons appends to every file URL. */
const clean = (u: string | undefined): string | null => {
  if (!u) return null;
  const i = u.indexOf("?");
  return i === -1 ? u : u.slice(0, i);
};

/** Exported for the fixture test — the response shapes above are the spec. */
export function normalizeCommonsPage(page: Page): NormalizedArchiveAsset | null {
  return normalize(page);
}

function normalize(page: Page): NormalizedArchiveAsset | null {
  const info = page.imageinfo?.[0];
  if (!info || page.missing || !info.url || !info.descriptionurl) return null;
  const mediaType: ArchiveMediaType | null =
    info.mediatype === "VIDEO" ? "video"
    : info.mediatype === "BITMAP" && info.mime !== "image/gif" ? "image"
    : null;
  if (!mediaType) return null;

  const ext = (k: string) => info.extmetadata?.[k]?.value ?? null;
  const title =
    stripHtml(ext("ObjectName")) ??
    page.title.replace(/^File:/, "").replace(/\.[a-z0-9]{2,4}$/i, "");
  const description = stripHtml(ext("ImageDescription"));
  const creator = stripHtml(ext("Artist"));
  const credit = stripHtml(ext("Credit"));
  const dateOriginal = stripHtml(ext("DateTimeOriginal"));

  const catSet = new Set<string>();
  for (const c of page.categories ?? []) catSet.add(c.title.replace(/^Category:/, ""));
  for (const c of String(ext("Categories") ?? "").split("|")) if (c.trim()) catSet.add(c.trim());
  const categories = [...catSet];

  const attrRaw = ext("AttributionRequired");
  const attributionHint = attrRaw === "true" ? true : attrRaw === "false" ? false : null;
  // A public-domain template sometimes carries no `License` code at all;
  // `Copyrighted: "False"` is then the only machine-readable signal.
  const code = ext("License") ?? (ext("Copyrighted") === "False" ? "pd" : null);
  const rights = classifyLicense(code, ext("LicenseShortName") ?? ext("UsageTerms"), attributionHint);

  const width = info.width ?? null;
  const height = info.height ?? null;
  const durationSeconds = typeof info.duration === "number" ? info.duration : null;

  return {
    provider: "wikimedia",
    providerAssetId: String(page.pageid),
    mediaType,
    title,
    description,
    sourceUrl: info.descriptionurl,
    downloadUrl: clean(info.url)!,
    thumbnailUrl: clean(info.thumburl),
    width,
    height,
    durationSeconds,
    mimeType: info.mime ?? null,
    sizeBytes: info.size ?? null,
    dateOriginal,
    yearsMentioned: yearsIn(title, description, dateOriginal),
    creator,
    credit,
    licenseOriginal: ext("LicenseShortName") ?? ext("UsageTerms"),
    licenseCode: ext("License"),
    licenseUrl: ext("LicenseUrl"),
    ...rights,
    categories,
    searchableText: searchable(title, description, categories, creator),
    qualityScore: qualityScoreOf(width, height, durationSeconds, mediaType),
  };
}

const PROPS = {
  prop: "imageinfo|categories",
  iiprop: "url|size|mime|mediatype|extmetadata",
  iiurlwidth: "640",
  iiextmetadatafilter: EXT_FIELDS,
  cllimit: "20",
};

async function searchOne(
  query: string,
  mediaType: ArchiveMediaType,
  limit: number,
  signal?: AbortSignal,
): Promise<NormalizedArchiveAsset[]> {
  const pages = await call(
    {
      action: "query",
      generator: "search",
      gsrnamespace: "6",
      gsrsearch: `${query} filetype:${mediaType === "video" ? "video" : "bitmap"}`,
      gsrlimit: String(Math.min(Math.max(limit, 1), 50)),
      ...PROPS,
    },
    signal,
  );
  // `index` is the relevance rank; pages arrive in arbitrary order.
  pages.sort((a, b) => ((a as { index?: number }).index ?? 0) - ((b as { index?: number }).index ?? 0));
  return pages.map(normalize).filter((a): a is NormalizedArchiveAsset => a !== null);
}

export const wikimedia: ArchiveProviderAdapter = {
  provider: "wikimedia",
  enabled: true,
  disabledReason: null,

  async search(query: string, opts: ArchiveSearchOptions) {
    const q = query.trim();
    if (!q) return [];
    if (opts.mediaType === "any") {
      const [videos, images] = await Promise.all([
        searchOne(q, "video", opts.limit, opts.signal),
        searchOne(q, "image", opts.limit, opts.signal),
      ]);
      return [...videos, ...images];
    }
    return searchOne(q, opts.mediaType, opts.limit, opts.signal);
  },

  async getAsset(providerAssetId: string, opts) {
    if (!/^\d+$/.test(providerAssetId)) return null;
    const pages = await call({ action: "query", pageids: providerAssetId, ...PROPS }, opts?.signal);
    return pages.length ? normalize(pages[0]) : null;
  },
};
