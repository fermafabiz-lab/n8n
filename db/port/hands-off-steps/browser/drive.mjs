// Hands-off by step, driven in real Chromium against the site's PRODUCTION
// build on a real Postgres engine (db/port/lib/local-pg.mjs, `next start` on
// DATA_BACKEND=postgres). Destructive to the LOCAL engine only.
//
//   node db/port/hands-off-steps/browser/drive.mjs
//
// Start the site with SITE_PASSWORD=local-test and
// N8N_NEW_PROJECT_WEBHOOK_URL=http://127.0.0.1:3299/webhook/new-project —
// this script answers on 3299 as a stand-in n8n that records what the brief
// posts, so the choice is checked on the wire, not just on the screen.
const { chromium } = await import(new URL("../../../../platform/node_modules/playwright-core/index.mjs", import.meta.url).href);
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";

const BASE = process.env.BASE || "http://127.0.0.1:3211";
const SHOTS = process.env.SHOTS || "/tmp/hands-off-shots";
const PASSWORD = process.env.SITE_PASSWORD || "local-test";
const results = [];
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  results.push(ok);
  console.log(`${ok ? "OK  " : "FAIL"} ${name} -> ${JSON.stringify(got)}${ok ? "" : ` (want ${JSON.stringify(want)})`}`);
};
const sql = (q) =>
  execFileSync("psql", ["-h", "127.0.0.1", "-p", process.env.LOCAL_PG_PORT || "55432", "-U", "postgres", "-d", "postgres", "-X", "-q", "-t", "-A", "-c", q], {
    env: { ...process.env, PGPASSWORD: "postgres" },
  }).toString().trim();
execFileSync("mkdir", ["-p", SHOTS]);
const until = async (label, fn, ms = 30000) => {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) return v;
    await new Promise((r) => setTimeout(r, 500));
  }
};

// ---- the stand-in n8n: records the brief's body --------------------------
let posted = null;
const mock = createServer((req, res) => {
  let data = "";
  req.on("data", (c) => (data += c));
  req.on("end", () => {
    try { posted = JSON.parse(data); } catch { posted = { unparsed: data }; }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ project_id: "recMOCKMOCKMOCK01" }));
  });
});
await new Promise((r) => mock.listen(3299, "127.0.0.1", r));

// ---- a film waiting at the image AND voice gates ---------------------------
const P = sql("select id from hov.project order by created_at limit 1");
sql(`update hov.project set status = 'În Lucru', editing_options = (editing_options - 'autoApprove' - 'autoApproveSteps') || '{"category":"story"}'::jsonb where id = '${P}'`);
sql(`delete from hov.scene where project_id = '${P}'`);
for (const n of [101, 102, 103]) {
  const sid = sql(`insert into hov.scene (project_id, scene_order, narration, scene_approved, voiceover_url, voice_approved, image_approved)
    values ('${P}', ${n}, 'Line ${n}.', true, 'https://example.com/v${n}.mp3', false, false) returning id`);
  sql(`insert into hov.attachment (scene_id, field, path) values ('${sid}', 'image', '${P}/image/test-${n}.png')`);
}
const approved = (kind) => Number(sql(`select count(*) from hov.scene where project_id = '${P}' and ${kind}_approved`));
const steps = () => sql(`select coalesce(editing_options->'autoApproveSteps', 'null'::jsonb)::text from hov.project where id = '${P}'`);

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.addCookies([{ name: "vf_auth", value: PASSWORD, url: BASE }]);
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("PAGE ERROR:", e.message));

// ---- "Auto-accept this step" on the Images step ----------------------------
await page.goto(`${BASE}/projects/${P}?stage=images`, { waitUntil: "networkidle" });
const bar = page.locator(".autostep");
check("the Images step offers to accept itself", await bar.getByRole("button", { name: "⚡ Auto-accept this step" }).count(), 1);
check("no hands-off banner yet", await page.locator(".autopilot").count(), 0);
await page.screenshot({ path: `${SHOTS}/1-images-offer.png`, clip: { x: 0, y: 0, width: 1280, height: 900 } });
await bar.getByRole("button", { name: "⚡ Auto-accept this step" }).click();
check("the film's list becomes exactly Images", await until("steps", () => steps() === '["images"]' && steps()), '["images"]');
check("…and the switch follows it", sql(`select editing_options->>'autoApprove' from hov.project where id = '${P}'`), "true");
await page.waitForSelector(".autopilot", { timeout: 15000 });
check("the banner appears and names the step", (await page.locator(".autopilot .ap-text b").first().innerText()).trim(), "Hands-off for Images");
check("the step now says it accepts itself, with Stop", [await bar.locator(".as-on").count(), await bar.getByRole("button", { name: "Stop" }).count()], [1, 1]);
check("AutoPilot signs off every waiting image by itself", await until("images", () => approved("image") === 3 && 3, 30000), 3);
check("…and NOT the takes, which were not chosen", approved("voice"), 0);
await page.screenshot({ path: `${SHOTS}/2-images-auto.png`, clip: { x: 0, y: 0, width: 1280, height: 900 } });

// ---- the live page: the takes are still the producer's ---------------------
await page.goto(`${BASE}/projects/${P}`, { waitUntil: "networkidle" });
check("the live page offers the step still waiting (Audio)", await page.locator(".autostep .as-btn").count() >= 1, true);
check("…by name when it is not alone, or as 'this step'", /Auto-accept (Audio|this step)/.test(await page.locator(".autostep .as-btn").first().innerText()), true);

// ---- Stop ------------------------------------------------------------------
await page.goto(`${BASE}/projects/${P}?stage=images`, { waitUntil: "networkidle" });
await page.locator(".autostep").getByRole("button", { name: "Stop" }).click();
check("Stop takes the step back out", await until("stop", () => steps() === "[]" && steps()), "[]");
await page.waitForTimeout(1500);
check("…and the banner goes with the last step", await page.locator(".autopilot").count(), 0);

// ---- an old film: the switch alone means every step ------------------------
sql(`update hov.project set editing_options = (editing_options - 'autoApproveSteps') || '{"autoApprove": true}'::jsonb where id = '${P}'`);
sql(`update hov.scene set voice_approved = false where project_id = '${P}'`);
await page.goto(`${BASE}/projects/${P}`, { waitUntil: "networkidle" });
check("an old hands-off film reads as every step (the full banner)", (await page.locator(".autopilot .ap-text b").first().innerText()).trim(), "Hands-off mode");
check("…and its takes are signed off too", await until("voices", () => approved("voice") === 3 && 3, 30000), 3);
await page.locator(".autopilot").getByRole("button", { name: "Turn off" }).click();
check("Turn off clears every step", await until("off", () => steps() === "[]" && steps()), "[]");

// ---- the brief ---------------------------------------------------------------
await page.goto(`${BASE}/new`, { waitUntil: "networkidle" });
const section = page.locator("section.fsec", { hasText: "Hands-off" });
check("hands-off starts off, with nothing to choose", await section.locator(".chiprow").count(), 0);
await section.getByRole("switch").or(section.locator('[role="switch"], input[type="checkbox"]')).first().click();
const chips = async () => section.locator(".chiprow button").evaluateAll((els) => els.map((e) => `${e.textContent.trim()}${e.getAttribute("aria-pressed") === "true" ? "*" : ""}`));
check("switching it on picks every step (All lit)", await chips(), ["All*", "Script*", "Scenes*", "Audio*", "Images*", "Video*", "Final render*"]);
const hidden = () => page.locator('input[name="auto_approve_steps"]').inputValue();
check("…and posts all six", await hidden(), "script,scenes,audio,images,video,final");
for (const name of ["Script", "Scenes", "Audio", "Final render"]) await section.locator(".chiprow button", { hasText: new RegExp(`^${name}$`) }).click();
check("unticking leaves exactly Images and Video", await hidden(), "images,video");
check("All is no longer lit", (await chips())[0], "All");
check("the description names them", /Images and Video sign off by themselves/.test(await section.innerText()), true);
await page.waitForTimeout(400); // let the chips finish their transition
await page.screenshot({ path: `${SHOTS}/3-brief-chips.png`, fullPage: false, clip: await section.boundingBox().then((b) => ({ x: 0, y: Math.max(0, b.y - 20), width: 1280, height: Math.min(b.height + 40, 900) })) });

// Submit, and read what the stand-in n8n received.
await page.fill("#name", "Hands-off chips test");
await page.locator("#created_by_group button", { hasText: "Dan" }).click();
await page.locator("button.go").click();
await until("posted", () => posted, 20000);
check("the webhook body carries the steps", posted?.auto_approve_steps, "images,video");
check("…and the switch for an n8n that has not learned the list", posted?.auto_approve, "yes");

// Untick the last two: the switch goes off with them.
await page.goto(`${BASE}/new`, { waitUntil: "networkidle" });
const section2 = page.locator("section.fsec", { hasText: "Hands-off" });
await section2.getByRole("switch").or(section2.locator('[role="switch"], input[type="checkbox"]')).first().click();
await section2.locator(".chiprow button", { hasText: /^All$/ }).click();
check("All on a full list clears it, and the switch goes off", [await section2.locator(".chiprow").count(), await page.locator('input[name="auto_approve_steps"]').inputValue()], [0, ""]);

// ---- a phone, both themes -----------------------------------------------------
for (const theme of ["light", "dark"]) {
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await phone.addCookies([{ name: "vf_auth", value: PASSWORD, url: BASE }, { name: "hov-theme", value: theme, url: BASE }]);
  const p = await phone.newPage();
  sql(`update hov.scene set image_approved = false where project_id = '${P}'`);
  await p.goto(`${BASE}/projects/${P}?stage=images`, { waitUntil: "networkidle" });
  check(`390px ${theme}: the step button is there and nothing runs off the side`, [await p.locator(".autostep .as-btn").count(), await p.evaluate(() => document.scrollingElement.scrollWidth <= 390)], [1, true]);
  await p.locator(".autostep").scrollIntoViewIfNeeded();
  await p.locator(".autostep").screenshot({ path: `${SHOTS}/4-phone-${theme}.png` });
  await phone.close();
}

await browser.close();
mock.close();
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
