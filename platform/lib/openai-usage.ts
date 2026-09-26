/**
 * What OpenAI was asked, call by call — read out of n8n's own executions.
 *
 * The producer's question (2026-09-26): "după ultima încărcare ni s-au dus
 * creditele foarte repede și aș vrea să știu ce a consumat și cât" — after the
 * last top-up the credits went very fast; what used them, and how much.
 *
 * OpenAI will not answer that to the key n8n holds, and this was measured
 * rather than assumed (execution 17685): the request log (`GET /v1/responses`)
 * "must be made with a session key … from the browser", the stored chat
 * completions list is empty (nothing is sent with `store: true`), and the
 * usage and costs endpoints want `api.usage.read`, which the key lacks. Even
 * with that permission OpenAI counts per MODEL, never per pipeline step.
 *
 * So the one place that knows which step asked is n8n itself, and it records
 * two different things depending on how the call was made:
 *
 * - A raw **HTTP Request** to api.openai.com (Rewrite Scene Text, the Motion
 *   Judge, Graphic Plan…) keeps OpenAI's own reply, `usage` included: those
 *   calls are MEASURED.
 * - A **model sub-node** (`lmChatOpenAi`, feeding an agent) keeps only n8n's
 *   own count of the prompt (`tokenUsageEstimate`) and the answer's text. An
 *   agent with an output parser answers through a tool call, so that text is
 *   empty and n8n counts the answer as ZERO — the answer is then measured off
 *   the agent's own output instead. Those calls are ESTIMATED.
 *
 * Priced at OpenAI's published list prices (PRICES, with where and when they
 * were read). NOT in the estimate, and said so wherever it is shown: web
 * searches ($10 per 1,000, plus every page read, billed as input) — two model
 * nodes search the web and n8n records neither the searches nor the pages.
 *
 * Pure: no database, no n8n. `lib/openai-collect.ts` feeds it executions and
 * stores what it returns in hov.openai_call (db/019); the usage page reads the
 * rows back through `summarize`. `scripts/check-openai-usage.mjs` pins it
 * against real executions.
 */

// ---- prices ------------------------------------------------------------------

/** Where the prices below were read, and when — they change, the page says so. */
export const PRICES_SOURCE = "https://developers.openai.com/api/docs/pricing";
export const PRICES_READ_AT = "2026-09-26";

export interface Price {
  /** USD per 1M input tokens. */
  input: number;
  /** USD per 1M cached input tokens. */
  cached: number;
  /** USD per 1M output tokens (reasoning tokens are output tokens). */
  output: number;
  /** Above LONG_CONTEXT tokens of input, gpt-5.4 bills the whole call at these. */
  long?: { input: number; cached: number; output: number };
}

/** Standard tier, per 1M tokens, as published on PRICES_READ_AT. */
export const PRICES: Record<string, Price> = {
  "gpt-5.4": { input: 2.5, cached: 0.25, output: 15, long: { input: 5, cached: 0.5, output: 22.5 } },
  "gpt-5.4-mini": { input: 0.75, cached: 0.075, output: 4.5 },
  "gpt-5.4-nano": { input: 0.2, cached: 0.02, output: 1.25 },
  "gpt-5.2": { input: 1.75, cached: 0.175, output: 14 },
  "gpt-5.1": { input: 1.25, cached: 0.125, output: 10 },
  "gpt-5": { input: 1.25, cached: 0.125, output: 10 },
  "gpt-5-mini": { input: 0.25, cached: 0.025, output: 2 },
  "gpt-5-nano": { input: 0.05, cached: 0.005, output: 0.4 },
  "gpt-4.1": { input: 2, cached: 0.5, output: 8 },
  "gpt-4.1-mini": { input: 0.4, cached: 0.1, output: 1.6 },
  "gpt-4.1-nano": { input: 0.1, cached: 0.025, output: 0.4 },
  "gpt-4o": { input: 2.5, cached: 1.25, output: 10 },
  "gpt-4o-2024-05-13": { input: 5, cached: 5, output: 15 },
  "gpt-4o-mini": { input: 0.15, cached: 0.075, output: 0.6 },
};

/** gpt-5.4's long-context threshold ("<272K context length" on the price page). */
export const LONG_CONTEXT = 272_000;
/** Web search: $10.00 per 1k calls, "all models". Content tokens come on top, as input. */
export const WEB_SEARCH_PER_CALL = 0.01;

/**
 * The price row for a model as OpenAI names it in a reply: `gpt-5.4-2026-03-05`
 * is gpt-5.4. An exact row wins, so `gpt-4o-2024-05-13` keeps its own price.
 */
export function priceOf(model: string): Price | null {
  const m = String(model ?? "").trim().toLowerCase();
  if (PRICES[m]) return PRICES[m];
  const base = m.replace(/-\d{4}-\d{2}-\d{2}$/, "");
  return PRICES[base] ?? null;
}

/** The model's family name, without a snapshot date — what a legend should say. */
export function modelName(model: string): string {
  return String(model ?? "").trim().toLowerCase().replace(/-\d{4}-\d{2}-\d{2}$/, "") || "unknown";
}

export interface Tokens {
  model: string;
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  /** Measured only; the searches of an estimated call are unknown and not priced. */
  webSearchCalls?: number;
}

/** USD at list price. An unknown model costs 0 here and is listed as unpriced. */
export function costOf(t: Tokens): number {
  const p = priceOf(t.model);
  const searches = Math.max(0, t.webSearchCalls ?? 0) * WEB_SEARCH_PER_CALL;
  if (!p) return searches;
  const input = Math.max(0, t.inputTokens);
  const cached = Math.min(input, Math.max(0, t.cachedTokens));
  const rate = p.long && input > LONG_CONTEXT ? p.long : p;
  return ((input - cached) * rate.input + cached * rate.cached + Math.max(0, t.outputTokens) * rate.output) / 1e6 + searches;
}

// ---- what asked: steps and families --------------------------------------------

/**
 * Six families, because a pie with more slices than that cannot be read —
 * the per-step table carries the detail. Ordered as the film is made.
 * The first rule that matches a step wins.
 */
export const FAMILIES = [
  {
    id: "research",
    label: "Research before writing",
    note: "Research Tema — searches the web first",
  },
  {
    id: "script",
    label: "Writing the script",
    note: "story bible, outline, narration, editor, scenes, hook, drawn cards",
  },
  {
    id: "deepsearch",
    label: "Deep Search",
    note: "the fact check and ⟳ Re-check — judge, web lookups, rewrite, top-up",
  },
  {
    id: "rewrites",
    label: "Scene and hook rewrites",
    note: "regenerate text, rewrite with feedback, a new hook",
  },
  {
    id: "clips",
    label: "Clip checks and prompt fixes",
    note: "Media Generation's judges and the prompt rewrites after a refusal",
  },
  {
    id: "other",
    label: "Everything else",
    note: "graphic plan, YouTube titles, brief, archive, series, the credits check",
  },
] as const;
export type FamilyId = (typeof FAMILIES)[number]["id"];

const FAMILY_RULES: Array<[RegExp, FamilyId]> = [
  [/^Research Tema$/, "research"],
  [/^(FC|DS) /, "deepsearch"],
  [
    /^(Generate Story Bible|Rebuild Story Bible|Generate Outline|Write Full Narration|Edit Full Narration|Segment Chapter Into Scenes|Generate Hook|Choose Motif Cards|Cine Treatment|Cine Shot List|Rewrite Script)$/,
    "script",
  ],
  [/^(Rewrite Scene Text|Rewrite Scene Standalone)$|^HR /, "rewrites"],
  [/Judge$|^(VP Rewrite AI|Rewrite Prompt AI)$/, "clips"],
];

export function familyOf(step: string, workflowName = ""): FamilyId {
  for (const [re, id] of FAMILY_RULES) if (re.test(step)) return id;
  // A whole workflow that exists to rewrite the hook is a rewrite, whatever its nodes are called.
  if (/hook regen/i.test(workflowName)) return "rewrites";
  return "other";
}

export const familyLabel = (id: string): string => FAMILIES.find((f) => f.id === id)?.label ?? "Everything else";

/**
 * A step as the producer knows it. Deep Search's nodes are `FC *` (the pass
 * while the script is written) and `DS *` (the ⟳ Re-check button) — CLAUDE.md,
 * "the mapping is FC = Deep Search". The node name stays visible beside it.
 */
const STEP_LABELS: Record<string, string> = {
  "Research Tema": "Research the topic (web)",
  "Generate Story Bible": "Story bible",
  "Rebuild Story Bible": "Story bible, rebuilt",
  "Generate Outline": "Outline",
  "Write Full Narration": "Narration",
  "Edit Full Narration": "Narration editor",
  "Segment Chapter Into Scenes": "Scenes from each chapter",
  "Generate Hook": "Hook",
  "Choose Motif Cards": "Drawn cards",
  "Cine Treatment": "Cinematic treatment",
  "Cine Shot List": "Cinematic shot list",
  "Rewrite Script": "Script rewrite (feedback)",
  "FC Judge": "Deep Search: judge",
  "FC Source": "Deep Search: web lookup",
  "FC Rewrite": "Deep Search: rewrite",
  "FC Fill": "Deep Search: top-up (web)",
  "FC Fill Check": "Deep Search: top-up check",
  "DS Judge": "Re-check: judge",
  "DS Source": "Re-check: web lookup",
  "DS Rewrite": "Re-check: rewrite",
  "DS Fill": "Re-check: top-up (web)",
  "DS Fill Check": "Re-check: top-up check",
  "Rewrite Scene Text": "Scene text, rewritten",
  "Rewrite Scene Standalone": "Scene text, regenerated",
  "Motion Judge": "Clip judge",
  "RG Motion Judge": "Clip judge (regeneration)",
  "Consistency Judge": "Consistency judge",
  "VP Rewrite AI": "Clip prompt rewrite",
  "Rewrite Prompt AI": "Image prompt rewrite",
  "Plan Model": "Graphic plan",
};

export function stepLabel(step: string, workflowName = ""): string {
  if (STEP_LABELS[step]) return STEP_LABELS[step];
  return workflowName && !/^(Claude Scripting|3\. Media Generation|1\. Master Orchestrator)/.test(workflowName)
    ? `${workflowName}: ${step}`
    : step;
}

// ---- reading an execution ------------------------------------------------------

/** The slice of an n8n workflow this needs: every node's name, type and parameters. */
export interface WorkflowDef {
  id: string;
  name: string;
  nodes: Array<{ name: string; type: string; parameters?: Record<string, unknown> }>;
}

type Item = { json?: Record<string, unknown> } | null;
type Lane = Array<Array<Item> | null>;
interface Run {
  startTime?: number;
  executionIndex?: number;
  executionStatus?: string;
  source?: Array<{ previousNode?: string; previousNodeRun?: number } | null> | null;
  data?: Record<string, Lane | undefined>;
  inputOverride?: Record<string, Lane | undefined>;
}

/** The shape of GET /api/v1/executions/{id}?includeData=true, as far as this reads it. */
export interface Execution {
  id: string | number;
  workflowId: string;
  status?: string;
  mode?: string;
  startedAt?: string | null;
  stoppedAt?: string | null;
  data?: { resultData?: { runData?: Record<string, Run[]> } } | null;
}

export interface OpenAiCall {
  executionId: number;
  /** The node that called OpenAI: a model sub-node, or an HTTP Request. */
  node: string;
  runIndex: number;
  itemIndex: number;
  workflowId: string;
  workflowName: string;
  /** What ASKED: the agent a model sub-node served, or the HTTP node itself. */
  step: string;
  projectId: string | null;
  sceneId: string | null;
  model: string;
  at: string;
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  /** The model had web search switched on: its searches are not in these numbers. */
  webSearch: boolean;
  /** Searches OpenAI reported (measured Responses API calls only). */
  webSearchCalls: number;
  /** True: OpenAI's own usage figures. False: n8n's estimate. */
  measured: boolean;
  costUsd: number;
}

const MODEL_NODE = "@n8n/n8n-nodes-langchain.lmChatOpenAi";
const HTTP_NODE = "n8n-nodes-base.httpRequest";
const RECORD_ID = /^rec[A-Za-z0-9]{14}$/;
const OPENAI_MODEL = /^(gpt-|o\d|chatgpt-)/i;
/** A reply this long, in characters, is about this many tokens — English and JSON alike. */
const CHARS_PER_TOKEN = 4;

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
};
const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const tokensOfText = (s: string): number => (s ? Math.ceil(s.length / CHARS_PER_TOKEN) : 0);

/** The model a model sub-node was configured with: `{__rl, value}` or a plain string. */
function configuredModel(parameters: Record<string, unknown> | undefined): string {
  const m = parameters?.model;
  if (typeof m === "string") return m;
  const v = obj(m)?.value;
  return typeof v === "string" ? v : "";
}

function hasWebSearch(parameters: Record<string, unknown> | undefined): boolean {
  return Boolean(obj(obj(parameters?.builtInTools)?.webSearch));
}

/** A reply's `usage`, whichever API answered. */
function usageOfReply(body: Record<string, unknown>): Omit<Tokens, "model"> & { reasoningTokens: number } | null {
  const u = obj(body.usage);
  if (!u) return null;
  if (u.input_tokens !== undefined || body.object === "response") {
    const output = Array.isArray(body.output) ? body.output : [];
    return {
      inputTokens: num(u.input_tokens),
      cachedTokens: num(obj(u.input_tokens_details)?.cached_tokens),
      outputTokens: num(u.output_tokens),
      reasoningTokens: num(obj(u.output_tokens_details)?.reasoning_tokens),
      webSearchCalls: output.filter((o) => obj(o)?.type === "web_search_call").length,
    };
  }
  if (u.prompt_tokens !== undefined || u.completion_tokens !== undefined) {
    return {
      inputTokens: num(u.prompt_tokens),
      cachedTokens: num(obj(u.prompt_tokens_details)?.cached_tokens),
      outputTokens: num(u.completion_tokens),
      reasoningTokens: num(obj(u.completion_tokens_details)?.reasoning_tokens),
      webSearchCalls: 0,
    };
  }
  return null;
}

/**
 * Which film an execution worked for. The trigger says so in every workflow
 * that has one: `Project_ID` (the sub-workflow triggers), `project_id` or
 * `scene_id` (the site's webhooks). A scene is turned into its film by the
 * database, which knows (lib/data/postgres.ts). Failing that, the first node
 * that carries a `Project_ID` answers.
 */
export function filmOf(runData: Record<string, Run[]>): { projectId: string | null; sceneId: string | null } {
  const firsts = Object.values(runData)
    .map((runs) => runs?.[0])
    .filter((r): r is Run => Boolean(r))
    .sort((a, b) => (a.executionIndex ?? 1e9) - (b.executionIndex ?? 1e9));
  const idsIn = (j: Record<string, unknown> | null) => {
    const look = (o: Record<string, unknown> | null, keys: string[]) => {
      for (const k of keys) {
        const v = o?.[k];
        if (typeof v === "string" && RECORD_ID.test(v.trim())) return v.trim();
      }
      return null;
    };
    const body = obj(j?.body);
    return {
      projectId: look(j, ["Project_ID", "project_id", "projectId"]) ?? look(body, ["Project_ID", "project_id", "projectId"]),
      sceneId: look(j, ["scene_id", "sceneId", "Scene_ID"]) ?? look(body, ["scene_id", "sceneId", "Scene_ID"]),
    };
  };
  const trigger = firsts.find((r) => !r.source || r.source.length === 0) ?? firsts[0];
  const t = idsIn(obj(trigger?.data?.main?.[0]?.[0]?.json));
  if (t.projectId || t.sceneId) return t;
  for (const r of firsts) {
    const found = idsIn(obj(r.data?.main?.[0]?.[0]?.json));
    if (found.projectId) return { projectId: found.projectId, sceneId: null };
  }
  return { projectId: null, sceneId: null };
}

/**
 * Every OpenAI call an execution made. `workflow` should be the definition the
 * execution ran (its nodes' types say which nodes call OpenAI); a node missing
 * from it — renamed or deleted since — is still read when its data can only
 * be an OpenAI call.
 */
export function callsOf(execution: Execution, workflow: WorkflowDef | null): OpenAiCall[] {
  const runData = execution.data?.resultData?.runData;
  if (!runData || typeof runData !== "object") return [];
  const defs = new Map((workflow?.nodes ?? []).map((n) => [n.name, n]));
  const film = filmOf(runData);
  const executionId = Number(execution.id);
  const base = {
    executionId,
    workflowId: String(execution.workflowId ?? ""),
    workflowName: workflow?.name ?? "",
    projectId: film.projectId,
    sceneId: film.sceneId,
  };
  const at = (run: Run) =>
    new Date(Number.isFinite(run.startTime) ? Number(run.startTime) : Date.parse(execution.startedAt ?? "") || 0).toISOString();

  const calls: OpenAiCall[] = [];
  // Model calls whose answer n8n counted as nothing, grouped by the agent run
  // they served, to be measured off that agent's output afterwards.
  const unanswered = new Map<string, OpenAiCall[]>();
  // Raw OpenAI replies found in node outputs, settled after the loop.
  const replies: Array<{ node: string; runIndex: number; itemIndex: number; run: Run; body: Record<string, unknown> }> = [];

  for (const [node, runs] of Object.entries(runData)) {
    if (!Array.isArray(runs)) continue;
    const def = defs.get(node);
    const isModelNode =
      def?.type === MODEL_NODE ||
      (!def && runs.some((r) => OPENAI_MODEL.test(String(obj(obj(r.inputOverride?.ai_languageModel?.[0]?.[0]?.json)?.options)?.model ?? ""))));
    const isHttp =
      (def?.type === HTTP_NODE && JSON.stringify(def.parameters ?? {}).includes("api.openai.com")) || !def;

    if (isModelNode) {
      runs.forEach((run, runIndex) => {
        const outs = run?.data?.ai_languageModel?.[0] ?? [];
        const ins = run?.inputOverride?.ai_languageModel?.[0] ?? [];
        const options = obj(obj(ins[0]?.json)?.options);
        // A model node pointed somewhere else (an OpenAI-compatible proxy) is not OpenAI's bill.
        const baseURL = String(obj(options?.configuration)?.baseURL ?? "");
        if (baseURL && !/openai\.com/.test(baseURL)) return;
        const step = run?.source?.[0]?.previousNode || node;
        const parentRun = run?.source?.[0]?.previousNodeRun ?? 0;
        outs.forEach((item, itemIndex) => {
          const j = obj(item?.json);
          if (!j) return;
          const real = obj(j.tokenUsage);
          const est = obj(j.tokenUsageEstimate);
          const measured = Boolean(real && num(real.completionTokens) > 0);
          const u = measured ? real : est;
          if (!u) return;
          const itemOptions = obj(obj(ins[itemIndex]?.json)?.options) ?? options;
          const model = String(itemOptions?.model ?? "") || configuredModel(def?.parameters);
          let outputTokens = num(u.completionTokens);
          if (!measured && outputTokens === 0) {
            const gens = obj(j.response)?.generations;
            const text = Array.isArray(gens)
              ? gens.flat().map((g) => String(obj(g)?.text ?? "")).join("")
              : "";
            outputTokens = tokensOfText(text);
          }
          const call: OpenAiCall = {
            ...base,
            node,
            runIndex,
            itemIndex,
            step,
            model: model || "unknown",
            at: at(run),
            inputTokens: num(u.promptTokens),
            cachedTokens: 0,
            outputTokens,
            reasoningTokens: 0,
            webSearch: hasWebSearch(def?.parameters),
            webSearchCalls: 0,
            measured,
            costUsd: 0,
          };
          calls.push(call);
          if (!measured && outputTokens === 0) {
            const key = `${step}\u0000${parentRun}`;
            (unanswered.get(key) ?? unanswered.set(key, []).get(key)!).push(call);
          }
        });
      });
      continue;
    }

    if (!isHttp) continue;
    runs.forEach((run, runIndex) => {
      const items = run?.data?.main?.[0] ?? [];
      items.forEach((item, itemIndex) => {
        const j = obj(item?.json);
        if (!j) return;
        // `Full Response` wraps the reply in {body, headers, statusCode}.
        const body = obj(j.body) && obj(obj(j.body)?.usage) ? obj(j.body)! : j;
        const kind = body.object;
        if (kind !== "chat.completion" && kind !== "response") return;
        if (!OPENAI_MODEL.test(String(body.model ?? ""))) return;
        replies.push({ node, runIndex, itemIndex, run, body });
      });
    });
  }

  // One reply is one call, however many nodes it passed through: a node this
  // could not identify (renamed or deleted since the run) may just be handing
  // the HTTP node's item along. OpenAI's reply id settles it — the first node
  // to hold it, in execution order, made the call.
  replies.sort(
    (a, b) =>
      (a.run.executionIndex ?? 1e9) - (b.run.executionIndex ?? 1e9) ||
      (a.run.startTime ?? 0) - (b.run.startTime ?? 0),
  );
  const seen = new Set<string>();
  for (const { node, runIndex, itemIndex, run, body } of replies) {
    const id = typeof body.id === "string" ? body.id : "";
    if (id) {
      if (seen.has(id)) continue;
      seen.add(id);
    }
    const u = usageOfReply(body);
    if (!u) continue;
    calls.push({
      ...base,
      node,
      runIndex,
      itemIndex,
      step: node,
      model: String(body.model),
      at: at(run),
      inputTokens: u.inputTokens,
      cachedTokens: u.cachedTokens,
      outputTokens: u.outputTokens,
      reasoningTokens: u.reasoningTokens,
      webSearch: (u.webSearchCalls ?? 0) > 0,
      webSearchCalls: u.webSearchCalls ?? 0,
      measured: true,
      costUsd: 0,
    });
  }

  // An agent with an output parser answers through a tool call, so n8n saw
  // no answer text and counted it as zero. The agent's own output IS that
  // answer: one output item per call when they pair up, shared out evenly
  // when they do not.
  for (const [key, group] of unanswered) {
    const [step, parentRun] = key.split("\u0000");
    const agentRun = runData[step]?.[Number(parentRun)];
    const outputs = (agentRun?.data?.main?.[0] ?? []).map((it) => {
      const j = obj(it?.json);
      const out = j && "output" in j ? j.output : j;
      return out === undefined || out === null ? "" : typeof out === "string" ? out : JSON.stringify(out);
    });
    if (outputs.length === group.length) {
      group.forEach((c, i) => (c.outputTokens = tokensOfText(outputs[i])));
    } else if (outputs.length > 0) {
      const each = Math.ceil(tokensOfText(outputs.join("")) / group.length);
      group.forEach((c) => (c.outputTokens = each));
    }
  }

  for (const c of calls) c.costUsd = costOf(c);
  return calls;
}

/** True when a workflow has anything that can call OpenAI — the rest are not worth fetching. */
export function callsOpenAi(workflow: WorkflowDef): boolean {
  return (workflow.nodes ?? []).some(
    (n) =>
      n.type === MODEL_NODE ||
      n.type === "@n8n/n8n-nodes-langchain.openAi" ||
      (n.type === HTTP_NODE && JSON.stringify(n.parameters ?? {}).includes("api.openai.com")),
  );
}

// ---- reading the ledger back ---------------------------------------------------

/** One group of calls as the database sums them (lib/data/postgres.ts). */
export interface CallGroup {
  day: number; // UTC midnight, ms
  step: string;
  workflowName: string;
  model: string;
  projectId: string | null;
  projectName: string | null;
  webSearch: boolean;
  measured: boolean;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface Slice {
  id: string;
  label: string;
  note?: string;
  value: number;
  calls: number;
}

export interface StepRow {
  step: string;
  label: string;
  family: FamilyId;
  models: string[];
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  webSearch: boolean;
  measured: number;
}

export interface Summary {
  costUsd: number;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  /** Calls whose tokens OpenAI reported, as opposed to n8n's estimate. */
  measuredCalls: number;
  /** Calls made with web search on — their searches are not in costUsd. */
  webSearchCalls: number;
  films: number;
  families: Slice[];
  models: Slice[];
  steps: StepRow[];
  days: Array<{ t: number; v: number }>;
  byFilm: Array<{ id: string; name: string; costUsd: number; calls: number }>;
  /** Models seen with no price row: their calls cost 0 above. */
  unpriced: string[];
}

/** Everything the page shows, from the grouped rows. */
export function summarize(groups: CallGroup[]): Summary {
  const fam = new Map<string, Slice>();
  const mod = new Map<string, Slice>();
  const steps = new Map<string, StepRow>();
  const days = new Map<number, number>();
  const films = new Map<string, { id: string; name: string; costUsd: number; calls: number }>();
  const unpriced = new Set<string>();
  let costUsd = 0;
  let calls = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let measuredCalls = 0;
  let webSearchCalls = 0;
  for (const g of groups) {
    costUsd += g.costUsd;
    calls += g.calls;
    inputTokens += g.inputTokens;
    outputTokens += g.outputTokens;
    if (g.measured) measuredCalls += g.calls;
    if (g.webSearch) webSearchCalls += g.calls;
    if (!priceOf(g.model)) unpriced.add(modelName(g.model));

    const f = familyOf(g.step, g.workflowName);
    const fs = fam.get(f) ?? { id: f, label: familyLabel(f), note: FAMILIES.find((x) => x.id === f)?.note, value: 0, calls: 0 };
    fs.value += g.costUsd;
    fs.calls += g.calls;
    fam.set(f, fs);

    const m = modelName(g.model);
    const ms = mod.get(m) ?? { id: m, label: m, value: 0, calls: 0 };
    ms.value += g.costUsd;
    ms.calls += g.calls;
    mod.set(m, ms);

    const sk = `${g.workflowName}\u0000${g.step}`;
    const s = steps.get(sk) ?? {
      step: g.step,
      label: stepLabel(g.step, g.workflowName),
      family: f,
      models: [],
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      webSearch: false,
      measured: 0,
    };
    s.calls += g.calls;
    s.inputTokens += g.inputTokens;
    s.outputTokens += g.outputTokens;
    s.costUsd += g.costUsd;
    s.webSearch ||= g.webSearch;
    if (g.measured) s.measured += g.calls;
    if (!s.models.includes(m)) s.models.push(m);
    steps.set(sk, s);

    days.set(g.day, (days.get(g.day) ?? 0) + g.costUsd);

    if (g.projectId) {
      const fl = films.get(g.projectId) ?? { id: g.projectId, name: g.projectName ?? g.projectId, costUsd: 0, calls: 0 };
      fl.costUsd += g.costUsd;
      fl.calls += g.calls;
      films.set(g.projectId, fl);
    }
  }
  const order = FAMILIES.map((f) => f.id as string);
  return {
    costUsd,
    calls,
    inputTokens,
    outputTokens,
    measuredCalls,
    webSearchCalls,
    films: films.size,
    families: [...fam.values()].filter((s) => s.calls > 0).sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id)),
    models: [...mod.values()].filter((s) => s.calls > 0).sort((a, b) => b.value - a.value || b.calls - a.calls),
    steps: [...steps.values()].sort((a, b) => b.costUsd - a.costUsd || b.calls - a.calls),
    days: [...days.entries()].sort((a, b) => a[0] - b[0]).map(([t, v]) => ({ t, v })),
    byFilm: [...films.values()].sort((a, b) => b.costUsd - a.costUsd),
    unpriced: [...unpriced].sort(),
  };
}

/**
 * At most `max` slices, the smallest folded into one "Other" — a pie stops
 * being readable past six. Slices keep their order; "Other" goes last.
 */
export function capSlices(slices: Slice[], max = 6): Slice[] {
  if (slices.length <= max) return slices;
  const ranked = [...slices].sort((a, b) => b.value - a.value);
  const keep = new Set(ranked.slice(0, max - 1).map((s) => s.id));
  const rest = slices.filter((s) => !keep.has(s.id));
  return [
    ...slices.filter((s) => keep.has(s.id)),
    {
      id: "other-slices",
      label: `Other (${rest.length})`,
      note: rest.map((s) => s.label).join(", "),
      value: rest.reduce((n, s) => n + s.value, 0),
      calls: rest.reduce((n, s) => n + s.calls, 0),
    },
  ];
}
