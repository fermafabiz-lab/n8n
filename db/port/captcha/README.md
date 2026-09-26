# The captcha — CapSolver's balance, and what the solves buy (2026-09-26)

The ask, verbatim: *"I want you to add the captcha program ( CapSolver) to see
how much we have left and if you can add some analytics it would be great.
Also, I would like you to make a button labeled "Analytics" instead of "Where
did the  credits go""*

Three things:

1. **CapSolver's balance on Developer insights**, a card like every other paid
   service's: dollars left, the pace, how long it lasts at that pace, and the
   strip on every page when it is low or out.
2. **Captcha analytics** on the Analytics page.
3. **"Analytics"** is the page's name, on its button and its title.

## Why a captcha is a cost worth watching

Every image and every clip Google Flow makes needs a reCAPTCHA Enterprise token.
useapi.net buys each one from a solving service with the producer's key, and
pays per ATTEMPT. Google then accepts the token, or refuses it as "unusual
activity", and useapi retries with a new one (up to `captchaRetry`, 5 since
2026-09-22). So the bill is set by how many solves a request needs, and that
depends on how many tokens Google accepts, far more than on the price of a
solve. On 2026-09-26, Google accepted 37 of CapSolver's 108 tokens and none of
2Captcha's 51. That is why 2Captcha was removed at 18:12 UTC that day
(CLAUDE.md, clip regeneration entry).

## Why the SITE reads CapSolver, not n8n

- useapi holds the producer's CapSolver key, but
  `GET /v1/google-flow/accounts/captcha-providers` answers it **masked**
  (`{"CapSolver": "CAP-B…"}`), and nothing else in useapi returns it.
- n8n has no CapSolver credential, and the MCP connector cannot create one.
- The site already takes its keys from GitHub Secrets: `deploy-platform.yml`
  writes them into `platform.env` on every deploy. So the key is one more
  Secret, **`CAPSOLVER_API_KEY`**, which is optional: the deploy warns when it
  is missing and never fails.

The balance call is `POST https://api.capsolver.com/getBalance
{"clientKey": KEY}`, which answers `{errorId: 0, balance, packages}`. It is
filed as a reading in `hov.api_balance` (provider `capsolver`, metric
`balance`, unit `usd`), so the card, the pace line and the strip work exactly
as they do for every other service. `lib/insights.ts` holds the thresholds:
low under $3, nearly out under $1, out at $0. Without the Secret, the reading is
`unavailable` and carries the instruction. That shows as a grey card, never as
an alarm.

## Where the analytics come from: useapi's record of every attempt

`GET https://api.useapi.net/v1/google-flow/accounts/captcha-stats?date=YYYY-MM-DD`
with the useapi token. It is read-only, the same call the pool-cooldown and
image-failover work used by hand.

- **What it keeps**: one record per attempt, three months back. Each record
  carries `timestamp`, `jobId` (which ends in `-email:<account>-bot:google-flow`,
  and that is where the Flow account comes from), `provider`, `route`
  (`post-images` / `post-videos`), `statusCode`, `reason`,
  `captchaDurationMs` and `attemptNumber`. Each day also carries a `summary`
  with useapi's own per-provider sample sizes and success rates, the tier
  rate, and the average solve time.
- **Latency** is 5-15 minutes, and answers are cached for 5.
- **How the site reads it** (`lib/captcha-sync.ts`): one UTC day per call,
  newest first, summed into one row of **`hov.captcha_day`** (`db/020`). A day
  read at least 20 minutes after it ended is marked `complete` and never read
  again. So the first tick back-fills a month (31 days), and every tick after
  that reads only today.
- **A row summed under the old rule is read again.** `completeCaptchaDays`
  counts a day as complete only if its `outcomes` has the `unavailable` key,
  which every row written since the correction carries. So the correction
  reached the whole month by itself, with no DELETE on the live table. The
  browser drive pins this.

### The outcome classes (`lib/captcha.ts`, `outcomeOf`)

| class | rule | what it means | the token |
|---|---|---|---|
| `accepted` | status 200 | the request went through | taken |
| `refused` | reason starts `PUBLIC_ERROR_UNUSUAL_ACTIVITY` (or a 403 with no reason) | a bot verdict: paid for, then retried | **refused** |
| `traffic` | reason `PUBLIC_ERROR_UNUSUAL_ACTIVITY_TOO_MUCH_TRAFFIC` | the other bot verdict, paid for and retried the same way | **refused** |
| `throttled` | any other 429 (throttled, `HIGH_TRAFFIC`, quota) | Google limiting the ACCOUNT | taken |
| `other` | anything else: 400, 403 `MODEL_ACCESS_DENIED`, 524 | the request failed AFTER the token: a refused prompt, a model the account lacks, a timeout | taken |
| `unavailable` | 503 | Google Flow was down | no verdict, left out |

**"Tokens Google accepted" is the last column**: taken ÷ (everything but
`unavailable`), per tally `passed / judged`. That is useapi's own success rate,
and it is NOT "requests that went through" (`accepted / jobs`), which the page
shows under it. On 2026-09-04, 85 refused prompts put the first at 88% and the
second at 59%.

`refused` and `throttled` both look like "the captcha failed", but they have
opposite fixes (change the provider, or rest the account). That is why the
page keeps them apart.

### The answer key — and how it was wrong for an hour

`platform/scripts/check-captcha.mjs` (`npm run check:captcha`) holds the sums
to useapi's own summaries, in two ways:

- **A real day**: `fixtures/captcha-stats-2026-09-26.json`, 159 attempts read
  in execution 17712 and trimmed to the fields above. The sums must equal
  useapi's summary for that day:
  - sample size per provider: 108 / 51;
  - success rate per provider: 34.26% / 0%;
  - the tier rate: 23.27%;
  - average solve time: 24,255 ms.
- **Two days rebuilt from useapi's summaries**:
  `fixtures/useapi-summaries.json`, read back in execution 17775.
  - Both days ran one attempt per request, so the per-request status mix is
    the attempt mix. The check rebuilds the attempts, first proves the rebuild
    reproduces useapi's mix to two decimals, then requires useapi's rate and
    sample.
  - 2026-09-04 carries 400s and a `HIGH_TRAFFIC` 429.
  - 2026-09-17 carries 503s, 524s and a record with no tier.

**The first version shipped with only the real day, and it was wrong.**

- The 2026-09-26 day holds nothing but 200s, bot 403s and `TOO_MUCH_TRAFFIC`
  429s. On it, "accepted" (200) and "token taken" are the same number, so the
  check passed with the page counting 200s.
- The live back-fill (execution 17772) put 27 days of useapi's summaries in
  `hov.captcha_day`. Read against them, the old rule matched 14 days to the
  hundredth and missed the other 13. Those 13 are exactly the days with any
  400, `MODEL_ACCESS_DENIED`, throttle, timeout or 503: on 09-04 the page would
  have said 59% where useapi says 88%, and on 09-06 71% against 93%. useapi
  counts all of those as successes except the 503, which it leaves out of the
  sample.
- **An answer key taken from a day without the edge cases proves nothing
  about them.** Check the rule against every day the source has summarised,
  not the one you happened to save.

## What the page shows

Analytics (`/admin/insights/usage`) gained a section, **"Captcha —
CapSolver"**, before ElevenLabs.

- **Figures**:
  - the CapSolver balance and its pace;
  - captcha solves;
  - the share of tokens Google accepted (useapi's rate), and under it the
    share of requests that went through;
  - the average solve time;
  - the estimated captcha cost, with the cost per request that went through.
- **Charts**, each titled "Service — what, per what" like the rest of the page:
  - "Captcha — what happened to each solve" (a pie of the five classes);
  - "Captcha — solves per Google Flow account" (a pie);
  - "Captcha — solves per day";
  - "Captcha — share of tokens Google accepted, per day";
  - "CapSolver — dollars spent per day (measured)", from the balance's own
    drops, once there is a history.
- **Tables**: "Captcha — by provider" and "Captcha — by Google Flow account".

**The cost is an ESTIMATE** at useapi's own table (per 1,000 solves:
CapSolver ~$3.00, 2Captcha ~$2.99, AntiCaptcha ~$2.00, SolveCaptcha ~$0.80,
EzCaptcha ~$2.50, read 2026-09-26), and the page says so. The measured figure is
the balance's hourly drop, which needs the Secret.

## The hourly tick

API Credits' last node used to be `Read OpenAI Ledger`. It is now **`Insights
Tick`**, posting to **`POST http://web:3000/api/insights/tick`**
`{"budgetMs": 120000}` with the `HOV Media Ingest` key. The site then does three
things, in this order:

1. reads CapSolver's balance (about a second);
2. reads the captcha days (at most 60 s; after the back-fill, only today);
3. reads the OpenAI ledger with whatever budget is left, as before.

The route is behind the key door in `middleware.ts` and checks the key again
itself. By hand:

- "Check now" on Developer insights also reads the balance;
- "⟳ Update now" on Analytics reads the last two captcha days, then the ledger.

`run-tick.workflow.js` runs the tick once from a Claude session, with a
270 s budget (the first back-fill).

## Live (2026-09-26)

- **db/020** was applied in execution 17768: the table is present with 12
  columns.
- **The site**: deploy #201 (merge `656bd1d`), then the correction in deploy
  #202 (merge `0c6a400`).
- **API Credits** went live as `8e51ec0c` (`Insights Tick`; rollback
  `2cbef392`).
- **First tick, execution 17772**: 31 days read, and the answer carried
  `capsolver`, `captcha` and `ledger`. Only the new build knows that route, so
  the answer itself proves the deploy is serving.
- **After the correction, execution 17780** read the 30 old-shaped days again
  by itself, plus today.
- **The check, execution 17781**: 31 rows in the new shape, and all 33
  provider-days equal useapi's `sample_size_by_provider` and
  `success_rate_by_provider` to the hundredth.
- **The CapSolver balance reads `unavailable`** until the Secret
  `CAPSOLVER_API_KEY` exists. Add it (GitHub → Settings → Secrets and
  variables → Actions, with the key from dashboard.capsolver.com), then run
  "Deploy platform".

The first month, 2026-08-27 to 09-26:

| | solves | requests | solves per request | tokens accepted | requests through |
|---|---|---|---|---|---|
| to 09-17 | 2,105 | 2,037 | 1.03 | 84.8% | 81.0% |
| 09-18 to 09-21 | 511 | 511 | 1.00 | 67.7% | 67.5% |
| from 09-22 (`captchaRetry` 5) | 1,140 | 551 | 2.07 | 27.9% | 56.4% |

- **By provider**: CapSolver 73.2% over 3,323 solves (8.8 s each); 2Captcha
  3.9% over 433 (28.9 s each).
- **By account since 09-18**: fermafabiz 47.3%, houseofvideos01 26.2%,
  houseofvideos02 28.9%.
- **Estimated cost of the month**: about $11 (3,323 × $0.003 + 433 ×
  $0.00299). The cost is small. What the captcha costs is **time**: every
  refused token is a 20-30 s solve plus a retry, and since 09-22 nearly three
  solves in four are refused.

## Files

- `db/020_captcha_day.sql`, with `apply-020.workflow.js` and `verify-020.sql`
- `platform/lib/captcha.ts`: pure, the classes, the day sums, the page figures
- `platform/lib/captcha-sync.ts`: the two reads, `readCapSolver` and
  `syncCaptchaDays`
- `platform/app/api/insights/tick/route.ts`: the hourly door
- `platform/lib/insights.ts`: the CapSolver card, its thresholds and its strip
  text
- `platform/app/admin/insights/usage/page.tsx`: the section
- `browser/drive.mjs`: 25 checks in Chromium against the production build on
  a real Postgres engine, with stand-ins for CapSolver and useapi on :3298
- `.github/workflows/deploy-platform.yml`: `USEAPI_TOKEN` and
  `CAPSOLVER_API_KEY` into `platform.env`
