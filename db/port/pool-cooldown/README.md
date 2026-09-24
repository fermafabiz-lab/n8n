# A failed submit froze the whole pool (2026-09-24)

Follow-up to `db/port/family-model/` ("Still owed: `Submit Cooldown Guard`
loops in place"). Measured on the Rome film (`recIIvYV8S6KNaw4C`, 26 scenes,
three accounts, `videoPool: true`, execution 16578 on `b9527072`).

## What was measured

The execution was cancelled at the gate the next morning, so it kept no
`runData`; the timeline comes from `hov.attachment.created_at` for each scene's
video and the owner hex-encoded in `video_media_id`.

| window | clips landed |
|---|---|
| 18:14 → 18:23:50 | 6, all three accounts |
| **18:23:50 → 18:37:43** | **none, on any account — 13m53** |
| 18:37:43 → 18:38:40 | 3, one per account, inside a minute |
| 18:38 → 19:02:55 | 17, ~89 s a clip across the pool |
| **19:02:55 → 19:15:30** | **none — 12m35** |
| 19:15:30 → 19:17:53 | the last 3, again in a burst |

26 of the clip phase's 63 minutes were stalls. The burst after each one is the
signature: the clips on the other accounts had finished at Google long before,
and nothing had collected them.

Split 11 / 9 / 6 (`fermafabiz` / `houseofvideos01` / `houseofvideos02`), every
clip on the account that owns its still, zero `Email mismatch`; scene 214 was
made by work stealing (still on `fermafabiz`, clip on `02`). In the steady
window the manager made a clip every ~2m50 and the invited accounts every
~4m50-5m25 — **why the paid model on the invited accounts is slower than the
free one on the manager is not known** (captcha retries are the guess;
`captcha-stats` only keeps an hour).

## Why

`Submit Video` [error] → `Submit Cooldown Guard` → `Wait Submit Cooldown`
(60 s) → `Submit Video`, up to twenty times. That loop is fine serially. In
the pool it runs INSIDE one tick, and `Pool Tick` is the only thing that polls
the jobs in flight on the other accounts — so one refusing account stopped the
whole film for as long as it kept refusing.

## What changed — Media Generation `c4cd24ea` (rollback `8dc9f448`)

- **`Submit Cooldown Guard`**: emits `inPool`; past `MAX` in the pool it emits
  `giveUp` instead of throwing (the scene is set aside for the next pass, as
  `MAX_POLLS` does for a clip that never finishes). Serial behaviour identical.
- **`Pool Cooldown?`** (new If): `inPool` → `Pool Record`; otherwise → `Wait
  Submit Cooldown`, the old loop.
- **`Pool Record`**, new `Pool Cooldown?` edge: the scene goes back to the head
  of the queue on the same account (stolen account, in-flight entry, queue
  entry, `poolAccount`, image owner — in that order), that account gets
  `cooldownUntil = now + 60 s`, and the still the attempt used is kept in
  `freshImage` (after the refusal ladder it is newer than the row `Sort Scenes
  For Video` loaded).
- **`Pool Tick`**: a resting account takes no submit and is no steal target;
  its clips in flight are polled as usual; a queue blocked only by resting
  accounts is `wait`, not `done`; an emitted row carries `freshImage`.

Diff against `8dc9f448`: 247 → 248 nodes, only the four expected nodes differ,
edges exactly `Submit Cooldown Guard → Pool Cooldown?`, `Pool Cooldown?[0] →
Pool Record`, `Pool Cooldown?[1] → Wait Submit Cooldown` (the old `Guard → Wait`
removed), every other node and the workflow settings identical, bodies
byte-equal to `paste/`.

`node db/port/pool-cooldown/check.mjs` — 19 assertions over the committed
bodies with a simulated pool, including the serial path. Not yet in
`npm run check`: wiring it means touching `platform/package.json`, which
deploys the site, and a Media Generation run was live when this shipped.

## Owed

- The first pooled film on `c4cd24ea`: in the log, `POOL submit failed … account
  rests 60s` lines with `POOL … poll` ticks continuing between them, and no
  window where every account goes quiet at once.
- Why the invited accounts run at half the manager's pace.

## Why the invited accounts are slower — answered the same day

**It is the captcha, not the generation.** Measured 2026-09-24 12:33-12:45
with a throwaway workflow (execution 16883 + a job read, 16889), on the two
invited accounts while the live batch used only `fermafabiz`, and read against
`captcha-stats` for the same hour:

| account | captcha attempts | accepted | CapSolver | 2Captcha |
|---|---|---|---|---|
| `fermafabiz` (the live batch's images) | 101 | **51 (50%)** | 48/76 (63%), ~16 s | 3/25 (12%), ~33 s |
| `houseofvideos01` | 13 | **1** | 1/8 | 0/5 |
| `houseofvideos02` | 13 | **0** | 0/8 | 0/5 |

Five of six image requests on the invited accounts ended `captcha_quality:
PUBLIC_ERROR_UNUSUAL_ACTIVITY after 5 attempts` (each 40-50 s of solving for
nothing). The one clip, on `01` with `veo-3.1-lite`: 3 captcha attempts, 41.8 s,
then **Google generated it in ~51 s** (created 12:34:04, media 12:34:46,
completed 12:35:37) — faster than the low-priority queue's ~110 s. So a slow
invited account is one whose requests spend most of their time being refused at
the captcha, and whose failed submits then rest (before `c4cd24ea`: froze the
pool). The image requests in this test were sent in parallel, which may have
lowered their scores; the single clip, and the Rome film's serial image phase
(01: 12 of 22 refused vs `fermafabiz` 1 of 26), point the same way.

**Why Google scores their tokens lower is not proven.** The accounts are a week
old (linked 2026-09-17) against the manager's months; reCAPTCHA Enterprise
weighs account and session history, so age/activity is the leading guess.

**Two things follow regardless of the why:**
- 2Captcha is ~9% accepted on every account and takes 20-35 s a solve (useapi's
  own docs: "30-60 seconds versus ~8-12 seconds for the others"). With
  `captchaRetry: 5` rotating CapSolver/2Captcha, two of every five attempts are
  near-certain losses. `captchaOrder` (e.g. CapSolver ×5) or a better second
  provider would cut that on ALL accounts.
- Invited accounts are better used for clips than for images: a clip is one
  captcha per 8 s of film, an image is one per scene and the image phase is
  serial.
