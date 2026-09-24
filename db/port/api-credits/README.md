# Developer insights — what every paid API has left (2026-09-24)

The ask, verbatim: *"Ai putea sa faci o pagina "Developer insights" in setting
sau langa settings unde sa vedem cate credite mai avem pe toate API-urile pe
care le folosim. Pt ca ne tot trezim ca ramanem fara credite. Eventual poate
poti sa ne faci si o pagina de analiza sa vedem pe ce consuma fiecare si cat
consuma."* — a page with the credits left on every API, because the team
keeps waking up to find one empty, and a page showing what each is spent on.

**The OpenAI account was empty the morning this was built** — the first probe
(execution 16818) answered `429 credit_balance_exhausted`. It had run dry twice
before (2026-08-08, 2026-09-19), each time found through a film that died while
its script was being written.

## What it is

| piece | where |
|---|---|
| the readings | `hov.api_balance` — **`db/015_api_balance.sql`**, one row per thing that can run out, per reading; a history, so pace and "runs out in" can be measured |
| the writer | n8n workflow **"API Credits"** `Bkuo0qIxKprUFVpU` — hourly (`Every Hour`) and on demand (webhook **`api-credits`**, header auth = `HOV Media Ingest`, i.e. `x-hov-key` = `MEDIA_INGEST_KEY`) |
| node bodies | `paste/Flow Emails.js`, `paste/Normalize.js`, `paste/Result.js`; `build.mjs` composes `api-credits.workflow.js` from them (token as `__USEAPI_TOKEN__`) |
| the judgement | `platform/lib/insights.ts` — low / nearly out / out, pace, days left, the alert text. One owner for the page, the Settings dot and the strip |
| the page | `/admin/insights` "Developer insights" (Settings card, red dot when anything is out or nearly out) |
| the analysis | `/admin/insights/usage` "Where the credits go" |
| everywhere | `components/CreditsAlert.tsx` in the root layout: a strip above the nav while anything is OUT or NEARLY OUT; × hides it until the set of alerts changes |
| Check now | `checkCreditsNow()` in `app/actions.ts` → the webhook, waited on (5-10 s) |

## What each provider answers (measured 2026-09-24, execution 16818)

| provider | call | what it gives |
|---|---|---|
| **OpenAI** | `POST /v1/chat/completions`, `gpt-4o-mini`, `max_tokens: 1` | **the balance cannot be read with an API key** — `/dashboard/billing/credit_grants` answers 403 "must be made with a session key (… from the browser)". So the probe asks the question that matters: does a paid call go through? Empty = `429 credit_balance_exhausted`. A rate limit (`rate_limit_exceeded`) is recorded as an error, never as OUT |
| OpenAI spend | `GET /v1/organization/costs?bucket_width=1d&group_by=line_item` | **403 "Missing scopes: api.usage.read"** with the key n8n holds. Give that key the *Usage → Read* permission and the usage page shows dollars per day and per model at the next hourly run — the parsing is written and fixture-tested against the documented shape, never yet against a real 200 |
| **ElevenLabs** | `GET /v1/user/subscription` | `character_count` / `character_limit` / `next_character_count_reset_unix`, tier (creator, 131,000 a month) |
| ElevenLabs usage | `GET /v1/usage/character-stats?aggregation_interval=day` | characters per day, ElevenLabs' own count (the 30-day sum equalled `character_count` exactly) |
| **Google Flow** | `GET /v1/google-flow/accounts` (useapi) | health per account — **no credits in the list** |
| Flow credits | `GET /v1/google-flow/accounts/{email}` | `credits.credits` (~22,000 each on the three accounts). **The same record carries Google session cookies and an access token** (redacted by useapi); `Normalize` copies named fields only, and `check.mjs` fails if any of it reaches a reading |
| **useapi** | `GET /v1/account` | `subscriptionIsActive`, accounts active/total |
| **Google Drive** | `GET /drive/v3/about?fields=storageQuota,user` | 10 GB used of 30 TB |
| fal | `GET rest.alpha.fal.ai/billing/user_balance` | **−$0.34**, and nothing calls fal any more (checked: no node in the live Media Generation or Claude Scripting) — left out of the page |
| captcha providers | `GET /v1/google-flow/accounts/captcha-providers` | CapSolver and 2Captcha are configured, keys redacted — **their balances cannot be read from here** |

## The useapi token

useapi has no n8n credential in this instance: the same token is hard-coded in
14 Media Generation nodes and one Claude Scripting node, and committed in many
`db/port` snapshots. The three useapi nodes here carry it the same way
(pasted at creation from `build.mjs --token-file`, never committed — the repo
copy says `__USEAPI_TOKEN__`). **When the token is rotated, these rotate with
the rest**; better, move all of them to one Header Auth credential.

## Verified

- `node db/port/api-credits/check.mjs` (`npm run check:api-credits-node`, 34):
  the three node bodies against the REAL answers of 2026-09-24
  (`fixtures/`, sanitised), including OUT vs rate limit vs network error, a
  signed-out Flow account (credits read fine, health says otherwise), one
  account failing without taking the others, no cookie or token in any
  reading, the SQL as one base64 literal, the write failing.
- The generated write run on a real Postgres engine (`local-pg.mjs`): all
  nine readings land with the right types.
- `npm run check:insights` (51): the judgement, the pace (drops only, refills
  ignored, under six hours is not a rate), the strip's text and order, one
  pricing rule for the usage page and the project page (`filmCost` from SQL
  counts equals `filmCost` from scenes), and the joints.
- **In Chromium against the production build on a real engine**,
  `browser/drive.mjs`, 40/40: the Settings card red with its reason; the
  strip on another page, worst first, with where to fix it; nothing on
  /login; every card in words; Check now reaching a stand-in n8n with the
  shared key, the page showing what it wrote and the strip going at once; a
  dead check (five hours without a reading) said out loud; the usage page's
  measured and estimated figures, tooltips on hover and on keyboard focus, the
  table twins, the period links; × hiding the strip until something else runs
  out; 390px in both themes.

## Live

- **The site: deploy #187**, merge `1fed24c` into the trunk; build
  10:45:28 → 10:48:13, `web` pulled and restarted by 10:48:32 UTC. Nothing
  was running in n8n at the push. Proof it is the build answering:
  `db/port/lib/served-css.workflow.js` (execution 16830) found
  `hov:credits-checked` — a string only `CreditsAlert` has — in
  `/_next/static/chunks/app/layout-d7a570d4d56ed91f.js`, the layout chunk
  /login links.
- **The production webhook, as the site calls it** (execution 16828): POST
  `http://localhost:5678/webhook/api-credits` with the `HOV Media Ingest` key
  → 200 in 4.9 s, `source: "webhook"`, `saved: true`, nine readings; the same
  POST without the key → **403** "Authorization data is wrong!".
- `db/015` applied in execution **16821** (table, 13 columns, 3 indexes).
- Workflow **`Bkuo0qIxKprUFVpU`** published as version **`78582ddd`**; its
  first run (16822, 5 s) wrote nine readings: OpenAI **OUT**, ElevenLabs
  51,720 of 131,000, Flow 21,960 / 21,950 / 22,000, useapi active, Drive 30 TB
  free. Successful runs are not kept in n8n's execution log
  (`saveDataSuccessExecution: none` — each carries ~150 KB of redacted
  cookies); the table is the record, and the page says when it stops filling.

## Adding a provider

One probe node (neverError + fullResponse, `onError: continueRegularOutput`),
one block in `Normalize.js` that `add()`s its readings, one entry in
`PROVIDERS` / `PRIMARY_METRIC` in `lib/insights.ts`, fixtures and a case in
`check.mjs`. Then `node build.mjs`, and re-create or patch the node from the
generated file.

## Owed

- The *Usage → Read* permission on the OpenAI key (the producer's click), and
  then the first real `spend_30d` read against the page.
- **Auto recharge** on the OpenAI account — the only thing that makes "empty
  mid-film" impossible rather than merely visible.
- Railway (the render server's usage-based bill) is not connected: n8n has no
  Railway credential.
