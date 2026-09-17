# Scroll-scrub hero — isolated prototype

A standalone Next.js (App Router, TypeScript) app with one thing in it: a
hero that draws a 100-frame WebP sequence onto a `<canvas>`, scrubbed by the
scroll position, followed by an empty test section. No brand, no content,
no scroll library. It lives under `prototypes/` on purpose: nothing here is
under `platform/**` or `remotion/**`, so pushing it deploys nothing.

## Run it

```
cd prototypes/scroll-hero
npm install
npm run frames      # regenerates public/frames/*.webp + public/poster.webp
npm run build && npm run start
```

- `npm test` — Playwright: scrubs the sequence, screenshots frames 0/25/50/75/99
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
| `scripts/make-frames.mjs` | Synthetic frames that print their own number (sharp). Swap in real frames with the same names. |
| `tests/hero.spec.ts` | Playwright checks listed above. |
| `scripts/lighthouse.mjs` | Mobile run (Lighthouse default: slow 4G, 4× CPU) and a desktop run with the same slow-4G simulation. |

## How the constraints are met

- **Canvas, not `<video>`** — frames are `HTMLImageElement`s decoded with
  `img.decode()` and drawn with `drawImage` in object-fit: cover geometry.
- **Poster first, then 20 frames, then the rest** — `poster.webp` is in the
  server-rendered HTML with `fetchpriority="high"` and a `<link rel="preload">`.
  Frames 1–20 fetch in parallel; the canvas becomes visible only in the same
  animation frame as its first draw, so there is no blank canvas between the
  poster and the sequence. Frames 21–100 load one at a time, in order.
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

`data-state` (`idle` / `loading` / `ready` / `static`), `data-frame` and
`data-loaded` on the `<section>` exist for the tests; they are cheap
attribute writes and can go when the mechanic moves into the site.

## Results (2026-09-17, production build, preinstalled Chromium)

**Playwright** — 5 of 5 passing. `shots/frame-00.png` … `frame-99.png` show
frames 0001, 0026, 0051, 0076 and 0100 at the five scroll checkpoints;
`held-at-19.png` shows frame 0020 held with frames 21+ stalled at the
network layer; `after-hero.png` is the test section filling the viewport;
`mobile.png` and `reduced-motion.png` are poster-only.

| Transfer (desktop, whole sequence) | |
|---|---|
| frames | 1316 kB (100 requests) |
| poster | 12 kB |
| JS + CSS + HTML | 108 kB |
| **total** | **1.40 MB** of the 3 MB budget |

The frames are synthetic gradients and compress to ~13 kB each. Real
footage at 1600×900 lands nearer 25–30 kB per frame, i.e. 2.5–3 MB for 100
frames — the budget is tight for a real render; 1280×720 or ~80 frames is
the lever if it is over.

**Lighthouse** (`lighthouse/summary.json`, `lighthouse/*.html`):

| run | perf | a11y | best practices | SEO | FCP | LCP | TBT | CLS |
|---|---|---|---|---|---|---|---|---|
| mobile (Lighthouse default: slow 4G, 4× CPU, 412px → poster-only path) | 100 | 100 | 96 | 100 | 0.76 s | 1.78 s | 64 ms | 0 |
| desktop screen + same slow-4G simulation (canvas path, all 100 frames) | 87 | 100 | 100 | 100 | 0.75 s | 2.29 s | 74 ms | 0 |

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
| Frames | **Not in the image** (`.dockerignore` drops `public/frames`). The workflow copies them to `/opt/n8n/frames`; Caddy mounts that read-only at `/srv/frames` and answers `/frames/*` from it with `handle_path`, before anything reaches Next. The code asks for `/frames/frame_0001.webp` either way — locally Next serves them from `public/`, on the box Caddy does. |
| Poster | Stays in the image (`public/poster.webp`, 12 kB). It has to match frame 1, so a new sequence on the box needs a rebuild with a matching poster — or move `POSTER_SRC` to `/frames/poster.webp` and copy it with the frames. |
| Caddy | `{$SITE_DEV_HOST}` block in `infra/Caddyfile`; `SITE_DEV_HOST` comes from `/opt/n8n/.env` through the caddy service's environment. |

### State as of the first deploy (2026-09-17 22:39 UTC)

Run #1 of the workflow went green end to end and created the container:
the box's compose file already carried a `site-dev` service, which this
repo's mirror did not know (see `infra/README.md`). Probed from n8n on the
same Docker network, `http://site-dev:3000/` answers 200 with the hero
markup and `/poster.webp` answers 200 as `image/webp`, 11,766 bytes.

**Unverified: whether Caddy serves `/frames/*`.** It needs the
`handle_path` block and the `./frames:/srv/frames:ro` mount to exist in the
box's own Caddyfile and compose file, which cannot be read from a web
session. Without them the page still renders: the poster shows, the frame
requests 404, the canvas never appears (state stays `loading`), and the
section is still a 200vh track. That is the "never blank" rule holding,
not a bug — check `/opt/n8n/frames` and the caddy mount, then
`docker compose up -d caddy` (a reload does not pick up a new mount).

## Notes for moving it into the site

- Frames stay as `HTMLImageElement`s on purpose. `createImageBitmap` would
  move decoding off the main thread, but pins 100 decoded bitmaps in memory
  (1600×900×4 B × 100 ≈ 576 MB), which kills a Safari tab. The browser's
  own image cache can evict and re-decode an `<img>`.
- The sticky stage is `100vh`, not `100svh`/`100dvh`; on iOS the bottom of
  the stage sits under the toolbar until it collapses. Mobile never scrubs,
  so this only affects how the poster is cropped.
- `Cache-Control: immutable` for `/frames/*` and `/poster.webp` is set in
  `next.config.mjs`; keep it wherever the files end up (Caddy, GHCR image).
