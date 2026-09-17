import { test, expect, type Page, type Route } from "@playwright/test";
import path from "node:path";

const SHOTS = path.resolve(__dirname, "..", "shots");
const FRAME_COUNT = 100;
const CHECKPOINTS = [0, 25, 50, 75, 99];
const BUDGET_BYTES = 3 * 1024 * 1024;
const POSTER_PATH = "/frames/poster.webp";

// Matches a numbered frame and NOT the poster beside it. The opt-out tests
// assert that no frame is fetched, while the poster still must be.
const isFrameRequest = (url: string) => /\/frames\/frame_\d+\.webp/.test(url);

const hero = (page: Page) => page.locator("section.hero");

// Scroll distance across which the sequence plays: section height minus one
// viewport (the sticky stage).
async function scrubRange(page: Page): Promise<number> {
  return page.evaluate(() => {
    const s = document.querySelector("section.hero") as HTMLElement;
    return s.offsetHeight - window.innerHeight;
  });
}

async function scrollToFrame(page: Page, index: number) {
  const range = await scrubRange(page);
  const y = Math.round((index / (FRAME_COUNT - 1)) * range);
  await page.evaluate((y) => window.scrollTo(0, y), y);
}

// Sums the bytes that actually crossed the wire for the hero's assets and
// the page's own JS/CSS/HTML: everything the hero costs a first visitor.
function trackBytes(page: Page) {
  const seen = new Map<string, number>();
  page.on("response", async (res) => {
    const url = new URL(res.url());
    if (url.origin !== "http://localhost:3000") return;
    try {
      const sizes = await res.request().sizes();
      seen.set(url.pathname + url.search, sizes.responseBodySize + sizes.responseHeadersSize);
    } catch {
      /* request torn down before sizes were available */
    }
  });
  return () => {
    let frames = 0;
    let poster = 0;
    let code = 0;
    for (const [p, n] of seen) {
      // The poster lives in the frame directory now, so it has to be taken
      // out before the frames are counted, not after.
      if (p === POSTER_PATH) poster += n;
      else if (p.startsWith("/frames/")) frames += n;
      else code += n;
    }
    return { frames, poster, code, total: frames + poster + code, requests: seen.size };
  };
}

test.describe("desktop", () => {
  test.use({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });

  test("scrubs the whole sequence and stays under budget", async ({ page }) => {
    const bytes = trackBytes(page);
    await page.goto("/");

    // Poster shows until the first batch is drawn.
    await expect(hero(page)).toHaveAttribute("data-state", /loading|ready/);
    await expect(hero(page)).toHaveAttribute("data-state", "ready", { timeout: 15_000 });
    const loadedAtReady = Number(await hero(page).getAttribute("data-loaded"));
    expect(loadedAtReady).toBeGreaterThanOrEqual(20);

    // Wait for the background loader to finish so frame 99 exists.
    await expect(hero(page)).toHaveAttribute("data-loaded", String(FRAME_COUNT), {
      timeout: 30_000,
    });

    for (const index of CHECKPOINTS) {
      await scrollToFrame(page, index);
      await expect(hero(page)).toHaveAttribute("data-frame", String(index));
      // one more frame so the compositor has shown the draw
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));
      await page.screenshot({ path: path.join(SHOTS, `frame-${String(index).padStart(2, "0")}.png`) });
    }

    // Scrolling back up reverses.
    await scrollToFrame(page, 40);
    await expect(hero(page)).toHaveAttribute("data-frame", "40");
    await scrollToFrame(page, 10);
    await expect(hero(page)).toHaveAttribute("data-frame", "10");

    // Past the track the stage unpins and the test section takes the viewport.
    const range = await scrubRange(page);
    await page.evaluate((y) => window.scrollTo(0, y + window.innerHeight), range);
    await expect(page.getByTestId("after-hero")).toBeInViewport({ ratio: 0.95 });
    await page.screenshot({ path: path.join(SHOTS, "after-hero.png") });

    const b = bytes();
    console.log(
      `transfer: frames ${(b.frames / 1024).toFixed(0)} kB, poster ${(b.poster / 1024).toFixed(0)} kB, ` +
        `code ${(b.code / 1024).toFixed(0)} kB, total ${(b.total / 1024 / 1024).toFixed(2)} MB over ${b.requests} requests`,
    );
    expect(b.total).toBeLessThan(BUDGET_BYTES);
  });

  test("holds the last loaded frame when scrolled ahead of the loader", async ({ page }) => {
    // Stall every frame after the first batch. The loader is sequential, so
    // only frame 21 is ever in flight; holding it holds all the rest.
    const held: Route[] = [];
    await page.route("**/frames/frame_*.webp", async (route) => {
      const n = Number(route.request().url().match(/frame_(\d+)\.webp/)?.[1]);
      if (n > 20) held.push(route);
      else await route.continue();
    });

    await page.goto("/");
    await expect(hero(page)).toHaveAttribute("data-state", "ready", { timeout: 15_000 });
    expect(await hero(page).getAttribute("data-loaded")).toBe("20");

    await scrollToFrame(page, 99);
    // Never blank, never past what exists: index 19 is the 20th frame.
    await expect(hero(page)).toHaveAttribute("data-frame", "19");
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));
    await page.screenshot({ path: path.join(SHOTS, "held-at-19.png") });
    const notBlank = await page.evaluate(() => {
      const c = document.querySelector("canvas.hero__canvas") as HTMLCanvasElement;
      const d = c.getContext("2d")!.getImageData(c.width >> 1, c.height >> 1, 1, 1).data;
      return d[0] + d[1] + d[2] > 0;
    });
    expect(notBlank).toBe(true);

    // Release the loader: the canvas catches up to 99 without a scroll event.
    for (const r of held.splice(0)) await r.continue();
    await page.unroute("**/frames/frame_*.webp");
    await expect(hero(page)).toHaveAttribute("data-frame", "99", { timeout: 30_000 });
  });

  test("nudges after 2s idle and stops for good after a real scroll", async ({ page }) => {
    await page.goto("/");
    await expect(hero(page)).toHaveAttribute("data-state", "ready", { timeout: 15_000 });
    await expect(hero(page)).toHaveAttribute("data-frame", "0");

    // Nudge peaks at +4 after ~2.45s, then eases back to 0.
    await expect(hero(page)).toHaveAttribute("data-frame", "4", { timeout: 4_000 });
    await expect(hero(page)).toHaveAttribute("data-frame", "0", { timeout: 4_000 });

    // A real scroll ends the hint permanently, even one that stays on frame 0.
    await page.mouse.wheel(0, 2);
    await page.waitForTimeout(150);
    await page.evaluate(() => window.scrollTo(0, 0));
    const observed = await page.evaluate(
      () =>
        new Promise<string[]>((resolve) => {
          const s = document.querySelector("section.hero") as HTMLElement;
          const seen = new Set<string>();
          const mo = new MutationObserver(() => seen.add(s.dataset.frame ?? ""));
          mo.observe(s, { attributes: true, attributeFilter: ["data-frame"] });
          setTimeout(() => {
            mo.disconnect();
            resolve([...seen]);
          }, 4_500);
        }),
    );
    expect(observed.filter((f) => f !== "0")).toEqual([]);
  });
});

test.describe("opt-outs", () => {
  test("under 768px: poster only, no frames fetched, no long scroll", async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage();
    const frameRequests: string[] = [];
    const posterRequests: string[] = [];
    page.on("request", (r) => {
      if (isFrameRequest(r.url())) frameRequests.push(r.url());
      else if (r.url().endsWith(POSTER_PATH)) posterRequests.push(r.url());
    });
    await page.goto("/", { waitUntil: "networkidle" });
    await page.waitForTimeout(1_500);

    expect(frameRequests).toEqual([]);
    // The poster is the one thing a narrow viewport must fetch.
    expect(posterRequests.length).toBeGreaterThan(0);
    await expect(hero(page)).toHaveAttribute("data-state", "static");
    await expect(page.locator("canvas.hero__canvas")).toBeHidden();
    await expect(page.locator("img.hero__poster")).toBeVisible();
    const heights = await page.evaluate(() => ({
      hero: (document.querySelector("section.hero") as HTMLElement).offsetHeight,
      viewport: window.innerHeight,
    }));
    expect(heights.hero).toBe(heights.viewport);
    await page.screenshot({ path: path.join(SHOTS, "mobile.png") });
    await context.close();
  });

  test("prefers-reduced-motion: static poster, nothing fetched", async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    const frameRequests: string[] = [];
    const posterRequests: string[] = [];
    page.on("request", (r) => {
      if (isFrameRequest(r.url())) frameRequests.push(r.url());
      else if (r.url().endsWith(POSTER_PATH)) posterRequests.push(r.url());
    });
    await page.goto("/", { waitUntil: "networkidle" });
    await page.waitForTimeout(1_500);

    expect(frameRequests).toEqual([]);
    expect(posterRequests.length).toBeGreaterThan(0);
    await expect(hero(page)).toHaveAttribute("data-state", "static");
    await expect(page.locator("canvas.hero__canvas")).toBeHidden();
    const heights = await page.evaluate(() => ({
      hero: (document.querySelector("section.hero") as HTMLElement).offsetHeight,
      viewport: window.innerHeight,
    }));
    expect(heights.hero).toBe(heights.viewport);
    await page.screenshot({ path: path.join(SHOTS, "reduced-motion.png") });
    await context.close();
  });
});
