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
