# "Scene review lags and blocks" (2026-09-20)

The producer: *"cand incerc sa ma uit la scene pe site … are mult lag … dau
play apare ca isi da load si ori se blocheaza ori isi da load mai greu decat
reluează, se intersectează și se blochează."*

Status: **DIAGNOSED AND FIXED**, site-only. Two changes, both in `platform/`;
no n8n change, no schema change, no backfill.

## What it was NOT

Worth writing down, because both were the obvious guesses and both are wrong:

* **Not too many players.** `SceneBoard` mounts exactly one `MediaPlayer`, for
  the active scene. `ProjectsGrid` mounts one hover preview; `RoughCut` one
  clip. Nothing renders a wall of `<video preload>` elements.
* **Not the clip.** Every scene clip has been kept on the box since the
  cutover — 48 of 48 on the film under review — and the board already prefers
  that copy (`storedVideoUrl ?? videoUrl`). Caddy serves it with
  `immutable`.

## What it was, measured

A scene preview is TWO media elements: the clip (silent since the render
started mixing narration at assembly time) and the voiceover laid over it.

| request | latency | answer |
|---|---|---|
| local clip, `bytes=0-262143` | **25 ms** | 206, `public, max-age=31536000, immutable` |
| local clip, seek to `bytes=100000-200000` | **29 ms** | 206 |
| Drive voiceover, `bytes=0-262143` | **1383 ms** | 206 (whole file, 40,586 B) |
| Drive voiceover, second range | **730 ms** | 416 |
| Drive voiceover, third range | **593 ms** | 416 |

(The two 416s are an artefact of the probe — the take is only 40 KB and the
ranges asked past its end — so they measure the ROUND TRIP, not the transfer.
That is the number that matters here: even saying "no" costs Drive 0.6 s.)

And the reason the voiceover is on Drive at all:

```
hov.attachment by field:  image 850 | video 775 | image_version 60
```

There is no audio field. `/api/media/ingest` accepts `image`, `video`,
`image_version`, `sheet` — never a take. So on the film under review:
**48 of 48 scenes have a local clip, 48 of 48 voiceovers are on Google Drive,
0 have a local copy.**

### The amplifier, which is what made it *block*

Slow audio alone would be a slow start. What made it collide was
`MediaPlayer`'s drift correction:

```js
const sync = () => {
  if (Math.abs(a.currentTime - v.currentTime) > 0.15) a.currentTime = v.currentTime;
};
v.addEventListener("timeupdate", sync);   // fires ~4x a second
```

Setting `currentTime` on an audio element is a SEEK. So: the take drifts past
0.15 s → seek → a fresh Drive range request costing 0.6–1.4 s → the audio
produces nothing while it waits → the drift is now larger than it was → the
next `timeupdate`, 250 ms later, seeks again. The audio can never catch up,
and the video is dragged along by an element that is permanently re-buffering.

`/api/media` sealed it by marking every 206 `private, no-store`: nothing was
ever reused, so playing the same scene twice paid Drive twice.

0.15 s is also tighter than the media clock's own resolution — on a slow
source that loop could not have settled even in principle.

## The fix

**1. The player stops seeking** (`components/MediaPlayer.tsx`). Hard sync only
at the deliberate moments — pressing play, and the producer scrubbing.
Ordinary drift is taken out with `playbackRate` (±6%, inaudible, free), which
closes a 0.9 s gap in about fifteen seconds without discarding a single
buffered byte. One hard seek survives as a last resort: drift over 1 s, and at
most one every 3 s. `waiting`/`stalled` on the audio resets the rate rather
than correcting, because correcting a source that is already out of bytes is
exactly what went wrong. The audio element is also `preload="auto"` now — a
take is tens of kilobytes, so fetching it whole costs one request where
`metadata` left the browser to range its way through it.

**2. The proxy keeps what it fetches** (`app/api/media/route.ts`,
`lib/media-cache.ts`). A miss now asks Drive for the WHOLE file once — not the
requested range, because a range request would leave the cache empty and the
next seek would pay Drive again — writes it to `/media/_drive/<id>.bin`
atomically, and serves every request after that off the disk with real byte
ranges. Content-addressed by the Drive id, which is what makes `immutable`
honest: a Drive file id names one fixed set of bytes.

Files over `MAX_CACHE_BYTES` (96 MB) are not kept — a finished film is watched
once or twice and would spend the media volume on the one case that does not
benefit — and fall back to the streaming behaviour this route always had. A
cache write that fails (full volume, read-only mount) is not an error: the
bytes are already in hand and get served from memory that once.

## Why not the tidier fix

The structurally right answer is for a voiceover to be an attachment like its
clip and its still — `field: 'voice'` through `/api/media/ingest`, a
`storedVoiceUrl` beside `storedVideoUrl`. That is worth doing and is written
down as owed below. It is NOT what was done today because it would have healed
nothing that already exists: it needs three n8n write-back nodes changed and a
backfill over every film ever made, and until that backfill ran the producer's
current film would have lagged exactly as before. The disk cache fixes every
film, old and new, from the moment it deploys.

## Verified

`npm run check:media-range` — **33 checks** on the byte-range arithmetic,
which is the part of this that fails invisibly. An off-by-one there does not
look like an off-by-one; it looks like a clip that plays but will not seek, or
a take that stops a fraction early, or a 416 the player reports as a broken
file. It covers the ordinary forms, the open-ended form, the SUFFIX form
(`bytes=-500`, which is how a player reads an mp4's trailing moov atom and the
classic cause of "plays but never seeks"), clamping past the end, the exact
416 shape the probe hit, malformed input, one-byte files, and the
`Content-Length = end - start + 1` derivation.

Four deliberate mutations were injected to confirm the check is not vacuous:
an off-by-one clamp, a negative start from an oversized suffix, and an
accepted reversed range were all caught. The fourth — deleting the
`start >= size` guard — was NOT caught, and that is correct: the reversed-range
check already rejects those inputs, so the guard is redundant rather than the
test weak. It is kept for intent.

The check also caught a real one on the way in: `header.trim()` silently
accepted `bytes=0-10\n`. A CR or LF inside a header value is a smuggling
signature, never a real client, so control characters are now rejected rather
than eaten.

`npx next build` clean; `npm run check` green (386 checks across the suite).

## What is owed

- **Watch one scene play on the deployed site.** Everything above is measured
  at the transport layer and unit-tested; nobody has yet pressed play in the
  browser and seen the badge-free, stall-free version.
- **Give voiceovers a real attachment row** (`field: 'voice'`), so new films
  never touch Drive for playback at all, and backfill the existing ones. The
  cache makes this an optimisation rather than a fix, which is why it can wait
  for a quiet moment.
- `/media` is served by Caddy without the site password, so `_drive/` is
  reachable by anyone who knows a Drive file id. That is not new exposure —
  those files are already "anyone with the link" on Drive, which is how the
  proxy fetches them unauthenticated — but it is worth knowing before anything
  private is ever cached there.
- Nothing prunes `_drive/`. At a voiceover per scene it is kilobytes per film;
  if it ever matters, the directory is safe to delete wholesale and will
  refill itself.
