// The Ken Burns move on an archive still, checked without ffmpeg.
//
// The producer's report was "it zooms out on the archive photos, but it shakes
// while it does it". The shake is not a bug in our arithmetic — it is
// `zoompan` working exactly as documented. Every output frame it takes
//
//     w = trunc(iw / zoom)     an integer number of SOURCE pixels
//     x = trunc(<x expr>)      an integer offset in source pixels
//
// crops that rectangle and scales it to the output. So the move can only ever
// advance in whole source pixels. With the still blown up to 2x the canvas,
// one source pixel is HALF an output pixel, while the move itself is only
// about one output pixel per frame — so on any given frame the picture either
// did not move at all or jumped half a pixel. Irregularly. Twenty-four times a
// second. That reads as shake, and a pull-out shows it worst because the frame
// is being remagnified at the same time.
//
// This file simulates that integer arithmetic frame by frame and asserts the
// residue stays under a tenth of an output pixel. It is a model of ffmpeg, not
// ffmpeg — the box has ffmpeg and this environment does not — so what it pins
// is the REASONING: if someone lowers the supersample or rewrites the x
// expression, the numbers that justified those choices move, and this fails.
//
//   node scripts/check-kenburns.mjs

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const results = [];
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  results.push(ok);
  console.log(`${ok ? "OK  " : "FAIL"} ${name} -> ${JSON.stringify(got)}${ok ? "" : ` (want ${JSON.stringify(want)})`}`);
};
const under = (name, got, limit) => {
  const ok = got <= limit;
  results.push(ok);
  console.log(`${ok ? "OK  " : "FAIL"} ${name} -> ${got} (must be <= ${limit})`);
};

// The filter string is read from the module that builds it, so the constants
// under test are the ones production uses.
const src = readFileSync(join(root, "lib", "archive", "kenburns.ts"), "utf8");
const S = Number(/const KEN_BURNS_SUPERSAMPLE = (\d+)/.exec(src)?.[1]);
const Z = Number(/const KEN_BURNS_ZOOM = ([\d.]+)/.exec(src)?.[1]);
const FPS = 24; // attach.ts pins the clip's frame rate
check("the constants are readable", [Number.isFinite(S), Number.isFinite(Z), Number.isFinite(FPS)], [true, true, true]);

/** ffmpeg vf_zoompan, in miniature: everything that matters is an integer. */
function simulate({ W, H, seconds, pullOut, supersample, xExpr }) {
  const iw = W * supersample;
  const frames = Math.round(seconds * FPS);
  const centres = [];
  const mags = [];
  for (let on = 0; on < frames; on++) {
    const raw = pullOut ? Math.max(1 + Z - (Z * on) / frames, 1) : Math.min(1 + (Z * on) / frames, 1 + Z);
    const zoom = Math.min(10, Math.max(1, raw));
    const w = Math.trunc(iw / zoom);
    const x = xExpr(iw, zoom, w);
    // Where the centre of the OUTPUT lands in the source, and how many output
    // pixels one source pixel is worth this frame.
    centres.push(x + w / 2);
    mags.push(W / w);
  }
  let step = 0;
  let offset = 0;
  for (let i = 0; i < centres.length; i++) {
    offset = Math.max(offset, Math.abs(centres[i] - iw / 2) * mags[i]);
    if (i) step = Math.max(step, Math.abs((centres[i] - centres[i - 1]) * mags[i]));
  }
  // How far the picture's edge travels each frame. A smooth zoom moves it by
  // the same amount every frame; the SPREAD is the zoom speeding up and
  // slowing down, which is the larger half of what the eye reads as shake.
  const edge = [];
  for (let i = 1; i < mags.length; i++) edge.push(Math.abs(((mags[i] - mags[i - 1]) * W) / 2 / mags[i]));
  const spread = Math.max(...edge) - Math.min(...edge);
  return { step: +step.toFixed(3), offset: +offset.toFixed(3), spread: +spread.toFixed(3) };
}

const OLD_X = (iw, zoom) => Math.trunc(iw / 2 - iw / zoom / 2);
const NEW_X = (iw, zoom, w) => Math.trunc((iw - w) / 2);
const CASES = [
  { name: "an 8 s archive still", W: 1280, H: 720, seconds: 8 },
  { name: "a 3 s insert (the move is faster, so the steps are coarser)", W: 1280, H: 720, seconds: 3 },
  { name: "a vertical film", W: 720, H: 1280, seconds: 8 },
];

// A tenth of an output pixel. Below this nothing survives the encoder, let
// alone the eye; above it a pull-out on a detailed photograph crawls.
const LIMIT = 0.1;

console.log("\n--- what the old filter did (2x, independently rounded x) ---");
for (const c of CASES) {
  const r = simulate({ ...c, pullOut: true, supersample: 2, xExpr: OLD_X });
  console.log(`     ${c.name}: ${JSON.stringify(r)}`);
}
// This is the fault the producer saw, in numbers. On an 8 s still the centre
// jumped 0.28 output pixels between frames and sat up to 0.56 off centre, on a
// move that only travels about 0.38 px per frame — so more than half the
// apparent motion was the rounding rather than the zoom. Asserted rather than
// narrated so that "we fixed something that was not broken" cannot creep in
// later: if the old arithmetic were fine, this fails and the whole file is
// pointless.
const old8 = simulate({ ...CASES[0], pullOut: true, supersample: 2, xExpr: OLD_X });
console.log(`     (the limit below is ${LIMIT}px, so the old jump was ${(old8.step / LIMIT).toFixed(1)}x it and the old offset ${(old8.offset / LIMIT).toFixed(1)}x)`);
check("the old settings really were shaky, or there was nothing to fix", old8.step > LIMIT * 2 && old8.offset > LIMIT * 4, true);

console.log("\n--- what it does now ---");
for (const c of CASES) {
  for (const pullOut of [true, false]) {
    const r = simulate({ ...c, pullOut, supersample: S, xExpr: NEW_X });
    const dir = pullOut ? "pull out" : "push in";
    console.log(`     ${c.name}, ${dir}: ${JSON.stringify(r)}`);
    under(`${c.name}, ${dir} — the centre never jumps`, r.step, LIMIT);
    under(`${c.name}, ${dir} — nor drifts off centre`, r.offset, LIMIT);
  }
}

// Centring x on the crop width is free and helps on its own, so it must not be
// quietly dropped in favour of "just supersample more".
const sameS = { ...CASES[1], pullOut: true, supersample: S };
const withOldX = simulate({ ...sameS, xExpr: OLD_X });
const withNewX = simulate({ ...sameS, xExpr: NEW_X });
check("centring x on the real crop width beats rounding it separately", withNewX.offset < withOldX.offset, true);

// There is no knee — the residue falls as 1/S — so the number has to be
// justified as a THRESHOLD: the smallest supersample that passes. This is what
// stops it being lowered to save time, and equally what stops it being raised
// to 12x on a hunch, since each step costs an intermediate frame.
const worstAt = (S) => {
  let worst = 0;
  for (const c of CASES) for (const pullOut of [true, false]) {
    for (let seconds = 3; seconds <= 20; seconds += 0.5) {
      const r = simulate({ ...c, seconds, pullOut, supersample: S, xExpr: NEW_X });
      worst = Math.max(worst, r.step, r.offset);
    }
  }
  return +worst.toFixed(3);
};
check(`${S}x is enough across every clip length the picker allows`, worstAt(S) <= LIMIT, true);
check(`and ${S - 1}x would not be — it is the smallest that passes`, worstAt(S - 1) > LIMIT, true);

// And the filter that actually runs says what we think it says.
const mod = await import(join(root, "lib", "archive", "kenburns.ts"));
const f = mod.kenBurnsFilter(1280, 720, 192, true, FPS);
check("the graph supersamples before zoompan", f.includes(`scale=${1280 * S}:${720 * S}`), true);
check("x and y are centred on the truncated crop", [f.includes("x='trunc((iw-trunc(iw/zoom))/2)'"), f.includes("y='trunc((ih-trunc(ih/zoom))/2)'")], [true, true]);
check("a pull-out starts wide and settles at 1", f.includes(`max(${(1 + Z).toFixed(3)}-${Z}*on/192,1)`), true);
check("and it still hands back the canvas size", f.includes("s=1280x720"), true);
// A stored clip whose pixel aspect is not square cannot be concat'd with the
// film's other clips — the failure is at the END of an hour-long render, in
// ffmpeg's voice, and names no scene. See the NASA film, 2026-09-15.
check("every frame it writes declares square pixels", f.includes("setsar=1"), true);

console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
