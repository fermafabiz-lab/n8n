// The OpenAI ledger (lib/openai-usage.ts): which step asked, for which film,
// with which model, how many tokens, at what price — pinned against two REAL
// executions (db/port/openai-usage/fixtures/, sanitised) and against the
// shapes a real run has not produced yet.
//
//   node --experimental-strip-types --no-warnings --import ./scripts/footage-loader.mjs scripts/check-openai-usage.mjs

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  callsOf,
  callsOpenAi,
  capSlices,
  costOf,
  familyOf,
  filmOf,
  modelName,
  priceOf,
  stepLabel,
  summarize,
} from "@/lib/openai-usage";

const here = dirname(fileURLToPath(import.meta.url));
const fx = (f) => JSON.parse(readFileSync(join(here, "../../db/port/openai-usage/fixtures", f), "utf8"));
const results = [];
const is = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  results.push(ok);
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `\n     got  ${JSON.stringify(got)}\n     want ${JSON.stringify(want)}`}`);
};
const near = (name, got, want, eps = 1e-9) => {
  const ok = Math.abs(got - want) <= eps;
  results.push(ok);
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` — got ${got}, want ${want}`}`);
};

const scripting = fx("scripting-17677.json");
const graphic = fx("graphic-plan-17679.json");
const wfScripting = fx("workflow-claude-scripting.json");
const wfGraphic = fx("workflow-graphic-plan.json");
const wfMedia = fx("workflow-media-generation.json");

// ---- prices, as published on the day they were read ----
is("gpt-5.4 row", priceOf("gpt-5.4"), { input: 2.5, cached: 0.25, output: 15, long: { input: 5, cached: 0.5, output: 22.5 } });
is("a snapshot name is its model", priceOf("gpt-5.4-2026-03-05")?.input, 2.5);
is("gpt-4o-2024-05-13 keeps its own row", priceOf("gpt-4o-2024-05-13")?.input, 5);
is("gpt-4o-2024-08-06 is gpt-4o", priceOf("gpt-4o-2024-08-06")?.output, 10);
is("an unknown model has no price", priceOf("claude-x"), null);
is("legend name drops the date", modelName("gpt-5.4-2026-03-05"), "gpt-5.4");
near("100k in + 100k out on gpt-5.4 = $1.75", costOf({ model: "gpt-5.4", inputTokens: 100_000, cachedTokens: 0, outputTokens: 100_000 }), 1.75);
near("cached input at the cached rate", costOf({ model: "gpt-5.4", inputTokens: 100_000, cachedTokens: 100_000, outputTokens: 0 }), 0.025);
near("past 272K the whole call is long-context", costOf({ model: "gpt-5.4", inputTokens: 300_000, cachedTokens: 0, outputTokens: 10_000 }), (300_000 * 5 + 10_000 * 22.5) / 1e6);
near("a web search is a cent on top", costOf({ model: "gpt-5.4", inputTokens: 0, cachedTokens: 0, outputTokens: 0, webSearchCalls: 3 }), 0.03);
near("cached never exceeds input", costOf({ model: "gpt-4o", inputTokens: 100, cachedTokens: 500, outputTokens: 0 }), (100 * 1.25) / 1e6);
near("unknown model costs only its searches", costOf({ model: "mystery", inputTokens: 1e6, cachedTokens: 0, outputTokens: 1e6, webSearchCalls: 1 }), 0.01);

// ---- which workflows are worth reading ----
is("Claude Scripting calls OpenAI", callsOpenAi(wfScripting), true);
is("Graphic Plan calls OpenAI", callsOpenAi(wfGraphic), true);
is("Media Generation calls OpenAI", callsOpenAi(wfMedia), true);
is("a workflow of webhooks and Postgres does not", callsOpenAi({ id: "x", name: "x", nodes: [{ name: "W", type: "n8n-nodes-base.webhook" }, { name: "P", type: "n8n-nodes-base.postgres" }] }), false);

// ---- the film ----
is("scripting: the film from Receive Project Data", filmOf(scripting.data.resultData.runData), { projectId: "recFwxgbWLGBwb6Tr", sceneId: null });
is("graphic plan: the film from the webhook body", filmOf(graphic.data.resultData.runData), { projectId: "recFwxgbWLGBwb6Tr", sceneId: null });
is(
  "a scene webhook names its scene",
  filmOf({ W: [{ executionIndex: 0, source: [], data: { main: [[{ json: { body: { scene_id: "recR8blM6RLZ07vB6" } } }]] } }] }),
  { projectId: null, sceneId: "recR8blM6RLZ07vB6" },
);
is(
  "no trigger id: the first node carrying Project_ID answers",
  filmOf({
    T: [{ executionIndex: 0, source: [], data: { main: [[{ json: { body: {} } }]] } }],
    Load: [{ executionIndex: 1, source: [{ previousNode: "T" }], data: { main: [[{ json: { Project_ID: "recXmYh1Agny881om" } }]] } }],
  }),
  { projectId: "recXmYh1Agny881om", sceneId: null },
);
is("something that only looks like an id is not one", filmOf({ T: [{ executionIndex: 0, source: [], data: { main: [[{ json: { project_id: "rec123" } }]] } }] }), { projectId: null, sceneId: null });

// ---- a real scripting run (17677) ----
const calls = callsOf(scripting, wfScripting);
const by = (step) => calls.filter((c) => c.step === step);
is("every model run found: 2 segment + 1 bible + 3 editor + 1 research", calls.length, 7);
is("all estimated (model sub-nodes)", calls.every((c) => !c.measured), true);
is("all on the film", [...new Set(calls.map((c) => c.projectId))], ["recFwxgbWLGBwb6Tr"]);
is("the step is the agent, not the model node", by("Segment Chapter Into Scenes").map((c) => c.node), ["Segment Model", "Segment Model"]);
is("model read from the run", [...new Set(calls.map((c) => c.model))], ["gpt-5.4"]);
is("prompt tokens are n8n's estimate", by("Segment Chapter Into Scenes").map((c) => c.inputTokens), [5761, 5851]);
// n8n counted the Segment answers as 0 (they came back through the output
// parser's tool call); the agent's two outputs are 12,223 and 20,009 characters.
is("parser answers measured off the agent's output, one per item", by("Segment Chapter Into Scenes").map((c) => c.outputTokens), [Math.ceil(12223 / 4), Math.ceil(20009 / 4)]);
is("story bible answer measured off its agent (9,694 chars)", by("Generate Story Bible").map((c) => c.outputTokens), [Math.ceil(9694 / 4)]);
is("a text answer keeps n8n's own count", by("Edit Full Narration").map((c) => c.outputTokens), [147, 138, 129]);
is("each editor run is its own call", by("Edit Full Narration").map((c) => c.runIndex), [0, 1, 2]);
is("research model: web search is on", by("Research Tema").map((c) => c.webSearch), [true]);
is("story bible model: web search is on", by("Generate Story Bible").map((c) => c.webSearch), [true]);
is("editor: no web search", by("Edit Full Narration").every((c) => !c.webSearch), true);
is("time is the run's start", by("Research Tema")[0].at, new Date(1790443727351).toISOString());
near("a call's cost is its tokens at list price", by("Research Tema")[0].costUsd, (454 * 2.5 + 10 * 15) / 1e6);
is("nothing secret is kept on a call", JSON.stringify(calls).includes("api_key"), false);

// ---- a real raw HTTP call (17679) ----
const gp = callsOf(graphic, wfGraphic);
is("one call, measured", gp.map((c) => [c.node, c.step, c.measured]), [["Plan Model", "Plan Model", true]]);
is("OpenAI's own usage", [gp[0].inputTokens, gp[0].cachedTokens, gp[0].outputTokens, gp[0].reasoningTokens], [1081, 0, 110, 0]);
is("the snapshot model as OpenAI named it", gp[0].model, "gpt-5.4-2026-03-05");
near("priced as gpt-5.4", gp[0].costUsd, (1081 * 2.5 + 110 * 15) / 1e6);
is("the node after it is not a second call", gp.length, 1);

// ---- shapes a real run has not shown yet ----
const reply = (id, extra = {}) => ({
  id,
  object: "response",
  model: "gpt-5.4-2026-03-05",
  output: [{ type: "web_search_call" }, { type: "web_search_call" }, { type: "message" }],
  usage: { input_tokens: 40_000, input_tokens_details: { cached_tokens: 10_000 }, output_tokens: 2_000, output_tokens_details: { reasoning_tokens: 500 } },
  ...extra,
});
const synth = {
  id: "9001",
  workflowId: "wf",
  startedAt: "2026-09-26T10:00:00.000Z",
  data: {
    resultData: {
      runData: {
        Hook: [{ executionIndex: 0, source: [], data: { main: [[{ json: { body: { scene_id: "recR8blM6RLZ07vB6" } } }]] } }],
        // A Responses API call through HTTP, full response on.
        Ask: [{ executionIndex: 1, startTime: 1790400000000, source: [{ previousNode: "Hook" }], data: { main: [[{ json: { body: reply("resp_1"), headers: {}, statusCode: 200 } }]] } }],
        // A node this workflow no longer has, passing the same reply along.
        "Old Passthrough": [{ executionIndex: 2, source: [{ previousNode: "Ask" }], data: { main: [[{ json: reply("resp_1") }]] } }],
        // A model sub-node with REAL usage recorded.
        "Real Model": [{ executionIndex: 3, source: [{ previousNode: "Agent", previousNodeRun: 0 }], data: { ai_languageModel: [[{ json: { response: { generations: [[{ text: "hi" }]] }, tokenUsage: { promptTokens: 100, completionTokens: 20 } } }]] }, inputOverride: { ai_languageModel: [[{ json: { options: { model: "gpt-4o-mini", configuration: { baseURL: "https://api.openai.com/v1" } } } }]] } }],
        // A model sub-node pointed somewhere else is not OpenAI's bill.
        "Proxy Model": [{ executionIndex: 4, source: [{ previousNode: "Agent", previousNodeRun: 0 }], data: { ai_languageModel: [[{ json: { response: { generations: [[{ text: "hi" }]] }, tokenUsageEstimate: { promptTokens: 100, completionTokens: 20 } } }]] }, inputOverride: { ai_languageModel: [[{ json: { options: { model: "gpt-4o", configuration: { baseURL: "https://openrouter.ai/api/v1" } } } }]] } }],
        // An error reply carries no usage: nothing to count.
        "Failed Ask": [{ executionIndex: 5, source: [{ previousNode: "Hook" }], data: { main: [[{ json: { error: { message: "You have no credits remaining." } } }]] } }],
      },
    },
  },
};
const wfSynth = {
  id: "wf",
  name: "Synthetic",
  nodes: [
    { name: "Hook", type: "n8n-nodes-base.webhook" },
    { name: "Ask", type: "n8n-nodes-base.httpRequest", parameters: { url: "https://api.openai.com/v1/responses" } },
    { name: "Real Model", type: "@n8n/n8n-nodes-langchain.lmChatOpenAi", parameters: { model: { value: "gpt-4o-mini" } } },
    { name: "Proxy Model", type: "@n8n/n8n-nodes-langchain.lmChatOpenAi", parameters: { model: { value: "gpt-4o" } } },
    { name: "Failed Ask", type: "n8n-nodes-base.httpRequest", parameters: { url: "https://api.openai.com/v1/chat/completions" } },
  ],
};
const sc = callsOf(synth, wfSynth);
is("synthetic: the reply counted once, the real-usage model once, the proxy never", sc.map((c) => c.node).sort(), ["Ask", "Real Model"]);
const ask = sc.find((c) => c.node === "Ask");
is("responses usage read, searches counted", [ask.inputTokens, ask.cachedTokens, ask.outputTokens, ask.reasoningTokens, ask.webSearchCalls, ask.webSearch], [40000, 10000, 2000, 500, 2, true]);
near("responses cost: uncached + cached + output + two searches", ask.costUsd, (30000 * 2.5 + 10000 * 0.25 + 2000 * 15) / 1e6 + 0.02);
is("a scene webhook's calls carry the scene", ask.sceneId, "recR8blM6RLZ07vB6");
const real = sc.find((c) => c.node === "Real Model");
is("real usage on a model node is measured", [real.measured, real.inputTokens, real.outputTokens, real.step], [true, 100, 20, "Agent"]);
is("no run data, no calls", callsOf({ id: 1, workflowId: "x", data: null }, wfSynth), []);

// ---- what asked, as the producer reads it ----
is("research", familyOf("Research Tema"), "research");
is("Deep Search, both passes", [familyOf("FC Judge"), familyOf("DS Source"), familyOf("FC Fill Check")], ["deepsearch", "deepsearch", "deepsearch"]);
is("writing", ["Generate Story Bible", "Write Full Narration", "Edit Full Narration", "Segment Chapter Into Scenes", "Generate Hook", "Cine Shot List"].map((x) => familyOf(x)), Array(6).fill("script"));
is("rewrites", [familyOf("Rewrite Scene Text"), familyOf("Rewrite Scene Standalone"), familyOf("HR Beats")], ["rewrites", "rewrites", "rewrites"]);
is("the Hook Regen workflow is a rewrite whatever its node", familyOf("Beats Model", "Hook Regen"), "rewrites");
is("clip checks", [familyOf("Motion Judge"), familyOf("RG Motion Judge"), familyOf("Consistency Judge"), familyOf("VP Rewrite AI")], ["clips", "clips", "clips", "clips"]);
is("the rest", [familyOf("Plan Model", "Graphic Plan"), familyOf("Titles", "YT Scene Titles")], ["other", "other"]);
is("a known step reads as the producer knows it", stepLabel("FC Source"), "Deep Search: web lookup");
is("an unknown step in a small workflow names its workflow", stepLabel("Titles", "YT Scene Titles"), "YT Scene Titles: Titles");

// ---- the page's numbers ----
const groups = [
  { day: 0, step: "Segment Chapter Into Scenes", workflowName: "Claude Scripting", model: "gpt-5.4", projectId: "recA", projectName: "A", webSearch: false, measured: false, calls: 2, inputTokens: 100, outputTokens: 50, costUsd: 3 },
  { day: 0, step: "FC Judge", workflowName: "Claude Scripting", model: "gpt-5.4", projectId: "recA", projectName: "A", webSearch: false, measured: false, calls: 1, inputTokens: 10, outputTokens: 5, costUsd: 5 },
  { day: 86400000, step: "Research Tema", workflowName: "Claude Scripting", model: "gpt-5.4", projectId: "recB", projectName: "B", webSearch: true, measured: false, calls: 1, inputTokens: 10, outputTokens: 5, costUsd: 1 },
  { day: 86400000, step: "Motion Judge", workflowName: "3. Media Generation (Batch)", model: "gpt-4o-2024-08-06", projectId: null, projectName: null, webSearch: false, measured: true, calls: 4, inputTokens: 40, outputTokens: 4, costUsd: 0.5 },
];
const sum = summarize(groups);
near("total", sum.costUsd, 9.5);
is("calls, measured, searching", [sum.calls, sum.measuredCalls, sum.webSearchCalls], [8, 4, 1]);
is("families in the order a film is made", sum.families.map((f) => [f.id, f.value]), [["research", 1], ["script", 3], ["deepsearch", 5], ["clips", 0.5]]);
is("models by spend, dates dropped", sum.models.map((m) => m.id), ["gpt-5.4", "gpt-4o"]);
is("steps most expensive first", sum.steps.map((x) => x.step), ["FC Judge", "Segment Chapter Into Scenes", "Research Tema", "Motion Judge"]);
is("a step remembers it searched", sum.steps.find((x) => x.step === "Research Tema").webSearch, true);
is("per day", sum.days, [{ t: 0, v: 8 }, { t: 86400000, v: 1.5 }]);
is("per film, calls with no film left out", sum.byFilm.map((f) => [f.id, f.costUsd]), [["recA", 8], ["recB", 1]]);
is("nothing unpriced", sum.unpriced, []);
const seven = Array.from({ length: 8 }, (_, i) => ({ id: `m${i}`, label: `m${i}`, value: 8 - i, calls: 1 }));
const capped = capSlices(seven, 6);
is("eight slices fold to six, the smallest into Other", capped.map((x) => x.id), ["m0", "m1", "m2", "m3", "m4", "other-slices"]);
is("Other carries what it folded", [capped[5].value, capped[5].calls, capped[5].label], [3 + 2 + 1, 3, "Other (3)"]);
is("six or fewer stay as they are", capSlices(seven.slice(0, 6), 6).length, 6);

// ---- the joints ----
const root = join(here, "..");
const read = (p) => readFileSync(join(root, p), "utf8");
const page = read("app/admin/insights/usage/page.tsx");
const titles = [...page.matchAll(/panelTitle\}>([^<{]+)</g)].map((m) => m[1].trim());
const tableTitles = [...page.matchAll(/<FilmTable\s+title="([^"]+)"/g)].map((m) => m[1]);
is("the page has its charts and tables titled (at least nine)", titles.length + tableTitles.length >= 9, true);
is(
  "every chart and table on the usage page is titled Service — what",
  [...titles, ...tableTitles].every((t) => /^(OpenAI|Google Flow|ElevenLabs|Captcha|CapSolver) — /.test(t)),
  true,
);
is("the OpenAI pies are there", ["OpenAI — dollars by pipeline step (estimate)", "OpenAI — dollars by model (estimate)"].every((t) => titles.includes(t)), true);
is("the page says what the estimate leaves out", /Not in these figures/.test(page) && /web search/.test(page), true);
is("the ledger door is behind the key", /\/api\/insights\/openai/.test(read("middleware.ts")) && /x-hov-key/.test(read("app/api/insights/openai/route.ts")), true);
is("the restart door takes several films", /projectIds/.test(read("app/api/ops/restart/route.ts")) && /export async function restartProductions/.test(read("app/actions.ts")), true);
is("fireResume stays private (a server action without its checks would be a door)", /\nexport async function fireResume/.test(read("app/actions.ts")), false);
const css = read("app/globals.css");
is("six series tokens, each light-dark", [1, 2, 3, 4, 5, 6].every((i) => new RegExp(`--series-${i}: light-dark\\(`).test(css)), true);

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
if (failed) process.exit(1);
