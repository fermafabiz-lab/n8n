// Generates the placeholder clips the examples section plays LOCALLY:
//   public/media/kidsstory.mp4, "public/media/m8 .mp4", "public/media/roman empire.mp4"
//
// Same arrangement as the frames: the real files live on the box (Caddy serves
// them from /opt/n8n/media) and are never in the container image, so these
// stand in for them on a laptop and under `npm test`. The names — spaces and
// all, including the odd space before `.mp4` in "m8 .mp4" — are copied from
// the real files on purpose: an encoding bug in the page has to fail here too,
// not only in production.
//
// There is no ffmpeg in this environment, so the clips are recorded from a
// canvas by the same Chromium Playwright drives: MediaRecorder writes real
// mp4. Each one prints its own name and a running clock, so a screenshot shows
// which clip is playing and that it IS playing.
//
// Replace nothing on the box with these. They are 4-second placeholders.

import { mkdir, writeFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { chromium } from "@playwright/test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "public", "media");

// Matches EXAMPLES in components/ExampleReel.tsx. Width and height are the
// real clips' shape — all three are horizontal 16:9.
const CLIPS = [
  { file: "kidsstory.mp4", label: "kidsstory", hue: 28 },
  { file: "m8 .mp4", label: "m8", hue: 205 },
  { file: "roman empire.mp4", label: "roman empire", hue: 348 },
];

// Small on purpose: these are committed, like the placeholder frames beside
// them, so that a fresh clone can run the suite without recording anything.
// Nothing here is ever seen at full size — the CSS gives the box its 16:9
// shape — so the resolution only has to keep the label readable in a shot.
const W = 854;
const H = 480;
const SECONDS = 4;
const FPS = 24;

const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM ?? "/opt/pw-browsers/chromium",
});
const page = await browser.newPage();
await page.goto("about:blank");

await mkdir(outDir, { recursive: true });

let total = 0;
for (const clip of CLIPS) {
  const b64 = await page.evaluate(
    async ({ W, H, SECONDS, FPS, label, hue }) => {
      const canvas = document.createElement("canvas");
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext("2d");

      const stream = canvas.captureStream(FPS);
      const rec = new MediaRecorder(stream, { mimeType: "video/mp4" });
      const chunks = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);

      const started = performance.now();
      const draw = () => {
        const t = (performance.now() - started) / 1000;
        const p = Math.min(1, t / SECONDS);

        const grad = ctx.createLinearGradient(0, 0, W, H);
        grad.addColorStop(0, `hsl(${hue} 55% 18%)`);
        grad.addColorStop(1, `hsl(${(hue + 40) % 360} 60% 34%)`);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, W, H);

        // A marker that moves, so a still frame proves the clip is running
        // rather than parked on frame one.
        ctx.beginPath();
        ctx.arc(120 + (W - 240) * p, H / 2 + 120 * Math.sin(p * Math.PI * 2), 48, 0, Math.PI * 2);
        ctx.fillStyle = "#f5f2e8";
        ctx.fill();

        ctx.fillStyle = "rgba(255,255,255,0.16)";
        ctx.fillRect(80, H - 70, W - 160, 8);
        ctx.fillStyle = "#f5f2e8";
        ctx.fillRect(80, H - 70, (W - 160) * p, 8);

        ctx.fillStyle = "#f5f2e8";
        ctx.font = "700 64px Helvetica, Arial, sans-serif";
        ctx.fillText(label, 60, 120);
        ctx.font = "400 28px Helvetica, Arial, sans-serif";
        ctx.fillStyle = "rgba(255,255,255,0.75)";
        ctx.fillText(`placeholder · ${t.toFixed(1)}s`, 60, 164);
      };

      draw();
      rec.start();
      const timer = setInterval(draw, 1000 / FPS);
      await new Promise((r) => setTimeout(r, SECONDS * 1000));
      clearInterval(timer);

      const blob = await new Promise((resolve) => {
        rec.onstop = () => resolve(new Blob(chunks, { type: "video/mp4" }));
        rec.stop();
      });
      const buf = new Uint8Array(await blob.arrayBuffer());
      let s = "";
      for (const byte of buf) s += String.fromCharCode(byte);
      return btoa(s);
    },
    { W, H, SECONDS, FPS, label: clip.label, hue: clip.hue },
  );

  const target = path.join(outDir, clip.file);
  await writeFile(target, Buffer.from(b64, "base64"));
  const bytes = (await stat(target)).size;
  total += bytes;
  console.log(`${clip.file}: ${(bytes / 1024).toFixed(0)} kB`);
}

await browser.close();
console.log(`${CLIPS.length} placeholder clips, ${SECONDS}s each, ${(total / 1024 / 1024).toFixed(2)} MB total`);
console.log(`in ${path.relative(root, outDir)} — local only, never in the image, never uploaded`);
