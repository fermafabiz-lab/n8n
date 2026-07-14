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
}

interface RawExecution {
  id: number | string;
  workflowId: string;
  status?: string;
  startedAt?: string;
  stoppedAt?: string;
  finished?: boolean;
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

export async function getExecutionError(id: string): Promise<string | null> {
  if (!n8nConfigured) return null;
  const res = await api(`/executions/${id}?includeData=true`);
  if (!res.ok) return null;
  const data = (await res.json()) as {
    data?: {resultData?: {error?: {message?: string}; lastNodeExecuted?: string}};
  };
  const rd = data.data?.resultData;
  if (!rd) return null;
  const msg = rd.error?.message ?? null;
  return msg ? `${rd.lastNodeExecuted ? `[${rd.lastNodeExecuted}] ` : ""}${msg}` : null;
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
