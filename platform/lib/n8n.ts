// n8n public API client — powers the "Production health" panel: shows
// running/failed executions and lets the team stop a runaway workflow.
//
// Env (Vercel → Settings → Environment Variables):
//   N8N_API_URL  e.g. https://your-n8n-host/api/v1  (cloud or self-hosted)
//   N8N_API_KEY  n8n → Settings → n8n API → Create API key

const BASE = process.env.N8N_API_URL;
const KEY = process.env.N8N_API_KEY;

export const n8nConfigured = Boolean(BASE && KEY);

// Workflow ids → human names, so the panel doesn't show raw ids.
//
// These are the SELF-HOSTED ids. The move off n8n Cloud did not preserve the
// originals, and every id below is matched against live execution records —
// a stale one matches nothing at all, silently.
const WORKFLOW_NAMES: Record<string, string> = {
  "8CienBFfG6SgbB1A": "Master Orchestrator",
  gkEtGMecv4TC3ZHp: "Scripting",
  yHG4DBCDjR3RJzav: "Media Generation",
  BY22Vlhh20Xdkr5Z: "Final Assembly",
};

export interface ExecutionSummary {
  id: string;
  workflowId: string;
  workflowName: string;
  status: string;
  startedAt: string | null;
  stoppedAt: string | null;
  errorMessage: string | null;
  waitTill: string | null;
}

interface RawExecution {
  id: number | string;
  workflowId: string;
  status?: string;
  startedAt?: string;
  stoppedAt?: string;
  finished?: boolean;
  waitTill?: string | null;
}

async function api(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "X-N8N-API-KEY": KEY as string,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
}

function toSummary(r: RawExecution): ExecutionSummary {
  return {
    id: String(r.id),
    workflowId: r.workflowId,
    workflowName: WORKFLOW_NAMES[r.workflowId] ?? r.workflowId,
    status: r.status ?? (r.finished ? "success" : "unknown"),
    startedAt: r.startedAt ?? null,
    stoppedAt: r.stoppedAt ?? null,
    errorMessage: null,
    waitTill: r.waitTill ?? null,
  };
}

export async function getExecutions(
  status: "running" | "error" | "waiting",
  limit = 10,
): Promise<ExecutionSummary[]> {
  if (!n8nConfigured) return [];
  const res = await api(`/executions?status=${status}&limit=${limit}`);
  if (!res.ok) throw new Error(`n8n API: HTTP ${res.status}`);
  const data = (await res.json()) as { data: RawExecution[] };
  return (data.data ?? []).map(toSummary);
}

export interface ExecutionError {
  node: string | null;
  message: string;
}

export async function getExecutionError(id: string): Promise<ExecutionError | null> {
  if (!n8nConfigured) return null;
  const res = await api(`/executions/${id}?includeData=true`);
  if (!res.ok) return null;
  const data = (await res.json()) as {
    data?: {
      resultData?: {
        error?: { message?: string; node?: { name?: string } };
        lastNodeExecuted?: string;
      };
    };
  };
  const rd = data.data?.resultData;
  if (!rd) return null;
  const msg = rd.error?.message ?? null;
  if (!msg) return null;
  // The error object's own node name is the most precise; lastNodeExecuted
  // is the fallback (they match except for sub-workflow bubbles).
  return { node: rd.error?.node?.name ?? rd.lastNodeExecuted ?? null, message: msg };
}

export const FINAL_ASSEMBLY_WORKFLOW_ID = "BY22Vlhh20Xdkr5Z";

/**
 * Display mirror of the CAP in Media Generation's "Sort & Cap Scenes" node:
 * each batch run takes at most this many unfinished scenes (pending sort
 * ahead of finished ones, so repeated runs converge). The real cap lives in
 * the n8n workflow — changing it there without updating this constant only
 * makes the "N more runs needed" hint wrong, nothing worse.
 */
export const MEDIA_BATCH_CAP = 8;

/**
 * Executions doing actual production work right now.
 *
 * Two traps hide in n8n's execution list:
 * - Work paused in a Wait node reports as "waiting", not "running" — but it
 *   IS alive (polling loops live there most of the time).
 * - The instance accumulates ZOMBIES: orchestrator parents stuck "waiting"
 *   with waitTill in the year 3000 for sub-workflows that died months ago.
 *   Counting those as alive makes Pause/Resume permanently wrong.
 * So: running always counts; waiting counts only for the worker workflows
 * (not the orchestrator) and only when the wake-up is genuinely near.
 */
const WORKER_WORKFLOWS = new Set([
  "yHG4DBCDjR3RJzav", // Media Generation
  "BY22Vlhh20Xdkr5Z", // Final Assembly
  "gkEtGMecv4TC3ZHp", // Scripting
]);

/**
 * A "running" execution that never actually started.
 *
 * n8n occasionally creates an execution, hands it its input, and then never
 * executes a single node. It reports as `running` forever: the parent sits in
 * `waitForSubWorkflow`, the batch never moves, and the site — which trusts
 * `running` — refuses to Resume because it believes work is in progress.
 *
 * THE OLD TEST WAS WRONG AND IT COST US A DAY. It called an execution dead
 * when `runData` was still empty after three minutes, on the premise that "a
 * healthy execution runs its first node within seconds". That premise is
 * false here: n8n does not persist node progress mid-run (`saveExecutionProgress`
 * is off), so `runData` stays `{}` for the WHOLE life of a perfectly healthy
 * execution and only lands when it finishes or suspends into a Wait node.
 * Proven by execution 2485 — `running` with empty `runData` for over a
 * minute, then a clean render four minutes later.
 *
 * So every render longer than three minutes was declared "STUCK — NEVER
 * STARTED", dropped from `getAliveProduction()`, and then STOPPED by the
 * next Resume, which restarted it from the beginning — the producer's
 * "it keeps stopping and the render starts over".
 *
 * What survives: only a `running` execution can be judged at all (a
 * `waiting` one has its state persisted by definition, so it is alive), and
 * only by AGE, well past anything legitimate. A real media batch runs for
 * the best part of an hour, but it spends that time in Wait nodes reporting
 * `waiting`; a continuously-`running` execution this old has stopped being
 * plausible. Deliberately conservative: a false negative costs a Stop
 * button nobody presses, a false positive kills a real render.
 */
const STALL_AGE_MS = 45 * 60 * 1000;

export function isStalled(e: ExecutionSummary): boolean {
  if (!e.startedAt) return false;
  return Date.now() - new Date(e.startedAt).getTime() > STALL_AGE_MS;
}

export async function getAliveProduction(): Promise<ExecutionSummary[]> {
  if (!n8nConfigured) return [];
  const [running, waiting] = await Promise.all([
    getExecutions("running", 20),
    getExecutions("waiting", 20),
  ]);
  const soon = Date.now() + 2 * 3600 * 1000;
  const candidates = [
    ...running.filter((e) => WORKER_WORKFLOWS.has(e.workflowId)),
    ...waiting.filter(
      (e) =>
        WORKER_WORKFLOWS.has(e.workflowId) &&
        e.waitTill !== null &&
        new Date(e.waitTill).getTime() < soon,
    ),
  ];
  // A running execution counts as alive, full stop. Nothing readable from
  // the API distinguishes "working" from "never started" while it runs, and
  // guessing here is what let Resume kill live renders.
  return candidates;
}

/**
 * Every Final Assembly execution currently alive.
 *
 * Same near-wake-up test as getAliveProduction: a render polling the render
 * server sits in a Wait node and reports as "waiting", not "running", so
 * looking only at "running" would leave half the renders unstoppable.
 */
export async function getAliveAssembly(): Promise<ExecutionSummary[]> {
  if (!n8nConfigured) return [];
  const [running, waiting] = await Promise.all([
    getExecutions("running", 20),
    getExecutions("waiting", 20),
  ]);
  const soon = Date.now() + 2 * 3600 * 1000;
  return [
    ...running,
    ...waiting.filter(
      (e) => e.waitTill !== null && new Date(e.waitTill).getTime() < soon,
    ),
  ].filter((e) => e.workflowId === FINAL_ASSEMBLY_WORKFLOW_ID);
}

/**
 * Executions running far longer than any real one — surfaced so the producer
 * can stop them instead of staring at a batch that will never move. Advisory
 * only: see isStalled for why this can no longer be trusted to auto-kill.
 */
export async function getStalledProduction(): Promise<ExecutionSummary[]> {
  if (!n8nConfigured) return [];
  return (await getExecutions("running", 20)).filter(
    (e) => WORKER_WORKFLOWS.has(e.workflowId) && isStalled(e),
  );
}

export interface AssemblyState {
  /** The render happening right now, if any. */
  running: ExecutionSummary | null;
  /** A recent failure, surfaced only when nothing is running. */
  failed: (ExecutionSummary & { detail: ExecutionError | null }) | null;
  /**
   * True only when n8n answered and there is genuinely nothing at work:
   * no render running, no upstream production alive, no recent failure.
   * "No running render" alone is NOT a verdict — production still being
   * upstream, or n8n not being configured, both look identical to a dead
   * render if the caller only checks `running`. Collapsing those into
   * "stopped" is exactly what made the panel push a manual restart on
   * every healthy project.
   */
  stopped: boolean;
}

/**
 * What the final render is doing. Used to tell "still working" apart from
 * "died half an hour ago" — from the project page, without opening n8n.
 */
export async function getAssemblyState(): Promise<AssemblyState> {
  // Can't see n8n at all — no verdict, never "stopped".
  if (!n8nConfigured) return { running: null, failed: null, stopped: false };
  const isAssembly = (e: ExecutionSummary) =>
    e.workflowId === FINAL_ASSEMBLY_WORKFLOW_ID;
  const [runningNow, waitingNow] = await Promise.all([
    getExecutions("running", 20),
    getExecutions("waiting", 20),
  ]);
  // A render polling the render server sits in a Wait node, and n8n reports
  // that as "waiting", not "running". Looking only at "running" made the
  // panel cry failure on a healthy render between two polls. Same near
  // wake-up test as getAliveProduction, for the same zombie reason.
  const soon = Date.now() + 2 * 3600 * 1000;
  const alive = [
    ...runningNow,
    ...waitingNow.filter(
      (e) => e.waitTill !== null && new Date(e.waitTill).getTime() < soon,
    ),
  ];
  const running = alive.find(isAssembly) ?? null;
  if (running) return { running, failed: null, stopped: false };

  // Production is still upstream: media generation marks the project as
  // assembling when it reaches the final-settings gate, long before there is
  // any render to watch. That gap is normal, not a stopped render.
  if (alive.some((e) => WORKER_WORKFLOWS.has(e.workflowId))) {
    return { running: null, failed: null, stopped: false };
  }

  // Only a failure from the last few minutes can belong to the render the
  // page is currently watching — executions carry no project id, so an older
  // one would be attributed to the wrong project.
  const recent = Date.now() - 20 * 60 * 1000;
  const failed =
    (await getExecutions("error", 10)).find(
      (e) => isAssembly(e) && new Date(e.startedAt ?? 0).getTime() > recent,
    ) ?? null;
  if (!failed) return { running: null, failed: null, stopped: true };
  return {
    running: null,
    failed: { ...failed, detail: await getExecutionError(failed.id) },
    stopped: false,
  };
}

/** Deep link into the n8n editor for a specific execution. */
export function executionUrl(workflowId: string, executionId: string): string | null {
  if (!BASE) return null;
  const editor = BASE.replace(/\/api\/v1\/?$/, "");
  return `${editor}/workflow/${workflowId}/executions/${executionId}`;
}

/**
 * Stop a running execution. n8n's public API exposes POST
 * /executions/{id}/stop on recent versions; if this instance doesn't have
 * it we surface the API's answer instead of guessing.
 */
export async function stopExecution(id: string): Promise<{ok: boolean; message: string}> {
  if (!n8nConfigured) return {ok: false, message: "N8N_API_URL / N8N_API_KEY not set."};
  const res = await api(`/executions/${id}/stop`, {method: "POST"});
  if (res.ok) return {ok: true, message: `Execution ${id} stopped.`};
  const body = await res.text();
  return {ok: false, message: `n8n API: HTTP ${res.status} — ${body.slice(0, 200)}`};
}
