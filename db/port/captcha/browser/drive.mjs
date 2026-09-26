// The captcha on Developer insights and Analytics, driven end to end against
// the site's PRODUCTION build on a real Postgres engine
// (db/port/lib/local-pg.mjs), with this script answering on 3298 as a stand-in
// for BOTH services the site asks: CapSolver (POST /getBalance) and useapi
// (GET /v1/google-flow/accounts/captcha-stats?date=), which serves the REAL
// day in ../fixtures for 2026-09-26 and an empty day for every other date.
// On 3299 a stand-in n8n with no workflows, so the tick's ledger step is quick.
// Destructive to the LOCAL engine only.
//
//   node db/port/captcha/browser/drive.mjs
//
// Start the site with SITE_PASSWORD=local-test, MEDIA_INGEST_KEY=local-key,
// CAPSOLVER_API_KEY=local-capsolver-key, CAPSOLVER_BASE_URL=http://127.0.0.1:3298,
// USEAPI_TOKEN=local-useapi-token, USEAPI_BASE_URL=http://127.0.0.1:3298,
// N8N_API_URL=http://127.0.0.1:3299/api/v1 and N8N_API_KEY=stand-in.
const { chromium } = await import(new URL("../../../../platform/node_modules/playwright-core/index.mjs", import.meta.url).href);
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE || "http://127.0.0.1:3211";
const SHOTS = process.env.SHOTS || "/tmp/captcha-shots";
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

// ---- the stand-ins ----
const day = JSON.parse(readFileSync(join(here, "..", "fixtures", "captcha-stats-2026-09-26.json"), "utf8"));
const seen = { clientKeys: [], auth: new Set(), dates: [] };
const services = createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const send = (code, b) => {
      res.writeHead(code, { "Content-Type": "application/json" });
      res.end(JSON.stringify(b));
    };
    if (req.method === "POST" && url.pathname === "/getBalance") {
      const b = JSON.parse(body || "{}");
      seen.clientKeys.push(b.clientKey);
      return b.clientKey === "local-capsolver-key"
        ? send(200, { errorId: 0, balance: 7.4213, packages: [] })
        : send(200, { errorId: 1, errorCode: "ERROR_KEY_DENIED_ACCESS", errorDescription: "Invalid clientKey" });
    }
    if (req.method === "GET" && url.pathname === "/v1/google-flow/accounts/captcha-stats") {
      seen.auth.add(req.headers.authorization);
      const date = url.searchParams.get("date");
      seen.dates.push(date);
      return send(200, date === day.date ? day : { date, total: 0 });
    }
    send(404, { error: `stand-in has no ${req.method} ${url.pathname}` });
  });
});
const n8n = createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ data: [], nextCursor: null }));
});
await new Promise((r) => services.listen(3298, "127.0.0.1", r));
await new Promise((r) => n8n.listen(3299, "127.0.0.1", r));

// ---- seed: a day and a half of CapSolver readings falling from $10 ----
run(`
delete from hov.captcha_day;
delete from hov.api_balance where provider = 'capsolver';
insert into hov.api_balance (taken_at, provider, account, metric, value, unit, status, source)
select now() - make_interval(hours => h), 'capsolver', '', 'balance', 7.6 + h * 0.07, 'usd', 'ok', 'schedule'
  from generate_series(1, 36) h;
`);

// ---- the tick ----
const post = (path, body, headers = {}) =>
  fetch(`${BASE}${path}`, { method: "POST", redirect: "manual", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
check("without the key the tick stays shut", (await post("/api/insights/tick", {})).status, 307);
const t1 = await (await post("/api/insights/tick", { budgetMs: 60000 }, { "x-hov-key": KEY })).json();
check("CapSolver read with the site's key", [t1.capsolver.ok, t1.capsolver.balance], [true, 7.4213]);
check("…and the key went to CapSolver, nowhere else", seen.clientKeys, ["local-capsolver-key"]);
check("a month of captcha days read, today first", [t1.captcha.ok, t1.captcha.read, t1.captcha.done, seen.dates[0]], [true, 31, true, new Date().toISOString().slice(0, 10)]);
check("…with the useapi token", [...seen.auth], ["Bearer local-useapi-token"]);
check("the ledger step ran too", t1.ledger.ok, true);
check("31 day rows", sql("select count(*) from hov.captcha_day"), "31");
check("the real day summed", sql("select attempts || '/' || accepted || '/' || jobs || '/' || complete from hov.captcha_day where day = '2026-09-26'"), "159/37/58/false");
check("past days are complete, never read again", sql("select count(*) from hov.captcha_day where complete"), "30");
check("the balance is a reading", sql("select value || '/' || status || '/' || source from hov.api_balance where provider = 'capsolver' order by taken_at desc limit 1"), "7.4213/ok/schedule");
seen.dates.length = 0;
const t2 = await (await post("/api/insights/tick", {}, { "x-hov-key": KEY })).json();
check("the next tick reads only today", [t2.captcha.read, seen.dates.length], [1, 1]);

// ---- the pages ----
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] }).catch(() => chromium.launch());
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.addCookies([{ name: "vf_auth", value: PASSWORD, url: BASE }]);
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(`${BASE}/admin/insights`, { waitUntil: "load" });
const card = page.locator("section").filter({ has: page.locator("h3", { hasText: "CapSolver" }) });
check("Developer insights has a CapSolver card", await card.count(), 1);
check("…with the balance", (await card.innerText()).includes("$7.42"), true);
check("…and its pace", /About \$\d+\.\d\d a day/.test(await card.innerText()), true);
const button = page.getByRole("link", { name: "Analytics", exact: true });
check("the button is labelled Analytics", [await button.count(), await button.getAttribute("class")], [1, "btn"]);
check("nothing says Where the credits go", await page.locator("text=Where the credits go").count(), 0);
await page.screenshot({ path: `${SHOTS}/insights-1280.png`, fullPage: true });
await button.click();
await page.waitForURL("**/admin/insights/usage");
check("it opens Analytics", (await page.locator("h2").first().innerText()).trim(), "Analytics");
const cap = page.locator("section").filter({ has: page.locator("h3", { hasText: "Captcha — CapSolver" }) });
const kpis = await cap.locator('div[class*="_kpi__"]').allInnerTexts();
check("captcha KPIs: balance, solves, accepted", [kpis[0].includes("$7.42"), kpis[1].includes("159"), kpis[2].includes("23%")], [true, true, true]);
const titles = await cap.locator('[class*="_panelTitle__"]').allInnerTexts();
check("every captcha chart titled", titles, [
  "Captcha — what happened to each solve",
  "Captcha — solves per Google Flow account",
  "Captcha — solves per day",
  "Captcha — share of tokens Google accepted, per day",
  "CapSolver — dollars spent per day (measured)",
  "Captcha — by provider",
  "Captcha — by Google Flow account",
]);
const outcomes = await cap.locator('div[class*="_panel__"]').filter({ hasText: "what happened to each solve" }).locator("li").allInnerTexts();
check("outcomes legend", outcomes.map((t) => t.split("\n")[0]), ["Accepted by Google", "Refused as unusual activity", "Too much traffic"]);
const providers = await cap.locator("table").filter({ hasText: "Provider" }).locator("tbody tr").allInnerTexts();
check("by provider", providers.map((t) => t.split("\t")[0]), ["CapSolver", "2Captcha"]);
const accounts = await cap.locator("table").filter({ hasText: "Account" }).locator("tbody tr").count();
check("by account", accounts, 3);
await cap.locator('div[class*="_panel__"]').filter({ hasText: "what happened to each solve" }).locator("svg path").first().focus();
check("focus a slice: the middle names it", (await cap.locator('[class*="_donutMid__"]').first().innerText()).includes("Accepted by Google"), true);
check("no errors in the pages", errors, []);
await page.screenshot({ path: `${SHOTS}/analytics-1280.png`, fullPage: true });
const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await phone.addCookies([
  { name: "vf_auth", value: PASSWORD, url: BASE },
  { name: "hov-theme", value: "dark", url: BASE },
]);
const p2 = await phone.newPage();
await p2.goto(`${BASE}/admin/insights/usage`, { waitUntil: "load" });
check("390px dark: no sideways scroll", await p2.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
await p2.locator("#u-cap").scrollIntoViewIfNeeded();
await p2.screenshot({ path: `${SHOTS}/analytics-390-dark.png`, fullPage: true });
await browser.close();
services.close();
n8n.close();

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed — screenshots in ${SHOTS}`);
process.exit(failed ? 1 : 0);
