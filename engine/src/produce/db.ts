// hov.production_job (db/018): one production run of a film, claimed with a
// lease like render_job and media_job, and the reads and writes the run makes.
import type pg from 'pg';
import type { AtRow } from '../assembly/types.ts';

export type Stage = 'setup' | 'voices' | 'images' | 'asset_gate' | 'clips' | 'video_gate' | 'finalize' | 'settings_gate' | 'done';
export interface ProductionJob {
  id: string;
  project_id: string;
  phase: 'queued' | 'running' | 'done' | 'failed' | 'stopped';
  stage: Stage;
  pass: number;
  trigger: { Voice_ID?: string; Aspect_Ratio?: string; Flow_Email?: string };
  state: Record<string, any>;
  attempts: number;
}

/** Queue a run. Refused (null) while the film already has one active. */
export async function enqueueProduction(db: pg.Pool, projectId: string, trigger: Record<string, unknown> = {}, requestedBy?: string): Promise<string | null> {
  const r = await db.query(
    `insert into hov.production_job (project_id, trigger, requested_by) values ($1, $2::jsonb, $3)
     on conflict (project_id) where phase in ('queued', 'running') do nothing returning id`,
    [projectId, JSON.stringify(trigger), requestedBy ?? null],
  );
  return r.rows[0]?.id ?? null;
}

export async function claimProduction(db: pg.Pool, workerId: string, leaseSeconds: number, exclude: string[] = []): Promise<ProductionJob | null> {
  const r = await db.query(
    `update hov.production_job set locked_by = $1, locked_until = now() + make_interval(secs => $2),
            phase = 'running', attempts = attempts + 1, started_at = coalesce(started_at, now())
     where id = (
       select id from hov.production_job
       where phase in ('queued', 'running')
         and (locked_until is null or locked_until < now())
         and not (id = any($3::bigint[]))
       order by id limit 1
       for update skip locked)
     returning *`,
    [workerId, leaseSeconds, exclude],
  );
  return r.rows[0] ?? null;
}

/**
 * Save where the run is and renew the lease, in one statement. False once the
 * run was stopped or taken over — the worker must then let go.
 */
export async function saveProduction(db: pg.Pool, job: ProductionJob, workerId: string, leaseSeconds: number): Promise<boolean> {
  const r = await db.query(
    `update hov.production_job set stage = $3, pass = $4, state = $5::jsonb, locked_until = now() + make_interval(secs => $6)
     where id = $1 and locked_by = $2 and phase = 'running' returning id`,
    [job.id, workerId, job.stage, job.pass, JSON.stringify(job.state), leaseSeconds],
  );
  return !!r.rowCount;
}

export async function finishProduction(db: pg.Pool, job: ProductionJob, workerId: string, phase: 'done' | 'failed', error?: string): Promise<boolean> {
  const r = await db.query(
    `update hov.production_job set phase = $3, stage = case when $3 = 'done' then 'done' else stage end, state = $4::jsonb,
            error = $5, finished_at = now(), locked_until = null
     where id = $1 and locked_by = $2 and phase = 'running' returning id`,
    [job.id, workerId, phase, JSON.stringify(job.state), error ?? null],
  );
  return !!r.rowCount;
}

export async function releaseProduction(db: pg.Pool, workerId: string): Promise<void> {
  await db.query(`update hov.production_job set locked_until = null where locked_by = $1 and phase = 'running'`, [workerId]);
}

// --- Reads, through the hov.at_* views n8n reads --------------------------------------------------
export async function loadProject(db: pg.Pool, projectId: string): Promise<AtRow | null> {
  const r = await db.query(`select id, "createdTime", fields from hov.at_project where id = $1`, [projectId]);
  return r.rows[0] ?? null;
}
/** Fetch Approved Scenes / Fetch Scenes After Batch / Fetch Regen Flags. */
export async function approvedScenes(db: pg.Pool, projectId: string): Promise<AtRow[]> {
  const r = await db.query(`select id, "createdTime", fields from hov.at_scene where fields->>'Project_ID' = $1 and (fields->>'Aprobare Scenă')::boolean`, [projectId]);
  return r.rows;
}
/** Refetch Scenes For Audio / For Video / Fetch Scene Images / Fetch Scene Videos: the pass's scenes, fresh. */
export async function scenesById(db: pg.Pool, ids: string[]): Promise<AtRow[]> {
  if (!ids.length) return [];
  const r = await db.query(`select id, "createdTime", fields from hov.at_scene where id = any($1::text[])`, [ids]);
  return r.rows;
}
export async function sceneRow(db: pg.Pool, id: string): Promise<AtRow | null> {
  const r = await db.query(`select id, "createdTime", fields from hov.at_scene where id = $1`, [id]);
  return r.rows[0] ?? null;
}
/** Load Scene Cast. */
export async function sceneCast(db: pg.Pool, projectId: string) {
  const r = await db.query(`select s.id, s.scene_order, s.tags, s.visual_prompt from hov.scene s where s.project_id = $1 and s.scene_approved order by s.scene_order`, [projectId]);
  return r.rows;
}
/** Load Sheet Media: every stored sheet of the film, with its public URL. */
export async function sheetMedia(db: pg.Pool, projectId: string, mediaBaseUrl: string) {
  const r = await db.query(`select flow_id, kind, name, path from hov.sheet_media where project_id = $1`, [projectId]);
  return r.rows.map((x: any) => ({ flow_id: x.flow_id, kind: x.kind, name: x.name, url: mediaBaseUrl ? mediaBaseUrl.replace(/\/+$/, '') + '/' + x.path : '' }));
}
/** VP Image Check. */
export async function sceneImageState(db: pg.Pool, id: string) {
  const r = await db.query(`select image_media_id, regen_image, coalesce(note, '') as note from hov.scene where id = $1`, [id]);
  return r.rows[0] ?? {};
}
/** Media jobs still active for these scenes, by kind — so a gate never queues a second. */
export async function activeMedia(db: pg.Pool, ids: string[]): Promise<Array<{ scene_id: string; kind: string; phase: string }>> {
  if (!ids.length) return [];
  const r = await db.query(`select scene_id, kind, phase from hov.media_job where scene_id = any($1::text[]) and phase in ('queued', 'running')`, [ids]);
  return r.rows;
}

// --- Writes ---------------------------------------------------------------------------------------------
export async function writeProject(db: pg.Pool, projectId: string, fields: Record<string, unknown>): Promise<void> {
  await db.query(`select * from hov.at_write('project', $1, $2::jsonb)`, [projectId, JSON.stringify(fields)]);
}
/** Save User Ref Id / Save Cast Refs / Save Set Plates / Save Flow Refs: `editing_options || patch`. */
export async function patchEditingOptions(db: pg.Pool, projectId: string, patch: Record<string, unknown>): Promise<void> {
  await db.query(`update hov.project set editing_options = coalesce(editing_options, '{}'::jsonb) || $2::jsonb where id = $1`, [projectId, JSON.stringify(patch)]);
}

/** Renew the lease only (a timer while one long call is in flight). False once stopped or taken over. */
export async function heartbeatProduction(db: pg.Pool, job: ProductionJob, workerId: string, leaseSeconds: number): Promise<boolean> {
  const r = await db.query(
    `update hov.production_job set locked_until = now() + make_interval(secs => $3)
     where id = $1 and locked_by = $2 and phase = 'running' returning id`,
    [job.id, workerId, leaseSeconds],
  );
  return !!r.rowCount;
}
