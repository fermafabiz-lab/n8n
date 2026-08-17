/**
 * The Postgres backend.
 *
 * Same functions, same signatures, same output as the Airtable one — the only
 * difference is where the bytes come from. Everything that shapes a `Project`
 * or a `Scene` lives in ./derive.ts and is shared, so the two backends cannot
 * drift while they run side by side.
 *
 * Selected with `DATA_BACKEND=postgres`. Anything else keeps Airtable, which
 * is still the source of truth.
 */

import { Pool } from "pg";
import {
  buildProject,
  buildScene,
  buildVersions,
  classifyStatus,
  orderScenes,
  planVersionSave,
  type Project,
  type RawProject,
  type RawScene,
  type Scene,
  type ScriptInfo,
  type GenreProfile,
  type LibraryScript,
  type ScriptExample,
} from "./derive";

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------

// Next.js re-evaluates modules on every hot reload in dev and across route
// handlers in prod; a Pool per evaluation exhausts Postgres' connection slots
// in minutes. Park it on globalThis so there is exactly one.
const globalForPg = globalThis as unknown as { hovPool?: Pool };

function pool(): Pool {
  if (!globalForPg.hovPool) {
    globalForPg.hovPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      // The site re-reads on every click (force-dynamic) and n8n polls the
      // same rows every 15s. Small and short-lived is the right shape.
      max: 8,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
  }
  return globalForPg.hovPool;
}

/**
 * Escape hatch for the Airtable-shaped shim, which needs the same pool but
 * builds its own SQL. Exported rather than duplicating the connection setup —
 * two pools in one process is how a box runs out of Postgres slots.
 */
export async function atQuery<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  return query<T>(sql, params);
}

async function query<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const res = await pool().query(sql, params);
  return res.rows as T[];
}

export const isConfigured = Boolean(process.env.DATABASE_URL);

/**
 * Public URL for a file in the media store.
 *
 * Attachment rows hold the PATH, never the URL — so the host or scheme can
 * change without rewriting 334 rows.
 */
const MEDIA_BASE = (process.env.MEDIA_BASE_URL ?? "").replace(/\/+$/, "");
const mediaUrl = (path: string | null): string | null =>
  path ? `${MEDIA_BASE}/${path}` : null;

// ---------------------------------------------------------------------------
// Row → Raw shapes
// ---------------------------------------------------------------------------

interface ProjectRow {
  id: string;
  name: string;
  tone: string | null;
  aspect: string;
  no_captions: boolean;
  length_seconds: number | null;
  status: string;
  final_video_url: string | null;
  editing_options: unknown;
  language: string;
  voice_id: string;
  pace: string | null;
  created_at: Date | null;
  cover_path?: string | null;
}

const PROJECT_COLS = `p.id, p.name, p.tone, p.aspect, p.no_captions, p.length_seconds,
                      p.status, p.final_video_url, p.editing_options, p.language,
                      p.voice_id, p.pace, p.created_at`;

function toRawProject(r: ProjectRow): RawProject {
  return {
    id: r.id,
    name: r.name,
    tone: r.tone,
    aspectRaw: r.aspect,
    noCaptions: r.no_captions,
    lengthSeconds: r.length_seconds,
    statusRaw: r.status ?? "—",
    finalVideoUrl: r.final_video_url,
    editingRaw: r.editing_options,
    language: r.language ?? "",
    voiceId: r.voice_id ?? "",
    paceRaw: r.pace,
    createdAt: r.created_at ? r.created_at.toISOString() : null,
    coverUrl: mediaUrl(r.cover_path ?? null),
  };
}

interface SceneRow {
  id: string;
  scene_order: number;
  narration: string | null;
  image_prompt: string | null;
  scene_final_url: string | null;
  voiceover_url: string | null;
  production_status: string;
  scene_approved: boolean;
  image_approved: boolean;
  voice_approved: boolean;
  video_approved: boolean;
  regen_image: boolean;
  regen_video: boolean;
  regen_voice: boolean;
  note: string | null;
  evidence_ref: string | null;
  needs_fact_check: boolean;
  motion_prompt: string | null;
  media_versions: unknown;
  created_at: Date | null;
  image_path: string | null;
  video_path: string | null;
  /** [{filename, path}] for field='image_version' — joined by buildVersions. */
  version_files: Array<{ filename: string | null; path: string }> | null;
}

/**
 * One image and one video path per scene, alongside the row.
 *
 * The unique index guarantees at most one of each, so these are plain
 * scalar sub-selects rather than a join that would multiply the rows.
 */
const SCENE_SELECT = `
  select s.*,
    (select a.path from hov.attachment a
      where a.scene_id = s.id and a.field = 'image') as image_path,
    (select a.path from hov.attachment a
      where a.scene_id = s.id and a.field = 'video') as video_path,
    (select jsonb_agg(jsonb_build_object('filename', a.filename, 'path', a.path)
              order by a.created_at)
       from hov.attachment a
      where a.scene_id = s.id and a.field = 'image_version') as version_files
  from hov.scene s`;

function toRawScene(r: SceneRow): RawScene & { createdAt: string | null } {
  return {
    id: r.id,
    order: r.scene_order,
    narration: r.narration,
    imagePrompt: r.image_prompt,
    imageUrl: mediaUrl(r.image_path),
    videoUrl: r.scene_final_url,
    storedVideoUrl: mediaUrl(r.video_path),
    voiceUrl: r.voiceover_url,
    sceneApproved: r.scene_approved,
    imageApproved: r.image_approved,
    voiceApproved: r.voice_approved,
    videoApproved: r.video_approved,
    regenImage: r.regen_image,
    regenVideo: r.regen_video,
    regenVoice: r.regen_voice,
    note: r.note,
    evidenceRef: r.evidence_ref,
    needsFactCheck: r.needs_fact_check,
    // Older rows can hold a URL here instead of a direction; showing that as
    // an editable prompt would invite someone to overwrite a link.
    videoPrompt: ((v) => (v && !/^https?:\/\//i.test(v.trim()) ? v : null))(r.motion_prompt),
    // Saved drafts: the metadata lives in media_versions, the files in
    // hov.attachment, and buildVersions joins them by filename — the same
    // join, and the same `last` back-fill, the Airtable path performs.
    versions: buildVersions(
      r.media_versions,
      (r.version_files ?? []).map((f) => ({ filename: f.filename, url: mediaUrl(f.path) })),
    ),
    statusRaw: r.production_status ?? "—",
    createdAt: r.created_at ? r.created_at.toISOString() : null,
  };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function getProjects(): Promise<Project[]> {
  // The cover is the earliest scene (by order) that has an image. One
  // correlated sub-select beats the Airtable adapter's full sweep of the
  // Scene table, which it had to do because Airtable cannot join.
  const rows = await query<ProjectRow>(`
    select ${PROJECT_COLS},
      (select a.path
         from hov.scene s
         join hov.attachment a on a.scene_id = s.id and a.field = 'image'
        where s.project_id = p.id
        order by s.scene_order
        limit 1) as cover_path
    from hov.project p
    order by p.created_at desc`);
  return rows.map((r) => buildProject(toRawProject(r)));
}

export async function getProject(id: string): Promise<Project | null> {
  const rows = await query<ProjectRow>(
    `select ${PROJECT_COLS} from hov.project p where p.id = $1`,
    [id],
  );
  return rows[0] ? buildProject(toRawProject(rows[0])) : null;
}

export async function getStatusCounts(): Promise<{ run: number; wait: number; err: number }> {
  const counts = { run: 0, wait: 0, err: 0 };
  // Only the status column — the ticker polls this every half minute.
  const rows = await query<{ status: string }>(`select status from hov.project`);
  for (const r of rows) {
    const { kind } = classifyStatus(r.status ?? "");
    if (kind === "run" || kind === "wait" || kind === "err") counts[kind] += 1;
  }
  return counts;
}

export async function getScenes(projectId: string): Promise<Scene[]> {
  const rows = await query<SceneRow>(
    `${SCENE_SELECT} where s.project_id = $1`,
    [projectId],
  );
  const ordered = orderScenes(rows.map(toRawScene));
  return ordered.map((r, i) => buildScene(r, i));
}

export async function findRecentProjectByName(
  name: string,
  withinMs = 5 * 60 * 1000,
): Promise<string | null> {
  if (!name.trim()) return null;
  const rows = await query<{ id: string }>(
    `select id from hov.project
      where name = $1 and created_at >= now() - ($2 || ' milliseconds')::interval
      order by created_at desc limit 1`,
    [name.trim(), String(withinMs)],
  );
  return rows[0]?.id ?? null;
}

export async function getProjectScript(projectId: string): Promise<string | null> {
  const rows = await query<{ script: string | null }>(
    `select coalesce(nullif(edited_narrator_script, ''), nullif(full_narrator_script, '')) as script
       from hov.project where id = $1`,
    [projectId],
  );
  const s = rows[0]?.script;
  return s && s.trim() ? s : null;
}

export async function getProjectScriptInfo(projectId: string): Promise<ScriptInfo | null> {
  // Airtable took the LAST entry of the project's "scripts" link — the most
  // recently attached draft. Newest by creation is the same thing.
  const rows = await query<{ id: string; content: string | null; status: string | null }>(
    `select id, content, status from hov.script
      where project_id = $1 order by created_at desc limit 1`,
    [projectId],
  );
  const r = rows[0];
  return r ? { id: r.id, content: r.content ?? "", status: r.status ?? "" } : null;
}

export async function readSceneNarration(sceneId: string): Promise<{
  narration: string;
  hasVoice: boolean;
  imagePrompt: string;
  imageApproved: boolean;
}> {
  const rows = await query<{
    narration: string | null;
    voiceover_url: string | null;
    image_prompt: string | null;
    image_approved: boolean;
  }>(
    `select narration, voiceover_url, image_prompt, image_approved
       from hov.scene where id = $1`,
    [sceneId],
  );
  const r = rows[0];
  if (!r) throw new Error(`scene ${sceneId} not found`);
  return {
    narration: r.narration ?? "",
    hasVoice: Boolean(r.voiceover_url),
    imagePrompt: r.image_prompt ?? "",
    imageApproved: r.image_approved,
  };
}

export async function readSceneVideoInputs(sceneId: string): Promise<{
  hasClip: boolean;
  hasImageMediaId: boolean;
  hasMotionPrompt: boolean;
}> {
  const rows = await query<{
    scene_final_url: string | null;
    image_media_id: string | null;
    motion_prompt: string | null;
  }>(
    `select scene_final_url, image_media_id, motion_prompt from hov.scene where id = $1`,
    [sceneId],
  );
  const r = rows[0];
  if (!r) return { hasClip: false, hasImageMediaId: false, hasMotionPrompt: false };
  return {
    hasClip: String(r.scene_final_url ?? "").startsWith("http"),
    hasImageMediaId: String(r.image_media_id ?? "").trim() !== "",
    hasMotionPrompt: String(r.motion_prompt ?? "").trim() !== "",
  };
}

// ---------------------------------------------------------------------------
// Writes
//
// `writeSceneFields` / `writeProjectFields` / `writeScriptFields` are called
// from fourteen places in app/actions.ts with **Airtable field names** —
// `{ "Aprobare Voce": true }`. Rewriting all fourteen call sites would have
// meant fourteen chances to fumble a diacritic in code that gates approvals,
// while the two backends are supposed to be running side by side and
// producing identical results. So the names are translated here instead, and
// the call sites are untouched.
//
// The map is the same one recorded in db/001_schema.sql as COMMENTs. When
// Airtable is finally gone, the call sites can move to column names and this
// map can go with them.
// ---------------------------------------------------------------------------

const SCENE_FIELDS: Record<string, string> = {
  "Script Scenă": "narration",
  "Imagine First Frame": "image_prompt",
  "Video Scenă URL": "motion_prompt",
  "Prompt Vizual": "visual_prompt",
  "Imagine Last Frame": "last_frame_url",
  "Voiceover URL": "voiceover_url",
  "Scene Final URL": "scene_final_url",
  "Image Media ID": "image_media_id",
  "Ordine Scenă": "scene_order",
  "Durată Scenă (secunde)": "duration_seconds",
  "Status Producție Scenă": "production_status",
  "Aprobare Scenă": "scene_approved",
  "Aprobare Imagine": "image_approved",
  "Aprobare Voce": "voice_approved",
  "Aprobare Video": "video_approved",
  "Regenerează Imagine": "regen_image",
  "Regenerează Video": "regen_video",
  "Regenerează Voce": "regen_voice",
  "Observații Scenă": "note",
  "Evidence Ref": "evidence_ref",
  "Needs Fact Check": "needs_fact_check",
};

const PROJECT_FIELDS: Record<string, string> = {
  "Nume Proiect": "name",
  Tonalitate: "tone",
  Format: "aspect",
  "Fără Subtitrări": "no_captions",
  Lenght: "length_seconds",
  "Status General": "status",
  "Link Video Final": "final_video_url",
  "Editing Options": "editing_options",
  Language: "language",
  Style: "style",
  "Story Bible": "story_bible",
  "Voice ID": "voice_id",
  "Full Narrator Script": "full_narrator_script",
  "Edited Narrator Script": "edited_narrator_script",
  "Script Status": "script_status",
};

const SCRIPT_FIELDS: Record<string, string> = {
  "Script Title": "title",
  "Script Content": "content",
  "script chapters": "chapters",
  Status: "status",
  Language: "language",
  "Observații Script": "notes",
};

/** Regen flags carry a timestamp so a stranded one is a query, not a mystery. */
const FLAG_TIMESTAMPS: Record<string, string> = {
  regen_image: "regen_image_at",
  regen_video: "regen_video_at",
  regen_voice: "regen_voice_at",
};

function buildUpdate(
  table: string,
  map: Record<string, string>,
  id: string,
  fields: Record<string, unknown>,
): { sql: string; params: unknown[] } | null {
  const sets: string[] = [];
  const params: unknown[] = [];

  for (const [name, value] of Object.entries(fields)) {
    const col = map[name];
    if (!col) {
      // Loud, not silent: an unmapped name means a write that would have
      // landed in Airtable is being dropped here, which is exactly the kind
      // of divergence the parallel run exists to catch.
      throw new Error(`No ${table} column mapped for Airtable field "${name}"`);
    }
    params.push(col === "editing_options" ? JSON.stringify(value) : value);
    sets.push(`${col} = $${params.length}`);

    const stamp = FLAG_TIMESTAMPS[col];
    if (stamp) {
      params.push(value === true ? new Date() : null);
      sets.push(`${stamp} = $${params.length}`);
    }
  }

  if (!sets.length) return null;
  params.push(id);
  return {
    sql: `update ${table} set ${sets.join(", ")} where id = $${params.length}`,
    params,
  };
}

export async function writeSceneFields(
  sceneId: string,
  fields: Record<string, unknown>,
): Promise<void> {
  const q = buildUpdate("hov.scene", SCENE_FIELDS, sceneId, fields);
  if (q) await query(q.sql, q.params);
}

export async function writeProjectFields(
  projectId: string,
  fields: Record<string, unknown>,
): Promise<void> {
  const q = buildUpdate("hov.project", PROJECT_FIELDS, projectId, fields);
  if (q) await query(q.sql, q.params);
}

export async function writeScriptFields(
  scriptId: string,
  fields: Record<string, unknown>,
): Promise<void> {
  const q = buildUpdate("hov.script", SCRIPT_FIELDS, scriptId, fields);
  if (q) await query(q.sql, q.params);
}

export async function writeSceneApproval(
  sceneId: string,
  kind: "image" | "video",
  action: "approve" | "regenerate",
): Promise<void> {
  if (kind === "image") {
    await writeSceneFields(
      sceneId,
      action === "approve"
        ? { "Aprobare Imagine": true, "Regenerează Imagine": false }
        : { "Regenerează Imagine": true, "Aprobare Imagine": false },
    );
    return;
  }
  await writeSceneFields(
    sceneId,
    action === "approve"
      ? { "Aprobare Video": true, "Regenerează Video": false }
      : {
          "Regenerează Video": true,
          "Aprobare Video": false,
          // Sort & Cap Scenes treats "Așteaptă Aprobare Video"/"Finalizat"
          // as DONE and sorts them behind the pending ones, where the cap of
          // 8 can drop them. A scene waiting on a regeneration IS outstanding
          // work, so it has to read as such.
          "Status Producție Scenă": "Generare Video",
        },
  );
}

/**
 * Merge a patch into the project's editing options.
 *
 * Airtable needed a read-modify-write for this, which is a lost update
 * waiting to happen: two approvals landing together and one silently
 * overwriting the other's settings. jsonb merges server-side in one
 * statement, so the race simply does not exist here.
 */
export async function updateEditingOptions(
  projectId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  await query(
    `update hov.project set editing_options = editing_options || $1::jsonb where id = $2`,
    [JSON.stringify(patch), projectId],
  );
}

export async function writeSceneFeedback(sceneId: string, feedback: string): Promise<void> {
  await writeSceneFields(sceneId, { "Observații Scenă": feedback });
}

export async function writeSceneScript(
  sceneId: string,
  fields: { narration?: string; imagePrompt?: string; approve?: boolean },
): Promise<void> {
  const patch: Record<string, unknown> = {};
  if (typeof fields.narration === "string") patch["Script Scenă"] = fields.narration;
  if (typeof fields.imagePrompt === "string") patch["Imagine First Frame"] = fields.imagePrompt;
  if (fields.approve) patch["Aprobare Scenă"] = true;
  if (!Object.keys(patch).length) return;
  await writeSceneFields(sceneId, patch);
}

export async function requestSceneRewrite(sceneId: string): Promise<void> {
  await writeSceneFields(sceneId, {
    "Status Producție Scenă": "Regenerare Text",
    "Aprobare Scenă": false,
  });
}

export async function releaseSceneRewrite(sceneId: string): Promise<void> {
  await writeSceneFields(sceneId, { "Status Producție Scenă": "Generare Script" });
}

export async function requestVoiceRegen(sceneId: string, narration?: string): Promise<void> {
  const patch: Record<string, unknown> = {
    "Regenerează Voce": true,
    // A fresh take has to be listened to again, and any clip built on the
    // old audio is stale.
    "Aprobare Voce": false,
    "Aprobare Video": false,
  };
  if (typeof narration === "string" && narration.trim()) {
    patch["Script Scenă"] = narration.trim();
  }
  await writeSceneFields(sceneId, patch);
}

/**
 * Remove a project and everything attached to it.
 *
 * Airtable needed three paginated delete calls in the right order, ten ids at
 * a time, and a project whose scenes deleted but whose record survived left
 * orphans nothing could reach. Here the foreign keys cascade, so it is one
 * statement that either happens or does not.
 *
 * Files under /opt/n8n/media are intentionally left in place — same rule the
 * Airtable path followed for Drive: storage is cheap, and a finished video
 * may already be published from its URL.
 */
export async function deleteProjectDeep(projectId: string): Promise<void> {
  await query(`delete from hov.project where id = $1`, [projectId]);
}

// ---------------------------------------------------------------------------
// Saved drafts
//
// Airtable filed a draft by re-uploading the asset, which made it re-host a
// second copy. Here the bytes are already ours — the scene's live image IS a
// row in hov.attachment — so a draft is a second row over the SAME file, which
// is why `attachment.path` stopped being globally unique (db/003).
//
// The bookkeeping lives in planVersionSave(); this only does the I/O.
// ---------------------------------------------------------------------------

interface LiveAsset {
  url: string | null;
  path: string | null;
  filename: string | null;
  /** Stable identity for de-duplication — never a URL. */
  key: string | null;
  prompt: string | null;
  mediaId: string | null;
}

/** What the scene currently holds of one kind, and how to recognise it again. */
async function liveAsset(sceneId: string, kind: "image" | "video"): Promise<LiveAsset> {
  const rows = await query<{
    image_media_id: string | null;
    image_prompt: string | null;
    motion_prompt: string | null;
    scene_final_url: string | null;
    path: string | null;
    filename: string | null;
  }>(
    `select s.image_media_id, s.image_prompt, s.motion_prompt, s.scene_final_url,
            a.path, a.filename
       from hov.scene s
       left join hov.attachment a on a.scene_id = s.id and a.field = $2
      where s.id = $1`,
    [sceneId, kind],
  );
  const r = rows[0];
  if (!r) throw new Error(`scene ${sceneId} not found`);

  const stored = mediaUrl(r.path);
  if (kind === "image") {
    return {
      url: stored,
      path: r.path,
      filename: r.filename,
      // The Flow media id is stable per generated image; the filename is the
      // fallback. The key is written into metadata that has to keep matching
      // later, so it stays independent of any URL.
      key: r.image_media_id || r.filename || r.path,
      prompt: r.image_prompt,
      mediaId: r.image_media_id,
    };
  }
  const url = stored ?? r.scene_final_url;
  return {
    url,
    path: r.path,
    filename: r.filename,
    key: url,
    prompt: r.motion_prompt,
    mediaId: null,
  };
}

export async function saveVersionOfScene(
  sceneId: string,
  kind: "image" | "video",
  opts: { auto?: boolean } = {},
): Promise<{ saved: true; dropped: number } | { saved: false; reason: string }> {
  const live = await liveAsset(sceneId, kind);
  if (!live.url || !live.key) {
    return {
      saved: false,
      reason: `There is no ${kind === "image" ? "image" : "clip"} on this scene yet — nothing to save.`,
    };
  }

  const rows = await query<{ media_versions: unknown }>(
    `select media_versions from hov.scene where id = $1`,
    [sceneId],
  );
  const raw = rows[0]?.media_versions;
  const list = Array.isArray(raw) ? (raw as Array<Record<string, unknown>>) : [];

  const plan = planVersionSave({
    list,
    kind,
    key: live.key,
    auto: opts.auto === true,
    prompt: live.prompt,
    mediaId: live.mediaId,
    url: live.url,
    nowIso: new Date().toISOString(),
    stamp: Date.now(),
  });

  if (plan.action === "duplicate") {
    return {
      saved: false,
      reason: `This ${kind === "image" ? "image" : "clip"} is already saved as a draft.`,
    };
  }

  if (plan.action === "marker") {
    await query(`update hov.scene set media_versions = $2::jsonb where id = $1`, [
      sceneId,
      JSON.stringify(plan.list),
    ]);
    return { saved: true, dropped: 0 };
  }

  const client = await pool().connect();
  try {
    await client.query("begin");

    if (kind === "image" && live.path) {
      // A second row over the same file. buildVersions() joins metadata to
      // rows BY FILENAME, so the synthetic name in the entry is the join key
      // and has to be what lands here.
      await client.query(
        `insert into hov.attachment
           (scene_id, field, path, filename, content_type, size_bytes, source_url)
         select $1, 'image_version', a.path, $3, a.content_type, a.size_bytes, a.source_url
           from hov.attachment a where a.scene_id = $1 and a.field = 'image' and a.path = $2
         on conflict (scene_id, field, path) do update set filename = excluded.filename`,
        [sceneId, live.path, plan.entry.file],
      );
    }

    // Rows for pruned drafts go; the FILES stay. Another draft — or the live
    // asset — may point at the same path, and a scene's own image very often
    // is exactly that.
    const keptNames = plan.list.flatMap((e) => (typeof e.file === "string" ? [e.file] : []));
    await client.query(
      `delete from hov.attachment
        where scene_id = $1 and field = 'image_version'
          and not (filename = any($2::text[]))`,
      [sceneId, keptNames],
    );

    await client.query(`update hov.scene set media_versions = $2::jsonb where id = $1`, [
      sceneId,
      JSON.stringify(plan.list),
    ]);
    await client.query("commit");
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  } finally {
    client.release();
  }

  return { saved: true, dropped: plan.dropped };
}

export async function restoreVersionOfScene(
  sceneId: string,
  versionId: string,
): Promise<{ restored: true; kind: "image" | "video" } | { restored: false; reason: string }> {
  const rows = await query<{
    media_versions: unknown;
    version_files: Array<{ filename: string | null; path: string }> | null;
  }>(
    `select s.media_versions,
            (select jsonb_agg(jsonb_build_object('filename', a.filename, 'path', a.path))
               from hov.attachment a
              where a.scene_id = s.id and a.field = 'image_version') as version_files
       from hov.scene s where s.id = $1`,
    [sceneId],
  );
  const row = rows[0];
  if (!row) return { restored: false, reason: "That scene no longer exists." };

  const files = row.version_files ?? [];
  const version = buildVersions(
    row.media_versions,
    files.map((f) => ({ filename: f.filename, url: mediaUrl(f.path) })),
  ).find((v) => v.id === versionId);

  if (!version || !version.url) {
    return {
      restored: false,
      reason: "That saved draft is no longer available — its file is missing.",
    };
  }

  // Restoring replaces the live asset, so file that one first — otherwise
  // stepping back to an older draft throws away the newer one, which is the
  // exact loss this feature exists to prevent. De-duplication makes it a no-op
  // when the live asset is already kept, and a failure here must not block the
  // restore.
  await saveVersionOfScene(sceneId, version.kind, { auto: true }).catch(() => {});

  if (version.kind === "image") {
    const path = files.find((f) => mediaUrl(f.path) === version.url)?.path;
    if (!path) return { restored: false, reason: "That draft's file could not be located." };

    const client = await pool().connect();
    try {
      await client.query("begin");
      // Point the live image at the draft's file. The row moves; no bytes do.
      await client.query(
        `insert into hov.attachment
           (scene_id, field, path, filename, content_type, size_bytes, source_url)
         select $1, 'image', a.path, a.filename, a.content_type, a.size_bytes, a.source_url
           from hov.attachment a
          where a.scene_id = $1 and a.field = 'image_version' and a.path = $2
         on conflict (scene_id, field) where field in ('image','video')
         do update set path = excluded.path, filename = excluded.filename,
                       content_type = excluded.content_type, size_bytes = excluded.size_bytes`,
        [sceneId, path],
      );
      // What is on screen changed, so the picture and the clip built from the
      // previous one both go back for review. And without the media id and the
      // prompt the scene looks right and cannot be filmed: video generation
      // refuses a scene with no Flow media id, and a later re-roll would work
      // from a prompt that made a different picture.
      await client.query(
        `update hov.scene
            set image_approved = false, video_approved = false,
                image_media_id = coalesce($2, image_media_id),
                image_prompt   = coalesce($3, image_prompt)
          where id = $1`,
        [sceneId, version.mediaId, version.prompt],
      );
      await client.query("commit");
    } catch (e) {
      await client.query("rollback").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
    return { restored: true, kind: "image" };
  }

  await query(
    `update hov.scene
        set scene_final_url = $2, video_approved = false,
            motion_prompt = coalesce($3, motion_prompt)
      where id = $1`,
    [sceneId, version.url, version.prompt],
  );
  return { restored: true, kind: "video" };
}
// ---------------------------------------------------------------------------
// Media ingest
// ---------------------------------------------------------------------------

/**
 * Record a file that has just been written into the media store, and apply the
 * scene's other field changes in the same transaction.
 *
 * The transaction is the point. Airtable did all of this in one PATCH: the
 * image landed, the approval flags cleared and the status moved together. Split
 * across separate statements, a failure between them leaves a scene claiming to
 * await an image it already has, or holding an image nobody will ever be asked
 * to approve — and the batch's gates read exactly those columns.
 *
 * `image` and `video` are one-per-scene (there is a unique index saying so), so
 * a new one replaces the old ROW. The old FILE is deliberately left on disk:
 * saved drafts point at it by path, and deleting it would empty the one feature
 * that exists to recover a bad re-roll.
 */
export async function attachMedia(opts: {
  sceneId: string;
  field: "image" | "video" | "image_version";
  path: string;
  filename: string | null;
  contentType: string | null;
  sizeBytes: number;
  sourceUrl: string;
  fields?: Record<string, unknown>;
}): Promise<{ id: string; createdTime: string; fields: Record<string, unknown> } | null> {
  const client = await pool().connect();
  try {
    await client.query("begin");

    if (opts.field !== "image_version") {
      await client.query(
        `delete from hov.attachment where scene_id = $1 and field = $2`,
        [opts.sceneId, opts.field],
      );
    }

    await client.query(
      `insert into hov.attachment
         (scene_id, field, path, filename, content_type, size_bytes, source_url)
       values ($1, $2, $3, $4, $5, $6, $7)
       -- (scene_id, field, path), not (path): a file may be both a scene's
       -- live image and a saved draft of it, so path alone stopped being
       -- unique when drafts landed (db/003).
       on conflict (scene_id, field, path) do update set
         filename   = excluded.filename,
         size_bytes = excluded.size_bytes,
         source_url = excluded.source_url`,
      [
        opts.sceneId,
        opts.field,
        opts.path,
        opts.filename,
        opts.contentType,
        opts.sizeBytes,
        opts.sourceUrl,
      ],
    );

    // Same Airtable field names the workflows already use — at_write owns the
    // translation, so there is one field map, not two.
    if (opts.fields && Object.keys(opts.fields).length) {
      await client.query(`select hov.at_write('scene', $1, $2::jsonb)`, [
        opts.sceneId,
        JSON.stringify(opts.fields),
      ]);
    }

    // Hand back the scene exactly as an Airtable node would have — the nodes
    // this replaces sat in the middle of a chain, and whatever follows them
    // reads $json without caring who produced it.
    const { rows } = await client.query(
      `select id, "createdTime", fields from hov.at_scene where id = $1`,
      [opts.sceneId],
    );

    await client.query("commit");
    return rows[0] ?? null;
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// The three hand-edited tables
// ---------------------------------------------------------------------------

const num = (v: unknown): number | null =>
  v === null || v === undefined ? null : Number(v);

export async function getGenreProfiles(): Promise<GenreProfile[]> {
  const rows = await query<Record<string, unknown>>(
    `select id, tone, format, research, research_brief, fact_sheet_framing, invention,
            structure, voice, wpm, hook_rule, visual, montage_intensity, active
       from hov.genre_profile order by lower(tone)`,
  );
  return rows.map((r) => ({
    id: String(r.id),
    tone: String(r.tone ?? ""),
    format: (r.format as string) ?? null,
    research: r.research === true,
    researchBrief: (r.research_brief as string) ?? null,
    factSheetFraming: (r.fact_sheet_framing as string) ?? null,
    invention: (r.invention as string) ?? null,
    structure: (r.structure as string) ?? null,
    voice: (r.voice as string) ?? null,
    wpm: num(r.wpm),
    hookRule: (r.hook_rule as string) ?? null,
    visual: (r.visual as string) ?? null,
    montageIntensity: Number(r.montage_intensity ?? 1),
    active: r.active === true,
  }));
}

const GENRE_COLS: Record<string, string> = {
  tone: "tone", format: "format", research: "research",
  researchBrief: "research_brief", factSheetFraming: "fact_sheet_framing",
  invention: "invention", structure: "structure", voice: "voice", wpm: "wpm",
  hookRule: "hook_rule", visual: "visual", montageIntensity: "montage_intensity",
  active: "active",
};

const LIBRARY_COLS: Record<string, string> = {
  title: "title", sourceUrl: "source_url", category: "category", tone: "tone",
  styleCard: "style_card", pacingWpm: "pacing_wpm", hookWpm: "hook_wpm",
  durationSeconds: "duration_seconds", active: "active", notes: "notes",
};

const EXAMPLE_COLS: Record<string, string> = {
  name: "name", content: "content", style: "style", tags: "tags",
  usageUrl: "usage_url", notes: "notes",
};

/**
 * One update builder for all three tables.
 *
 * An unmapped key throws rather than being skipped — a form field that
 * silently does nothing is exactly the failure these screens exist to end.
 */
async function patchRow(
  table: string,
  cols: Record<string, string>,
  id: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    const col = cols[k];
    if (!col) throw new Error(`${table}: no column for "${k}"`);
    params.push(v === "" && typeof v === "string" ? null : v);
    sets.push(`${col} = $${params.length}`);
  }
  if (!sets.length) return;
  params.push(id);
  await query(`update hov.${table} set ${sets.join(", ")} where id = $${params.length}`, params);
}

export const saveGenreProfile = (id: string, patch: Record<string, unknown>) =>
  patchRow("genre_profile", GENRE_COLS, id, patch);

export async function createGenreProfile(tone: string): Promise<string> {
  const rows = await query<{ id: string }>(
    `insert into hov.genre_profile (tone, active) values ($1, false) returning id`,
    [tone],
  );
  return rows[0].id;
}

export async function getLibraryScripts(): Promise<LibraryScript[]> {
  const rows = await query<Record<string, unknown>>(
    `select id, title, source_url, category, tone, style_card, pacing_wpm, hook_wpm,
            duration_seconds, active, notes,
            coalesce(length(raw_transcript), 0) as transcript_chars
       from hov.script_library order by active desc, lower(title)`,
  );
  return rows.map((r) => ({
    id: String(r.id),
    title: String(r.title ?? ""),
    sourceUrl: (r.source_url as string) ?? null,
    category: (r.category as string) ?? null,
    tone: (r.tone as string) ?? null,
    styleCard: (r.style_card as string) ?? null,
    pacingWpm: num(r.pacing_wpm),
    hookWpm: num(r.hook_wpm),
    durationSeconds: num(r.duration_seconds),
    active: r.active === true,
    notes: (r.notes as string) ?? null,
    transcriptChars: Number(r.transcript_chars ?? 0),
  }));
}

export const saveLibraryScript = (id: string, patch: Record<string, unknown>) =>
  patchRow("script_library", LIBRARY_COLS, id, patch);

export async function getScriptExamples(): Promise<ScriptExample[]> {
  const rows = await query<Record<string, unknown>>(
    `select id, name, content, style, tags, usage_url, notes
       from hov.script_example order by lower(name)`,
  );
  return rows.map((r) => ({
    id: String(r.id),
    name: String(r.name ?? ""),
    content: (r.content as string) ?? null,
    style: (r.style as string[]) ?? [],
    tags: (r.tags as string[]) ?? [],
    usageUrl: (r.usage_url as string) ?? null,
    notes: (r.notes as string) ?? null,
  }));
}

export const saveScriptExample = (id: string, patch: Record<string, unknown>) =>
  patchRow("script_example", EXAMPLE_COLS, id, patch);
