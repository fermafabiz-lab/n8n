# Scroll-scrub hero — isolated prototype

A standalone Next.js (App Router, TypeScript) app with one thing in it: a
hero that draws a WebP frame sequence onto a `<canvas>`, scrubbed by the
scroll position, followed by an empty test section. No brand, no content,
no scroll library. It lives under `prototypes/` on purpose: nothing here is
under `platform/**` or `remotion/**`, so pushing it deploys nothing.

## Run it

```
cd prototypes/scroll-hero
npm install
npm run frames      # regenerates the sequence (72 frames, poster, manifest)
npm run frames -- 48   # …or any other length
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
| `app/globals.css` | 260vh track + sticky 100vh stage (100vh scrubs, 60vh opens the door); the opt-outs collapse it to 100vh in CSS. |
| `app/page.tsx` | Hero + the empty test section. |
| `scripts/make-frames.mjs` | Synthetic frames that print their own number (sharp), plus the poster and `manifest.json`. Takes the count: `npm run frames -- 48`. Swap in real frames with the same names. |
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
- **Walking through the door** — past the last frame, a div sized and placed
  over the lit doorway grows until it fills the stage, and the section below
  carries the same colour, so the hero does not end — it becomes the page.
  The rectangle is measured off the real footage and lives in the manifest
  (`door`), mapped through the canvas's own cover transform so it stays on
  the doorway at any viewport aspect. Scroll writes nothing but `transform`
  and `opacity`; the div's box is set on resize only, and the tick makes one
  layout read (`getBoundingClientRect`) and then only writes. Scale is
  exponential rather than linear, so apparent size grows at an even rate
  instead of crawling then lurching.
- **Typeface** — Bricolage Grotesque, variable, one family for everything,
  self-hosted by `next/font` at build time into `.next/static`. No runtime
  request to Google and no layout shift. The `latin-ext` subset is not
  optional: without it "temă" and "platformă" break mid-word to a fallback.
- **The length is not compiled in** — `/frames/manifest.json` (`{"count": 72}`)
  is uploaded with the frames and read at startup, so re-cutting the sequence
  needs no rebuild. The request starts in parallel with the poster and is
  awaited inside the poster-decode gate, so it costs no latency, and the count
  is settled before the first draw — the scroll-to-frame mapping never shifts
  under the viewer. A missing or malformed manifest falls back to
  `FALLBACK_FRAME_COUNT` in `ScrollHero.tsx`; keep that constant equal to what
  is on the box. A bad count is refused rather than coerced: `"72"`, `0` and
  `1e9` all fall back, because guessing would scrub through frames that do not
  exist.

`data-state` (`idle` / `loading` / `ready` / `static`), `data-frame`,
`data-loaded` and `data-count` on the `<section>` exist for the tests; they
are cheap attribute writes and can go when the mechanic moves into the site.

## Results (2026-09-18, production build, preinstalled Chromium)

**Playwright** — 10 of 10 passing. `shots/frame-000.png` … `frame-071.png` show
frames 0001, 0019, 0037, 0054 and 0072 at the five scroll checkpoints;
`held-at-19.png` shows frame 0020 held with frames 21+ stalled at the
network layer; `after-hero.png` is the test section filling the viewport;
`mobile.png` and `reduced-motion.png` are poster-only.

| Transfer (desktop, whole sequence) | |
|---|---|
| frames | 937 kB (72 requests) |
| poster | 11 kB |
| JS + CSS + HTML | 108 kB |
| **total** | **1.03 MB** of the 3 MB budget |

The frames above are synthetic gradients at ~13 kB each, which is why that
total looks comfortable. **It is not what the real sequence costs.**

### The real sequence is over the 3 MB budget (measured 2026-09-18)

The 72 real frames went up on the box the evening of 2026-09-17, and every
one of them was weighed over HTTP:

| | |
|---|---|
| frames on disk | 72, none missing |
| smallest / mean / largest | 29.5 kB / 40.8 kB / 61.6 kB |
| all 72 frames | **3,004,548 B — 2.87 MiB** |
| poster | 41.8 kB |
| JS + CSS + HTML + webfont | ~169 kB |
| **hero total for a first visitor** | **~3.22 MB (3.07 MiB)** |

The budget is 3 MB, so this is over it — by about 7% against decimal MB,
2% against MiB. The frames alone are 3.00 MB decimal, at the line without
anything else counted. An earlier note here guessed 25–30 kB per frame and
concluded 1.8–2.2 MB; the real mean is 40.8 kB, and the later frames are
the heavy ones (61.6 kB at the end against 29.5 kB at the lightest).

Three levers, cheapest first:

1. **Re-encode at a lower WebP quality.** The frames are visibly
   high-quality; dropping to q≈70 typically takes 25–35% off with no
   visible change at 1600×900 behind a scrim.
2. **1280×720.** About 35% off, and the canvas scales it to fit anyway —
   worth testing by eye, since the hero is full-bleed.
3. **Fewer frames.** 60 would land near 2.45 MB. This one changes the
   motion, so it is the last resort rather than the first.

Nothing in the code needs to change for any of them: re-encode, upload, and
update `manifest.json` if the count moves.

**Not yet measured: LCP with the real poster.** The Lighthouse figures
below were taken against the 11 kB placeholder poster; the real one is
41.8 kB, roughly 200 ms more on simulated 4G, which would put LCP near
2.3 s against the 2.5 s bar. Run `npm run lighthouse` with `URL` pointing
at the live host to get the true number.

### The doorway, measured off the real footage

The final frame is a house at night with its front door open. The door
rectangle and the colour of the light in it were not guessed: frame 72 was
fetched from the box through n8n, downscaled, and the lit opening found by
thresholding for bright warm pixels, then checked by drawing the rectangle
back onto the frame and looking at it.

| | |
|---|---|
| door rectangle (fractions of the frame) | `x 0.4625, y 0.3905, w 0.1099, h 0.3881` |
| light | `#e4b068`, the mean of the bright warm pixels inside it |

Both live in `manifest.json` under `door`, with the same measured values as
the fallback in `ScrollHero.tsx`. **The box has no manifest yet**, so the
fallback is what runs there — which is why it carries the real numbers
rather than something neutral. A door that is malformed in the manifest is
refused whole, never patched: three good numbers and one bad one would put
the transition somewhere that is not the door, which reads as a bug in the
film rather than in the file.

The placeholder frames draw a doorway at the same rectangle, opening over
the last third of the sequence, so the transition can be exercised locally
against something that is actually there. Verified at 1280×800: the div
lands at 586.7, 312.4 and 156×311 px, against a doorway drawn at 586, 311.

`shots/door-025.png` … `door-100.png` walk the door track:

| through the door track | area vs stage | door opacity | canvas opacity |
|---|---|---|---|
| 25% | 16% | 1.00 | 1.00 |
| 50% | 53% | 1.00 | 1.00 |
| 75% | 179% | 1.00 | 0.43 |
| 100% | 371% | 1.00 | 0.00 |

The test also asserts the door's centre does not move while it grows, that
the area only ever increases, and that the section below resolves to the
same colour as the div.

### Legibility, measured rather than eyeballed

`shots/copy-000.png` … `copy-071.png` are the five frames at the scroll
positions asked for. Each one is measured, not just looked at: the test
screenshots the text region twice, with and without the words, and reads the
backdrop's luminance from the second.

| frame | copy opacity | backdrop luminance | contrast vs white |
|---|---|---|---|
| 0 | 1.00 | 0.015 | 16.2:1 |
| 20 | 0.53 | 0.036 | 12.2:1 |
| 40 | 0.06 | 0.051 | 10.4:1 |
| 60 | 0.00 | 0.065 | — faded out |
| 71 | 0.00 | 0.065 | — faded out |

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
