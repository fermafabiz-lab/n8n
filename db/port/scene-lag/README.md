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

**2. ~~The proxy keeps what it fetches.~~ WITHDRAWN — see below.** The disk
cache was reverted the same hour. `/api/media` is byte-for-byte the version it
had before today.

### The cache failed twice and never once worked

Kept in full, because the failure is more useful than the feature would have
been.

**Attempt one** made the request that MISSED do the downloading: fetch the
whole file, write it, then answer. Invisible on a 40 kB voiceover — which is
every case the tests covered — and fatal on a film: the browser was sent
nothing at all until the server held the last byte, so a player that used to
stream from the first byte never started. The producer reported it as *"nu se
mai incarca deloc videoul intreg"*.

**Attempt two** moved the fill off the request path, which was the right
shape. It did not help, because the cache had never written anything at all.
Checked directly through Caddy, which serves the media volume:
`/media/_drive/<id>.json` answered **404 for every id tried** — a final video,
a voiceover, a second film. `writeCached` swallows its own failure by design
(a full volume must not cost a play), so it had been failing silently from the
first deploy, almost certainly on `mkdir` inside `/media`: the `web` container
runs with `group_add: "2000"` for write access to what already exists, which
is not the same as being able to create a new directory at the volume root.

So: two user-visible regressions, zero measured benefit, and a component that
has never functioned. It was removed rather than repaired. **The measured win
for scene review was the player fix alone** (no seek storm, `preload="auto"`),
which is what the producer confirmed working.

### And the cache header poisoned browsers on the way out

The withdrawn version answered `Cache-Control: private, max-age=31536000,
immutable` for twelve minutes. `immutable` tells a browser not to revalidate
*at all*, so any response a player received in that window — whole, truncated
or aborted — is pinned for a year, and a normal reload is precisely what
`immutable` says to skip. That is why the final video kept showing a spinner
after the fix deployed.

`mediaSrc` now appends `&v=2`. A different URL cannot match a poisoned entry,
so every player starts clean without anyone having to know about hard reloads.
Bump it again if this route ever ships a bad cache header again.

## What to do instead, when someone comes back to this

The structurally right answer is for a voiceover to be an attachment like its
clip and its still — `field: 'voice'` through `/api/media/ingest`, a
`storedVoiceUrl` beside `storedVideoUrl`. It writes through the path that has
worked for 850 images and 775 clips, under a directory that already exists and
is already writable, and it needs no new caching layer at all.

The disk cache was chosen over it because it promised to heal films that
already exist, where the attachment row needs three n8n write-back nodes
changed and a backfill before it helps anything. That reasoning was sound and
the execution was not: the thing that "heals everything immediately" healed
nothing, twice, in production. **Prefer the path that already works, even when
it is slower to arrive.**

## Verified

~~`npm run check:media-range`~~ — removed with the cache it covered. It was
**49 checks** on the byte-range arithmetic and the fill decision,
which is the part of this that fails invisibly. An off-by-one there does not
look like an off-by-one; it looks like a clip that plays but will not seek, or
a take that stops a fraction early, or a 416 the player reports as a broken
file. It covers the ordinary forms, the open-ended form, the SUFFIX form
(`bytes=-500`, which is how a player reads an mp4's trailing moov atom and the
classic cause of "plays but never seeks"), clamping past the end, the exact
416 shape the probe hit, malformed input, one-byte files, and the
`Content-Length = end - start + 1` derivation.

Seven deliberate mutations were injected to confirm the check is not vacuous.
Five were caught: an off-by-one clamp, a negative start from an oversized
suffix, an accepted reversed range, a `content-range` parsed as its slice
start rather than its total, and the cache ceiling raised past what fits in
memory. One — deleting the `start >= size` guard — was NOT caught, and that is
correct: the reversed-range check already rejects those inputs, so the guard is
redundant rather than the test weak, and it is kept for intent.

The seventh exposed a real gap and was fixed rather than explained away: a
`content-range` whose TOTAL is zero was treated as a size, and `0 <=
MAX_CACHE_BYTES` would have scheduled a fill for an empty file. Three
assertions now cover it, and the mutation is caught.

The check also caught a real one on the way in: `header.trim()` silently
accepted `bytes=0-10\n`. A CR or LF inside a header value is a smuggling
signature, never a real client, so control characters are now rejected rather
than eaten.

`npx next build` clean; `npm run check` green (386 checks across the suite).

## What is owed

- **Confirm the final video plays again.** The scenes were confirmed working
  by the producer; the final video is what the cache broke, and the revert
  plus the `v=2` bust have been verified by build but not yet by a play.
- If a local copy of voiceovers is ever wanted, do it as an attachment row
  (above), not as a proxy cache — and whatever the mechanism, **test it on a
  file the size of a film**, which is the one thing neither attempt did.
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
