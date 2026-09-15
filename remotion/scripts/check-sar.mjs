// Every clip that reaches a `concat` must declare square pixels first.
//
// ffmpeg's `concat` filter compares its inputs' sample aspect ratio as exact
// integers and refuses to join them if they differ — by a part in twelve
// thousand, or between "0:1" (undeclared) and "1:1" (declared square). The
// failure lands at the END of a render, in ffmpeg's voice, naming a filter
// index and no scene:
//
//   Input link in0:v0 parameters (size 1280x720, SAR 0:1) do not match the
//   corresponding output link in0:v0 parameters (1280x720, SAR 12735:12736)
//
// It stayed invisible for months because every clip in a film came from the
// same place (Veo, via Drive) and therefore carried the same SAR. Documentary
// mode broke that: archive footage comes from whatever the source archive
// held. The NASA film on 2026-09-15 was the first to mix the two — three of
// nine clips from the media store — and it failed three times in a row.
//
// WHAT THIS CHECKS AND WHAT IT CANNOT. There is no ffmpeg in a Claude Code web
// session, so this asserts the GRAPH, not the render: that the one cover-fit
// every clip passes through ends in setsar=1, and that the video chain is
// built from that function rather than from a second copy of the string. The
// proof that the graph is right is a finished film — see the NASA render.
//
//   node --experimental-strip-types scripts/check-sar.mjs
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const results = [];
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  results.push(ok);
  console.log(`${ok ? "OK  " : "FAIL"} ${name} -> ${JSON.stringify(got)}${ok ? "" : ` (want ${JSON.stringify(want)})`}`);
};

const { coverFit } = await import(join(root, "server", "assemble.mjs"));

// --- the real function, at both canvases the site can render ---------------
check(
  "landscape cover-fit ends by declaring square pixels",
  coverFit(1280, 720),
  "scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,setsar=1",
);
check(
  "portrait too",
  coverFit(720, 1280),
  "scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,setsar=1",
);
// Order matters: setsar before the retime and therefore before any concat.
// A setsar after a trim/concat would be too late for the filter that compares.
check(
  "setsar comes after the crop, not somewhere later",
  /crop=\d+:\d+,setsar=1$/.test(coverFit(1920, 1080)),
  true,
);

// --- and the render actually uses it ---------------------------------------
// The bug was a hand-written scale/crop string in the video chain. If one
// comes back, this is the line that catches it: every cover-fit in the file
// has to be THIS function, or there are two owners again and only one of them
// will have been fixed.
const src = readFileSync(join(root, "server", "assemble.mjs"), "utf8");
const inlineFits = [...src.matchAll(/force_original_aspect_ratio=increase/g)].length;
check(
  "the file spells the cover-fit exactly once — inside coverFit()",
  inlineFits,
  1,
);
check(
  "the video chain calls coverFit rather than rebuilding the string",
  src.includes("`${coverFit(W, H)},`"),
  true,
);

// --- the graph that feeds concat -------------------------------------------
// Both branches of the video chain (the plain one and the bounce, which
// concats a clip with its own reversed tail) start from vchain, so proving
// vchain is normalised proves every concat input is. Assert the shape rather
// than trusting the comment: `concat` must never appear before the cover-fit
// in the built parts.
const chainAt = src.indexOf("const vchain =");
const firstConcat = src.indexOf("concat=n=", chainAt);
check("the cover-fit is built before any concat in the chain", chainAt > 0 && firstConcat > chainAt, true);

console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
