# API route audit — external calls, separable or inline

Written for workstream 4 (Zod at the API boundaries), so that work targets
real shapes instead of guessing. One sentence per route: what it reads, what
external service (if any) it touches, and whether that touch is already in a
function that can be fixture-tested without a live network, or sits inline in
the route handler.

16 routes, verified by reading each file directly (`grep` for
`req.json()`/`searchParams`/`fetch(` plus the import list), not assumed.

## Already separable — the external call lives in `lib/`, covered by `check:footage`

These seven all delegate to `lib/footage/*` / `lib/archive/*` / `lib/data/stock`,
which is exactly what the existing 186-check `check:footage` fixture suite
already exercises with the network and the database mocked at their edges.
Zod here only needs to validate the route's own body/query shape before it
reaches those functions — no new separation work needed.

- **`archive/search` (GET)** — query params (`q`, `type`, `provider`, …) into
  `searchArchives()` / `searchStockLibrary()`.
- **`archive/suggest` (GET, POST)** — GET takes `?project=`; POST takes a
  body, both routed through `buildFootageRequest()` / `searchFootage()`.
- **`archive/use` (POST)** — body into `attachArchiveAsset()`.
- **`footage/import` (POST)** — body into `importFootageFromUrl()`
  (`lib/footage/urlImport`).
- **`footage/providers` (GET)** — no body; reads `allProviders()` /
  `providerStats()`. No external call at all on the request path.
- **`footage/search` (GET, POST)** — query or body into `requestFromQuery()`
  / `searchFootage()`.
- **`footage/upload` (POST)** — body (including binary bytes) into
  `storeMediaBytes()` + `validateRights()`; also shells out to `ffprobe` via
  `execFile`, which is a separate concern from the JSON shape.

## Inline `fetch()` in the route handler — not separated, not covered by any check script

These call an external host directly inside the handler. Zod can validate
the request shape without touching this, but none of the actual network call
is fixture-tested today, and separating it is real work this audit does not
promise:

- **`audio-bundle` (GET)** — `?project=` + `?chapter=`; fetches each scene's
  take straight from `drive.google.com` and concatenates with ffmpeg
  (`lib/mp3.ts` for the no-ffmpeg fallback, which is fixture-testable
  already since it is pure).
- **`expand-brief` (POST)** — body `{idea, …}`; POSTs to the n8n
  `expand-brief` webhook (OpenAI key stays in n8n).
- **`media/ingest` (POST)** — body `{sceneId, field, url, fields}`; fetches
  the asset URL (fal/Flow) and writes it to the media store. Guarded by
  `x-hov-key` against `MEDIA_INGEST_KEY`, not a Next.js session — see
  CLAUDE.md's "The four nodes that need more than a query" section.
- **`media` (GET)** — `?id=`; proxies `drive.google.com` (the Range-request
  fix CLAUDE.md documents at length under "Drive-hosted media must go
  through `platform/app/api/media`").
- **`music` (GET, POST)** — GET lists cached tracks; POST body `{id}` shares
  one Drive file and returns its proxy URL; both call the n8n `Music
  Library` webhook.
- **`voices` (GET)** — query params (`lang`, `q`, `page`, `provider`, …);
  three separate `fetch()` calls into the ElevenLabs API directly (`/v2/voices`,
  `/v1/shared-voices`, `/v1/voices/{id}`) — this is the biggest route (352
  lines) and the most externally-dependent one with no separation at all.
- **`yt-kit` (GET)** — `?project=`; fetches every scene's take from Drive to
  compute real chapter timestamps, and calls the n8n `YT Scene Titles`
  webhook for short-film scene labels.

## No external call

- **`at/[...path]` (GET, POST, PATCH)** — the Airtable-shape compatibility
  shim over Postgres (`hov.at_*`). Talks to the database, not an external
  API; already covered by the `at_write`/`at_create` refusal behaviour
  documented in CLAUDE.md ("Postgres speaks Airtable").
- **`status` (GET)** — no body, no external call, returns a static health
  shape.

## What this meant for workstream 4 — done, 2026-09-13

Zod schemas now cover 13 of the 16 routes: every route above except
`status` and `footage/providers` (no input at all) and `footage/upload`
(multipart/form-data — Zod does not apply cleanly, and the route's own
manual checks stay as they were). Everything lives in
`platform/lib/apiSchemas.ts` (pure Zod, no `next/server` import — see its
own header) plus `platform/lib/validation.ts` (the `parseJsonBody`/
`parseQuery`/`zodBad` helpers, which DO import `next/server` and are
route-only). Each route's existing response contract — status code, `{ok:
false,error}` vs `{error}`, the soft-fail 200 on `expand-brief` and `music`
POST — was preserved exactly; this was a boundary hardening pass, not a
response-shape change.

Two gaps the audit above did not call out by name, found while wiring:
`at/[...path]` let a malformed JSON body fall through to its outer
catch-all and answer a misclassified 500 instead of a 400; `voices` had no
query validation of any kind (`page`, `q`, `ids`, `lang` all read via bare
`.get()`). Both now validate like every other route.

The `Editing Options` thin shape check (`parseEditingOptionsShape` in
`platform/lib/editingOptionsShape.ts` — deliberately NOT in `validation.ts`,
because `lib/data/derive.ts` is imported by client components for its
values and cannot pull in `next/server`) replaced `parseEditing()`'s silent
`catch { return {} }` with the same safe default PLUS a greppable
`console.warn` naming what was actually found — a corrupted row or a bad
migration now leaves a trace instead of vanishing.

Verified: `npx tsc --noEmit` clean across the whole app; 56 schema fixtures
(`check:validation`) plus 5 real-route-handler fixtures (`check:routes`,
calling the actual exported `GET`/`POST` functions with constructed
`Request` objects — proving the wiring, not just the schema objects) both
wired into `npm run check`; a deliberately broken schema was confirmed
caught by the aggregator and reverted. `platform/scripts/alias-loader.mjs`
gained one fallback (retry a bare `next/<subpath>` specifier as
`<subpath>.js` on resolution failure) to make `check:routes` possible at
all — the one thing letting a plain `node` script call a route handler
that imports `next/server`, which none of the earlier `check:*` scripts
needed to do.

Left for later, not part of this pass: pulling the inline `fetch()` calls
in `audio-bundle`, `expand-brief`, `media/ingest`, `media`, `music`,
`voices` and `yt-kit` into separately fixture-testable functions, the way
`lib/footage`/`lib/archive` already are for the seven routes that delegate
to them.
