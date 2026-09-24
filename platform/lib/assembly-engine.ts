/**
 * The final render, when the ENGINE draws it instead of n8n
 * (docs/plans/engine-final-assembly.md, phase 4).
 *
 * The engine (`engine/` in the repo, its own container) takes its work from
 * `hov.render_job` (db/016): the site queues a row, the engine drives it
 * through assemble → graphics → store and marks the project Finalizat
 * exactly as n8n's Final Assembly did. So everything the site needs to do
 * here is a statement on that one table — queue, read, stop.
 *
 * WHO RENDERS is decided per call by `engineFor()`:
 *   - FINAL_ASSEMBLY_ENGINE=code on the site  → the engine, for every film
 *   - otherwise (the default)                  → n8n, exactly as before —
 *     unless THIS film was rendered by the engine in the last day, so a
 *     Restart on a film being tried on the engine stays on the engine
 *     rather than silently falling back to n8n halfway through a test.
 *
 * Every read tolerates the table not existing (db/016 not applied): the
 * answer is then "no engine job", and the site behaves as it always has.
 */
import { atQuery, isConfigured } from "@/lib/data/postgres";
import type { AssemblyState, ExecutionSummary } from "@/lib/n8n";

export type AssemblyEngine = "n8n" | "code";

/** The site-wide choice. Anything but the exact word `code` is n8n. */
export function defaultEngine(): AssemblyEngine {
  return process.env.FINAL_ASSEMBLY_ENGINE === "code" ? "code" : "n8n";
}

export interface EngineJob {
  id: string;
  phase: "queued" | "assemble" | "graphics" | "store" | "done" | "failed" | "stopped";
  progress: number | null;
  error: string | null;
  final_url: string | null;
  created_at: string;
  started_at: string | null;
  updated_at: string;
  finished_at: string | null;
}

const ACTIVE = new Set(["queued", "assemble", "graphics", "store"]);
export const isActive = (j: EngineJob | null) => !!j && ACTIVE.has(j.phase);

/** The newest engine job for a film, or null (none, or db/016 not applied). */
export async function latestEngineJob(projectId: string): Promise<EngineJob | null> {
  if (!isConfigured) return null;
  try {
    const rows = await atQuery<EngineJob>(
      `select id::text, phase, progress, error, final_url,
              created_at::text, started_at::text, updated_at::text, finished_at::text
         from hov.render_job where project_id = $1 order by id desc limit 1`,
      [projectId],
    );
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

/** Which engine renders THIS film now. See the header. */
export async function engineFor(projectId: string): Promise<AssemblyEngine> {
  if (defaultEngine() === "code") return "code";
  const last = await latestEngineJob(projectId);
  if (last && Date.now() - new Date(last.created_at).getTime() < 24 * 3600 * 1000) return "code";
  return "n8n";
}

/**
 * Queue a render on the engine. The database refuses a second active job for
 * the same film (the partial unique index in db/016), which is the
 * double-render guard: two clicks cannot race into two renders.
 */
export async function queueEngineRender(
  projectId: string,
  requestedBy: string,
  trigger: { aspect?: string; captions?: string } = {},
): Promise<{ ok: boolean; message: string }> {
  if (!isConfigured) return { ok: false, message: "The database is not configured." };
  try {
    const rows = await atQuery<{ id: string }>(
      `insert into hov.render_job (project_id, trigger, requested_by) values ($1, $2::jsonb, $3)
       on conflict (project_id) where phase in ('queued', 'assemble', 'graphics', 'store') do nothing
       returning id::text`,
      [projectId, JSON.stringify(trigger), requestedBy],
    );
    return rows[0]
      ? { ok: true, message: "started" }
      : { ok: false, message: "a render is already running for this film" };
  } catch (e) {
    return { ok: false, message: `could not queue the render: ${(e as Error).message}` };
  }
}

/**
 * Stop the film's active engine job. The engine lets go within one poll (its
 * next write is refused). The Railway job it started keeps drawing to the
 * end — there is no cancel endpoint — exactly as with n8n.
 */
export async function stopEngineRender(projectId: string): Promise<number> {
  if (!isConfigured) return 0;
  try {
    const rows = await atQuery(
      `update hov.render_job set phase = 'stopped', finished_at = now()
        where project_id = $1 and phase in ('queued', 'assemble', 'graphics', 'store') returning id`,
      [projectId],
    );
    return rows.length;
  } catch {
    return 0;
  }
}

/** What the panel shows for an engine render, beside n8n's AssemblyState. */
export interface EngineProgress {
  phase: EngineJob["phase"];
  progress: number | null;
}

/**
 * The render state for ONE film. An engine job answers first — it names its
 * project, which n8n executions never could — and n8n's instance-wide
 * guesswork (getAssemblyState) answers only when the engine has nothing for
 * this film. A failure still outranks "still working", as there.
 */
export async function getAssemblyStateFor(
  projectId: string,
  n8nState: () => Promise<AssemblyState>,
): Promise<(AssemblyState & { engine?: EngineProgress }) | null> {
  const job = await latestEngineJob(projectId);
  const asExecution = (j: EngineJob, status: string): ExecutionSummary =>
    ({
      id: `engine-${j.id}`,
      workflowId: "engine",
      workflowName: "Render engine",
      status,
      startedAt: j.started_at ?? j.created_at,
      stoppedAt: j.finished_at,
      errorMessage: j.error,
      waitTill: null,
    }) as ExecutionSummary;
  if (job && isActive(job)) {
    return {
      running: asExecution(job, "running"),
      failed: null,
      stopped: false,
      upstream: null,
      upstreamStalled: false,
      engine: { phase: job.phase, progress: job.progress },
    };
  }
  // Only a recent failure belongs to the render being watched, the same
  // twenty minutes n8n's answer uses.
  if (job && job.phase === "failed" && Date.now() - new Date(job.finished_at ?? job.updated_at).getTime() < 20 * 60 * 1000) {
    return {
      running: null,
      failed: { ...asExecution(job, "error"), detail: { node: "render engine", message: job.error ?? "unknown error" } },
      stopped: false,
      upstream: null,
      upstreamStalled: false,
    };
  }
  return n8nState().catch(() => null);
}
