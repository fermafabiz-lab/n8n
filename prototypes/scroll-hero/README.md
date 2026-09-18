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
| `app/globals.css` | 200vh track + sticky 100vh stage; the opt-outs collapse it to 100vh in CSS. |
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

## Results (2026-09-17, production build, preinstalled Chromium)

**Playwright** — 7 of 7 passing. `shots/frame-000.png` … `frame-071.png` show
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

The frames are synthetic gradients and compress to ~13 kB each. Real
footage at 1600×900 lands nearer 25–30 kB per frame, so 72 frames is about
1.8–2.2 MB — inside the budget, where 100 would have been at its edge.
If a longer cut ever goes over, 1280×720 is the lever.

**Lighthouse** (`lighthouse/summary.json`, `lighthouse/*.html`):

| run | perf | a11y | best practices | SEO | FCP | LCP | TBT | CLS |
|---|---|---|---|---|---|---|---|---|
| mobile (Lighthouse default: slow 4G, 4× CPU, 412px → poster-only path) | 100 | 100 | 96 | 100 | 0.76 s | 1.77 s | 56 ms | 0 |
| desktop screen + same slow-4G simulation (canvas path, whole sequence) | 87 | 100 | 100 | 100 | 0.75 s | 2.29 s | 64 ms | 0 |

Measured with Caddy in front, the shape the box runs: frames and poster off
disk, everything else proxied to Next. **Expect noise on the desktop run.**
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
