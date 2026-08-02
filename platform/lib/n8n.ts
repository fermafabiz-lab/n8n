// n8n public API client — powers the "Production health" panel: shows
// running/failed executions and lets the team stop a runaway workflow.
//
// Env (Vercel → Settings → Environment Variables):
//   N8N_API_URL  e.g. https://fermafabiz.app.n8n.cloud/api/v1
//   N8N_API_KEY  n8n → Settings → n8n API → Create API key

const BASE = process.env.N8N_API_URL;
const KEY = process.env.N8N_API_KEY;

export const n8nConfigured = Boolean(BASE && KEY);

// Workflow ids → human names, so the panel doesn't show raw ids.
const WORKFLOW_NAMES: Record<string, string> = {
  a9eyVteQcP1ZxtZH: "Master Orchestrator",
  auz2GejSQAhvLkCA: "Scripting",
  u5eVcB6VOGNdTMom: "Media Generation",
  y8ZPxgUFOxdRpva8: "Final Assembly",
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

export const FINAL_ASSEMBLY_WORKFLOW_ID = "y8ZPxgUFOxdRpva8";

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
  "u5eVcB6VOGNdTMom", // Media Generation
  "y8ZPxgUFOxdRpva8", // Final Assembly
  "auz2GejSQAhvLkCA", // Scripting
]);

export async function getAliveProduction(): Promise<ExecutionSummary[]> {
  if (!n8nConfigured) return [];
  const [running, waiting] = await Promise.all([
    getExecutions("running", 20),
    getExecutions("waiting", 20),
  ]);
  const soon = Date.now() + 2 * 3600 * 1000;
  return [
    ...running.filter((e) => WORKER_WORKFLOWS.has(e.workflowId)),
    ...waiting.filter(
      (e) =>
        WORKER_WORKFLOWS.has(e.workflowId) &&
        e.waitTill !== null &&
        new Date(e.waitTill).getTime() < soon,
    ),
  ];
}

export interface AssemblyState {
  /** The render happening right now, if any. */
  running: ExecutionSummary | null;
  /** A recent failure, surfaced only when nothing is running. */
  failed: (ExecutionSummary & { detail: ExecutionError | null }) | null;
}

/**
 * What the final render is doing. Used to tell "still working" apart from
 * "died half an hour ago" — from the project page, without opening n8n.
 */
export async function getAssemblyState(): Promise<AssemblyState> {
  if (!n8nConfigured) return { running: null, failed: null };
  const isAssembly = (e: ExecutionSummary) =>
    e.workflowId === FINAL_ASSEMBLY_WORKFLOW_ID;
  const running = (await getExecutions("running", 20)).find(isAssembly) ?? null;
  if (running) return { running, failed: null };

  // Only a failure from the last few minutes can belong to the render the
  // page is currently watching — executions carry no project id, so an older
  // one would be attributed to the wrong project.
  const recent = Date.now() - 20 * 60 * 1000;
  const failed =
    (await getExecutions("error", 10)).find(
      (e) => isAssembly(e) && new Date(e.startedAt ?? 0).getTime() > recent,
    ) ?? null;
  if (!failed) return { running: null, failed: null };
  return { running: null, failed: { ...failed, detail: await getExecutionError(failed.id) } };
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
