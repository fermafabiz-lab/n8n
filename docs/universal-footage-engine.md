# Universal Footage Engine

The one search behind every "real footage" door in the platform: the
Documentary picker's *Search real footage*, the automatic suggestion run
that fires on scene-text approval, the *Add from URL* and *Upload* doors, and
the admin library at `/admin/footage`. Since 2026-09-09 it replaces the
single-archive search in `lib/archive/index.ts`, which now calls into it.

It lives on the **site** (`platform/lib/footage/`), not in n8n: the site
holds the library, the media store and the scene rows, and n8n holds only
the two model calls of the suggestion run (see `footage-n8n-workflow.md`).
The site runs on the Hetzner box, not on Vercel.

## What it does, in order

```
FootageSearchRequest
  → library first            searchStockLibrary() over the scene's queries
  → good enough? → return    best ≥ 62 and ≥ 3 candidates, no provider called
  → cache                    footage_search_cache, 6 h, same request → same rows
  → router                   routeProviders(): categories → at most 4 providers
  → providers in parallel    Promise.allSettled, 20 s each, failures isolated
  → rights filter            validateRights(); `restricted` is REMOVED here
  → dedupe                   provider+id, canonical URL, content hash
  → file as metadata         saveStockCandidates() — no bytes move
  → judge                    matchSignals → rankOne + assessProvenance
  → merge with library, order, remember
```

`searchFootage(request, options)` in `engine.ts` is the whole thing; the
`UniversalFootageEngine` object is the same three functions under one name
(`search`, `judge`, `fallbackPlan`).

## The request

`FootageSearchRequest` (`types.ts`) carries what a scene NEEDS, not what to
type into a search box: `narration`, `topic`, `event`, `location`,
`country`, `dateFrom`/`dateTo`, `people`, `organizations`, `keywords`,
`preferredMediaType`, `preferredFootageType` (`broll | stockshots | speech |
interview | any`), `requireExactEvent`, and optional authored `queries`.

`buildFootageRequest(scene)` in `request.ts` builds one from a scene: proper
nouns become keywords, years named in the narration become the date window,
a quoted statement asks for a speaker (`speech`), anything else asks for
pictures (`broll`). **No date, place or event is ever invented** — a field
the scene does not support stays undefined, and the matcher treats an
absent signal as unknown, never as a mismatch.

`generateSearchQueries(request)` turns it into **three to six** short
catalogue queries, most specific first: authored queries, then the event,
then event + place, then keyword pairs. Never more — the archives are
rate-limited and ask clients to be polite.

## Library first, always

Every provider answer is filed into `hov.stock_media` the moment it
arrives, as metadata (title, dates, place, licence, URLs), so a second scene
asking what a sibling asked last week is answered from the box without an
external call. A provider outage therefore costs *new* material only.

Bytes move exactly once: when a scene USES an asset
(`lib/archive/attach.ts`), which downloads the file, cuts the clip and
poster with the site's own ffmpeg, and writes the content hash back to the
library row. Metadata-first indexing is deliberate — no bulk downloads, and
no binary payloads through n8n.

## Provider isolation

Each routed provider runs under its own timeout inside
`Promise.allSettled`. A throw, a 429 or a changed response shape becomes a
line in the result's `providers` report (`{provider, routed, reason, count,
ms}`) and a mark in `health.ts` — three consecutive failures hold a provider
back for five minutes, a rate limit for fifteen — and the other providers'
answers go through. **Documentary generation never waits on, or fails with,
one archive.** Stats persist in `hov.footage_provider_status` and are shown
at the top of `/admin/footage`.

## Rights are a filter, not a score

`validateRights()` runs before ranking. A `restricted` asset is dropped —
it never reaches a candidate list, a score or a render. `manual_review`,
`editorial_only` and `unknown` are ranked and returned FLAGGED: the picker
offers them behind "Use — I accept the rights", the suggestion run never
offers them at all, and the render path (`renderable()`) accepts them only
once a person has marked the row `approved`. Details in
`footage-rights-validator.md`.

## The fallback ladder

`fallbackPlan(result, floor = 45)` states what a scene should do with a
result: a real **video** above the floor, else a real **image** above the
floor, else **AI**. The floor is the point — an unrelated real clip is never
used merely to avoid a generated picture (spec §32).

## Where it is called

| Caller | How |
|---|---|
| `GET/POST /api/footage/search` | the picker and any n8n node; `scene=` builds the request from the scene, `q=` from a typed query, `providers=` filters, `library=1` local only, `fresh=1` skips the short-circuit |
| `POST /api/archive/suggest` stage `search` | the suggestion run, one request per scene, 300 ms apart |
| `lib/archive/index.ts` `searchArchives()` | the legacy signature, kept for the two callers that had it |
| `lib/archive/attach.ts` | `assessProvenance()` on Use, to stamp the scene's provenance |

## Environment

| Variable | Needed for |
|---|---|
| `DVIDS_API_KEY` | DVIDS. Absent → the provider reads as *off* in the registry and is never routed; the deploy prints a warning, not an error |
| `EU_AV_API_BASE` | EU Audiovisual Service base URL; defaults to `https://audiovisual.ec.europa.eu/api` |
| `MEDIA_INGEST_KEY` | already existed — the `x-hov-key` header n8n uses against `/api/footage/*` and `/api/archive/*` |

Nothing else. NASA and Wikimedia are keyless. `NARA_API_KEY` and
`SMITHSONIAN_API_KEY` are not read anywhere (`nara-smithsonian-deprecation.md`).

## Tests

`npm run check:footage` (in `platform/`) runs `scripts/check-footage.mjs`
against the real engine with the network and the database mocked at their
edges (`scripts/footage-loader.mjs` maps the `@/` alias and swaps
`lib/data/stock` and `lib/data/postgres` for in-memory doubles). 125 checks:
request building, routing, the four normalizers, rights, provenance,
ranking, dedupe, the engine end to end (local-first, isolation, hold-back,
rate limit), the fallback ladder, URL import and its refusals, the legacy
door, and the source-watermark contract.

## Files

```
platform/lib/footage/
  types.ts        FootageSearchRequest, FootageProvider, RightsResult, RankedFootage…
  request.ts      buildFootageRequest, generateSearchQueries
  registry.ts     the providers, requestCategories, routeProviders
  rights.ts       validateRights, usableAutomatically, usableWithReview, renderable
  match.ts        matchSignals — the tri-valued event/date/place/people signals
  provenance.ts   assessProvenance, baseProvenance
  rank.ts         rankOne, orderByScore, visualUsefulness
  dedupe.ts       canonicalUrl, identityKeys, dedupeAssets
  health.ts       heldBack, recordSearch/Selection/Failure, providerStats
  urlImport.ts    readPage, importFootageFromUrl
  engine.ts       searchFootage, judge, fallbackPlan
  auth.ts         footageAuthorized, footageUsable
  providers/      wikimedia, euav, dvids, nasa, urlImport, upload
```
