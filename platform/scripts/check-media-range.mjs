// Byte-range arithmetic for the media proxy — the one part of the playback
// fix that is easy to get subtly wrong.
//
//   npm run check:media-range
//
// An off-by-one here does not look like an off-by-one. It looks like a clip
// that plays but will not seek, or a voiceover that stops a fraction early,
// or a 416 the player reports as a broken file. The browser is the only thing
// that would ever notice, and it notices in the producer's hands.
//
// Context: db/port/scene-lag/ — scene review stalled because every range went
// to Google Drive (593-1383 ms) instead of the disk (~25 ms).
import { parseRange, MAX_CACHE_BYTES } from '@/lib/media-cache';

let pass = 0;
const fails = [];
const is = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) pass++;
  else fails.push(`${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};

const SIZE = 40586; // the real voiceover measured on the box

// ---- no range asked -------------------------------------------------------
is('no header', parseRange(null, SIZE), null);
is('empty header', parseRange('', SIZE), null);

// ---- the ordinary forms ---------------------------------------------------
is('first byte', parseRange('bytes=0-0', SIZE), { start: 0, end: 0 });
is('explicit window', parseRange('bytes=100-199', SIZE), { start: 100, end: 199 });
is('open-ended', parseRange('bytes=100-', SIZE), { start: 100, end: SIZE - 1 });
is('the whole file, spelled out', parseRange(`bytes=0-${SIZE - 1}`, SIZE), { start: 0, end: SIZE - 1 });
is('whitespace is tolerated', parseRange('  bytes=0-99  ', SIZE), { start: 0, end: 99 });

// ---- the suffix form, which players use to read a trailing atom -----------
// An mp4 written with the moov atom at the end is read this way, and getting
// it wrong is what makes a file "play but never seek".
is('last 500 bytes', parseRange('bytes=-500', SIZE), { start: SIZE - 500, end: SIZE - 1 });
is('suffix longer than the file clamps to the whole file', parseRange(`bytes=-${SIZE + 10}`, SIZE), { start: 0, end: SIZE - 1 });
is('suffix of zero is not a range', parseRange('bytes=-0', SIZE), null);

// ---- asking past the end --------------------------------------------------
// Serving what exists is what every static server does, and is what the
// browser expects; refusing would strand the last chunk of every file.
is('end past the file is clamped', parseRange(`bytes=100-${SIZE + 9999}`, SIZE), { start: 100, end: SIZE - 1 });
is('start past the file is unsatisfiable', parseRange(`bytes=${SIZE}-`, SIZE), null);
is('start well past the file is unsatisfiable', parseRange(`bytes=${SIZE + 5000}-${SIZE + 6000}`, SIZE), null);
// This is the exact shape that answered 416 from Drive while measuring:
// a 40,586-byte take asked for bytes 100000-200000.
is('the measured 416 case', parseRange('bytes=100000-200000', SIZE), null);

// ---- malformed input is never a range -------------------------------------
for (const bad of [
  'bytes=', 'bytes=-', 'bytes=abc-def', 'items=0-10', 'bytes=10-5',
  'bytes=0-10, 20-30', 'bytes=1.5-2', 'bytes=-1-2', 'bytes=0-10\n',
]) is(`rejected: ${JSON.stringify(bad)}`, parseRange(bad, SIZE), null);

// ---- a one-byte file, the degenerate case ---------------------------------
is('one byte, whole', parseRange('bytes=0-0', 1), { start: 0, end: 0 });
is('one byte, suffix', parseRange('bytes=-1', 1), { start: 0, end: 0 });
is('one byte, past the end', parseRange('bytes=1-', 1), null);

// ---- lengths the caller derives from it -----------------------------------
// Content-Length is end-start+1, and Content-Range is `start-end/size`. The
// inclusive end is the thing that gets dropped, so assert the derivation.
const len = (h, size) => { const r = parseRange(h, size); return r ? r.end - r.start + 1 : null; };
is('length of bytes=0-0', len('bytes=0-0', SIZE), 1);
is('length of bytes=0-262143 on a bigger file', len('bytes=0-262143', 2048670), 262144);
is('length of an open-ended range', len('bytes=40000-', SIZE), SIZE - 40000);
is('length of the whole file', len(`bytes=0-${SIZE - 1}`, SIZE), SIZE);

// ---- the cache ceiling ----------------------------------------------------
// A voiceover and a scene clip must be kept; a finished film must not be.
const MB = 1024 * 1024;
is('a voiceover is cached', SIZE < MAX_CACHE_BYTES, true);
is('a 2 MB scene clip is cached', 2 * MB < MAX_CACHE_BYTES, true);
is('a 200 MB film is not', 200 * MB < MAX_CACHE_BYTES, false);

if (fails.length) {
  console.error(`check:media-range — ${fails.length} FAILED`);
  for (const f of fails) console.error('  ' + f);
  process.exit(1);
}
console.log(`check:media-range — ${pass}/${pass} passed`);
