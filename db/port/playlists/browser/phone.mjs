// Playlists, driven in real Chromium against the site on a real Postgres
// engine — see ../README.md, "How it was verified". Needs db/port/lib/local-pg.mjs
// listening and `next dev` on DATA_BACKEND=postgres pointed at it. Destructive
// to the LOCAL engine only (it clears hov.playlist before it starts).
//
//   node db/port/playlists/browser/phone.mjs
// The same feature at 390px — the producer works from the phone — and at night.
const { chromium } = await import(new URL("../../../../platform/node_modules/playwright-core/index.mjs", import.meta.url).href);
import { execFileSync } from "node:child_process";
const SHOTS = process.env.SHOTS || "/tmp/playlist-shots";
const results = [];
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  results.push(ok);
  console.log(`${ok ? "OK  " : "FAIL"} ${name} -> ${JSON.stringify(got)}${ok ? "" : ` (want ${JSON.stringify(want)})`}`);
};
const sql = (q) => execFileSync("psql", ["-h", "127.0.0.1", "-p", process.env.LOCAL_PG_PORT || "55432", "-U", "postgres", "-d", "postgres", "-X", "-q", "-t", "-A", "-c", q], { env: { ...process.env, PGPASSWORD: "postgres" } }).toString().trim();
execFileSync("mkdir", ["-p", SHOTS]);
sql("delete from hov.playlist");
// Three playlists, one with a long name, so wrapping is exercised.
sql(`with a as (insert into hov.playlist (name) values ('Google Maps — the documentaries') returning id),
          b as (insert into hov.playlist (name) values ('Pip the Fox') returning id),
          c as (insert into hov.playlist (name) values ('To post this week') returning id)
     insert into hov.playlist_project (playlist_id, project_id)
     select a.id, p.id from a, hov.project p where p.name in ('How Google Maps was built','Street View''s first car','The ZipDash deal nobody remembers')
     union all select b.id, p.id from b, hov.project p where p.name like 'Pip the Fox%'
     union all select c.id, p.id from c, hov.project p where p.status = 'Finalizat' limit 20`);

const b = await chromium.launch({ executablePath: process.env.CHROMIUM || "/opt/pw-browsers/chromium" });
for (const theme of ["light", "dark"]) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  if (theme === "dark") await ctx.addCookies([{ name: "hov-theme", value: "dark", url: process.env.BASE || "http://127.0.0.1:3211" }]);
  const p = await ctx.newPage();
  p.on("pageerror", (e) => console.log("PAGE ERROR:", e.message));
  await p.goto(`${process.env.BASE || "http://127.0.0.1:3211"}/projects`, { waitUntil: "networkidle" });
  const bar = p.locator('[role="group"][aria-label="Playlists"]');
  await bar.scrollIntoViewIfNeeded();
  const overflow = () => p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(`${theme}: no sideways scroll`, await overflow(), 0);
  const chipBoxes = await bar.locator("button[aria-pressed]").evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.right)]; }));
  check(`${theme}: every chip inside the screen`, chipBoxes.every(([l, r]) => l >= 0 && r <= 390), true);
  await bar.getByRole("button", { name: /Google Maps/ }).click();
  await p.waitForTimeout(500);
  await bar.scrollIntoViewIfNeeded();
  await p.screenshot({ path: `${SHOTS}/phone-${theme}-bar.png` });
  const tools = await bar.getByRole("button", { name: "Delete playlist" }).boundingBox();
  check(`${theme}: Rename/Delete on their own line, inside the screen`, [Math.round(tools.x + tools.width) <= 390], [true]);
  check(`${theme}: still no sideways scroll`, await overflow(), 0);
  // Select → Add to playlist on the phone
  await p.locator(".ptools").getByRole("button", { name: "☑ Select" }).click();
  await p.locator("a.proj").first().click();
  await p.locator(".ptools").getByRole("button", { name: "＋ Add to playlist" }).click();
  const pop = p.locator('[role="dialog"][aria-label="Add to a playlist"]');
  await pop.waitFor();
  const box = await pop.boundingBox();
  check(`${theme}: the menu fits the phone (16px margins)`, [Math.round(box.x) >= 16, Math.round(box.x + box.width) <= 390 - 16], [true, true]);
  await pop.scrollIntoViewIfNeeded();
  await p.screenshot({ path: `${SHOTS}/phone-${theme}-menu.png` });
  check(`${theme}: and nothing scrolls sideways with it open`, await overflow(), 0);
  await p.keyboard.press("Escape");
  // Measured contrast on the real page, both themes: chip label/count on the chip.
  const pairs = await bar.locator("button[aria-pressed]").first().evaluate((btn) => {
    const rgb = (s) => s.match(/[\d.]+/g).slice(0, 3).map(Number);
    const lum = ([r, g, b]) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return +((x + 0.05) / (y + 0.05)).toFixed(2); };
    const bg = rgb(getComputedStyle(btn).backgroundColor);
    const [name, count] = btn.querySelectorAll("span");
    return { label: ratio(rgb(getComputedStyle(btn).color), bg), count: ratio(rgb(getComputedStyle(count).color), bg), bg: getComputedStyle(btn).backgroundColor };
  });
  check(`${theme}: "All films" label and count read at ≥ 4.5:1 on their chip (${JSON.stringify(pairs)})`, pairs.label >= 4.5 && pairs.count >= 4.5, true);
  await ctx.close();
}
await b.close();
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
