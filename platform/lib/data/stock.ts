/**
 * The archive library — `hov.stock_media` — from the site's side.
 *
 * Postgres only. There is no Airtable half because the table never existed
 * there: Documentary mode is the first feature born after the cutover.
 * Everything a scene needs from an asset is read back through here.
 */

import { atQuery, withTransaction } from "./postgres";
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
}): Promise<void> {
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
    await q(
      `update hov.scene
          set visual_source = $2, stock_media_id = $3, stock_offset_seconds = $4
        where id = $1`,
      [o.sceneId, o.mediaType === "video" ? "stock_video" : "stock_image", o.stockId, o.offsetSeconds],
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
  await withTransaction(async (q) => {
    await q(`delete from hov.attachment where scene_id = $1 and field = 'video'`, [sceneId]);
    await q(
      `update hov.scene
          set visual_source = 'ai', stock_media_id = null, stock_offset_seconds = null,
              scene_final_url = null
        where id = $1`,
      [sceneId],
    );
  });
}
