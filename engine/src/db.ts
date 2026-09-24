// Every statement the engine runs against `hov`. Reads go through the
// hov.at_* views, exactly as n8n's Postgres nodes did — that is what the
// assembly modules are pinned to. The one write outside render_job goes
// through hov.at_write, the same function Final Assembly's `Update Project
// Status` node called, so the project row changes in exactly the same way
// (and bumps library activity the same way, db/014).
import pg from 'pg';
import type { AtRow } from './assembly/types.ts';

export const ACTIVE = ['queued', 'assemble', 'graphics', 'store'] as const;
export type Phase = typeof ACTIVE[number] | 'done' | 'failed' | 'stopped';

export interface RenderJob {
  id: string;
  project_id: string;
  phase: Phase;
  trigger: Record<string, string>;
  inputs: any;
  assemble_job_id: string | null;
  assemble_body: any;
  assemble_polls: number;
  assembled: any;
  graphics_job_id: string | null;
  render_body: any;
  graphics_polls: number;
  graphics_output_url: string | null;
  progress: number | null;
  final_url: string | null;
  error: string | null;
}

export function pool(databaseUrl: string, max: number): pg.Pool {
  return new pg.Pool({ connectionString: databaseUrl, max });
}

/**
 * Queue a render. Refused (returns null) while the project already has an
 * active one — the partial unique index says so, not a check that can race.
 * This is the statement the site's startAssembly() will run (phase 4).
 */
export async function enqueue(db: pg.Pool, projectId: string, trigger: Record<string, string> = {}, requestedBy?: string): Promise<string | null> {
  const r = await db.query(
    `insert into hov.render_job (project_id, trigger, requested_by) values ($1, $2, $3)
     on conflict (project_id) where phase in ('queued', 'assemble', 'graphics', 'store') do nothing
     returning id`,
    [projectId, trigger, requestedBy ?? null],
  );
  return r.rows[0]?.id ?? null;
}

/** Take the oldest active row nobody holds (never claimed, or its worker's lease ran out). */
export async function claim(db: pg.Pool, workerId: string, leaseSeconds: number, exclude: string[] = []): Promise<RenderJob | null> {
  const r = await db.query(
    `update hov.render_job set locked_by = $1, locked_until = now() + make_interval(secs => $2),
            started_at = coalesce(started_at, now())
     where id = (
       select id from hov.render_job
       where phase in ('queued', 'assemble', 'graphics', 'store')
         and (locked_until is null or locked_until < now())
         and not (id = any($3::bigint[]))
       order by id limit 1
       for update skip locked)
     returning *`,
    [workerId, leaseSeconds, exclude],
  );
  return r.rows[0] ?? null;
}

const COLS = new Set(['phase', 'inputs', 'assemble_job_id', 'assemble_body', 'assemble_polls', 'assembled', 'graphics_job_id', 'render_body', 'graphics_polls', 'graphics_output_url', 'progress', 'verify', 'final_url', 'error', 'finished_at']);

/**
 * Write what changed and renew the lease, in one statement — but only while
 * the row is still ours and still active. Returns false when it is not:
 * the site stopped it, or another worker took it over after our lease
 * lapsed. Either way the caller must drop the job at once.
 */
export async function save(db: pg.Pool, job: RenderJob, workerId: string, leaseSeconds: number, patch: Record<string, unknown>): Promise<boolean> {
  const keys = Object.keys(patch).filter((k) => COLS.has(k));
  const sets = keys.map((k, i) => `${k} = $${i + 4}`);
  const values = keys.map((k) => {
    const v = patch[k];
    return v !== null && typeof v === 'object' && !(v instanceof Date) ? JSON.stringify(v) : v;
  });
  const r = await db.query(
    `update hov.render_job set ${[...sets, 'locked_until = now() + make_interval(secs => $3)'].join(', ')}
     where id = $1 and locked_by = $2 and phase in ('queued', 'assemble', 'graphics', 'store')
     returning id`,
    [job.id, workerId, leaseSeconds, ...values],
  );
  if (!r.rowCount) return false;
  Object.assign(job, patch);
  return true;
}

export async function release(db: pg.Pool, workerId: string): Promise<void> {
  await db.query(`update hov.render_job set locked_until = null where locked_by = $1 and phase in ('queued', 'assemble', 'graphics', 'store')`, [workerId]);
}

/** The inputs Final Assembly's Postgres nodes read, from the same views. */
export async function loadInputs(db: pg.Pool, projectId: string): Promise<{ sceneRows: AtRow[]; project: AtRow | null; script: AtRow | null }> {
  // Fetch Approved Scenes
  const scenes = await db.query(
    `select id, "createdTime", fields from hov.at_scene where fields->>'Project_ID' = $1 and (fields->>'Aprobare Scenă')::boolean`,
    [projectId],
  );
  // Fetch Project Info
  const project = await db.query(`select id, "createdTime", fields from hov.at_project where id = $1`, [projectId]);
  // Fetch Script Titles: the newest script that names this project.
  const script = await db.query(
    `select id, "createdTime", fields from hov.at_script where fields->'Associated Project' @> $1::jsonb order by "createdTime" desc limit 1`,
    [JSON.stringify([projectId])],
  );
  return { sceneRows: scenes.rows, project: project.rows[0] ?? null, script: script.rows[0] ?? null };
}

/** Update Project Status: the film is finished and this is where it lives. */
export async function markFinished(db: pg.Pool, projectId: string, url: string): Promise<void> {
  await db.query(`select * from hov.at_write('project', $1, $2::jsonb)`, [projectId, JSON.stringify({ 'Status General': 'Finalizat', 'Link Video Final': url })]);
}

/** Terminal write for a job that failed: no lease condition beyond ownership, the error must land. */
export async function fail(db: pg.Pool, job: RenderJob, workerId: string, message: string): Promise<void> {
  await db.query(
    `update hov.render_job set phase = 'failed', error = $3, finished_at = now(), locked_until = null
     where id = $1 and locked_by = $2 and phase in ('queued', 'assemble', 'graphics', 'store')`,
    [job.id, workerId, message.slice(0, 4000)],
  );
}
