/**
 * A film's PRODUCTION RUN on the engine (engine/src/produce/, hov.production_job
 * — db/018) instead of n8n's Media Generation batch: the sheets, the voices,
 * the images, the two approval gates, the clips and the settings gate
 * (docs/plans/engine-media-generation.md, phase 6).
 *
 * WHO runs a film's production is `PRODUCTION_ENGINE` on the site: `code` =
 * the engine, anything else = n8n, exactly as before. The orchestrator asks
 * the site (POST /api/ops/produce) at the moment it would have called Media
 * Generation, so the switch and its rollback are one Variable, as for every
 * other engine stage.
 *
 * What changes for the producer: Pause stops THIS film's run and nothing else
 * (n8n could only stop every execution at once), and a restart of the box
 * resumes where the run was — clips in flight at Google included.
 *
 * Every read tolerates the table not existing (db/018 not applied): the answer
 * is then "no engine run", and the site behaves as it always has.
 */
import { atQuery, isConfigured } from "@/lib/data/postgres";
import type { ExecutionSummary } from "@/lib/n8n";

export const productionEngine = (): "code" | "n8n" =>
  process.env.PRODUCTION_ENGINE === "code" ? "code" : "n8n";

export interface ProductionJob {
  id: string;
  phase: "queued" | "running" | "done" | "failed" | "stopped";
  stage: string;
  pass: number;
  error: string | null;
  created_at: string;
  started_at: string | null;
  updated_at: string;
  finished_at: string | null;
}
const ACTIVE = new Set(["queued", "running"]);

/** The newest production run for a film, or null (none, or db/018 not applied). */
export async function latestProductionJob(projectId: string): Promise<ProductionJob | null> {
  if (!isConfigured) return null;
  try {
    const rows = await atQuery<ProductionJob>(
      `select id::text, phase, stage, pass, error, created_at::text, started_at::text, updated_at::text, finished_at::text
         from hov.production_job where project_id = $1 order by id desc limit 1`,
      [projectId],
    );
    return rows[0] ?? null;
  } catch {
    return null;
  }
}
export const isProducing = (j: ProductionJob | null) => !!j && ACTIVE.has(j.phase);

/**
 * The orchestrator's inputs for Media Generation, read from the project the
 * way `Fetch Project For Resume` reads them: the narrator and the format.
 */
async function triggerFor(projectId: string): Promise<{ Voice_ID?: string; Aspect_Ratio: string }> {
  const rows = await atQuery<{ voice_id: string | null; aspect: string | null }>(
    `select voice_id, aspect from hov.project where id = $1`,
    [projectId],
  );
  const p = rows[0];
  if (!p) throw new Error("no such film");
  return { ...(p.voice_id ? { Voice_ID: p.voice_id } : {}), Aspect_Ratio: p.aspect === "9:16" ? "9:16" : "16:9" };
}

/**
 * Queue the film's production run. The database refuses a second active run
 * for the same film (the partial unique index in db/018) — two presses cannot
 * start two batches, which in n8n took a zombie filter and a hope.
 */
export async function queueProduction(
  projectId: string,
  requestedBy: string,
  trigger?: { Voice_ID?: string; Aspect_Ratio?: string },
): Promise<{ ok: boolean; message: string }> {
  if (!isConfigured) return { ok: false, message: "The database is not configured." };
  try {
    const t = { ...(await triggerFor(projectId)), ...Object.fromEntries(Object.entries(trigger || {}).filter(([, v]) => v)) };
    const rows = await atQuery<{ id: string }>(
      `insert into hov.production_job (project_id, trigger, requested_by) values ($1, $2::jsonb, $3)
       on conflict (project_id) where phase in ('queued', 'running') do nothing
       returning id::text`,
      [projectId, JSON.stringify(t), requestedBy],
    );
    return rows[0]
      ? { ok: true, message: "started" }
      : { ok: false, message: "production is already running for this film" };
  } catch (e) {
    return { ok: false, message: `could not start production: ${(e as Error).message}` };
  }
}

/** Stop the film's run. The engine lets go at its next save; finished assets stay. */
export async function stopProduction(projectId: string): Promise<number> {
  if (!isConfigured) return 0;
  try {
    const rows = await atQuery(
      `update hov.production_job set phase = 'stopped', finished_at = now()
        where project_id = $1 and phase in ('queued', 'running') returning id`,
      [projectId],
    );
    return rows.length;
  } catch {
    return 0;
  }
}

/**
 * An active run, in the shape the project page's Pause/Resume logic reads
 * (getAliveProduction's), so "is anything working on this film" is answered
 * for the engine too.
 */
export function asExecution(j: ProductionJob): ExecutionSummary {
  return {
    id: `production-${j.id}`,
    workflowId: "engine",
    workflowName: "Production engine",
    status: "running",
    startedAt: j.started_at ?? j.created_at,
    stoppedAt: null,
    errorMessage: null,
    waitTill: null,
  } as ExecutionSummary;
}
