/**
 * The archive library — `hov.stock_media` — from the site's side.
 *
 * Postgres only. There is no Airtable half because the table never existed
 * there: Documentary mode is the first feature born after the cutover.
 * Everything a scene needs from an asset is read back through here.
 */

import { createHash } from "node:crypto";
import { atQuery, footageReady, provenanceReady, withTransaction } from "./postgres";
import type {
  ArchiveMediaType,
  ArchiveProvider,
  FootageFormat,
  FootageOrigin,
  FootageProvenance,
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
  updatedAt: string;
  /** db/010: where an upload's bytes live, and its hash; null for links. */
  mediaPath: string | null;
  contentHash: string | null;
  availabilityStatus: "available" | "unavailable" | "unknown";
  verifiedAt: string | null;
  verifiedNote: string | null;
  notes: string | null;
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
  updated_at?: Date | null;
  /** db/010 — every one optional, so a read before the migration still maps. */
  preview_url?: string | null;
  footage_format?: string | null;
  origin?: string | null;
  filming_date?: string | null;
  publication_date?: string | null;
  location?: string | null;
  country?: string | null;
  event_name?: string | null;
  people?: string[] | null;
  organizations?: string[] | null;
  rights_text?: string | null;
  provenance?: string | null;
  provenance_confidence?: number | null;
  availability_status?: string | null;
  media_path?: string | null;
  content_hash?: string | null;
  verified_at?: Date | null;
  verified_note?: string | null;
  notes?: string | null;
}

const num = (v: string | number | null | undefined): number | null =>
  v === null || v === undefined ? null : Number(v);

const FORMATS: readonly FootageFormat[] = ["broll", "stockshots", "speech", "press_conference", "interview", "news_package", "live_stream", "documentary", "unknown"];
const ORIGINS: readonly FootageOrigin[] = ["recent_news", "official_media", "historical", "generic", "user_upload"];
const PROVENANCES: readonly FootageProvenance[] = ["actual_footage", "illustrative_footage", "archival_footage", "archival_photo", "real_stock", "unknown"];
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  (allowed as readonly string[]).includes(String(v)) ? (v as T) : fallback;

function toStock(r: Row): StockMedia {
  return {
    // db/010 enrichments first, so the spread of the classic fields below
    // can never be shadowed by an older row's missing columns.
    previewUrl: r.preview_url ?? null,
    footageFormat: oneOf(r.footage_format, FORMATS, "unknown"),
    origin: oneOf(r.origin, ORIGINS, "generic"),
    filmingDate: r.filming_date ?? null,
    publicationDate: r.publication_date ?? null,
    location: r.location ?? null,
    country: r.country ?? null,
    eventName: r.event_name ?? null,
    people: r.people ?? [],
    organizations: r.organizations ?? [],
    rightsText: r.rights_text ?? null,
    provenance: oneOf(r.provenance, PROVENANCES, "unknown"),
    provenanceConfidence: r.provenance_confidence ?? undefined,
    availabilityStatus: oneOf(r.availability_status, ["available", "unavailable", "unknown"] as const, "available"),
    mediaPath: r.media_path ?? null,
    contentHash: r.content_hash ?? null,
    verifiedAt: r.verified_at ? r.verified_at.toISOString() : null,
    verifiedNote: r.verified_note ?? null,
    notes: r.notes ?? null,
    updatedAt: (r.updated_at ?? r.created_at).toISOString(),
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

/**
 * `select *` rather than a column list: the db/010 columns are optional on the
 * Row type, so a database that has not had the migration still answers, and
 * one that has answers with everything. (The old explicit list is what made
 * every new column a two-place edit.)
 */
const COLS = `*`;

const ENRICH_COLS = `preview_url, footage_format, origin, filming_date, publication_date, location, country,
  event_name, people, organizations, rights_text, provenance, provenance_confidence, media_path, content_hash`;

/**
 * File what a search surfaced, and hand back the library ids.
 *
 * One statement per asset, on conflict REFRESH: the rights verdict, the
 * download URL and the metadata all follow the provider's current answer,
 * while `status` — the producer's decision — is deliberately not in the
 * update list, and neither are the verification columns or a provenance a
 * person set (`verified_at` guards it). `times_found` and `last_query` are
 * the cheap signal for which assets keep coming up.
 */
export async function saveStockCandidates(
  assets: NormalizedArchiveAsset[],
  query: string,
): Promise<Map<string, StockMedia>> {
  const out = new Map<string, StockMedia>();
  const enriched = await footageReady();
  for (const a of assets) {
    const base = [
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
    ];
    const extra = enriched
      ? [
          a.previewUrl ?? null,
          oneOf(a.footageFormat, FORMATS, "unknown"),
          oneOf(a.origin, ORIGINS, "generic"),
          a.filmingDate ?? null,
          a.publicationDate ?? null,
          a.location ?? null,
          a.country ?? null,
          a.eventName ?? null,
          a.people ?? [],
          a.organizations ?? [],
          a.rightsText ?? null,
          oneOf(a.provenance, PROVENANCES, "unknown"),
          a.provenanceConfidence ?? null,
          (a as { mediaPath?: string | null }).mediaPath ?? null,
          (a as { contentHash?: string | null }).contentHash ?? null,
        ]
      : [];
    const rows = await atQuery<Row>(
      `insert into hov.stock_media (
         provider, provider_asset_id, media_type, title, description, source_url,
         download_url, thumbnail_url, width, height, duration_seconds, mime_type,
         size_bytes, date_original, years_mentioned, creator, credit, license_original,
         license_code, license_url, rights_status, commercial_use, modifications,
         attribution_required, review_status, review_reason, categories,
         searchable_text, quality_score, first_query, last_query${enriched ? `, ${ENRICH_COLS}` : ""})
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
               $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$30${enriched ? ",$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41,$42,$43,$44,$45" : ""})
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
         times_found = hov.stock_media.times_found + 1${
           enriched
             ? `,
         preview_url = coalesce(excluded.preview_url, hov.stock_media.preview_url),
         footage_format = case when excluded.footage_format = 'unknown' then hov.stock_media.footage_format else excluded.footage_format end,
         origin = excluded.origin,
         filming_date = coalesce(excluded.filming_date, hov.stock_media.filming_date),
         publication_date = coalesce(excluded.publication_date, hov.stock_media.publication_date),
         location = coalesce(excluded.location, hov.stock_media.location),
         country = coalesce(excluded.country, hov.stock_media.country),
         event_name = coalesce(excluded.event_name, hov.stock_media.event_name),
         people = case when cardinality(excluded.people) = 0 then hov.stock_media.people else excluded.people end,
         organizations = case when cardinality(excluded.organizations) = 0 then hov.stock_media.organizations else excluded.organizations end,
         rights_text = coalesce(excluded.rights_text, hov.stock_media.rights_text),
         -- A provenance a person set (verified_at) is never overwritten by a re-sighting.
         provenance = case when hov.stock_media.verified_at is not null then hov.stock_media.provenance else excluded.provenance end,
         provenance_confidence = case when hov.stock_media.verified_at is not null then hov.stock_media.provenance_confidence else excluded.provenance_confidence end,
         media_path = coalesce(excluded.media_path, hov.stock_media.media_path),
         content_hash = coalesce(excluded.content_hash, hov.stock_media.content_hash)`
             : ""
         }
       returning ${COLS}`,
      [...base, ...extra],
    );
    if (rows[0]) out.set(`${a.provider}:${a.providerAssetId}`, toStock(rows[0]));
  }
  return out;
}

/** What the engine needs from a scene to build a request: its own words. */
export async function getSceneForFootage(
  sceneId: string,
): Promise<{ id: string; projectId: string; narration: string; visual: string | null; imagePrompt: string | null } | null> {
  const rows = await atQuery<{ id: string; project_id: string; narration: string | null; visual_prompt: string | null; image_prompt: string | null }>(
    `select id, project_id, narration, visual_prompt, image_prompt from hov.scene where id = $1`,
    [sceneId],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    projectId: r.project_id,
    narration: (r.narration ?? "").replace(/\[[^\]]{0,60}\]\s*/g, " ").replace(/\s+/g, " ").trim(),
    visual: r.visual_prompt,
    imagePrompt: r.image_prompt,
  };
}

/** What attaching needs to know about the scene: whose film, which order, which canvas. */
export async function getSceneCanvas(
  sceneId: string,
): Promise<{ projectId: string; order: number; portrait: boolean } | null> {
  const rows = await atQuery<{ project_id: string; scene_order: number; aspect: string | null }>(
    `select s.project_id, s.scene_order, p.aspect
       from hov.scene s join hov.project p on p.id = s.project_id
      where s.id = $1`,
    [sceneId],
  );
  const r = rows[0];
  return r ? { projectId: r.project_id, order: r.scene_order, portrait: r.aspect === "9:16" } : null;
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
  opts: { mediaType: ArchiveMediaType | "any"; limit: number; provider?: ArchiveProvider; providers?: ArchiveProvider[] },
): Promise<StockMedia[]> {
  const words = q
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter((w) => w.length > 1);
  if (!words.length) return [];
  // OR, not AND: the engine hands this several short queries and wants the
  // union ranked, and an AND over "ceuta migrants spain" finds only rows that
  // say all three. Prefix-matched so "migrant" finds "migrants".
  const tsq = words.map((w) => `${w}:*`).join(" | ");
  const providers = opts.providers?.length ? opts.providers : opts.provider ? [opts.provider] : null;
  const rows = await atQuery<Row>(
    `select ${COLS} from hov.stock_media
      where status <> 'rejected'
        and ($2 = 'any' or media_type = $2)
        and ($4::text[] is null or provider = any($4))
        and to_tsvector('simple', searchable_text) @@ to_tsquery('simple', $1)
      order by ts_rank(to_tsvector('simple', searchable_text), to_tsquery('simple', $1)) desc,
               quality_score desc nulls last, updated_at desc
      limit $3`,
    [tsq, opts.mediaType, Math.min(Math.max(opts.limit, 1), 100), providers],
  );
  return rows.map(toStock);
}

export async function setStockStatus(id: string, status: StockStatus): Promise<void> {
  await atQuery(`update hov.stock_media set status = $2 where id = $1`, [id, status]);
}

/** `provider:providerAssetId` of every asset a scene has taken in the last 90 days — the ranker's "recently reused". */
export async function recentlyUsedProviderAssetKeys(): Promise<Set<string>> {
  const rows = await atQuery<{ provider: string; provider_asset_id: string }>(
    `select m.provider, m.provider_asset_id
       from hov.scene s join hov.stock_media m on m.id = s.stock_media_id
      where s.stock_media_id is not null
        and coalesce(s.updated_at, s.created_at) > now() - interval '90 days'`,
  ).catch(() => []);
  return new Set(rows.map((r) => `${r.provider}:${r.provider_asset_id}`));
}

// ---------------------------------------------------------------------------
// The search cache (db/010)
// ---------------------------------------------------------------------------

const CACHE_TTL_HOURS = 6;

/** The fingerprint of a request: what it asks FOR, not which scene asked. */
function cacheKey(r: { event?: string; location?: string; country?: string; dateFrom?: string; dateTo?: string; keywords: string[]; preferredMediaType: string; preferredFootageType?: string; queries?: string[] }): string {
  const core = JSON.stringify({
    e: (r.event ?? "").toLowerCase(),
    l: (r.location ?? "").toLowerCase(),
    c: (r.country ?? "").toLowerCase(),
    d: [r.dateFrom ?? "", r.dateTo ?? ""],
    k: [...r.keywords].map((k) => k.toLowerCase()).sort(),
    m: r.preferredMediaType,
    t: r.preferredFootageType ?? "any",
    q: [...(r.queries ?? [])].map((q) => q.toLowerCase()).sort(),
  });
  return createHash("sha256").update(core).digest("hex").slice(0, 32);
}

export async function readSearchCache(r: Parameters<typeof cacheKey>[0]): Promise<StockMedia[] | null> {
  if (!(await footageReady())) return null;
  const hit = await atQuery<{ stock_ids: string[] }>(
    `select stock_ids from hov.footage_search_cache
      where cache_key = $1 and created_at > now() - ($2 || ' hours')::interval`,
    [cacheKey(r), String(CACHE_TTL_HOURS)],
  );
  const ids = hit[0]?.stock_ids ?? null;
  if (!ids) return null;
  if (!ids.length) return [];
  const rows = await atQuery<Row>(`select ${COLS} from hov.stock_media where id = any($1) and status <> 'rejected'`, [ids]);
  return rows.map(toStock);
}

export async function writeSearchCache(r: Parameters<typeof cacheKey>[0], stockIds: string[]): Promise<void> {
  if (!(await footageReady())) return;
  await atQuery(
    `insert into hov.footage_search_cache (cache_key, request, stock_ids)
     values ($1, $2::jsonb, $3)
     on conflict (cache_key) do update set request = excluded.request, stock_ids = excluded.stock_ids, created_at = now()`,
    [cacheKey(r), JSON.stringify(r), stockIds],
  );
  // Opportunistic housekeeping, cheap and never awaited by anyone in particular.
  await atQuery(`delete from hov.footage_search_cache where created_at < now() - interval '1 day'`).catch(() => {});
}

// ---------------------------------------------------------------------------
// The admin page (db/010)
// ---------------------------------------------------------------------------

export interface StockFilter {
  provider?: string;
  mediaType?: ArchiveMediaType | "any";
  reviewStatus?: ReviewStatus | "any";
  status?: StockStatus | "any";
  provenance?: FootageProvenance | "any";
  origin?: FootageOrigin | "recent" | "historical" | "any";
  event?: string;
  country?: string;
  year?: number;
  q?: string;
  limit?: number;
  offset?: number;
}

/** The library, filtered the way the admin page asks. Newest sightings first. */
export async function listStockMedia(f: StockFilter): Promise<{ rows: StockMedia[]; total: number }> {
  const where: string[] = ["true"];
  const params: unknown[] = [];
  const add = (sql: string, v: unknown) => {
    params.push(v);
    where.push(sql.replace("?", `$${params.length}`));
  };
  if (f.provider && f.provider !== "all") add("provider = ?", f.provider);
  if (f.mediaType && f.mediaType !== "any") add("media_type = ?", f.mediaType);
  if (f.reviewStatus && f.reviewStatus !== "any") add("review_status = ?", f.reviewStatus);
  if (f.status && f.status !== "any") add("status = ?", f.status);
  const enriched = await footageReady();
  if (enriched) {
    if (f.provenance && f.provenance !== "any") add("provenance = ?", f.provenance);
    if (f.origin === "recent") where.push("origin in ('recent_news', 'official_media')");
    else if (f.origin === "historical") where.push("origin = 'historical'");
    else if (f.origin && f.origin !== "any") add("origin = ?", f.origin);
    if (f.event) add("(event_name ilike ? or title ilike $" + (params.length + 1) + ")", `%${f.event}%`);
    if (f.country) add("(country ilike ? or location ilike $" + (params.length + 1) + ")", `%${f.country}%`);
  }
  if (f.year) add("? = any(years_mentioned)", f.year);
  if (f.q) {
    const words = f.q.toLowerCase().split(/\s+/).map((w) => w.replace(/[^\p{L}\p{N}]/gu, "")).filter((w) => w.length > 1);
    if (words.length) add("to_tsvector('simple', searchable_text) @@ to_tsquery('simple', ?)", words.map((w) => `${w}:*`).join(" & "));
  }
  const limit = Math.min(Math.max(f.limit ?? 60, 1), 200);
  const offset = Math.max(f.offset ?? 0, 0);
  const cond = where.join(" and ");
  const [rows, count] = await Promise.all([
    atQuery<Row>(`select ${COLS} from hov.stock_media where ${cond} order by updated_at desc limit ${limit} offset ${offset}`, params),
    atQuery<{ n: string }>(`select count(*)::text as n from hov.stock_media where ${cond}`, params),
  ]);
  return { rows: rows.map(toStock), total: Number(count[0]?.n ?? 0) };
}

/** What a person may change about a library row from the admin page. */
export interface StockPatch {
  title?: string;
  description?: string | null;
  eventName?: string | null;
  location?: string | null;
  country?: string | null;
  filmingDate?: string | null;
  categories?: string[];
  people?: string[];
  organizations?: string[];
  provenance?: FootageProvenance;
  provenanceConfidence?: number | null;
  /** A person's rights decision, over the licence classifier's. */
  reviewStatus?: ReviewStatus;
  reviewReason?: string | null;
  licenseOriginal?: string | null;
  attributionRequired?: boolean;
  credit?: string | null;
  notes?: string | null;
}

export async function updateStockMedia(id: string, p: StockPatch, verifiedNote?: string | null): Promise<StockMedia | null> {
  const enriched = await footageReady();
  const sets: string[] = [];
  const params: unknown[] = [id];
  const set = (col: string, v: unknown) => {
    params.push(v);
    sets.push(`${col} = $${params.length}`);
  };
  if (p.title !== undefined) set("title", p.title);
  if (p.description !== undefined) set("description", p.description);
  if (p.categories !== undefined) set("categories", p.categories);
  if (p.reviewStatus !== undefined) set("review_status", p.reviewStatus);
  if (p.reviewReason !== undefined) set("review_reason", p.reviewReason);
  if (p.licenseOriginal !== undefined) set("license_original", p.licenseOriginal);
  if (p.attributionRequired !== undefined) set("attribution_required", p.attributionRequired);
  if (p.credit !== undefined) set("credit", p.credit);
  if (enriched) {
    if (p.eventName !== undefined) set("event_name", p.eventName);
    if (p.location !== undefined) set("location", p.location);
    if (p.country !== undefined) set("country", p.country);
    if (p.filmingDate !== undefined) set("filming_date", p.filmingDate);
    if (p.people !== undefined) set("people", p.people);
    if (p.organizations !== undefined) set("organizations", p.organizations);
    if (p.provenance !== undefined) set("provenance", oneOf(p.provenance, PROVENANCES, "unknown"));
    if (p.provenanceConfidence !== undefined) set("provenance_confidence", p.provenanceConfidence);
    if (p.notes !== undefined) set("notes", p.notes);
    // A person touched it: from now on a re-sighting keeps their provenance.
    sets.push("verified_at = now()");
    if (verifiedNote !== undefined) set("verified_note", verifiedNote);
  }
  if (!sets.length) return getStockMedia(id);
  const rows = await atQuery<Row>(`update hov.stock_media set ${sets.join(", ")} where id = $1 returning ${COLS}`, params);
  return rows[0] ? toStock(rows[0]) : null;
}

/** Drop a row from the index. Scenes that already took it keep their bytes and lose the link. */
export async function deleteStockMedia(id: string): Promise<boolean> {
  const rows = await atQuery<{ id: string }>(`delete from hov.stock_media where id = $1 returning id`, [id]);
  return rows.length > 0;
}

/**
 * File a producer's own upload. The bytes are already in the media store
 * (the route put them there, content-addressed); this records the row with
 * whatever the person declared and NOTHING more: rights are their statement,
 * provenance is `unknown` until they or the admin page say otherwise, and the
 * hash is the dedupe identity so the same file twice is one row.
 */
export async function saveUploadedFootage(o: {
  mediaType: ArchiveMediaType;
  title: string;
  description: string | null;
  sourceUrl: string;
  mediaUrl: string;
  mediaPath: string;
  thumbnailUrl: string | null;
  contentHash: string;
  mimeType: string | null;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  filmingDate: string | null;
  location: string | null;
  country: string | null;
  eventName: string | null;
  owner: string | null;
  rightsStatus: "cleared" | "attribution_required" | "manual_review" | "restricted";
  attribution: string | null;
  notes: string | null;
  provenance?: FootageProvenance;
}): Promise<StockMedia> {
  const declared = o.rightsStatus;
  const asset: NormalizedArchiveAsset & { mediaPath: string; contentHash: string } = {
    provider: "user_upload",
    providerAssetId: o.contentHash,
    mediaType: o.mediaType,
    title: o.title,
    description: o.description,
    sourceUrl: o.sourceUrl,
    downloadUrl: o.mediaUrl,
    thumbnailUrl: o.thumbnailUrl,
    previewUrl: null,
    width: o.width,
    height: o.height,
    durationSeconds: o.durationSeconds,
    mimeType: o.mimeType,
    sizeBytes: o.sizeBytes,
    dateOriginal: o.filmingDate,
    yearsMentioned: [],
    creator: o.owner,
    credit: o.attribution ?? o.owner,
    licenseOriginal:
      declared === "cleared" ? "Uploaded — rights cleared by the producer"
      : declared === "attribution_required" ? "Uploaded — credit required (producer's statement)"
      : declared === "restricted" ? "Uploaded — restricted (producer's statement)"
      : null,
    licenseCode: null,
    licenseUrl: null,
    rightsStatus: declared === "cleared" || declared === "attribution_required" ? "other_free" : declared === "restricted" ? "restricted" : "unknown",
    commercialUse: declared === "cleared" || declared === "attribution_required" ? "allowed" : declared === "restricted" ? "forbidden" : "unknown",
    modifications: declared === "cleared" || declared === "attribution_required" ? "allowed" : declared === "restricted" ? "forbidden" : "unknown",
    attributionRequired: declared === "attribution_required",
    reviewStatus: declared === "cleared" || declared === "attribution_required" ? "auto_approved" : declared === "restricted" ? "rejected" : "manual_review",
    reviewReason:
      declared === "manual_review" ? "Uploaded without a rights statement — a person must establish them."
      : declared === "restricted" ? "The uploader marked this restricted."
      : null,
    categories: [],
    searchableText: [o.title, o.description, o.eventName, o.location, o.country, o.owner].filter(Boolean).join(" ").toLowerCase().slice(0, 4000),
    qualityScore: 0.5,
    footageFormat: "unknown",
    origin: "user_upload",
    filmingDate: o.filmingDate,
    publicationDate: null,
    location: o.location,
    country: o.country,
    eventName: o.eventName,
    people: [],
    organizations: o.owner ? [o.owner] : [],
    rightsText: [o.attribution, o.notes].filter(Boolean).join(" · ") || null,
    // Never authentic by upload (§25).
    provenance: o.provenance && o.provenance !== "actual_footage" ? o.provenance : "unknown",
    provenanceConfidence: o.provenance && o.provenance !== "actual_footage" && o.provenance !== "unknown" ? 60 : 0,
    mediaPath: o.mediaPath,
    contentHash: o.contentHash,
  };
  const filed = await saveStockCandidates([asset], `upload:${o.title.slice(0, 120)}`);
  const row = filed.get(`user_upload:${o.contentHash}`);
  if (!row) throw new Error("the upload could not be filed in the library");
  if (o.notes) await atQuery(`update hov.stock_media set notes = $2 where id = $1`, [row.id, o.notes]).catch(() => {});
  return row;
}

/** Every distinct provider the library holds — including retired ones, for the filter. */
export async function stockProviders(): Promise<Array<{ provider: string; n: number }>> {
  const rows = await atQuery<{ provider: string; n: string }>(
    `select provider, count(*)::text as n from hov.stock_media group by provider order by count(*) desc`,
  ).catch(() => []);
  return rows.map((r) => ({ provider: r.provider, n: Number(r.n) }));
}

interface StoredAsset {
  path: string;
  filename: string;
  contentType: string | null;
  sizeBytes: number;
  sourceUrl: string;
}

/**
 * Point a scene at an archive asset — both attachment rows, the scene's own
 * columns, and the library's `used` mark, in ONE transaction.
 *
 * The scene fields go through `hov.at_write` under their Airtable names, the
 * same door n8n uses, so the approval resets and the status stamp are written
 * by the one function that knows the column map. `Așteaptă Aprobare Video`
 * is deliberate: `Sort & Cap Scenes` counts that stamp as done work, so the
 * scene stops eating a slot in the batch's cap of 8 the moment its clip
 * exists. The approvals are reset because the producer picked the asset, not
 * signed it off — the gates n8n polls are the same checkboxes as ever.
 */
export async function attachStockToScene(o: {
  sceneId: string;
  stockId: string;
  mediaType: ArchiveMediaType;
  offsetSeconds: number | null;
  image: StoredAsset;
  video: StoredAsset;
  videoUrl: string;
  /** db/009: what the picture now IS, classified by the caller. */
  visualOrigin: string;
  provenanceConfidence: number;
  /** What the ASSET states about itself, carried onto the scene so the watermark can print it. */
  eventName?: string | null;
  location?: string | null;
  filmingDate?: string | null;
}): Promise<void> {
  const withProvenance = await provenanceReady();
  await withTransaction(async (q) => {
    for (const [field, a] of [["image", o.image], ["video", o.video]] as const) {
      await q(`delete from hov.attachment where scene_id = $1 and field = $2`, [o.sceneId, field]);
      await q(
        `insert into hov.attachment (scene_id, field, path, filename, content_type, size_bytes, source_url)
         values ($1, $2, $3, $4, $5, $6, $7)
         on conflict (scene_id, field, path) do update set
           filename = excluded.filename, size_bytes = excluded.size_bytes, source_url = excluded.source_url`,
        [o.sceneId, field, a.path, a.filename, a.contentType, a.sizeBytes, a.sourceUrl],
      );
    }
    await q(`select hov.at_write('scene', $1, $2::jsonb)`, [
      o.sceneId,
      JSON.stringify({
        "Scene Final URL": o.videoUrl,
        "Aprobare Imagine": false,
        "Aprobare Video": false,
        "Regenerează Imagine": false,
        "Regenerează Video": false,
        "Status Producție Scenă": "Așteaptă Aprobare Video",
      }),
    ]);
    // The provenance moves with the media, in the same transaction and for the
    // same reason the approvals do: a scene must never hold archive bytes while
    // its record still says the picture was generated. The producer's own
    // Footage type choice is cleared here too — it described the OLD picture.
    //
    // Asked before it is written, not attempted: naming a column db/009 has
    // not created yet would abort this whole transaction, and the media is
    // already on disk by the time we get here.
    await q(
      withProvenance
        ? `update hov.scene
              set visual_source = $2, stock_media_id = $3, stock_offset_seconds = $4,
                  visual_origin = $5, provenance_confidence = $6,
                  provenance_manually_verified = false,
                  provenance_event_name = $7, provenance_location = $8, provenance_date = $9
            where id = $1`
        : `update hov.scene
              set visual_source = $2, stock_media_id = $3, stock_offset_seconds = $4
            where id = $1`,
      [
        o.sceneId,
        o.mediaType === "video" ? "stock_video" : "stock_image",
        o.stockId,
        o.offsetSeconds,
        ...(withProvenance
          ? [o.visualOrigin, o.provenanceConfidence, o.eventName ?? null, o.location ?? null, o.filmingDate ?? null]
          : []),
      ],
    );
    await q(`update hov.stock_media set status = 'used' where id = $1`, [o.stockId]);
  });
}

// ---------------------------------------------------------------------------
// AI-proposed archive footage (db/008)
// ---------------------------------------------------------------------------

export interface SuggestScene {
  id: string;
  order: number;
  narration: string;
  visual: string | null;
  imagePrompt: string | null;
}

/**
 * The scenes a suggestion run should look at, CLAIMED for ten minutes.
 *
 * Approved text, still on the AI path, no clip yet, never looked at. The
 * claim exists because every scene approval fires the webhook, so two runs
 * can overlap on the same film; without it both would spend the same model
 * calls on the same scenes. A run that dies leaves the lease to expire.
 */
export async function claimScenesForSuggestion(projectId: string): Promise<{
  project: { id: string; name: string; language: string; brief: string | null } | null;
  scenes: SuggestScene[];
}> {
  const proj = await atQuery<{
    id: string;
    name: string;
    language: string | null;
    editing_options: unknown;
  }>(`select id, name, language, editing_options from hov.project where id = $1`, [projectId]);
  if (!proj[0]) return { project: null, scenes: [] };
  let brief: string | null = null;
  try {
    const raw = proj[0].editing_options;
    const opts = (typeof raw === "string" ? JSON.parse(raw) : raw) as Record<string, unknown> | null;
    brief = typeof opts?.producerBrief === "string" && opts.producerBrief.trim() ? opts.producerBrief.trim() : null;
  } catch {
    brief = null;
  }
  const rows = await atQuery<{
    id: string;
    scene_order: number;
    narration: string | null;
    visual_prompt: string | null;
    image_prompt: string | null;
  }>(
    `with picked as (
       select s.id from hov.scene s
        where s.project_id = $1
          and s.scene_approved
          and s.visual_source = 'ai'
          and coalesce(s.scene_final_url, '') = ''
          and s.archive_suggested_at is null
          and (s.archive_suggest_claimed_at is null
               or s.archive_suggest_claimed_at < now() - interval '10 minutes')
        order by s.scene_order
        limit 120)
     update hov.scene s set archive_suggest_claimed_at = now()
       from picked where s.id = picked.id
     returning s.id, s.scene_order, s.narration, s.visual_prompt, s.image_prompt`,
    [projectId],
  );
  const scenes = rows
    .map((r) => ({
      id: r.id,
      order: r.scene_order,
      narration: (r.narration ?? "").replace(/\[[^\]]{0,60}\]\s*/g, " ").replace(/\s+/g, " ").trim(),
      visual: r.visual_prompt,
      imagePrompt: r.image_prompt,
    }))
    .sort((a, b) => a.order - b.order);
  return {
    project: { id: proj[0].id, name: proj[0].name, language: proj[0].language ?? "English", brief },
    scenes,
  };
}

/**
 * Write a run's verdict: the picks for the scenes that got some, and the
 * "looked at" stamp for EVERY scene the run processed — the ones with no
 * picks included, or the site could not tell "nothing relevant" from "not
 * yet". Picks naming an asset the library does not hold are dropped rather
 * than failing the whole write; a model can misquote an id.
 */
export async function storeArchiveSuggestions(o: {
  processed: string[];
  scenes: Array<{
    id: string;
    picks: Array<{ stockId: string; relevance: number | null; reason: string | null; query?: string | null }>;
  }>;
}): Promise<{ scenes: number; picks: number }> {
  const processed = [...new Set([...o.processed, ...o.scenes.map((s) => s.id)])];
  if (!processed.length) return { scenes: 0, picks: 0 };
  const wanted = [...new Set(o.scenes.flatMap((s) => s.picks.map((p) => p.stockId)))];
  const known = new Set(
    wanted.length
      ? (await atQuery<{ id: string }>(`select id from hov.stock_media where id = any($1)`, [wanted])).map((r) => r.id)
      : [],
  );
  let picks = 0;
  await withTransaction(async (q) => {
    await q(`delete from hov.scene_archive_suggestion where scene_id = any($1)`, [processed]);
    for (const s of o.scenes) {
      let rank = 0;
      for (const p of s.picks) {
        if (!known.has(p.stockId)) continue;
        rank += 1;
        await q(
          `insert into hov.scene_archive_suggestion (scene_id, stock_media_id, rank, relevance, reason, query)
           values ($1, $2, $3, $4, $5, $6)
           on conflict (scene_id, stock_media_id) do update set
             rank = excluded.rank, relevance = excluded.relevance, reason = excluded.reason, query = excluded.query`,
          [
            s.id,
            p.stockId,
            rank,
            p.relevance === null || p.relevance === undefined ? null : Math.max(0, Math.min(1, Number(p.relevance))),
            p.reason ? String(p.reason).slice(0, 300) : null,
            p.query ? String(p.query).slice(0, 200) : null,
          ],
        );
        picks += 1;
      }
    }
    await q(
      `update hov.scene set archive_suggested_at = now(), archive_suggest_claimed_at = null
        where id = any($1)`,
      [processed],
    );
  });
  return { scenes: processed.length, picks };
}

/** Forget the "looked at" stamps so a run looks again. Existing picks stay until replaced. */
export async function resetArchiveSuggestions(projectId: string): Promise<number> {
  const rows = await atQuery<{ id: string }>(
    `update hov.scene set archive_suggested_at = null, archive_suggest_claimed_at = null
      where project_id = $1 and visual_source = 'ai' and coalesce(scene_final_url, '') = ''
      returning id`,
    [projectId],
  );
  return rows.length;
}

/**
 * Send a scene back to the AI pipeline: the archive link, the clip and the
 * clip URL go, so `Needs Clip?` generates again once a new image is approved.
 * The image row is left for the caller — it flags an image regeneration,
 * and `IR Write Image` replaces the row when the new picture lands.
 */
export async function detachStockFromScene(sceneId: string): Promise<void> {
  // The provenance goes back with the media. A stale "ARCHIVAL FOOTAGE" on a
  // scene about to be generated by the image model is the worst possible
  // failure of this feature — it is the label asserting the opposite of the
  // truth — so it is cleared in the same transaction as the clip, and the
  // producer's own override with it: that described the picture being removed.
  const withProvenance = await provenanceReady();
  await withTransaction(async (q) => {
    await q(`delete from hov.attachment where scene_id = $1 and field = 'video'`, [sceneId]);
    await q(
      withProvenance
        ? `update hov.scene
              set visual_source = 'ai', stock_media_id = null, stock_offset_seconds = null,
                  scene_final_url = null,
                  visual_origin = 'ai_generated', provenance_confidence = 100,
                  provenance_manually_verified = false,
                  provenance_event_name = null, provenance_location = null,
                  provenance_date = null
            where id = $1`
        : `update hov.scene
              set visual_source = 'ai', stock_media_id = null, stock_offset_seconds = null,
                  scene_final_url = null
            where id = $1`,
      [sceneId],
    );
  });
}
