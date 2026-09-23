// "Recently worked on", driven in real Chromium against the site on a real
// Postgres engine (db/port/lib/local-pg.mjs with 001..014, `next dev` on
// DATA_BACKEND=postgres). Destructive to the LOCAL engine only.
//
//   node db/port/activity-order/browser/drive.mjs
//
// It walks the producer's own rule, one clause at a time: looking at a film
// does not move it; editing it does; the pipeline moving it does; publishing
// and playlists do not; the order holds inside playlists and tabs; it never
// moves under the pointer; and Settings can put the old order back.
const { chromium } = await import(new URL("../../../../platform/node_modules/playwright-core/index.mjs", import.meta.url).href);
import { execFileSync } from "node:child_process";

const BASE = process.env.BASE || "http://127.0.0.1:3211";
const SHOTS = process.env.SHOTS || "/tmp/activity-shots";
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
const idOf = (name) => sql(`select id from hov.project where name = '${name.replace(/'/g, "''")}'`);
execFileSync("mkdir", ["-p", SHOTS]);

// A library whose last activity IS its creation, so the order starts where
// "Newest first" would, and every move below is one this test caused.
sql("delete from hov.playlist");
sql("delete from hov.script");
sql("delete from hov.scene");
sql("update hov.project set activity_at = created_at");
const WHERE2 = "Where 2 Technologies — the two brothers";
sql(`insert into hov.script (project_id, content, status, created_at, updated_at)
     select id, 'Two brothers in Sydney drew a map that could move.', 'awaiting_approval', created_at, created_at
       from hov.project where name = '${WHERE2}'`);

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("PAGE ERROR:", e.message));

// The whole library in on-screen order: every page, read through the pager.
const libraryOrder = async (path = "/projects") => {
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  const names = [];
  for (let guard = 0; guard < 6; guard++) {
    names.push(...(await page.locator("a.proj h3").evaluateAll((els) => els.map((e) => e.textContent.trim()))));
    const next = page.locator(".pgbtn", { hasText: "Next" });
    if ((await next.count()) === 0 || (await next.isDisabled())) break;
    await next.click();
    await page.waitForTimeout(250);
  }
  return names;
};
// Page 1's first card. libraryOrder() leaves the page on the LAST page, and
// the first draft of this read page 2's first card — "updated 15 hours ago"
// for a film that was, correctly, at the very top.
const firstCardLabel = async () => {
  await page.goto(`${BASE}/projects`, { waitUntil: "networkidle" });
  return page.locator("a.proj .foot span").first().textContent();
};

// 1 — the starting point
let before = await libraryOrder();
const createdOrder = sql("select string_agg(name, '|' order by created_at desc) from hov.project").split("|");
check("with no cookie the library is Recently worked on, starting from creation", before, createdOrder);
check("the card says when it was last changed", (await firstCardLabel()).includes("updated"), true);

// 2 — LOOKING does not count
await page.goto(`${BASE}/projects/${idOf(WHERE2)}`, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
await page.screenshot({ path: `${SHOTS}/01-looking.png` });
let after = await libraryOrder();
check("opening a film and reading it does not move it", after.indexOf(WHERE2), before.indexOf(WHERE2));

// 3 — CHANGING it does: the producer edits the script and saves
await page.goto(`${BASE}/projects/${idOf(WHERE2)}`, { waitUntil: "networkidle" });
const box = page.locator("textarea").first();
await box.waitFor({ timeout: 15000 });
await box.fill("Two brothers in Sydney drew a map that could move — and Google bought it.");
await page.getByRole("button", { name: /Save draft|Save changes/ }).first().click();
await page.waitForTimeout(1500);
after = await libraryOrder();
check("saving an edit to its script puts it FIRST", after[0], WHERE2);
check("…and the card says just now", (await firstCardLabel()).endsWith("updated just now"), true);
await page.screenshot({ path: `${SHOTS}/02-after-edit.png` });

// 4 — the PIPELINE moving it does (a status the pipeline writes)
const MAPS = "How Google Maps was built";
// Toggled, so every run really changes it: re-sending the value it already
// has is (rightly) not activity, and a second run against the same database
// used to write the same status and wait for a move that could not come.
sql(`update hov.project set status = case when status = 'Asteapta Aprobare Video' then 'Generare Video' else 'Asteapta Aprobare Video' end where name = '${MAPS}'`);
after = await libraryOrder();
check("the pipeline advancing the oldest film brings it to the top", after.slice(0, 2), [MAPS, WHERE2]);

// 5 — PUBLISHING does not
const STREET = "Street View's first car";
before = after;
sql(`update hov.project set editing_options = editing_options || '{"publishing":{"state":"posted"}}' where name = '${STREET.replace(/'/g, "''")}'`);
after = await libraryOrder();
check("marking a film Posted does not move it", after.indexOf(STREET), before.indexOf(STREET));

// 6 — PLAYLISTS do not (added through the page, like the producer would)
const KEYHOLE = "Keyhole and the CIA's money";
before = after;
await page.goto(`${BASE}/projects`, { waitUntil: "networkidle" });
const bar = page.locator('[role="group"][aria-label="Playlists"]');
await bar.getByRole("button", { name: "＋ New playlist" }).click();
await bar.locator('input[aria-label="Name the playlist"]').fill("Sources");
await bar.locator('input[aria-label="Name the playlist"]').press("Enter");
await page.locator(".ptools button.abtn.ok").waitFor();
for (const t of [KEYHOLE, STREET, "The ZipDash deal nobody remembers"]) {
  const card = page.locator("a.proj", { has: page.locator("h3", { hasText: t }) }).first();
  for (let i = 0; i < 4 && (await card.count()) === 0; i++) {
    await page.locator(".pgbtn", { hasText: "Next" }).click();
    await page.waitForTimeout(250);
  }
  await card.click();
}
await page.locator(".ptools button.abtn.ok").click();
await page.waitForTimeout(1200);
after = await libraryOrder();
check("adding films to a playlist does not move them", [KEYHOLE, STREET].map((t) => after.indexOf(t)), [KEYHOLE, STREET].map((t) => before.indexOf(t)));

// 7 — the order holds INSIDE a playlist and a tab
const ZIP = "The ZipDash deal nobody remembers";
sql(`insert into hov.scene (project_id, scene_order) select id, 1 from hov.project where name = '${ZIP}'`);
const pl = sql("select id from hov.playlist where name = 'Sources'");
const inPlaylist = await libraryOrder(`/projects?playlist=${pl}`);
check("inside the playlist, the film just worked on comes first", inPlaylist[0], ZIP);
const finishedTab = await libraryOrder("/projects?filter=done");
check("…and in the Finished tab too", finishedTab[0], ZIP);

// 8 — it never moves UNDER THE POINTER
const STORM = "A storm over the Carpathians";
await page.goto(`${BASE}/projects`, { waitUntil: "networkidle" });
const firstBefore = (await page.locator("a.proj h3").first().textContent()).trim();
// hover() scrolls the card into view first. The first draft moved the mouse
// to the grid's box, which started at y=943 in a 900px viewport — it hovered
// nothing, the order (rightly) did not hold, and the check blamed the product.
await page.locator("a.proj").first().hover();
check("pointing at a card holds the order (the grid says so)", await page.locator(".projects[data-holding]").count(), 1);
sql(`update hov.project set status = case when status = 'Generare Imagine' then 'Generare Voce' else 'Generare Imagine' end where name = '${STORM}'`);
await page.waitForTimeout(17500); // the page refreshes itself every 15 s
check("the refresh has the new data (Rendering tab count grew)", Number(await page.locator(".ftab", { hasText: "Rendering" }).locator(".c").textContent()) >= 1, true);
check("while the pointer is on the cards, the first card stays put", (await page.locator("a.proj h3").first().textContent()).trim(), firstBefore);
await page.mouse.move(640, 5);
await page.waitForTimeout(600);
check("the moment it leaves, the storm film takes its place at the top", (await page.locator("a.proj h3").first().textContent()).trim(), STORM);
await page.screenshot({ path: `${SHOTS}/03-after-hold.png` });

// 9 — Settings puts the old order back, and brings the new one back
await page.goto(`${BASE}/admin/customize`, { waitUntil: "networkidle" });
await page.screenshot({ path: `${SHOTS}/04-settings.png` });
await page.getByRole("radio", { name: "Newest first" }).click();
await page.waitForTimeout(800);
const oldOrder = await libraryOrder();
check("Newest first is the creation order again, exactly", oldOrder, createdOrder);
check("…and the card shows the creation age, as before", (await firstCardLabel()).includes("updated"), false);
await page.goto(`${BASE}/admin/customize`, { waitUntil: "networkidle" });
check("the switch opens on what this device chose", await page.getByRole("radio", { name: "Newest first" }).getAttribute("aria-checked"), "true");
await page.getByRole("radio", { name: "Recently worked on" }).click();
await page.waitForTimeout(800);
const back = await libraryOrder();
check("Recently worked on comes back with the work in it", back.slice(0, 3), [STORM, ZIP, MAPS]);

// 10 — the Settings page on a phone, both themes
for (const theme of ["light", "dark"]) {
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  if (theme === "dark") await phone.addCookies([{ name: "hov-theme", value: "dark", url: BASE }]);
  const p = await phone.newPage();
  await p.goto(`${BASE}/admin/customize`, { waitUntil: "networkidle" });
  check(`${theme}: Settings has no sideways scroll at 390px`, await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0);
  const seg = await p.getByRole("radiogroup", { name: "Library order" }).boundingBox();
  check(`${theme}: the switch fits the phone`, Math.round(seg.x + seg.width) <= 390 - 16, true);
  await p.getByRole("radiogroup", { name: "Library order" }).scrollIntoViewIfNeeded();
  await p.screenshot({ path: `${SHOTS}/05-settings-phone-${theme}.png` });
  await phone.close();
}

await browser.close();
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
