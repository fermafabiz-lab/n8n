#!/usr/bin/env node
/**
 * Draws the placeholder stills for the genre spiral on /new.
 *
 * These are provisional: the plan is to replace them with frames from real
 * finished projects at launch. Until then they have to be actual images —
 * a flat gradient reads as a missing asset, whereas a composed scene reads
 * as a film — so each genre gets a procedurally drawn one: sky, light
 * source, layered silhouettes fading into haze, vignette, grain.
 *
 * Everything is generated locally. No network, no model, no API key: an SVG
 * per genre, screenshotted by the Chromium already on the box, then squeezed
 * to WebP.
 *
 *   node scripts/make-genre-stills.mjs
 *
 * Output: public/genres/<slug>.webp
 */
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "public", "genres");
const TMP = join(HERE, "..", ".genre-tmp");
const W = 640;
const H = 360;

const CHROME =
  process.env.CHROME_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

/** Deterministic RNG, so a re-run produces byte-identical art. */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// ---------------------------------------------------------------- layers

/** Ridge line across the frame at `base` height, roughness by `amp`. */
function ridge(rand, base, amp, steps = 14) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const x = (i / steps) * W;
    const y = base + (rand() - 0.5) * amp - Math.sin((i / steps) * Math.PI) * amp * 0.5;
    pts.push(`${x.toFixed(0)},${y.toFixed(0)}`);
  }
  return `M-10,${H + 10} L${pts.join(" L")} L${W + 10},${H + 10} Z`;
}

function ridges(rand, colors, base) {
  return colors
    .map((c, i) => {
      const y = base + i * ((H - base) / (colors.length + 0.6));
      return `<path d="${ridge(rand, y, 46 - i * 8)}" fill="${c}"/>`;
    })
    .join("");
}

function skyline(rand, color, base, lit) {
  let out = "";
  let x = -20;
  while (x < W + 20) {
    const w = 18 + rand() * 46;
    const h = 40 + rand() * 150;
    const y = base - h;
    out += `<rect x="${x.toFixed(0)}" y="${y.toFixed(0)}" width="${w.toFixed(0)}" height="${(h + 40).toFixed(0)}" fill="${color}"/>`;
    // lit windows
    for (let wy = y + 8; wy < base - 6; wy += 11) {
      for (let wx = x + 4; wx < x + w - 5; wx += 9) {
        if (rand() > 0.55)
          out += `<rect x="${wx.toFixed(0)}" y="${wy.toFixed(0)}" width="3" height="4" fill="${lit}" opacity="${(0.35 + rand() * 0.6).toFixed(2)}"/>`;
      }
    }
    x += w + 3 + rand() * 8;
  }
  return out;
}

function road(color, line) {
  const hz = H * 0.52;
  return (
    `<path d="M${W * 0.5 - 8},${hz} L${W * 0.5 + 8},${hz} L${W * 1.35},${H} L${-W * 0.35},${H} Z" fill="${color}"/>` +
    [0.62, 0.74, 0.88].
      map((t) => {
        const y = hz + (H - hz) * t;
        const w = 2 + t * 9;
        return `<rect x="${(W * 0.5 - w / 2).toFixed(1)}" y="${y.toFixed(0)}" width="${w.toFixed(1)}" height="${(6 + t * 12).toFixed(0)}" fill="${line}" opacity="0.8"/>`;
      })
      .join("")
  );
}

function stars(rand, n = 90) {
  let out = "";
  for (let i = 0; i < n; i++) {
    const x = rand() * W;
    const y = rand() * H * 0.72;
    const r = rand() * 1.3 + 0.25;
    out += `<circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${r.toFixed(2)}" fill="#fff" opacity="${(0.25 + rand() * 0.7).toFixed(2)}"/>`;
  }
  return out;
}

function shafts(rand, color) {
  let out = "";
  for (let i = 0; i < 7; i++) {
    const x = rand() * W;
    const w = 26 + rand() * 70;
    out += `<path d="M${x.toFixed(0)},-20 L${(x + w).toFixed(0)},-20 L${(x + w * 2.4).toFixed(0)},${H} L${(x + w * 0.9).toFixed(0)},${H} Z" fill="${color}" opacity="${(0.05 + rand() * 0.1).toFixed(3)}"/>`;
  }
  return out;
}

function trunks(rand, color, n = 11) {
  let out = "";
  for (let i = 0; i < n; i++) {
    const x = rand() * W;
    const w = 6 + rand() * 22;
    out += `<rect x="${x.toFixed(0)}" y="${(-20 + rand() * 40).toFixed(0)}" width="${w.toFixed(0)}" height="${H + 40}" fill="${color}" opacity="${(0.55 + rand() * 0.45).toFixed(2)}"/>`;
  }
  return out;
}

function plumes(rand, color) {
  let out = "";
  for (let i = 0; i < 6; i++) {
    const cx = rand() * W;
    const cy = H * (0.3 + rand() * 0.3);
    const r = 40 + rand() * 90;
    out += `<ellipse cx="${cx.toFixed(0)}" cy="${cy.toFixed(0)}" rx="${r.toFixed(0)}" ry="${(r * 0.62).toFixed(0)}" fill="${color}" opacity="${(0.16 + rand() * 0.22).toFixed(2)}"/>`;
  }
  return out;
}

// ---------------------------------------------------------------- genres

const SCENES = {
  nature: { sky: ["#8fc9e8", "#cfe6c4"], sun: ["#fff6d8", 0.32, 0.3], type: "ridges", cols: ["#5d8f5a", "#3d6b41", "#27492e", "#16301f"] },
  mountains: { sky: ["#9ec7d8", "#e6eef2"], sun: ["#ffffff", 0.7, 0.22], type: "ridges", cols: ["#7ea0b0", "#547080", "#33505e", "#12242b"] },
  desert: { sky: ["#f3d9a4", "#e8a765"], sun: ["#fff1c9", 0.5, 0.34], type: "ridges", cols: ["#d9a866", "#b8834a", "#8a5d33", "#2a1a0f"] },
  coast: { sky: ["#ffc27a", "#e2705a"], sun: ["#fff3cf", 0.42, 0.46], type: "sea", cols: ["#c76a55", "#8d4547", "#231218"] },
  history: { sky: ["#e8cf9a", "#a98a5c"], sun: ["#fff0c2", 0.62, 0.26], type: "ridges", cols: ["#b39463", "#8a6f44", "#5e4a2c", "#241a0f"] },
  documentary: { sky: ["#cfc9bd", "#8f8779"], sun: ["#ffffff", 0.3, 0.2], type: "skyline", cols: ["#3a352d", "#1d1a16"], lit: "#e8dcc0" },
  "scifi-city": { sky: ["#7d5bd0", "#2a2f66"], sun: ["#ffd9f2", 0.68, 0.3], type: "skyline", cols: ["#232a5c", "#0d1230"], lit: "#8fd8ff" },
  cyberpunk: { sky: ["#3a1f5c", "#0a0a24"], sun: ["#ff5fa2", 0.28, 0.26], type: "skyline", cols: ["#241a4a", "#0a0a24"], lit: "#ff7ac4" },
  racing: { sky: ["#28407a", "#101a33"], sun: ["#ffe1a8", 0.74, 0.2], type: "road", cols: ["#1b2440", "#e8e2d0"] },
  rally: { sky: ["#c9cfd4", "#7d868c"], sun: ["#ffffff", 0.4, 0.28], type: "road", cols: ["#4a5257", "#d8dde0"] },
  space: { sky: ["#3a1c12", "#a8683c"], sun: ["#ffd9a8", 0.28, 0.24], type: "ridges", cols: ["#8c4f2c", "#6b3a22", "#402015", "#20120d"] },
  orbit: { sky: ["#050a18", "#0d1c3a"], sun: ["#bfe4ff", 0.76, 0.16], type: "space", cols: ["#2c6ea8", "#0b2betc"] },
  underwater: { sky: ["#3fa8cf", "#062231"], sun: ["#d9f5ff", 0.44, 0.2], type: "underwater", cols: ["#0b3f57"] },
  war: { sky: ["#8a6a45", "#3a2a1c"], sun: ["#ffb15e", 0.34, 0.3], type: "war", cols: ["#2b2015", "#14100c"] },
  horror: { sky: ["#4a5f4e", "#0a0f0b"], sun: ["#cfe6c9", 0.6, 0.18], type: "forest", cols: ["#0d140e"] },
  kids: { sky: ["#ffd9a0", "#f0927e"], sun: ["#fff6e0", 0.3, 0.36], type: "ridges", cols: ["#e39a86", "#b96f78", "#7d4668", "#4a2a4e"] },
};

function svgFor(slug) {
  const s = SCENES[slug];
  const rand = rng(
    [...slug].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7),
  );
  const [c0, c1] = s.sky;
  const [sunCol, sunX, sunY] = s.sun;
  const horizon = H * 0.52;

  let body = "";
  if (s.type === "ridges") body = ridges(rand, s.cols, horizon);
  else if (s.type === "skyline")
    body = skyline(rand, s.cols[0], horizon + 30, s.lit) +
      `<rect x="0" y="${horizon + 60}" width="${W}" height="${H}" fill="${s.cols[1]}"/>`;
  else if (s.type === "road")
    body = road(s.cols[0], s.cols[1]) +
      `<rect x="0" y="${horizon}" width="${W}" height="4" fill="#000" opacity="0.35"/>`;
  else if (s.type === "sea")
    body =
      `<rect x="0" y="${horizon}" width="${W}" height="${H - horizon}" fill="${s.cols[0]}"/>` +
      [0.1, 0.3, 0.55, 0.85]
        .map((t) => {
          const y = horizon + (H - horizon) * t;
          return `<rect x="0" y="${y.toFixed(0)}" width="${W}" height="${(3 + t * 9).toFixed(0)}" fill="#fff" opacity="${(0.16 - t * 0.11).toFixed(3)}"/>`;
        })
        .join("") +
      `<path d="${ridge(rand, horizon - 6, 26)}" fill="${s.cols[1]}" opacity="0.9"/>`;
  else if (s.type === "space")
    body =
      stars(rand) +
      `<circle cx="${W * 0.5}" cy="${H * 1.35}" r="${W * 0.72}" fill="#12406e"/>` +
      `<circle cx="${W * 0.5}" cy="${H * 1.35}" r="${W * 0.72}" fill="none" stroke="#9fd6ff" stroke-width="3" opacity="0.7"/>`;
  else if (s.type === "underwater")
    body =
      shafts(rand, "#dff6ff") +
      `<ellipse cx="${W * 0.58}" cy="${H * 0.62}" rx="150" ry="52" fill="${s.cols[0]}" opacity="0.9"/>` +
      stars(rand, 40);
  else if (s.type === "war")
    // Blurred, or the plumes read as a pile of circles rather than smoke.
    body =
      `<g filter="url(#soft)">${plumes(rand, "#e8955a")}${plumes(rand, "#2a2018")}</g>` +
      `<path d="${ridge(rand, H * 0.72, 34)}" fill="${s.cols[0]}"/>` +
      `<path d="${ridge(rand, H * 0.86, 22)}" fill="${s.cols[1]}"/>`;
  else if (s.type === "forest") body = trunks(rand, s.cols[0]);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs>
  <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${c0}"/><stop offset="1" stop-color="${c1}"/>
  </linearGradient>
  <radialGradient id="sun" cx="${sunX}" cy="${sunY}" r="0.55">
    <stop offset="0" stop-color="${sunCol}" stop-opacity="0.95"/>
    <stop offset="0.35" stop-color="${sunCol}" stop-opacity="0.28"/>
    <stop offset="1" stop-color="${sunCol}" stop-opacity="0"/>
  </radialGradient>
  <!-- Gentle: the palettes already go near-black at the foot of the frame,
       and a strong vignette on top of that turned the bottom third into a
       dead band. -->
  <radialGradient id="vig" cx="0.5" cy="0.5" r="0.8">
    <stop offset="0.6" stop-color="#000" stop-opacity="0"/>
    <stop offset="1" stop-color="#000" stop-opacity="0.34"/>
  </radialGradient>
  <filter id="soft"><feGaussianBlur stdDeviation="14"/></filter>
  <filter id="grain"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2"/>
    <feColorMatrix type="saturate" values="0"/></filter>
</defs>
<rect width="${W}" height="${H}" fill="url(#sky)"/>
<rect width="${W}" height="${H}" fill="url(#sun)"/>
${body}
<rect width="${W}" height="${H}" fill="url(#vig)"/>
<rect width="${W}" height="${H}" filter="url(#grain)" opacity="0.06"/>
</svg>`;
}

// ---------------------------------------------------------------- render

const slugs = Object.keys(SCENES);
mkdirSync(OUT, { recursive: true });
mkdirSync(TMP, { recursive: true });

for (const slug of slugs) {
  const html = join(TMP, `${slug}.html`);
  const png = join(TMP, `${slug}.png`);
  writeFileSync(
    html,
    `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:#000}svg{display:block}</style>${svgFor(slug)}`,
  );
  execFileSync(
    CHROME,
    [
      "--headless",
      "--disable-gpu",
      "--no-sandbox",
      "--hide-scrollbars",
      `--window-size=${W},${H}`,
      `--screenshot=${png}`,
      "--virtual-time-budget=2500",
      `file://${html}`,
    ],
    { stdio: "ignore" },
  );
  if (!existsSync(png)) throw new Error(`Chromium produced nothing for ${slug}`);
  process.stdout.write(`drew ${slug}\n`);
}

// PNG → WebP. sharp is a devDependency of this script only; if it is not
// installed the PNGs are left in place and can be converted by hand.
let sharp = null;
try {
  ({ default: sharp } = await import("sharp"));
} catch {
  console.error("sharp not installed — leaving PNGs in .genre-tmp/");
  process.exit(0);
}
for (const slug of slugs) {
  await sharp(join(TMP, `${slug}.png`))
    .webp({ quality: 82 })
    .toFile(join(OUT, `${slug}.webp`));
}
rmSync(TMP, { recursive: true, force: true });
console.log(`\n${slugs.length} stills written to public/genres/`);
