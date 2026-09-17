// Lighthouse against the running production server (`npm run start`).
//
// Two runs:
//   mobile  — Lighthouse's default mobile preset: Moto G Power emulation,
//             412px viewport, simulated slow 4G (1.6 Mbps, 150 ms RTT),
//             4× CPU slowdown. At 412px the hero takes the poster-only path.
//   desktop-4g — desktop screen (so the canvas path runs) with the SAME
//             slow-4G network simulation, which is the case the frame
//             budget is really about.
//
// Reports land in ./lighthouse/<name>.{json,html}; the summary prints here.

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import lighthouse from "lighthouse";
import * as chromeLauncher from "chrome-launcher";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "lighthouse");
const url = process.env.URL ?? "http://localhost:3000/";
const chromePath =
  process.env.CHROME_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const SLOW_4G = {
  rttMs: 150,
  throughputKbps: 1638.4,
  requestLatencyMs: 150 * 3.75,
  downloadThroughputKbps: 1638.4 * 0.9,
  uploadThroughputKbps: 750 * 0.9,
  cpuSlowdownMultiplier: 4,
};

const runs = [
  {
    name: "mobile",
    settings: { formFactor: "mobile" },
  },
  {
    name: "desktop-4g",
    settings: {
      formFactor: "desktop",
      screenEmulation: { mobile: false, width: 1350, height: 940, deviceScaleFactor: 1, disabled: false },
      emulatedUserAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Chrome-Lighthouse",
      throttlingMethod: "simulate",
      throttling: SLOW_4G,
    },
  },
];

await mkdir(outDir, { recursive: true });

const chrome = await chromeLauncher.launch({
  chromePath,
  chromeFlags: ["--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
});

const ms = (audit) => (audit?.numericValue == null ? "n/a" : `${Math.round(audit.numericValue)} ms`);
const score = (cat) => (cat?.score == null ? "n/a" : Math.round(cat.score * 100));

try {
  const rows = [];
  for (const run of runs) {
    const result = await lighthouse(url, {
      port: chrome.port,
      output: ["json", "html"],
      logLevel: "error",
      onlyCategories: ["performance", "accessibility", "best-practices", "seo"],
      ...run.settings,
    });
    const lhr = result.lhr;
    await writeFile(path.join(outDir, `${run.name}.json`), result.report[0]);
    await writeFile(path.join(outDir, `${run.name}.html`), result.report[1]);
    const a = lhr.audits;
    rows.push({
      run: run.name,
      performance: score(lhr.categories.performance),
      accessibility: score(lhr.categories.accessibility),
      "best-practices": score(lhr.categories["best-practices"]),
      seo: score(lhr.categories.seo),
      FCP: ms(a["first-contentful-paint"]),
      LCP: ms(a["largest-contentful-paint"]),
      TBT: ms(a["total-blocking-time"]),
      CLS: a["cumulative-layout-shift"]?.displayValue ?? "n/a",
      "Speed Index": ms(a["speed-index"]),
      "LCP element": a["largest-contentful-paint-element"]?.details?.items?.[0]?.items?.[0]?.node?.snippet ?? "n/a",
      "total bytes": `${Math.round((a["total-byte-weight"]?.numericValue ?? 0) / 1024)} kB`,
    });
  }
  console.table(rows);
  await writeFile(path.join(outDir, "summary.json"), JSON.stringify(rows, null, 2));
} finally {
  await chrome.kill();
}
