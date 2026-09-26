// The OpenAI ledger and the several-films restart, driven end to end against
// the site's PRODUCTION build on a real Postgres engine
// (db/port/lib/local-pg.mjs, `next start` on DATA_BACKEND=postgres), with
// this script answering on 3299 as a stand-in n8n: its public API serves the
// two REAL executions in ../fixtures (and one still running, which must be
// left alone), its stop endpoint and resume webhook record what the site asks.
// Destructive to the LOCAL engine only.
//
//   node db/port/openai-usage/browser/drive.mjs
//
// Start the site with SITE_PASSWORD=local-test, MEDIA_INGEST_KEY=local-key,
// N8N_API_URL=http://127.0.0.1:3299/api/v1, N8N_API_KEY=stand-in and
// N8N_NEW_PROJECT_WEBHOOK_URL=http://127.0.0.1:3299/webhook/new-project.
const { chromium } = await import(new URL("../../../../platform/node_modules/playwright-core/index.mjs", import.meta.url).href);
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE || "http://127.0.0.1:3211";
const SHOTS = process.env.SHOTS || "/tmp/openai-usage-shots";
const PASSWORD = process.env.SITE_PASSWORD || "local-test";
const KEY = process.env.MEDIA_INGEST_KEY || "local-key";
const results = [];
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  results.push(ok);
  console.log(`${ok ? "OK  " : "FAIL"} ${name} -> ${JSON.stringify(got)}${ok ? "" : ` (want ${JSON.stringify(want)})`}`);
};
const psql = (args, input) =>
  execFileSync("psql", ["-h", "127.0.0.1", "-p", process.env.LOCAL_PG_PORT || "55432", "-U", "postgres", "-d", "postgres", "-X", "-q", "-v", "ON_ERROR_STOP=1", ...args], {
    env: { ...process.env, PGPASSWORD: "postgres" },
    input,
  }).toString().trim();
const sql = (q) => psql(["-t", "-A", "-c", q]);
const run = (text) => psql(["-f", "-"], text);
execFileSync("mkdir", ["-p", SHOTS]);

// ---- the stand-in n8n ----
const fx = (f) => JSON.parse(readFileSync(join(here, "..", "fixtures", f), "utf8"));
const executions = { "17677": fx("scripting-17677.json"), "17679": fx("graphic-plan-17679.json") };
const workflows = [
  fx("workflow-claude-scripting.json"),
  fx("workflow-graphic-plan.json"),
  { id: "wmGLHkNssLAyZHKX", name: "Video Factory Notifications", nodes: [{ name: "Every 5 min", type: "n8n-nodes-base.scheduleTrigger" }] },
];
const lists = {
  gkEtGMecv4TC3ZHp: [
    // Still going: counted when it ends, never before.
    { id: 17700, workflowId: "gkEtGMecv4TC3ZHp", status: "running", mode: "webhook", startedAt: new Date().toISOString(), stoppedAt: null },
    { id: 17677, workflowId: "gkEtGMecv4TC3ZHp", status: "success", mode: "integrated", startedAt: executions["17677"].startedAt, stoppedAt: executions["17677"].stoppedAt },
  ],
  "5oSW8UaZeOHVUOSx": [
    { id: 17679, workflowId: "5oSW8UaZeOHVUOSx", status: "success", mode: "webhook", startedAt: executions["17679"].startedAt, stoppedAt: executions["17679"].stoppedAt },
  ],
};
const MG = "yHG4DBCDjR3RJzav";
const ORCH = "8CienBFfG6SgbB1A";
let running = [
  { id: 9101, workflowId: MG, status: "running", mode: "integrated", startedAt: new Date().toISOString() },
  { id: 9102, workflowId: ORCH, status: "running", mode: "webhook", startedAt: new Date().toISOString() },
  { id: 9103, workflowId: MG, status: "running", mode: "integrated", startedAt: new Date().toISOString() },
  { id: 9104, workflowId: ORCH, status: "running", mode: "webhook", startedAt: new Date().toISOString() },
];
const seen = { keys: new Set(), dataFetched: [], stops: [], resumes: [] };
let nextId = 9200;
const n8n = createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  const send = (code, body) => {
    res.writeHead(code, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    if (url.pathname.startsWith("/api/v1/")) seen.keys.add(req.headers["x-n8n-api-key"]);
    if (req.method === "GET" && url.pathname === "/api/v1/workflows") return send(200, { data: workflows, nextCursor: null });
    if (req.method === "GET" && url.pathname === "/api/v1/executions") {
      const status = url.searchParams.get("status");
      if (status === "running") return send(200, { data: running });
      if (status) return send(200, { data: [] });
      return send(200, { data: lists[url.searchParams.get("workflowId")] ?? [], nextCursor: null });
    }
    const one = url.pathname.match(/^\/api\/v1\/executions\/(\d+)$/);
    if (req.method === "GET" && one) {
      seen.dataFetched.push(one[1]);
      return executions[one[1]] ? send(200, executions[one[1]]) : send(404, { message: "not found" });
    }
    const stop = url.pathname.match(/^\/api\/v1\/executions\/(\d+)\/stop$/);
    if (req.method === "POST" && stop) {
      seen.stops.push(Number(stop[1]));
      running = running.filter((e) => e.id !== Number(stop[1]));
      return send(200, { id: stop[1], status: "canceled" });
    }
    if (req.method === "POST" && url.pathname === "/webhook/resume-project") {
      const b = JSON.parse(body || "{}");
      seen.resumes.push(b.project_id);
      // The resumed film is alive at once, as in n8n: a check made now would see it.
      running.push({ id: nextId++, workflowId: ORCH, status: "running", mode: "webhook", startedAt: new Date().toISOString() });
      return send(200, { message: "Workflow was started" });
    }
    send(404, { message: `stand-in has no ${req.method} ${url.pathname}` });
  });
});
await new Promise((r) => n8n.listen(3299, "127.0.0.1", r));

// ---- seed: the two films, and an OpenAI top-up two days ago ----
run(`
insert into hov.project (id, name) values
  ('recFwxgbWLGBwb6Tr', 'Cities that never woke up'),
  ('recXmYh1Agny881om', 'Anime style football match between romania and hungary')
on conflict (id) do nothing;
delete from hov.openai_call;
delete from hov.openai_scan;
delete from hov.api_balance where provider = 'openai';
insert into hov.api_balance (taken_at, provider, account, metric, value, unit, status, note, source)
select now() - make_interval(hours => h), 'openai', '', 'access', case when h < 50 then 1 else 0 end, 'bool',
       case when h < 50 then 'ok' else 'out' end,
       case when h < 50 then null else 'You have no credits remaining.' end, 'schedule'
  from generate_series(0, 60) h;
`);

// ---- the ledger door ----
const post = (path, body, headers = {}) =>
  fetch(`${BASE}${path}`, { method: "POST", redirect: "manual", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
const noKey = await post("/api/insights/openai", {});
check("without the key the door stays shut (sent to /login)", [noKey.status, (noKey.headers.get("location") || "").includes("/login")], [307, true]);
const wrongKey = await post("/api/insights/openai", {}, { "x-hov-key": "nope" });
check("a wrong key is not the key", wrongKey.status, 307);
const first = await post("/api/insights/openai", { budgetMs: 60000 }, { "x-hov-key": KEY });
const r1 = await first.json();
check("with the key: read the two finished runs, left the running one", [first.status, r1.ok, r1.read, r1.done], [200, true, 2, true]);
check("…found every call in them (7 scripting + 1 graphic plan)", r1.calls, 8);
check("…fetched only the finished runs' data", seen.dataFetched.sort(), ["17677", "17679"]);
check("…with the site's n8n API key", [...seen.keys], ["stand-in"]);
check("ledger rows", sql("select count(*) from hov.openai_call"), "8");
check("every call on the film", sql("select string_agg(distinct project_id, ',') from hov.openai_call"), "recFwxgbWLGBwb6Tr");
check("scan notes: two runs read, the running one not yet", sql("select string_agg(execution_id::text || ':' || calls, ',' order by execution_id) from hov.openai_scan"), "17677:7,17679:1");
check("the measured one is Graphic Plan's", sql("select string_agg(step, ',') from hov.openai_call where measured"), "Plan Model");
check(
  "steps as the agents that asked",
  sql("select string_agg(step || '=' || n, ',' order by step) from (select step, count(*) n from hov.openai_call group by step) t"),
  "Edit Full Narration=3,Generate Story Bible=1,Plan Model=1,Research Tema=1,Segment Chapter Into Scenes=2",
);
const total = Number(sql("select sum(cost_usd) from hov.openai_call"));
check("a total was priced", total > 0.1 && total < 1, true);
const again = await (await post("/api/insights/openai", {}, { "x-hov-key": KEY })).json();
check("a second call reads nothing new", [again.read, again.calls, sql("select count(*) from hov.openai_call")], [0, 0, "8"]);

// ---- the page ----
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] }).catch(() => chromium.launch());
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.addCookies([{ name: "vf_auth", value: PASSWORD, url: BASE }]);
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(`${BASE}/admin/insights/usage?days=topup`, { waitUntil: "load" });
check("the top-up range is offered and chosen", await page.locator('nav[aria-label="Period"] a[aria-current="true"]').innerText(), "Since the OpenAI top-up");
const titles = await page.locator('[class*="_panelTitle__"]').allInnerTexts();
check("every panel is titled Service — what", titles.length >= 7 && titles.every((t) => /^(OpenAI|Google Flow|ElevenLabs) — /.test(t)), true);
check("OpenAI comes first", titles[0], "OpenAI — dollars by pipeline step (estimate)");
check(
  "the two OpenAI pies",
  titles.filter((t) => /OpenAI — dollars by (pipeline step|model)/.test(t)).length,
  2,
);
const kpi = await page.locator('div[class*="_kpi__"]').filter({ hasText: "Since the top-up (estimate)" }).innerText();
const fmt = (n) => `$${n.toFixed(n >= 100 ? 0 : 2)}`;
check("the top-up figure is the ledger's total", kpi.includes(fmt(total)), true);
const stepLegend = await page.locator('div[class*="_panel__"]').filter({ hasText: "OpenAI — dollars by pipeline step" }).locator("li").allInnerTexts();
check("pipeline-step legend: research, writing, everything else", stepLegend.map((t) => t.split("\n")[0]), ["Research before writing", "Writing the script", "Everything else"]);
const modelLegend = await page.locator('div[class*="_panel__"]').filter({ hasText: "OpenAI — dollars by model" }).locator("li").allInnerTexts();
check("model legend: one model, dates dropped", modelLegend.map((t) => t.split("\n")[0]), ["gpt-5.4"]);
// One slice is a whole ring, and it must be SEEN: the slice gap in the
// stylesheet once painted it the colour of the card.
const ringStroke = await page.locator('div[class*="_panel__"]').filter({ hasText: "OpenAI — dollars by model" }).locator("svg circle").evaluate((el) => getComputedStyle(el).stroke);
const cardColour = await page.locator('div[class*="_panel__"]').first().evaluate((el) => getComputedStyle(el).backgroundColor);
check("a one-slice ring is drawn in its series colour, not the card's", ringStroke !== cardColour && ringStroke !== "none", true);
check("a fraction of a cent reads <$0.01", (await page.locator("text=<$0.01").count()) > 0, true);
// Keyboard: Tab onto the first slice, and the ring's middle answers for it.
const firstSlice = page.locator('div[class*="_panel__"]').filter({ hasText: "OpenAI — dollars by pipeline step" }).locator("svg path").first();
await firstSlice.focus();
check("focus a slice: the middle names it", (await page.locator('[class*="_donutMid__"]').first().innerText()).includes("Research before writing"), true);
// Hover where a person would: on the ring itself, halfway along the slice
// (the middle of an arc's bounding box is the hole, not the slice).
const stepPanel = page.locator('div[class*="_panel__"]').filter({ hasText: "OpenAI — dollars by pipeline step" });
await stepPanel.scrollIntoViewIfNeeded();
const onRing = await stepPanel.locator("svg path").nth(1).evaluate((el) => {
  const pt = el.getPointAtLength(el.getTotalLength() / 4);
  const m = el.getScreenCTM();
  return { x: m.a * pt.x + m.c * pt.y + m.e, y: m.b * pt.x + m.d * pt.y + m.f };
});
await page.mouse.move(onRing.x, onRing.y);
check("hover a slice: the middle follows", (await page.locator('[class*="_donutMid__"]').first().innerText()).includes("Writing the script"), true);
check("the pie has its table", await page.locator('div[class*="_panel__"]').filter({ hasText: "OpenAI — dollars by pipeline step" }).locator("details summary").innerText(), "Show as a table");
const steps = await page.locator("table").filter({ hasText: "Tokens in / out" }).locator("tbody tr").allInnerTexts();
check("every step listed", steps.length, 5);
check("web-search steps are marked", steps.filter((t) => t.includes("web search")).length, 2);
check("the film table names the film", await page.locator('div[class*="_panel__"]').filter({ hasText: "OpenAI — dollars per video" }).locator("tbody a").allInnerTexts(), ["Cities that never woke up"]);
check("the page says what is not counted", (await page.locator("text=Not in these figures").count()) > 0, true);
await page.screenshot({ path: `${SHOTS}/usage-openai-1280.png`, fullPage: true });
await page.getByRole("button", { name: "⟳ Update now" }).click();
await page.locator('[role="status"]').waitFor({ timeout: 30000 });
check("Update now answers", await page.locator('[role="status"]').innerText(), "Up to date.");
check("no errors in the page", errors, []);

// Narrow and dark.
await ctx.addCookies([{ name: "hov-theme", value: "dark", url: BASE }]);
const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await phone.addCookies([
  { name: "vf_auth", value: PASSWORD, url: BASE },
  { name: "hov-theme", value: "dark", url: BASE },
]);
const p2 = await phone.newPage();
await p2.goto(`${BASE}/admin/insights/usage?days=topup`, { waitUntil: "load" });
check("390px: no sideways scroll", await p2.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
await p2.screenshot({ path: `${SHOTS}/usage-openai-390-dark.png`, fullPage: true });
await p2.close();
await page.goto(`${BASE}/admin/insights/usage?days=topup`, { waitUntil: "load" });
await page.screenshot({ path: `${SHOTS}/usage-openai-1280-dark.png`, fullPage: false });
await browser.close();

// ---- the several-films restart ----
const both = await post("/api/ops/restart", { projectIds: ["recFwxgbWLGBwb6Tr", "recXmYh1Agny881om"] }, { "x-hov-key": KEY });
const rb = await both.json();
check("restart two films: answered ok", [both.status, rb.ok], [200, true]);
check("…every production run stopped once", seen.stops.sort(), [9101, 9102, 9103, 9104]);
check("…both films resumed, in order, though the first was alive by then", seen.resumes, ["recFwxgbWLGBwb6Tr", "recXmYh1Agny881om"]);
check("…and each says so", rb.results.map((x) => [x.projectId, x.ok]), [["recFwxgbWLGBwb6Tr", true], ["recXmYh1Agny881om", true]]);
const bad = await post("/api/ops/restart", { projectIds: ["recFwxgbWLGBwb6Tr", "nope"] }, { "x-hov-key": KEY });
check("a list with a non-id is refused whole", bad.status, 400);

n8n.close();
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed — screenshots in ${SHOTS}`);
process.exit(failed ? 1 : 0);
