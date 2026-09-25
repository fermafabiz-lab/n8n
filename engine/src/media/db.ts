// hov.media_job (db/017): per-scene media work — a voice take today, images
// and clips later. Same claim-and-lease shape as render_job (../db.ts).
import type pg from 'pg';
import type { AtRow } from '../assembly/types.ts';

export type MediaKind = 'voice' | 'image' | 'clip';
export interface MediaJob {
  id: string;
  project_id: string;
  scene_id: string;
  kind: MediaKind;
  phase: 'queued' | 'running' | 'done' | 'failed' | 'stopped';
  request: Record<string, unknown>;
  attempts: number;
}

/**
 * Queue work for one scene. Refused (null) while the same kind of work is
 * already active on that scene — the database's partial unique index.
 */
export async function enqueueMedia(db: pg.Pool, sceneId: string, kind: MediaKind, request: Record<string, unknown> = {}, requestedBy?: string): Promise<string | null> {
  const r = await db.query(
    `insert into hov.media_job (project_id, scene_id, kind, request, requested_by)
     select s.project_id, s.id, $2, $3::jsonb, $4 from hov.scene s where s.id = $1
     on conflict (scene_id, kind) where phase in ('queued', 'running') do nothing
     returning id`,
    [sceneId, kind, JSON.stringify(request), requestedBy ?? null],
  );
  return r.rows[0]?.id ?? null;
}

export async function claimMedia(db: pg.Pool, workerId: string, leaseSeconds: number, kinds: MediaKind[], exclude: string[] = []): Promise<MediaJob | null> {
  const r = await db.query(
    `update hov.media_job set locked_by = $1, locked_until = now() + make_interval(secs => $2),
            phase = 'running', attempts = attempts + 1, started_at = coalesce(started_at, now())
     where id = (
       select id from hov.media_job
       where phase in ('queued', 'running') and kind = any($3::text[])
         and (locked_until is null or locked_until < now())
         and not (id = any($4::bigint[]))
       order by id limit 1
       for update skip locked)
     returning *`,
    [workerId, leaseSeconds, kinds, exclude],
  );
  return r.rows[0] ?? null;
}

/** Renew the lease; false once the job was stopped or taken over. */
export async function heartbeat(db: pg.Pool, job: MediaJob, workerId: string, leaseSeconds: number): Promise<boolean> {
  const r = await db.query(
    `update hov.media_job set locked_until = now() + make_interval(secs => $3)
     where id = $1 and locked_by = $2 and phase = 'running' returning id`,
    [job.id, workerId, leaseSeconds],
  );
  return !!r.rowCount;
}

export async function finishMedia(db: pg.Pool, job: MediaJob, workerId: string, phase: 'done' | 'failed', patch: { result?: unknown; error?: string }): Promise<boolean> {
  const r = await db.query(
    `update hov.media_job set phase = $3, result = $4::jsonb, error = $5, finished_at = now(), locked_until = null
     where id = $1 and locked_by = $2 and phase = 'running' returning id`,
    [job.id, workerId, phase, patch.result === undefined ? null : JSON.stringify(patch.result), patch.error ?? null],
  );
  return !!r.rowCount;
}

export async function releaseMedia(db: pg.Pool, workerId: string): Promise<void> {
  await db.query(`update hov.media_job set locked_until = null where locked_by = $1 and phase = 'running'`, [workerId]);
}

/** The scene, its project and every scene of the film, through the hov.at_* views n8n reads. */
export async function loadSceneContext(db: pg.Pool, sceneId: string): Promise<{ scene: AtRow | null; project: AtRow | null; allScenes: AtRow[] }> {
  const s = await db.query(`select id, "createdTime", fields from hov.at_scene where id = $1`, [sceneId]);
  const scene = s.rows[0] ?? null;
  if (!scene) return { scene: null, project: null, allScenes: [] };
  const pid = scene.fields?.Project_ID;
  const [p, all] = await Promise.all([
    db.query(`select id, "createdTime", fields from hov.at_project where id = $1`, [pid]),
    db.query(`select id, "createdTime", fields from hov.at_scene where fields->>'Project_ID' = $1`, [pid]),
  ]);
  return { scene, project: p.rows[0] ?? null, allScenes: all.rows };
}

/** A scene write through hov.at_write, the function every n8n writer uses. */
export async function writeScene(db: pg.Pool, sceneId: string, fields: Record<string, unknown>): Promise<void> {
  await db.query(`select * from hov.at_write('scene', $1, $2::jsonb)`, [sceneId, JSON.stringify(fields)]);
}
