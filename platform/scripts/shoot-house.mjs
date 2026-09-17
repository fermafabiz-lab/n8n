#!/usr/bin/env node
/**
 * Screenshots the house against a running server, in both themes and with
 * reduced motion, and reports what it actually found in the page.
 *
 * `docs/lessons-site.md`'s standing rule is that a look is verified in a real
 * browser, not by reading the CSS — and this stage has two claims that CSS
 * cannot settle: that the WebGL house mounts when it is wanted, and that it
 * does NOT mount under `prefers-reduced-motion`, which the global
 * `animation: none` rule in globals.css cannot reach because a requestAnimationFrame
 * loop is not an animation.
 *
 * Chromium is already on the box (Playwright's), so this needs no download.
 * playwright-core is a dev-time dependency of this script only, deliberately
 * not in package.json — the same arrangement make-genre-stills.mjs has with
 * sharp:
 *
 *   npm i --no-save playwright-core
 *   npx next build && npx next start -p 3100 &
 *   node scripts/shoot-house.mjs                 # writes to .house-shots/
 *
 * Software GL is forced, because a container has no GPU and the point is to
 * prove the scene runs, not to measure how fast.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.SHOOT_BASE || "http://localhost:3100";
const OUT = process.env.SHOOT_OUT || ".house-shots";
const EXE =
  process.env.CHROME_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

let chromium;
try {
  ({ chromium } = await import("playwright-core"));
} catch {
  console.error("playwright-core not installed — run: npm i --no-save playwright-core");
  process.exit(2);
}

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: EXE,
  args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"],
});

const results = [];

/**
 * @param expect  what this run is supposed to prove: `canvas: true|false`.
 */
async function shot(name, { path = "/login", theme, reduce = false, width = 1280, height = 800, expect = {} } = {}) {
  const ctx = await browser.newContext({
    viewport: { width, height },
    reducedMotion: reduce ? "reduce" : "no-preference",
  });
  if (theme) await ctx.addCookies([{ name: "hov-theme", value: theme, url: BASE }]);

  const page = await ctx.newPage();
  const errors = [];
  let modelOk = false;
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("response", (r) => /\.glb(\?|$)/.test(r.url()) && r.status() === 200 && (modelOk = true));
  // A bare console error says "Failed to load resource" and names nothing, so
  // failed responses are recorded from the network side, with their URL.
  page.on("response", (r) => r.status() >= 400 && errors.push(`HTTP ${r.status()} ${r.url()}`));
  page.on("requestfailed", (r) => errors.push(`REQ ${r.url()} ${r.failure()?.errorText ?? ""}`));
  page.on(
    "console",
    (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errors.push(m.text()),
  );

  // Not `networkidle`: a page that keeps a WebGL loop running never reliably
  // reaches it, and Playwright discourages it for exactly this reason. Wait for
  // the document, then give the dynamically-imported scene time to load its
  // model and draw a few frames.
  await page.goto(BASE + path, { waitUntil: "load", timeout: 20000 });
  await page.waitForTimeout(4000);

  const canvas = (await page.locator(".facade-gl canvas").count()) > 0;
  const readout = (await page.locator("p[class*='sr']").first().textContent().catch(() => "")) || "";
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  if (overflow) errors.push("horizontal overflow: the page scrolls sideways");

  await page.screenshot({ path: join(OUT, `${name}.png`) });
  await ctx.close();

  const want = expect.canvas;
  // When the canvas is meant to be there, the model has to have loaded too.
  const ok =
    (want === undefined || canvas === want) && errors.length === 0 && (want !== true || modelOk);
  results.push(ok);
  console.log(
    `${ok ? "OK  " : "FAIL"} ${name.padEnd(16)} canvas=${canvas}${
      want === undefined ? "" : ` (want ${want})`
    } model=${modelOk} errors=${errors.length}  "${readout.trim()}"`,
  );
  if (errors.length) for (const e of errors.slice(0, 3)) console.log(`       ! ${e}`);
}

await shot("login-light", { theme: "light", expect: { canvas: true } });
await shot("login-dark", { theme: "dark", expect: { canvas: true } });
// The one that cannot be checked by reading CSS: no canvas at all, not a
// frozen one.
await shot("login-reduced", { theme: "light", reduce: true, expect: { canvas: false } });
// Phone width: the card re-centres and the house becomes a backdrop, because
// there is not room for both. Mostly this is here to catch a horizontal
// scrollbar, which is the usual way a full-bleed backdrop goes wrong.
await shot("login-phone", { theme: "light", width: 390, height: 844, expect: { canvas: true } });

await browser.close();
console.log(`\n${results.filter(Boolean).length}/${results.length} passed — images in ${OUT}/`);
process.exit(results.every(Boolean) ? 0 : 1);
