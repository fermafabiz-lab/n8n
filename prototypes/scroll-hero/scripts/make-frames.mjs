// Generates the placeholder frame sequence for the prototype:
//   public/frames/frame_0001.webp … frame_0100.webp  and  public/frames/poster.webp
//
// The poster sits IN the frame directory on purpose. Neither it nor the frames
// are in the container image; both are served off disk (by Caddy on the box,
// by Next from public/ locally), so one directory is the whole upload and a
// new sequence never needs a rebuild.
//
// The content is deliberately synthetic and self-describing: every frame
// prints its own number and moves a marker along a path, so a screenshot of
// the canvas proves which frame was drawn without any guesswork. Replace the
// files with a real render (same names, same count) and nothing else changes.
//
// Sizes are the design constraint: the whole hero has to stay under 3 MB, so
// the script prints the total at the end and refuses to finish quietly if it
// goes over.

import { mkdir, writeFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "public", "frames");
const posterPath = path.join(outDir, "poster.webp");

// `npm run frames -- 48` or FRAME_COUNT=48 to make a different length. The
// count is written into manifest.json beside the frames, which is what the
// hero reads — the constant in ScrollHero.tsx is only the fallback.
const COUNT = Number(process.argv[2] ?? process.env.FRAME_COUNT ?? 110);
if (!Number.isInteger(COUNT) || COUNT < 1 || COUNT > 2000) {
  console.error(`frame count must be a whole number from 1 to 2000, got ${process.argv[2] ?? process.env.FRAME_COUNT}`);
  process.exit(1);
}
const W = 1600;
const H = 900;
const BUDGET_BYTES = 3 * 1024 * 1024;

function pad(n) {
  return String(n).padStart(4, "0");
}

function svgFor(index) {
  const t = index / (COUNT - 1);
  const hueA = Math.round(215 + 70 * t);
  const hueB = Math.round(275 + 70 * t);
  const cx = Math.round(180 + (W - 360) * t);
  const cy = Math.round(H / 2 + 170 * Math.sin(t * Math.PI * 2));
  const barW = Math.round((W - 200) * t);
  const ring = Math.round(60 + 40 * Math.sin(t * Math.PI));
  const tick = Math.round(t * 100);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="hsl(${hueA} 45% 14%)"/>
      <stop offset="1" stop-color="hsl(${hueB} 50% 26%)"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <path d="M 180 ${H / 2} Q ${W / 2} ${H / 2 - 340} ${W - 180} ${H / 2}" fill="none" stroke="rgba(255,255,255,0.12)" stroke-width="3"/>
  <circle cx="${cx}" cy="${cy}" r="${ring}" fill="none" stroke="rgba(255,255,255,0.35)" stroke-width="6"/>
  <circle cx="${cx}" cy="${cy}" r="34" fill="#f5f2e8"/>
  <rect x="100" y="${H - 120}" width="${W - 200}" height="10" rx="5" fill="rgba(255,255,255,0.15)"/>
  <rect x="100" y="${H - 120}" width="${barW}" height="10" rx="5" fill="#f5f2e8"/>
  <text x="100" y="230" font-family="Helvetica, Arial, sans-serif" font-size="180" font-weight="700" fill="#f5f2e8">${pad(index + 1)}</text>
  <text x="100" y="290" font-family="Helvetica, Arial, sans-serif" font-size="40" fill="rgba(255,255,255,0.7)">frame ${index + 1} of ${COUNT} · ${tick}%</text>
</svg>`;
}

async function render(svg, target, quality) {
  const buf = await sharp(Buffer.from(svg))
    .webp({ quality, effort: 5, smartSubsample: true })
    .toBuffer();
  await writeFile(target, buf);
  return buf.length;
}

await mkdir(outDir, { recursive: true });

let total = 0;
for (let i = 0; i < COUNT; i++) {
  const bytes = await render(svgFor(i), path.join(outDir, `frame_${pad(i + 1)}.webp`), 72);
  total += bytes;
}
// The poster is the first frame at the same quality, so the canvas taking
// over from it is invisible.
total += await render(svgFor(0), posterPath, 72);

// What the hero reads to know how long the sequence is. It ships with the
// frames; a real sequence uploaded by hand needs one of these too.
const manifestPath = path.join(outDir, "manifest.json");
await writeFile(manifestPath, `${JSON.stringify({ count: COUNT }, null, 2)}\n`);

const posterSize = (await stat(posterPath)).size;
console.log(`frames: ${COUNT} × ${W}×${H} in ${path.relative(root, outDir)}`);
console.log(`poster: ${(posterSize / 1024).toFixed(1)} kB (same directory)`);
console.log(`manifest: {"count": ${COUNT}}`);
console.log(`total assets: ${(total / 1024 / 1024).toFixed(2)} MB (budget ${(BUDGET_BYTES / 1024 / 1024).toFixed(1)} MB)`);
if (total > BUDGET_BYTES) {
  console.error("over budget");
  process.exit(1);
}
