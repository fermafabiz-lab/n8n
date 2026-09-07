/**
 * The archive library — `hov.stock_media` — from the site's side.
 *
 * Postgres only. There is no Airtable half because the table never existed
 * there: Documentary mode is the first feature born after the cutover.
 * Everything a scene needs from an asset is read back through here.
 */

import { atQuery } from "./postgres";
import type {
  ArchiveMediaType,
  ArchiveProvider,
  NormalizedArchiveAsset,
  ReviewStatus,
  RightsStatus,
  UseStatus,
} from "@/lib/archive/types";

export type StockStatus = "candidate" | "approved" | "rejected" | "used";

/** A library row: the normalized asset plus what the library knows about it. */
export interface StockMedia extends NormalizedArchiveAsset {
  id: string;
  status: StockStatus;
  timesFound: number;
  createdAt: string;
}

interface Row {
  id: string;
  provider: ArchiveProvider;
  provider_asset_id: string;
  media_type: ArchiveMediaType;
  title: string;
  description: string | null;
  source_url: string;
  download_url: string;
  thumbnail_url: string | null;
  width: number | null;
  height: number | null;
  duration_seconds: string | number | null;
  mime_type: string | null;
  size_bytes: string | number | null;
  date_original: string | null;
  years_mentioned: number[];
  creator: string | null;
  credit: string | null;
  license_original: string | null;
  license_code: string | null;
  license_url: string | null;
  rights_status: RightsStatus;
  commercial_use: UseStatus;
  modifications: UseStatus;
  attribution_required: boolean;
  review_status: ReviewStatus;
  review_reason: string | null;
  status: StockStatus;
  categories: string[];
  searchable_text: string;
  quality_score: number | null;
  times_found: number;
  created_at: Date;
}

const num = (v: string | number | null): number | null =>
  v === null || v === undefined ? null : Number(v);

function toStock(r: Row): StockMedia {
  return {
    id: r.id,
    provider: r.provider,
    providerAssetId: r.provider_asset_id,
    mediaType: r.media_type,
    title: r.title,
    description: r.description,
    sourceUrl: r.source_url,
    downloadUrl: r.download_url,
    thumbnailUrl: r.thumbnail_url,
    width: r.width,
    height: r.height,
    durationSeconds: num(r.duration_seconds),
    mimeType: r.mime_type,
    sizeBytes: num(r.size_bytes),
    dateOriginal: r.date_original,
    yearsMentioned: r.years_mentioned ?? [],
    creator: r.creator,
    credit: r.credit,
    licenseOriginal: r.license_original,
    licenseCode: r.license_code,
    licenseUrl: r.license_url,
    rightsStatus: r.rights_status,
    commercialUse: r.commercial_use,
    modifications: r.modifications,
    attributionRequired: r.attribution_required,
    reviewStatus: r.review_status,
    reviewReason: r.review_reason,
    categories: r.categories ?? [],
    searchableText: r.searchable_text,
    qualityScore: r.quality_score ?? 0,
    status: r.status,
    timesFound: r.times_found,
    createdAt: r.created_at.toISOString(),
  };
}

const COLS = `id, provider, provider_asset_id, media_type, title, description, source_url,
  download_url, thumbnail_url, width, height, duration_seconds, mime_type, size_bytes,
  date_original, years_mentioned, creator, credit, license_original, license_code,
  license_url, rights_status, commercial_use, modifications, attribution_required,
  review_status, review_reason, status, categories, searchable_text, quality_score,
  times_found, created_at`;

/**
 * File what a search surfaced, and hand back the library ids.
 *
 * One statement per asset, on conflict REFRESH: the rights verdict, the
 * download URL and the metadata all follow the provider's current answer,
 * while `status` — the producer's decision — is deliberately not in the
 * update list. `times_found` and `last_query` are the cheap signal for which
 * assets keep coming up.
 */
export async function saveStockCandidates(
  assets: NormalizedArchiveAsset[],
  query: string,
): Promise<Map<string, StockMedia>> {
  const out = new Map<string, StockMedia>();
  for (const a of assets) {
    const rows = await atQuery<Row>(
      `insert into hov.stock_media (
         provider, provider_asset_id, media_type, title, description, source_url,
         download_url, thumbnail_url, width, height, duration_seconds, mime_type,
         size_bytes, date_original, years_mentioned, creator, credit, license_original,
         license_code, license_url, rights_status, commercial_use, modifications,
         attribution_required, review_status, review_reason, categories,
         searchable_text, quality_score, first_query, last_query)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
               $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$30)
       on conflict (provider, provider_asset_id) do update set
         title = excluded.title,
         description = excluded.description,
         source_url = excluded.source_url,
         download_url = excluded.download_url,
         thumbnail_url = excluded.thumbnail_url,
         width = excluded.width,
         height = excluded.height,
         duration_seconds = excluded.duration_seconds,
         mime_type = excluded.mime_type,
         size_bytes = excluded.size_bytes,
         date_original = excluded.date_original,
         years_mentioned = excluded.years_mentioned,
         creator = excluded.creator,
         credit = excluded.credit,
         license_original = excluded.license_original,
         license_code = excluded.license_code,
         license_url = excluded.license_url,
         rights_status = excluded.rights_status,
         commercial_use = excluded.commercial_use,
         modifications = excluded.modifications,
         attribution_required = excluded.attribution_required,
         review_status = excluded.review_status,
         review_reason = excluded.review_reason,
         categories = excluded.categories,
         searchable_text = excluded.searchable_text,
         quality_score = excluded.quality_score,
         last_query = excluded.last_query,
         times_found = hov.stock_media.times_found + 1
       returning ${COLS}`,
      [
        a.provider,
        a.providerAssetId,
        a.mediaType,
        a.title,
        a.description,
        a.sourceUrl,
        a.downloadUrl,
        a.thumbnailUrl,
        a.width,
        a.height,
        a.durationSeconds,
        a.mimeType,
        a.sizeBytes,
        a.dateOriginal,
        a.yearsMentioned,
        a.creator,
        a.credit,
        a.licenseOriginal,
        a.licenseCode,
        a.licenseUrl,
        a.rightsStatus,
        a.commercialUse,
        a.modifications,
        a.attributionRequired,
        a.reviewStatus,
        a.reviewReason,
        a.categories,
        a.searchableText,
        a.qualityScore,
        query.slice(0, 200),
      ],
    );
    if (rows[0]) out.set(`${a.provider}:${a.providerAssetId}`, toStock(rows[0]));
  }
  return out;
}

export async function getStockMedia(id: string): Promise<StockMedia | null> {
  const rows = await atQuery<Row>(`select ${COLS} from hov.stock_media where id = $1`, [id]);
  return rows[0] ? toStock(rows[0]) : null;
}

/**
 * The library's own search — what has already been seen, without asking the
 * archives again. Full-text over `searchable_text`, newest sightings first
 * among equals. Rejected assets are excluded: the producer said no once.
 */
export async function searchStockLibrary(
  q: string,
  opts: { mediaType: ArchiveMediaType | "any"; limit: number },
): Promise<StockMedia[]> {
  const words = q
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter((w) => w.length > 1);
  if (!words.length) return [];
  const tsq = words.map((w) => `${w}:*`).join(" & ");
  const rows = await atQuery<Row>(
    `select ${COLS} from hov.stock_media
      where status <> 'rejected'
        and ($2 = 'any' or media_type = $2)
        and to_tsvector('simple', searchable_text) @@ to_tsquery('simple', $1)
      order by ts_rank(to_tsvector('simple', searchable_text), to_tsquery('simple', $1)) desc,
               quality_score desc nulls last, updated_at desc
      limit $3`,
    [tsq, opts.mediaType, Math.min(Math.max(opts.limit, 1), 100)],
  );
  return rows.map(toStock);
}

export async function setStockStatus(id: string, status: StockStatus): Promise<void> {
  await atQuery(`update hov.stock_media set status = $2 where id = $1`, [id, status]);
}
