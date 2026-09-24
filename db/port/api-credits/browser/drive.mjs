// Developer insights, driven in real Chromium against the site's PRODUCTION
// build on a real Postgres engine (db/port/lib/local-pg.mjs, `next start` on
// DATA_BACKEND=postgres). Destructive to the LOCAL engine only.
//
//   node db/port/api-credits/browser/drive.mjs
//
// Start the site with SITE_PASSWORD=local-test, MEDIA_INGEST_KEY=local-key and
// N8N_NEW_PROJECT_WEBHOOK_URL=http://127.0.0.1:3299/webhook/new-project — this
// script answers on 3299 as a stand-in n8n: POST /webhook/api-credits records
// the key it was sent and writes a fresh, healthy set of readings, which is
// what the real "API Credits" workflow does.
const { chromium } = await import(new URL("../../../../platform/node_modules/playwright-core/index.mjs", import.meta.url).href);
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE || "http://127.0.0.1:3211";
const SHOTS = process.env.SHOTS || "/tmp/insights-shots";
const PASSWORD = process.env.SITE_PASSWORD || "local-test";
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
const until = async (fn, ms = 20000) => {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v || Date.now() - t0 > ms) return v;
    await new Promise((r) => setTimeout(r, 300));
  }
};

// ---- seed: three days of hourly readings, and three films that spent them ----
// Scene orders follow the pipeline's encoding: 1 is the hook, chapter c's
// scenes are c*100 + n (lib/cost.ts prices anything under 100 as the hook).
const fx = JSON.parse(readFileSync(join(here, "..", "fixtures", "2026-09-24.json"), "utf8"));
const elDaily = fx["ElevenLabs Usage"].body.time.map((t, i) => ({ t, v: fx["ElevenLabs Usage"].body.usage.All[i] }));
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
run(`
delete from hov.api_balance;
insert into hov.api_balance (taken_at, provider, account, metric, value, unit, "limit", resets_at, status, note, detail, source)
select now() - make_interval(hours => h), 'google-flow', a.acct, 'credits', a.start - (72 - h) * a.rate, 'credits', null, null, 'ok', null,
       '{"health":"OK","tier":"PAYGATE_TIER_TWO"}'::jsonb, 'schedule'
  from generate_series(0, 72) h,
       (values ('fermafabiz@gmail.com', 22500, 7.5), ('houseofvideos01@gmail.com', 22300, 4.9), ('houseofvideos02@gmail.com', 1300, 4.2)) a(acct, start, rate);
insert into hov.api_balance (taken_at, provider, account, metric, value, unit, "limit", resets_at, status, detail, source)
select now() - make_interval(hours => h), 'elevenlabs', '', 'characters', 60000 - (72 - h) * 115, 'characters', 131000,
       '2026-09-27T14:58:27Z', 'ok', '{"tier":"creator"}'::jsonb, 'schedule'
  from generate_series(0, 72) h;
insert into hov.api_balance (taken_at, provider, account, metric, value, unit, status, note, source)
select now() - make_interval(hours => h), 'openai', '', 'access', case when h > 20 then 1 else 0 end, 'bool',
       case when h > 20 then 'ok' else 'out' end,
       case when h > 20 then null else 'You have no credits remaining. Add credits to continue using the API.' end, 'schedule'
  from generate_series(0, 72) h;
insert into hov.api_balance (provider, account, metric, value, unit, status, note, detail) values
  ('openai', '', 'spend_30d', null, null, 'unavailable', 'You have insufficient permissions for this operation. Missing scopes: api.usage.read.', '{"httpStatus":403}'),
  ('elevenlabs', '', 'usage_30d', 79280, 'characters', 'ok', null, ${q(JSON.stringify({ daily: elDaily }))}::jsonb),
  ('useapi', 'fermafabiz@gmail.com', 'subscription', 1, 'bool', 'ok', null, '{"accountsActive":3,"accountsTotal":3}'),
  ('google-drive', 'fermafabiz@gmail.com', 'storage', 32974984083226, 'bytes', 'ok', null, '{"usage":10364750054}');
update hov.api_balance set "limit" = 32985348833280 where provider = 'google-drive';
`);
const films = sql("select id from hov.project order by created_at, id limit 3").split("\n");
run(`
delete from hov.attachment where scene_id in (select id from hov.scene where project_id in (${films.map(q).join(",")}));
delete from hov.scene where project_id in (${films.map(q).join(",")});
delete from hov.script where project_id in (${films.map(q).join(",")});
update hov.project set editing_options = editing_options || '{"videoModel":"veo-3.1-fast"}'::jsonb where id = ${q(films[0])};
insert into hov.scene (project_id, scene_order, narration, scene_final_url, voiceover_url, media_versions)
select p.id, case when n = 1 then 1 else 100 + n end, repeat('word ', 30 + n % 7), 'https://example.com/v' || n || '.mp4', 'https://example.com/a' || n || '.mp3',
       case when n % 3 = 0 then '[{"kind":"video","url":"https://example.com/old.mp4"}]'::jsonb else '[]'::jsonb end
  from (values (${q(films[0])}, 1), (${q(films[1])}, 2), (${q(films[2])}, 3)) p(id, k),
       generate_series(1, 4 + p.k * 2) n;
insert into hov.attachment (scene_id, field, path)
select s.id, 'image', s.project_id || '/image/' || s.scene_order || '.png' from hov.scene s where s.project_id in (${films.map(q).join(",")});
insert into hov.script (project_id, content) values (${q(films[0])}, 'one'), (${q(films[1])}, 'two');
`);

// ---- the stand-in n8n --------------------------------------------------------
let asked = null;
const mock = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    if (req.url === "/webhook/api-credits") {
      asked = { method: req.method, key: req.headers["x-hov-key"] ?? null };
      run(`
insert into hov.api_balance (provider, account, metric, value, unit, status, source) values ('openai', '', 'access', 1, 'bool', 'ok', 'webhook');
insert into hov.api_balance (provider, account, metric, value, unit, status, detail, source) values
  ('google-flow', 'houseofvideos02@gmail.com', 'credits', 22000, 'credits', 'ok', '{"health":"OK"}', 'webhook');
`);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, saved: true, saveError: null, readings: [] }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
});
await new Promise((r) => mock.listen(3299, "127.0.0.1", r));

// The strip, and only the strip: Next.js's route announcer is role="alert" too.
const STRIP = '[role="alert"]:has-text("Developer insights")';

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.addCookies([{ name: "vf_auth", value: PASSWORD, url: BASE }]);
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("PAGE ERROR:", e.message));

// ---- Settings: the card, red ---------------------------------------------------
await page.goto(`${BASE}/admin`, { waitUntil: "networkidle" });
const card = page.locator("a.scard", { hasText: "Developer insights" });
check("Settings has a Developer insights card", await card.count(), 1);
check("…with the red dot and what is wrong", [await card.locator(".sdot").count(), (await card.locator(".snote").innerText()).trim()], [1, "2 paid services are out or nearly out."]);

// ---- the strip, on another page -------------------------------------------------
await page.goto(`${BASE}/projects`, { waitUntil: "networkidle" });
const strip = page.locator(STRIP, { hasText: "OpenAI is out of credits" });
await strip.waitFor({ timeout: 15000 });
check("every page carries the strip, worst first", (await strip.innerText()).includes("OpenAI is out of credits — new films cannot be written. (+1 more)"), true);
check("…with where to fix it and the page that explains", [await strip.getByRole("link", { name: "Fix it ↗" }).getAttribute("href"), await strip.getByRole("link", { name: "Developer insights" }).getAttribute("href")], ["https://platform.openai.com/settings/organization/billing/overview", "/admin/insights"]);
await page.screenshot({ path: `${SHOTS}/1-strip.png`, clip: { x: 0, y: 0, width: 1280, height: 220 } });

const anon = await browser.newContext();
const anonPage = await anon.newPage();
// "load", not "networkidle": signed out, the nav's prefetches bounce off the
// password gate to /login again and again, so the network never goes quiet.
await anonPage.goto(`${BASE}/login`, { waitUntil: "load" });
await anonPage.waitForTimeout(2500);
check("the login page never shows a balance", await anonPage.locator(STRIP).count(), 0);
await anon.close();

// ---- the page ------------------------------------------------------------------
await page.goto(`${BASE}/admin/insights`, { waitUntil: "networkidle" });
const cardOf = (name) => page.locator("section", { has: page.locator("h3", { hasText: new RegExp(`^${name}$`) }) });
check("the alert panel lists both", await page.locator('section[aria-label="Needs attention now"] li').count(), 2);
check("OpenAI: Out, in words", [(await cardOf("OpenAI").locator("[class*=lv_]").first().innerText()).replace(/\s+/g, ""), await cardOf("OpenAI").getByText("Out of credits").count()], ["✕Out", 1]);
check("…and the way to never see it again", await cardOf("OpenAI").getByText("auto recharge").count(), 1);
check("…and why spend is not shown", await cardOf("OpenAI").getByText("OpenAI will not say what it spent to this key").count(), 1);
const flowRows = cardOf("Google Flow").locator("li");
check("Google Flow: one row per account", await flowRows.count(), 3);
check("…the nearly-empty one says so", (await flowRows.filter({ hasText: "houseofvideos02" }).innerText()).includes("Nearly out"), true);
check("…the healthy ones carry no pill", await flowRows.filter({ hasText: "houseofvideos01" }).locator("[class*=lv_]").count(), 0);
const el = await cardOf("ElevenLabs").innerText();
check("ElevenLabs: what is left, of what, and when it refills", [el.includes("51,720"), el.includes("characters left of 131,000 this month"), el.includes("Refills on 27 Sept") || el.includes("Refills on 27 Sep")], [true, true, true]);
check("…at what pace (ElevenLabs' own daily count)", /About [\d,]+ a day/.test(el), true);
check("useapi: active, with its accounts", [(await cardOf("useapi.net").innerText()).includes("Active"), (await cardOf("useapi.net").innerText()).includes("3 of 3 Google Flow accounts connected.")], [true, true]);
check("Drive: free space", (await cardOf("Google Drive").innerText()).includes("30 TB free"), true);
check("when it was last checked", /Last checked .* · (just now|\d+ min ago)/.test(await page.locator(`text=Last checked`).first().innerText()), true);
check("the ElevenLabs meter says how much is left", await cardOf("ElevenLabs").locator('[role="meter"]').getAttribute("aria-valuenow"), "39");
await page.screenshot({ path: `${SHOTS}/2-insights.png`, fullPage: true });

// ---- Check now ---------------------------------------------------------------------
await page.getByRole("button", { name: "⟳ Check now" }).click();
check("Check now reaches n8n with the shared key", await until(() => asked), { method: "POST", key: "local-key" });
await page.getByText("Checked just now.").waitFor({ timeout: 20000 });
await until(async () => (await cardOf("OpenAI").getByText("Credits available").count()) === 1);
check("…and the page shows what n8n just wrote", await cardOf("OpenAI").getByText("Credits available").count(), 1);
check("…and the strip goes, without waiting five minutes", await until(async () => (await page.locator(STRIP).count()) === 0), true);

// ---- a dead check is not a quiet one -------------------------------------------------
sql("update hov.api_balance set taken_at = taken_at - interval '5 hours'");
await page.goto(`${BASE}/admin/insights`, { waitUntil: "networkidle" });
check("five hours without a reading says the check has stopped", await page.getByText("the hourly check has stopped reporting").count(), 1);
sql("update hov.api_balance set taken_at = taken_at + interval '5 hours'");

// ---- where it goes --------------------------------------------------------------------
await page.goto(`${BASE}/admin/insights/usage`, { waitUntil: "networkidle" });
const flow = page.locator("section", { has: page.locator("#u-flow") });
check("Flow: credits measured from the hourly readings", Number((await flow.locator("[class*=kpiValue]").first().innerText()).replace(/,/g, "")) > 500, true);
check("…per day, as columns", (await flow.locator("[class*=col]").count()) >= 3, true);
await flow.locator("[class*=col]").last().hover();
check("…with a tooltip on hover", /credits/.test(await flow.locator("[class*=tooltip]").innerText()), true);
const flowTable = flow.locator("table[class*=rank]");
check("…and the films that spent them, most first", await flowTable.locator("tbody tr").count(), 3);
check("…the Fast-model film first", await flowTable.locator("tbody tr").first().locator("a").getAttribute("href"), `/projects/${films[0]}`);
const elSec = page.locator("section", { has: page.locator("#u-el") });
check("ElevenLabs: characters per day from its own count", (await elSec.locator("[class*=col]").count()) >= 28, true);
await elSec.locator("[class*=col]").nth(8).focus();
check("…the tooltip answers the keyboard too", /characters/.test(await elSec.locator("[class*=tooltip]").innerText()), true);
check("…and a table for the same numbers", await elSec.locator("details summary", { hasText: "Show as a table" }).count(), 1);
const oai = page.locator("section", { has: page.locator("#u-oai") });
check("OpenAI: says which permission would show spend", await oai.getByText("Usage → Read").count(), 1);
check("…and what it can count: scripts written", (await oai.locator("[class*=kpi]").first().innerText()).includes("Scripts written"), true);
await page.screenshot({ path: `${SHOTS}/3-usage.png`, fullPage: true });
await page.getByRole("link", { name: "7 days" }).click();
await page.waitForURL(/days=7/);
check("the period is one row of links", await page.getByRole("link", { name: "7 days" }).getAttribute("aria-current"), "true");

// ---- × hides the strip until something else changes ---------------------------------------
sql("insert into hov.api_balance (provider, account, metric, value, unit, status, source) values ('openai', '', 'access', 0, 'bool', 'out', 'schedule')");
await page.goto(`${BASE}/projects`, { waitUntil: "networkidle" });
await page.locator(STRIP).waitFor({ timeout: 15000 });
await page.getByRole("button", { name: "Hide until something else changes" }).click();
check("× hides the strip", await page.locator(STRIP).count(), 0);
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(1500);
check("…and it stays hidden for the same alert", await page.locator(STRIP).count(), 0);
sql("insert into hov.api_balance (provider, account, metric, value, unit, status, source) values ('useapi', 'fermafabiz@gmail.com', 'subscription', 0, 'bool', 'out', 'schedule')");
await page.reload({ waitUntil: "networkidle" });
check("…until something else runs out", await until(async () => (await page.locator(STRIP).count()) === 1), true);

// ---- a phone, both themes -------------------------------------------------------------------
for (const theme of ["light", "dark"]) {
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await phone.addCookies([{ name: "vf_auth", value: PASSWORD, url: BASE }, { name: "hov-theme", value: theme, url: BASE }]);
  const p = await phone.newPage();
  for (const path of ["/admin/insights", "/admin/insights/usage"]) {
    await p.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
    check(`390px ${theme} ${path}: nothing runs off the side`, await p.evaluate(() => document.scrollingElement.scrollWidth <= 390), true);
  }
  await p.goto(`${BASE}/admin/insights`, { waitUntil: "networkidle" });
  await p.screenshot({ path: `${SHOTS}/4-phone-${theme}.png`, fullPage: true });
  await phone.close();
}

await browser.close();
mock.close();
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
