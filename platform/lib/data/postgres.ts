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
  type Project,
  type RawProject,
  type RawScene,
  type Scene,
  type ScriptInfo,
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
  created_at: Date | null;
  cover_path?: string | null;
}

const PROJECT_COLS = `p.id, p.name, p.tone, p.aspect, p.no_captions, p.length_seconds,
                      p.status, p.final_video_url, p.editing_options, p.language,
                      p.voice_id, p.created_at`;

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
    // The clip the site plays is the muxed per-scene file; the stored
    // attachment is the fallback, exactly as the Airtable adapter reads
    // "Scene Final URL" first and the "Video Scenă" attachment second.
    videoUrl: r.scene_final_url || mediaUrl(r.video_path),
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
// Saved drafts — read here, not yet written here
// ---------------------------------------------------------------------------

/**
 * Not ported yet, and deliberately loud about it.
 *
 * Reading versions works (see version_files above); writing one does not, and
 * the gap is real rather than an oversight. On Airtable a save re-uploaded the
 * asset and Airtable re-hosted it. Here the bytes are already in the media
 * store, so a save ought to be little more than a second `attachment` row —
 * except `attachment.path` is globally unique, so two rows cannot point at one
 * file, and the choice between relaxing that constraint and copying the bytes
 * changes what "12 drafts per kind" costs on disk.
 *
 * That decision belongs with the feature, which is days old and still moving
 * upstream. Guessing at it now and being wrong would corrupt the media store
 * quietly, which is worse than a button that says it does not work yet — and
 * this is a convenience path, not the production one. Throwing keeps the two
 * backends honestly different instead of pretending they are the same.
 */
export async function saveVersionOfScene(
  _sceneId: string,
  _kind: "image" | "video",
  _opts: { auto?: boolean } = {},
): Promise<{ saved: true; dropped: number } | { saved: false; reason: string }> {
  throw new Error(
    "saveVersionOfScene is not implemented on the Postgres backend yet — " +
      "saved drafts still need their storage decision (see lib/data/postgres.ts).",
  );
}

/** Same story as saveVersionOfScene — the read path works, the write does not. */
export async function restoreVersionOfScene(
  _sceneId: string,
  _versionId: string,
): Promise<{ restored: true; kind: "image" | "video" } | { restored: false; reason: string }> {
  throw new Error(
    "restoreVersionOfScene is not implemented on the Postgres backend yet — " +
      "saved drafts still need their storage decision (see lib/data/postgres.ts).",
  );
}
