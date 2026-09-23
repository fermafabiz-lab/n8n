// The category playlists, driven in real Chromium against the site's
// PRODUCTION build on a real Postgres engine (db/port/lib/local-pg.mjs with
// 001..014, `next start` on DATA_BACKEND=postgres). Destructive to the LOCAL
// engine only.
//
//   node db/port/category-lists/browser/drive.mjs
//
// Needs the server started with SITE_PASSWORD and MEDIA_INGEST_KEY set (the
// values below), so the restart door is tested behind the real password gate.
const { chromium } = await import(new URL("../../../../platform/node_modules/playwright-core/index.mjs", import.meta.url).href);
import { execFileSync } from "node:child_process";

const BASE = process.env.BASE || "http://127.0.0.1:3211";
const SHOTS = process.env.SHOTS || "/tmp/category-shots";
const PASSWORD = process.env.SITE_PASSWORD || "local-test";
const KEY = process.env.MEDIA_INGEST_KEY || "local-key";
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

// ------------------------------------------------------------------ setup
// Two films the producer never filed by hand: one with no category at all
// (made before categories existed) and one with a category this site no
// longer knows. Both belong under Story, where getCategory files them.
sql("delete from hov.playlist");
sql(`update hov.project set editing_options = editing_options - 'category'
      where id = (select id from hov.project where editing_options->>'category' = 'documentary' order by created_at limit 1)`);
sql(`update hov.project set editing_options = jsonb_set(editing_options, '{category}', '"musicvideo"')
      where id = (select id from hov.project where editing_options->>'category' = 'kids' order by created_at limit 1)`);
const unfiled = sql("select name from hov.project where not (editing_options ? 'category')");
const unknown = sql("select name from hov.project where editing_options->>'category' = 'musicvideo'");
const expected = {
  Story: Number(sql("select count(*) from hov.project where coalesce(editing_options->>'category','') not in ('documentary','cinematic','kids')")),
  Documentary: Number(sql("select count(*) from hov.project where editing_options->>'category' = 'documentary'")),
  Cinematic: Number(sql("select count(*) from hov.project where editing_options->>'category' = 'cinematic'")),
  "Kids story": Number(sql("select count(*) from hov.project where editing_options->>'category' = 'kids'")),
};
const total = Number(sql("select count(*) from hov.project"));
// One playlist of the producer's own, to sit beside them.
sql(`insert into hov.playlist (name) values ('Season two')`);

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.addCookies([{ name: "vf_auth", value: PASSWORD, url: BASE }]);
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("PAGE ERROR:", e.message));

const bar = () => page.locator('[role="group"][aria-label="Playlists"]');
const chips = async () =>
  (await bar().locator("button[aria-pressed]").evaluateAll((els) =>
    els.map((e) => e.innerText.replace(/\s+/g, " ").trim()),
  ));
const showing = async () => (await page.locator(".pshowing span").first().innerText()).replace(/\s+/g, " ");
const cardNames = async () => {
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

// ------------------------------------------------------------- the chips
await page.goto(`${BASE}/projects`, { waitUntil: "networkidle" });
check(
  "the row: All films, then one chip per category with films (brief order, icon, count), then the producer's own",
  await chips(),
  [
    `All films ${total}`,
    `📖 Story ${expected.Story}`,
    `🎥 Documentary ${expected.Documentary}`,
    `🎬 Cinematic ${expected.Cinematic}`,
    `🧸 Kids story ${expected["Kids story"]}`,
    "Season two 0",
  ],
);
check("the counts add up to the whole library", Object.values(expected).reduce((a, b) => a + b, 0), total);
await page.screenshot({ path: `${SHOTS}/1-row.png`, clip: { x: 0, y: 0, width: 1280, height: 420 } });

// ------------------------------------------------ opening a category
await bar().getByRole("button", { name: /Documentary/ }).click();
await page.waitForTimeout(300);
check("the address names it", new URL(page.url()).searchParams.get("playlist"), "category:documentary");
check("it is the chip that is on", await bar().locator('button[aria-pressed="true"]').innerText().then((t) => t.replace(/\s+/g, " ").trim()), `🎥 Documentary ${expected.Documentary}`);
check("the library shows exactly its films", (await showing()).includes(`of ${expected.Documentary} in “Documentary”`), true);
const docNames = await cardNames();
const docInDb = sql("select name from hov.project where editing_options->>'category' = 'documentary' order by name").split("\n");
check("…and they are the documentary films, all of them", [...docNames].sort(), docInDb.sort());
check("no Rename / Delete playlist for a category", [await bar().getByText("Rename").count(), await bar().getByText("Delete playlist").count()], [0, 0]);
await page.screenshot({ path: `${SHOTS}/2-documentary.png`, clip: { x: 0, y: 0, width: 1280, height: 700 } });

await page.reload({ waitUntil: "networkidle" });
check("a reload keeps the category open", (await showing()).includes("in “Documentary”"), true);

// ------------------------------------------- Select inside a category
await page.getByRole("button", { name: "☑ Select" }).click();
check("Select offers Add to playlist…", await page.getByRole("button", { name: /Add to playlist/ }).count() > 0, true);
check("…and never 'Remove from' a category", await page.getByRole("button", { name: /Remove from/ }).count(), 0);
const first = docNames[0];
await page.locator("a.proj", { hasText: first }).first().click();
await page.getByRole("button", { name: /Add to playlist/ }).click();
await page.getByRole("menuitem", { name: /Season two/ }).or(page.getByRole("button", { name: /Season two/ }).last()).click();
await page.waitForTimeout(600);
check("a film chosen inside a category lands in the producer's playlist", sql(`select count(*) from hov.playlist_project pp join hov.playlist p on p.id = pp.playlist_id join hov.project f on f.id = pp.project_id where p.name = 'Season two' and f.name = '${first.replace(/'/g, "''")}'`), "1");

// ------------------------------------------------ Story takes the unfiled
await page.goto(`${BASE}/projects?playlist=category:story`, { waitUntil: "networkidle" });
const storyNames = await cardNames();
check("a film with no category is under Story", storyNames.includes(unfiled), true);
check("so is a film filed under a category the site no longer knows", storyNames.includes(unknown), true);
check("Story holds exactly its count", storyNames.length, expected.Story);

// ------------------------------------ a category that empties, and links
sql("update hov.project set editing_options = jsonb_set(editing_options, '{category}', '\"documentary\"') where editing_options->>'category' = 'cinematic'");
await page.goto(`${BASE}/projects`, { waitUntil: "networkidle" });
check("a category with no films loses its chip", (await chips()).some((c) => c.includes("Cinematic")), false);
await page.goto(`${BASE}/projects?playlist=category:cinematic`, { waitUntil: "networkidle" });
check("an old link to it says so, with nothing to fill", [await page.getByText("No Cinematic films yet.").count(), await page.getByRole("button", { name: /Add films to it/ }).count()], [1, 0]);
await page.goto(`${BASE}/projects?playlist=category:nope`, { waitUntil: "networkidle" });
check("a link to a category the site does not know is stale", await page.getByText("That playlist no longer exists").count(), 1);

// ------------------------------------------------------ a phone, both themes
for (const theme of ["light", "dark"]) {
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await phone.addCookies([
    { name: "vf_auth", value: PASSWORD, url: BASE },
    { name: "hov-theme", value: theme, url: BASE },
  ]);
  const p = await phone.newPage();
  await p.goto(`${BASE}/projects?playlist=category:documentary`, { waitUntil: "networkidle" });
  const wide = await p.evaluate(() => document.scrollingElement.scrollWidth);
  check(`390px ${theme}: nothing runs off the side`, wide <= 390, true);
  const sep = await p.locator('[role="group"][aria-label="Playlists"] span[aria-hidden="true"]').evaluateAll((els) =>
    els.filter((e) => getComputedStyle(e).width === "1px").map((e) => getComputedStyle(e).display),
  );
  check(`390px ${theme}: the divider is hidden where the row wraps`, sep.every((d) => d === "none"), true);
  await p.screenshot({ path: `${SHOTS}/3-phone-${theme}.png`, clip: { x: 0, y: 0, width: 390, height: 520 } });
  await phone.close();
}

// ------------------------------------------ the restart door, for real
const post = (headers, body) =>
  fetch(`${BASE}/api/ops/restart`, { method: "POST", redirect: "manual", headers: { "Content-Type": "application/json", ...headers }, body });
const noKey = await post({}, JSON.stringify({ projectId: "recABCDEFGHIJKLMN" }));
check("the door without a key: the password gate sends it to /login", [noKey.status, (noKey.headers.get("location") || "").includes("/login")], [307, true]);
const wrong = await post({ "x-hov-key": "nope" }, JSON.stringify({ projectId: "recABCDEFGHIJKLMN" }));
check("…with the wrong key: the same", wrong.status, 307);
const logged = await post({ Cookie: `vf_auth=${PASSWORD}` }, JSON.stringify({ projectId: "recABCDEFGHIJKLMN" }));
check("…a logged-in BROWSER without the key: refused by the route itself", logged.status, 401);
const badId = await post({ "x-hov-key": KEY }, JSON.stringify({ projectId: "category:story" }));
check("…the right key, a bad id: 400", badId.status, 400);
const real = await post({ "x-hov-key": KEY }, JSON.stringify({ projectId: sql("select id from hov.project order by created_at limit 1") }));
const realBody = await real.json();
check("…the right key, a real film: the button's own answer (no n8n here, so 409 'not configured')", [real.status, realBody.ok, /not configured/i.test(realBody.message)], [409, false, true]);

await browser.close();
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
