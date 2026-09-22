# Scroll-scrub hero — isolated prototype

A standalone Next.js (App Router, TypeScript) app: a hero that draws a WebP
frame sequence onto a `<canvas>`, scrubbed by the scroll position, then an
examples section playing three finished films, then an empty test section.
No scroll library. It lives under `prototypes/` on purpose: nothing here is
under `platform/**` or `remotion/**`, so pushing it deploys nothing.

## Run it

```
cd prototypes/scroll-hero
npm install
npm run frames      # regenerates the sequence (110 frames, poster, manifest)
npm run frames -- 48   # …or any other length
npm run media       # placeholder clips for the examples section
npm run build && npm run start
```

- `npm test` — Playwright: scrubs the sequence, screenshots the first frame,
  the three quarter marks and the last one
  into `shots/`, checks the held-frame fallback, the idle nudge, and the two
  opt-outs. Uses the Chromium preinstalled at `/opt/pw-browsers/chromium`
  (set `PW_CHROMIUM` to point elsewhere).
- `npm run lighthouse` — Lighthouse against the running server; reports land
  in `lighthouse/`, summary printed as a table.

## Files

| File | What |
|---|---|
| `components/ScrollHero.tsx` | The whole mechanic. Client component, one `useEffect`. |
| `components/ExampleReel.tsx` | The examples section: three clips, one IntersectionObserver, and `EXAMPLES` — the one place the captions are edited. |
| `app/globals.css` | 200vh track + sticky 100vh stage; the opt-outs collapse it to 100vh in CSS. Then the examples, then the test section. |
| `app/page.tsx` | Hero + examples + the empty test section. |
| `scripts/make-frames.mjs` | Synthetic frames that print their own number (sharp), plus the poster and `manifest.json`. Takes the count: `npm run frames -- 48`. Swap in real frames with the same names. |
| `scripts/make-media.mjs` | Placeholder clips under `public/media`, recorded from a canvas by Chromium's MediaRecorder (there is no ffmpeg here). Same file names as the real films, spaces and all. |
| `tests/hero.spec.ts` | Playwright checks listed above. |
| `scripts/lighthouse.mjs` | Mobile run (Lighthouse default: slow 4G, 4× CPU) and a desktop run with the same slow-4G simulation. |

## How the constraints are met

- **Canvas, not `<video>`** — frames are `HTMLImageElement`s decoded with
  `img.decode()` and drawn with `drawImage` in object-fit: cover geometry.
- **Poster first, then 20 frames, then the rest** — `/frames/poster.webp` is
  in the server-rendered HTML with `fetchpriority="high"` and a `<link rel="preload">`.
  Frames 1–20 fetch in parallel; the canvas becomes visible only in the same
  animation frame as its first draw, so there is no blank canvas between the
  poster and the sequence. The rest load one at a time, in order.
- **Hold, never jump** — the drawn index is the highest loaded index at or
  below the scroll target (`resolveIndex`). Each frame that finishes loading
  requests a redraw, so a held scroll position catches up by itself.
- **rAF only, one draw, deduped** — `tick()` is the only place that draws; it
  is scheduled at most once per animation frame (`schedule()`), and returns
  before drawing when the resolved index equals the last one drawn. The
  scroll listener is `{ passive: true }` and only calls `schedule()`.
- **DPR cap 2, ResizeObserver** — the canvas bitmap is `stage × min(dpr, 2)`;
  the observer watches the sticky stage, marks the size dirty, and the next
  tick resizes and redraws. No `resize` event listener.
- **Reduced motion / under 768px** — the CSS already collapses the section
  to 100vh and hides the canvas for both media queries, so the layout is
  right before hydration. The script reads the same two queries and never
  starts loading; a `change` on either query switches mode live.
- **Idle nudge** — 2 s after the first draw, if no real scroll has happened
  and the target is frame 0, the index eases +4 (450 ms out) and back
  (1100 ms), then re-arms for the next idle window. The first scroll event
  that moves `scrollY` cancels it for the life of the page.
- **Vanilla** — no GSAP, Lenis, or scroll library. Dependencies: Next, React.
- **The copy over the film** — fixed nav, and a title block at 10% in from
  the bottom-left corner. Scrim and words live in one layer and fade as one
  thing on raw scroll progress, gone by 60% of the scrub; a dark corner with
  no text in it would be worse than no scrim. The nav does not fade: a hero
  that scrubs away should still leave a way out. The fade is written in the
  same rAF tick that draws, before the frame-index dedupe, so it eases
  continuously instead of stepping once per frame.
- **The outro** — over the last 10% of the scrub the film crossfades into
  the colour the first content section is painted in, so that section arrives
  out of the film rather than after it. One opacity on one full-stage
  overlay: no transform, nothing to lay out, nothing to scale. The colour has
  a single owner, `--content-bg` on `:root`, read by both the overlay and the
  section, so the join cannot drift into a visible seam.
- **Typeface** — Bricolage Grotesque, variable, one family for everything,
  self-hosted by `next/font` at build time into `.next/static`. No runtime
  request to Google and no layout shift. The `latin-ext` subset is not
  optional: without it "temă" and "platformă" break mid-word to a fallback.
- **The length is not compiled in** — `/frames/manifest.json` (`{"count": 110}`)
  is uploaded with the frames and read at startup, so re-cutting the sequence
  needs no rebuild. The request starts in parallel with the poster and is
  awaited inside the poster-decode gate, so it costs no latency, and the count
  is settled before the first draw — the scroll-to-frame mapping never shifts
  under the viewer. A missing or malformed manifest falls back to
  `FALLBACK_FRAME_COUNT` in `ScrollHero.tsx`; keep that constant equal to what
  is on the box. A bad count is refused rather than coerced: `"110"`, `0` and
  `1e9` all fall back, because guessing would scrub through frames that do not
  exist.

`data-state` (`idle` / `loading` / `ready` / `static`), `data-frame`,
`data-loaded` and `data-count` on the `<section>` exist for the tests; they
are cheap attribute writes and can go when the mechanic moves into the site.

## Results (2026-09-20, production build, preinstalled Chromium)

**Playwright** — 16 of 16 passing. `shots/frame-000.png` … `frame-109.png` show
frames 0001, 0028, 0056, 0083 and 0110 at the five scroll checkpoints;
`held-at-19.png` shows frame 0020 held with frames 21+ stalled at the
network layer; `after-hero.png` is the examples arriving under the hero;
`mobile.png` and `reduced-motion.png` are poster-only; `outro-090.png` …
`outro-100.png` walk the crossfade at the end; `examples-playing.png`,
`examples-mobile.png` and `examples-reduced-motion.png` are the section.

**The suite used to test whatever was last built.** `webServer.command` was
`npm run start` under a comment claiming it built first, with
`reuseExistingServer: true` — so a run would start (or reuse) a server
holding an older `.next` and pass cheerfully against it. That is how a first
run of the examples tests reported eight failures whose real cause was that
the section was not in the build. It now runs `npm run build && npm run
start` and refuses to reuse a server it did not start.

**A shot named after a frame lifts the outro overlay, and only that shot.**
The overlay is fully opaque at 100% of the scrub, which is where the
last-frame checkpoints sit — so `frame-109` and `held-at-19` came back as a
flat fill the moment the crossfade landed. That is right on screen and
useless as evidence: `held-at-19` exists to prove the canvas is never blank,
and a flat fill is exactly what blank looks like. `shootFrame()` in the spec
suppresses the overlay for those; the crossfade keeps its own three shots.

The outro, measured rather than described:

| through the scrub | overlay opacity |
|---|---|
| 0% | 0.00 |
| 50% | 0.00 |
| 90% | 0.00 |
| 95% | 0.50 |
| 100% | 1.00 |

The test also asserts the overlay's computed `transform` is still `none`,
so the effect cannot quietly grow a second mechanism, and that the section
below resolves to the same colour.

| Transfer (desktop, whole sequence) | |
|---|---|
| frames | 1438 kB (110 requests) |
| poster | 12 kB |
| JS + CSS + HTML + webfont | 168 kB |
| **total** | **1.58 MB** of the 3 MB budget |

The example films are counted and printed beside that total, never added
into it: they are streamed on demand, and one of them on its own is a
hundred times the whole budget. A budget that quietly absorbs video stops
meaning anything.

The frames above are synthetic gradients at ~13 kB each, which is why that
total looks comfortable. **It is not what the real sequence costs.**

## The examples section

Three films under the hero, each near the full width, one under the other on
every screen width — there is no second column for a phone to fall back
from, because all three are horizontal.

- **Nothing is fetched until a clip is on screen.** `preload="none"` on the
  elements, and one `IntersectionObserver` starts a clip at a quarter
  visible and pauses it when it leaves. Measured: at page open, zero
  requests to `/media/`; after scrolling the first clip into view, exactly
  one file has been asked for and the third is still at `readyState: 0`.
- **There is deliberately no `autoplay` ATTRIBUTE.** It means "start as soon
  as you can", which makes the browser begin loading at once and throws away
  the point of `preload="none"`. The observer does the starting; the clips
  are `muted` + `playsInline` so a browser grants it without a click. The
  test asserts the attribute is absent, so nobody "fixes" this back.
- **A playing clip is many requests, not one.** It is streamed in ranges —
  one clip produced five. An early version of the test counted requests and
  read one playing film as three loading ones.
- **The caption is theme · duration · platform**, and the duration comes off
  the file: `EXAMPLES` carries the value measured on the box so the line is
  right before anything loads, and `loadedmetadata` overrides it. That is
  visible in the shots — the reduced-motion one reads `1:39`, the real
  film's length, because it never loaded; the playing one reads `0:04`, the
  placeholder's.
- **Theme and platform are placeholders**, taken from the file names, which
  is all this prototype knows about the films. One constant, `EXAMPLES` in
  `components/ExampleReel.tsx`, is the only place to edit them.
- **`prefers-reduced-motion: reduce` gets no moving picture**, and gets the
  controls back in exchange — without them there would be no way left to
  watch a film at all.

### What the three files actually are (measured 2026-09-20)

Read off the real files on the box, by HTTP probes from n8n (a Claude web
session has no outbound HTTP of its own), including the mp4 headers:

| file | size | duration | `moov` |
|---|---|---|---|
| `kidsstory.mp4` | 56.4 MB | 1:39 | at byte 36 — streams immediately |
| `m8 .mp4` | 3.3 MB | 0:08 | at the END — the browser must fetch the tail first |
| `roman empire.mp4` | 321.3 MB | 6:41 | at byte 36 |

Two things follow, neither of them fixable in this code:

**321 MB is not a web clip.** At 6:41 it is ~6.4 Mbps, and `loop` means a
visitor who leaves the tab open keeps pulling it. `kidsstory` is ~4.6 Mbps.
The section is built so only what is on screen streams, which is the best
the page can do — the rest is an encode: 1280×720 at ~1.5 Mbps with
`-movflags +faststart`, or better for a showcase, a 10–20 second excerpt of
each, which lands around 2–4 MB apiece. There is no ffmpeg in this
environment; the Railway render server has one.

**`m8 .mp4` has its `moov` atom at the end**, so a browser has to fetch the
file's tail before it can start. At 3.3 MB that is one extra round trip and
no more, but the same file at 300 MB would be unplayable. `+faststart` is
the same one-line fix.

### The clips 404 on site-dev until Caddy is told about them

They answer 200 on `house-of-videos.com/media/...` and **404 on
`dev.house-of-videos.com/media/...`**: that host's Caddy block routes
`/frames/*` and nothing else, so `/media/...` falls through to Next. The
block that fixes it is in `infra/Caddyfile` in this repo, but **applying it
needs a key on the box** — `docker compose up -d caddy` in `/opt/n8n`, not a
reload. Until then the section renders black. See `infra/README.md`.

Locally the same paths are served from `public/media`, which `npm run media`
fills with 4-second placeholders — recorded from a canvas by Chromium's
MediaRecorder, since there is no ffmpeg here. They carry the real names,
spaces and all, so the URL encoding is exercised: `m8 .mp4` has to leave as
`m8%20.mp4`, and the test asserts exactly that.

### The real sequence is well over the 3 MB budget (re-measured 2026-09-18)

The cut is 110 frames now, not 72, and it is already on the box. Every
frame was weighed over HTTP:

| | |
|---|---|
| frames on disk | 110, none missing, 111 absent |
| smallest / mean / largest | 18.4 kB / 42.1 kB / 80.7 kB |
| all 110 frames | **4,746,592 B — 4.53 MiB** |
| poster | 41.8 kB |
| JS + CSS + HTML + webfont | ~168 kB |
| **hero total for a first visitor** | **~4.96 MB (4.73 MiB)** |

That is **65% over** the 3 MB budget, against 7% over when the cut was 72
frames. Adding 38 frames added ~1.7 MB, and the new ones are heavier: the
largest is 80.7 kB where the old sequence topped out at 61.6 kB.

Three levers, cheapest first, none of which need a code change:

1. **Re-encode at a lower WebP quality.** q≈70 typically takes 25–35% off
   with no visible change at 1600×900 behind a scrim. On its own that is
   ~3.2–3.6 MB — closer, still over.
2. **1280×720.** About 35% off, and the canvas scales it to fit anyway.
   Combined with the re-encode this lands comfortably inside the budget.
3. **Fewer frames.** The lever you just moved the other way, so probably
   the last one to reach for.

A note on the shape of the problem: at 110 frames the budget is no longer
something a single setting fixes. Either the frames get cheaper or the
budget moves; it is worth deciding which, because the sequence will keep
growing otherwise.

**Not yet measured: LCP with the real poster.** The Lighthouse figures
below were taken against the 11 kB placeholder poster; the real one is
41.8 kB, roughly 200 ms more on simulated 4G, which would put LCP near
2.3 s against the 2.5 s bar. Run `npm run lighthouse` with `URL` pointing
at the live host to get the true number.

### Legibility, measured rather than eyeballed

`shots/copy-000.png` … `copy-109.png` are the five frames at the scroll
positions asked for. Each one is measured, not just looked at: the test
screenshots the text region twice, with and without the words, and reads the
backdrop's luminance from the second.

| frame | copy opacity | backdrop luminance | contrast vs white |
|---|---|---|---|
| 0 | 1.00 | 0.015 | 16.2:1 |
| 20 | 0.69 | 0.027 | 13.6:1 |
| 40 | 0.39 | 0.036 | 12.3:1 |
| 60 | 0.08 | 0.050 | 10.5:1 |
| 109 | 0.00 | 0.065 | — faded out |

**Those numbers flatter the design, and one test says so.** This placeholder
sequence is dark, so the scrim is barely being asked to work. Replace the
film with pure white — brighter than any real frame — and the 60% scrim on
its own leaves the title at **1.8:1**, unreadable. Deepening the scrim
enough to fix that would take 82% black, which is a box, not a gradient.

What carries it instead is a tight dark ring at the glyph edge, the same
thing subtitles have always used: invisible on dark footage, decisive on
bright. `shots/copy-on-white.png` is that case, and the test measures each
element against its own WCAG bar — 3:1 for the title, which is large text,
4.5:1 for everything at body size:

| on a pure white frame | scrim alone | glyphs vs their halo | bar |
|---|---|---|---|
| title | 1.8:1 | 6.6:1 | 3:1 |
| subtitle | 2.2:1 | 5.8:1 | 4.5:1 |
| nav brand | 9.2:1 | 8.0:1 | 4.5:1 |
| nav links | 9.1:1 | 6.7:1 | 4.5:1 |

The nav was the weakest of the four and is the reason its wash is taller
than the bar itself: at the nav's own height the gradient had thinned to
~0.27 alpha exactly where the words sit, and the links were the first thing
a bright frame swallowed.

**Lighthouse** (`lighthouse/summary.json`, `lighthouse/*.html`):

| run | perf | a11y | best practices | SEO | FCP | LCP | TBT | CLS |
|---|---|---|---|---|---|---|---|---|
| mobile (Lighthouse default: slow 4G, 4× CPU, 412px → poster-only path) | 98 | 100 | 96 | 100 | 0.77 s | 2.13 s | 70 ms | 0 |
| desktop screen + same slow-4G simulation (canvas path, whole sequence) | 89 | 100 | 100 | 100 | 0.75 s | 2.11 s | 70 ms | 0 |

Measured with Caddy in front, the shape the box runs: frames and poster off
disk, everything else proxied to Next. **The webfont is what the headroom
went on**: mobile LCP was 1.77 s before the copy layer and is 2.13 s with
it, for ~60 kB of latin + latin-ext subsets competing with the poster on a
narrow pipe. Still inside the 2.5 s budget, and latin-ext is not droppable
— the copy is Romanian. **Expect noise on the desktop run.**
Of two consecutive runs one came back 87 with 64 ms of blocking time and the
other 76 with 285 ms, on identical code — Lighthouse, the server and Caddy
share one small box here. LCP and CLS were stable across both (2.29 s /
2.31 s, 0). Take the blocking-time figure as "tens of ms, sometimes a
few hundred", and re-run before believing a single number.

LCP is the poster `<img>` in both. The desktop-4G LCP is bound by the
simulated round trips (HTML → CSS → poster at 150 ms RTT), not by the
frames: they are fetched at Low priority and, since the last change, only
after the poster has decoded and painted. Before that gating the same run
scored 75 with 305 ms TBT — the 20-frame decode batch was landing on the
main thread at the moment of the LCP paint. Best-practices 96 on mobile is
Lighthouse flagging the missing `Content-Security-Policy` / HSTS headers,
which the prototype does not set.

## Deploy: the `site-dev` container on Hetzner

Same recipe as the producer's site, one size down:

| Piece | Where |
|---|---|
| Image | `Dockerfile` here → `ghcr.io/fermafabiz-lab/n8n/site-dev`, built by `.github/workflows/deploy-site-dev.yml` (trunk pushes touching `prototypes/scroll-hero/**`, or **Run workflow** by hand from any branch). The box never builds. |
| Service | `site-dev` in `/opt/n8n/docker-compose.yml` (mirror: `infra/docker-compose.yml`). `container_name: site-dev`, port 3000 on `n8n_net`, **no host port**. |
| Frames **and poster** | **Not in the image.** `.dockerignore` drops the whole of `public/`, and the Dockerfile therefore has no `COPY public` — the directory does not exist in the build context. Caddy mounts `/opt/n8n/frames` read-only at `/srv/frames` and answers `/frames/*` from it with `handle_path`, before anything reaches Next. The code asks for `/frames/frame_0001.webp` and `/frames/poster.webp` either way — locally Next serves them from `public/frames`, on the box Caddy does. |
| Who puts them there | **A person, with `scp`. No deploy touches them.** The sequence is content, not code: `scp prototypes/scroll-hero/public/frames/* root@<box>:/opt/n8n/frames/`. The workflow used to copy the repo's placeholders on every run, which overwrote the real ones; that step is gone and must not come back. |
| `manifest.json` | Goes up **with** the frames and says how many there are. Write it by hand for a real sequence: `{"count": 72}`. It is the only file in that directory whose contents change under the same name, so Caddy must not mark it `immutable` — the mirror's Caddyfile excludes it, and the hero asks for it with `no-store` so a stale copy cannot bite even if the box's config lags. |
| Caddy | `{$SITE_DEV_HOST}` block in `infra/Caddyfile`; `SITE_DEV_HOST` comes from `/opt/n8n/.env` through the caddy service's environment. |

### Live at https://dev.house-of-videos.com (2026-09-17 22:39 UTC)

Run #1 of the workflow went green end to end and created the container.
The box's compose file already carried a `site-dev` service, which this
repo's mirror did not know — see `infra/README.md` before editing it.

Verified from n8n (throwaway workflows, archived), inside the network and
then over the public URL:

| Request | Answer |
|---|---|
| `http://site-dev:3000/` | 200, the hero markup |
| `https://dev.house-of-videos.com/` | 200, same markup, `via: 1.1 Caddy` |
| `/frames/frame_0001.webp` | 200, `image/webp`, 11,766 B, immutable |
| `/frames/frame_0100.webp` | 200, `image/webp`, 12,492 B, immutable |
| `/frames/frame_0999.webp` | 404 from Caddy, **no** cache header |
| `/frames/frame_0001.webp` on the container itself | 404 — the frames are not in the image, by design |

The last two are the ones worth keeping: a missing frame is not cached for
a year, so a visit made before the frames landed does not keep failing
afterwards; and the container's own 404 proves `.dockerignore` kept the
frames out of the build context, so Caddy is what serves them.

### What is on the box right now (checked 2026-09-17 23:11 UTC)

The poster move needs no upload — **the real poster is already there**:

| File on the box | Size | Modified | What it is |
|---|---|---|---|
| `frames/poster.webp` | 42,804 B | 23:03 | a real image, uploaded by hand |
| `frames/frame_0001.webp` | 11,766 B | 22:36 | still this repo's placeholder |
| `frames/frame_0050.webp` | 13,514 B | 22:36 | still this repo's placeholder |
| `frames/frame_0100.webp` | 12,492 B | 22:36 | still this repo's placeholder |

**Deployed at 23:19 UTC and re-checked at 23:22 — the guarantee holds.**
Every file above came back byte-identical with its original timestamp, so
the deploy wrote nothing into that directory. And `/poster.webp`, which the
image used to answer, now returns 404 from Next: the poster really has left
the image, and the real one on disk is what the page loads.

That 404 is the check worth repeating after any change here. If the old
path ever answers 200 again, something put the poster back in the image.

### The box still holds a 100-frame placeholder sequence

The deploy of 22:36 left `frame_0001` … `frame_0100` there, from when the
workflow still copied them. The sequence is 72 now, so uploading the real
frames leaves **`frame_0073` … `frame_0100` behind as stale placeholders**.

They are harmless: without a `manifest.json` the hero uses the fallback
constant, 72, and never asks for a frame past that. But they are 28 files
of someone else's content sitting in a directory that is meant to be the
film, so clear the frames out before uploading the real ones:

```
ssh root@<box> 'rm -f /opt/n8n/frames/frame_*.webp'
scp frame_*.webp manifest.json root@<box>:/opt/n8n/frames/
```

**Note what each line does and does not touch.** The `rm` matches
`frame_*.webp` only, so the real `poster.webp` already on the box survives
it — and the upload names its files explicitly for the same reason: a bare
`scp public/frames/*` from this repo would put the 11 kB placeholder poster
over the real 42 kB one. Run the two in that order; between them the hero
shows its poster and no sequence, which is the "never blank" behaviour
rather than a failure.

Uploading `manifest.json` alongside is what makes the length data rather
than code — after that a re-cut is an upload and nothing else.

**Expect a mismatch in the meantime.** Until the real sequence is uploaded
next to that poster, the hero opens on a real image and then scrubs through
synthetic gradients. Nothing is broken; the two just come from different
places. Uploading the frames is what finishes it, and no deploy will
overwrite them.

## Notes for moving it into the site

- Frames stay as `HTMLImageElement`s on purpose. `createImageBitmap` would
  move decoding off the main thread, but pins 100 decoded bitmaps in memory
  (1600×900×4 B × 100 ≈ 576 MB), which kills a Safari tab. The browser's
  own image cache can evict and re-decode an `<img>`.
- The sticky stage is `100vh`, not `100svh`/`100dvh`; on iOS the bottom of
  the stage sits under the toolbar until it collapses. Mobile never scrubs,
  so this only affects how the poster is cropped.
- `Cache-Control: immutable` for `/frames/*` (the poster included) is set in
  `next.config.mjs` for local runs and by Caddy on the box. Keep the rule that
  only an existing file gets it, so a 404 is never cached for a year.
