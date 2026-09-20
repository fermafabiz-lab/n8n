# Etapa 3 — the in-flight pool

Status: **designed, measured, not built.** Etapa 1 and 2 are live and verified;
this is the only stage that actually makes a film finish sooner.

## Why the clip phase is the only phase worth parallelising

Voices are ElevenLabs and already fast. Images are serial by necessity —
`POST /images` answers `400 Parameter async not supported`. Clips are the hours:
`Submit Video` sends `async: true`, gets a `jobid` in about a second, and then the
execution sits in `Wait Video` → `Poll Video Job` for minutes per scene, one scene
at a time. Eighty scenes is roughly 6.7 hours of almost nothing but waiting.

**The concurrency we need is at Google, not in n8n.** Nothing has to run in
parallel inside the execution; it only has to stop blocking on one job at a time.

## The measurement that changes the design

The plan in `/root/.claude/plans/…` says several concurrent Media Generation
executions are "blocked by workflow-scoped static data". **That is wrong, and it
was never checked.** Every counter the clip chain keeps in
`$getWorkflowStaticData('global')` is keyed BY SCENE ID:

| key | node |
|---|---|
| `sd.polls[sceneId]` | `Check Job Status`, `Resubmit Guard`, `Motion Resubmit` |
| `sd.resubmits[sceneId]` | `Resubmit Guard` |
| `sd.rewrites[sceneId]` | `VP Prep` |
| `sd.motionRerolls[sceneId]` | `Motion Prep`, `Motion Verdict` |
| `sd.motionNotes[sceneId]` | `Motion Verdict` |

Scene sets are disjoint across account blocks, so those never collide. The only
non-scene-keyed state is the end-frame circuit breaker (`sd.endFrameOffAt`,
`sd.endFrameFails`) — and sharing THAT across blocks is correct, since it exists
to make everything back off when end frames start failing.

So concurrency between executions is safe. It is a different obstacle that rules
it out — see below.

## Why not three executions

A second entry point into the clip chain would have to supply everything the
chain looks up by node name: `Receive Batch Input` (an `executeWorkflowTrigger`,
which a webhook execution never runs), `IMG Load Project`, `Sort & Cap Scenes`
and `Assign Accounts`. `$('X').first()` on a node that did not run throws. This
is `CLAUDE.md`'s "any third entry point needs its own tail", and here the tail is
38 nodes and 77,341 characters of parameters.

Copying it into a worker workflow would double the most duplicated code in the
project — the motion tail already lives in seven places, and the lesson on record
is that a prompt fragment always lives in more copies than the one you found.
Rejected on maintenance grounds, not on correctness.

## Why not rewrite the chain to carry per-item context

Eleven nodes read `$('Current Scene').first()`, and they are the largest bodies in
the workflow: `End Frame Prompt` 13,587 chars, `Motion Resubmit` 12,739,
`Motion Prep` 9,686, `Motion Verdict` 9,159, `Current Scene` 8,020. Rewriting them
means transcribing about 50,000 characters of Code through MCP, which `CLAUDE.md`
says cannot be done from a web session — it is exactly why Etapa 1 put the account
override in the 24-633 character HTTP nodes instead of in `Build Image Request`.

## The design that needs neither

**Keep `Current Scene` as the one place that names the scene, and re-run it once
per pool action.**

The pool is a sequence of TICKS, and each tick acts on exactly one scene. Within a
tick the path is linear, so `$('Current Scene').first()` — a node's latest run — is
that tick's scene for every node downstream of it. The eleven large bodies keep
working untouched, because they never run outside the tick that set their scene.

```
Sort Scenes For Video → Pool Init ─ off → Loop Scenes            (today's chain, untouched)
                                  └ on  → Pool Tick
Pool Tick → Pool Route
   ├ submit → Current Scene → Pool Action? ─ submit → Needs Clip? → … → Submit Video → Pool Record
   ├ poll   → Current Scene → Pool Action? ─ poll   → Poll Video Job → … → Pool Record
   ├ wait   → Pool Wait (20s) → Pool Tick
   └ done   → Wait Video Approval                                  (today's gate)
Pool Record → Pool Tick
```

`Pool Tick` holds the state in the item it emits — `{queue, inflight, done}` — and
`Pool Record` reads it back with `$('Pool Tick').first()`, which is unambiguous
here for the same reason: one tick at a time. **No static data, so nothing new can
collide.**

Poll spacing stays under 65 s, above which n8n suspends the execution and loses
the item state.

### What must change, and it is all small

| node | chars | change |
|---|---|---|
| `Poll Video Job` | 320 | take the jobid from the pool item, not `$('Submit Video')` (its latest run is another scene's) |
| `Submit Video` | 1,135 | same treatment for `$('Motion Resubmit')` / `$('Submit Cooldown Guard')` |
| every `→ Loop Scenes` return edge | — | re-point at `Pool Record` when the pool is on |

Six new nodes: `Pool Init`, `Pool Tick`, `Pool Route`, `Pool Wait`, `Pool Record`,
`Pool Action?`.

### The window

`shards = accounts x jobs_per_account`. Start at one job per account — three in
flight — because P2 showed a single account answers `429 Try spacing your requests
out` to three submits 7-13 s apart, and **whether one account can hold two
generations at once has never been measured**. The probe is: submit, wait 60 s,
submit, compare completion times. Do it before raising the window.

## Safety

Gated on `Editing Options.videoPool`, strict boolean, default OFF — the same shape
as `flowAccounts`, `endFrame` and `motionJudge`. With the flag off, `Pool Init`
routes to `Loop Scenes` and the executed graph is identical to today's.

The invariant to protect in review: **no node that reads `$('Current Scene')` may
run in a tick other than the one that set it.** Every edge added to the pool has to
be checked against that by walking the graph, not by eye.

## Verification

1. A disposable film with `flowAccounts: 3`, `videoPool: true`, at least six scenes.
2. Three clips in flight at once, seen as three `jobid`s outstanding in the tick log.
3. Every clip lands on the scene it belongs to — the failure mode of a broken tick
   is a clip written to the wrong scene, which no existing check would catch.
4. Wall clock against the same film with the flag off.

---

## Applied 2026-09-18 (Media Generation `8ce5af14`, rollback `8c4ef1bf`)

Nine nodes added, one changed, nothing removed.

| node | kind | role |
|---|---|---|
| `Video Pool?` | if | reads `Editing Options.videoPool`; false → `Loop Scenes`, the serial path |
| `Pool Tick` | code | the brain; one tick, one action, one scene |
| `Pool Route` | switch | `wait` → `Pool Wait`, `done` → `Wait Video Approval`, fallback → `Current Scene` |
| `Pool Wait` | wait, 20s | under the 65s suspension threshold |
| `Pool Action?` | if | after `Current Scene`: poll tick → `Poll Video Job`, otherwise → `Needs Clip?` |
| `Pool Submitted?` | if | after `Submit Video`: pool on → `Pool Record`, off → `Wait Video` |
| `Pool Retry?` | if | job not finished: pool on → `Pool Record`, off → `Wait Retry` |
| `Pool Record` | code | folds the tick's result in; edges told apart by `$prevNode.name` |
| `Pool Return?` | if | pool on → `Pool Tick`, off → `Loop Scenes` |

`Poll Video Job` is the only existing node changed: its url read
`$('Submit Video').first().json.jobid`, whose latest run belongs to a different
scene once more than one clip is in flight. It now prefers `$json.poolJobid`,
which `Current Scene` carries through because it returns
`Object.assign({}, $json, …)`, and falls back to the old lookup on the serial path.

**Verified before publishing.** Diff against `8c4ef1bf`: 225 → 234 nodes,
`added 9, removed 0, changed 1`, and the one change is the url above. No dangling
`$('…')` references anywhere in 234 nodes, all 12 Google Drive nodes intact. Every
Code body and every routing expression byte-identical to its file in `paste/`.

**The OFF path was walked edge by edge**, because "it only runs when the flag is
on" is exactly the kind of claim that is wrong in one branch:

```
Sort Scenes For Video → Video Pool?(1) → Loop Scenes → … → Current Scene
  → Pool Action?(1) → Needs Clip? → … → Submit Video
  → Pool Submitted?(1) → Wait Video → … → If Job Failed(1)
  → Pool Retry?(1) → Wait Retry
returns: Update Scene Record / Mark Video Prompt Rejected / Needs Clip?(1)
  → Pool Record (no state → passes through) → Pool Return?(1) → Loop Scenes
```

Same order, same nodes, same data — six extra gates that only forward.

**Still owed, and it is the whole point:** a run with `videoPool: true`. Nothing
below has been exercised even once.

1. Three clips in flight at the same time — `POOL submit … (3 in flight)` in the log.
2. **Every clip written to the scene it belongs to.** This is the failure mode
   that matters: a tick that reads another tick's `Current Scene` would write a
   clip to the wrong scene, and no existing check would catch it. Audit by
   decoding each scene's `video_media_id` and comparing with its block account.
3. Wall clock against the same film with the flag off.
4. Only then the probe for whether one account holds two generations at once,
   before `videoPoolPerAccount` goes above 1.

## First pool run: execution 14618 (2026-09-18 09:54 → 10:20)

`rec1rkfxvBeMCFDRj`, `videoPool: true`, `flowAccounts: 3`, one job per account.

**What the pool got right.**

- Ten ticks, two clips written, and **every clip minted on the account that owns
  its own scene's image** — 4 of 4 across the film, counting the two from the
  earlier serial run. The failure this design was most exposed to, a tick reading
  another tick's `Current Scene` and writing a clip to the wrong scene, did not
  happen.
- Three submits went out before the first clip came back, on three different
  accounts. That is the concurrency, and it is impossible in the serial loop.
- Two clips landed 26 seconds apart on different accounts.

**What killed it, and it was not the pool.** The run ended `error` at tick 10:

```
400 Email mismatch: body has 'houseofvideos01@gmail.com',
                    references have 'houseofvideos02@gmail.com'
```

`Submit Video` turns out to be written carefully — every one of its stale-run
lookups (`Attach End Frame`, `Submit Cooldown Guard`, `Motion Resubmit`) is
already guarded by `sceneId === cs.id`, so no cross-tick contamination was
possible there. The disagreement came from `Assign Accounts`.

**The latent Etapa 1 defect the pool exposed.** `Assign Accounts` assigned the
account purely by POSITION in the list it receives. That list is not the same
between passes: `Sort & Cap Scenes` puts scenes that already have a clip at the
BACK. So on a second pass over a partly-finished film — this film had two clips
from the earlier run — every block boundary moves, and a scene whose image was
minted on account 02 is handed account 01. Every such scene then dies on
`Email mismatch`.

**This was never about the pool.** The serial loop would fail identically on any
second pass of a multi-account film; it had simply never had one. `flowAccounts`
defaults to 1, so no production film was exposed.

**The fix (Media Generation `2d3f0f86`, rollback `98e7b4b0`).** The IMAGE is the
anchor, not the position: a scene that already has an `Image Media ID` stays on
whatever account minted it, and position decides only for scenes with no image
yet. It costs nothing in balance — a scene with an image no longer needs image
generation, which is the only phase the block split exists to spread — and it
makes the assignment stable across passes instead of drifting with the sort.
Diff: 234 → 234 nodes, added 0, removed 0, changed 1, connections identical,
body byte-identical to `paste/Assign Accounts.js`.

**Still owed:** a pool run that reaches the end of a film. Nothing above shows
the pool finishing; it shows it working for ten ticks and then hitting a bug in
a node it does not own.

## Second pool run: the film finishes (execution 14645, 2026-09-18 10:44)

Same film, with the anchor fix live (`2d3f0f86`). This was exactly the case that
broke run 14618 — a second pass over a partly-finished film, where
`Sort & Cap Scenes` moves the finished scenes to the back and every block
boundary shifts.

**Result: 9 of 9 scenes have a clip, and `wrong_account` is 0.** Every clip is
minted on the account that owns its own scene's image. No `Email mismatch`.

The five clips this run produced, from a 10:44:55 start:

| scene | account | landed |
|---|---|---|
| 101 | `houseofvideos01` | 10:47:02 |
| 103 | `houseofvideos02` | 10:49:07 |
| 3 | `fermafabiz` | 10:49:55 |
| 104 | `houseofvideos02` | 10:50:46 |
| 105 | `houseofvideos02` | 10:52:34 |

**What this does and does not measure.** Five clips in 7m39, against a per-clip
latency of roughly two minutes — so about 92 s per clip end to end. That is
better than serial, but it is NOT the 3x the three accounts suggest, and the
reason is visible in the table: the work left on this film was 1 clip on the
primary, 1 on account 01 and **3 on account 02**. At one job per account, those
three are strictly serial, and they are the critical path. The pool cannot beat
an uneven remainder.

**So the honest claim is correctness, not speed.** The pool runs a film to
completion, writes every clip to the right scene on the right account, survives
a second pass, and interleaves across accounts. A real speed measurement needs a
film whose clip work is EVENLY divided — which means measuring on a first pass,
where `Assign Accounts` splits the scenes into equal blocks, not on a remainder.

**Still owed:**

1. A first-pass film with `videoPool: true` and enough scenes for the blocks to be
   even, timed against the same film with the flag off. That is the only number
   that answers "does a film finish sooner".
2. The probe for whether one account holds two generations at once, before
   `videoPoolPerAccount` goes above 1. With an even split that is what turns 3
   in flight into 6.

## The A/B, 2026-09-18 — the serial baseline is the easy half

The film above (`rec1rkfxvBeMCFDRj`, nine scenes, three accounts, all nine
images already on the right accounts) was cleared of its clips and run twice on
the same scenes, changing exactly one thing: `videoPool`.

### Arm A — `videoPool: false`, fired 12:26:24

| scene | account | clip landed | gap |
|---|---|---|---|
| 1 | `fermafabiz` | 12:28:09 | 1m45 from the start |
| 2 | `fermafabiz` | 12:29:34 | 1m25 |
| 3 | `fermafabiz` | 12:30:59 | 1m25 |
| 4 | `houseofvideos01` | 12:32:39 | 1m40 |

**One clip every 85–100 seconds, dead steady.** The run was stopped at 12:35:06
before it reached scene 101, so the nine-clip figure is an extrapolation rather
than a stopwatch: 9 × ~88 s ≈ **13 minutes**. The cadence is regular enough over
four consecutive clips that the extrapolation is worth more than the fifth
data point would have added.

Note what the account column already proves: `Assign Accounts` split nine scenes
into three even blocks — 1/2/3 on the primary, 4/101/102 on account 01,
103/104/105 on account 02 — which is the even split the previous run lacked.
This is the first pass that entry 1 under "Still owed" asked for.

**Arm A was killed by something outside this session**, 8m42 into the run, with
a fresh webhook execution starting 46 seconds later. That is neither of the two
signatures documented in `docs/lessons-site.md`: `restartProduction` leaves a
1.7–5.3 s gap between the cancel and the resume, and `pauseProduction` stops
every running execution inside 130 ms. A 46-second gap is a person reading the
page between two clicks. **Nothing in an execution records who stopped it**, so
this stays an inference — but it is the third time a timing run on this film has
been cut short from outside, and that is the reason the serial arm is an
extrapolation.

### Arm B — `videoPool: true`, fired 12:47:10

Same nine scenes, cleared again, nothing else changed.

| account | clips | landed | gap |
|---|---|---|---|
| `fermafabiz` | 1, 2, 3 | 12:49:30, 12:51:38, 12:53:46 | 2m08, 2m08 |
| `houseofvideos01` | 4, 101, 102 | 12:49:07, 12:51:28, 12:53:58 | 2m21, 2m30 |
| `houseofvideos02` | 103, 104, 105 | 12:49:18, 12:55:49, 12:57:15 | **6m31**, 1m26 |

**9 of 9 clips, every one on the account that owns its scene's image, zero
`Email mismatch`.** The three accounts submitted 14 seconds apart (12:47:31,
12:47:45, 12:47:59) and the first three clips landed within 23 seconds of each
other — the pool holds exactly three in flight, one per account, as designed.

### The number

| | clips | wall clock |
|---|---|---|
| Arm A, serial | 9 (extrapolated from 4) | **~13m12** |
| Arm B, pool | 9 (measured) | **10m05** |

**1.31x. Not 3x.** Two things eat the difference, and they are different in kind.

**The one that is an accident:** scene 104 took 6m31 against a 2m10 norm.
**Why is unknown.** The first guess was a motion re-roll, and it is wrong: no
scene on this film carries an extra `media_versions.video` entry, and the only
note anywhere is on scene 3 — an `AUTO-REWRITE-VIDEO` from Google's content
filter — which is the wrong scene AND carries no timestamp, so it cannot even be
attributed to this run. Scene 3 landed on its account's cadence to the second
(12:49:30 / 12:51:38 / 12:53:46, gaps of 2m08 and 2m08), so whatever that
rewrite cost, it was not six minutes. The 104 outlier stays unexplained.
Without it account 02 would have finished around 12:54 with the other two, for a
total near 7 minutes. **With three accounts the slowest account IS the film**, so
a single re-roll costs the whole run its margin. The serial arm has the same
exposure but spreads it: one re-roll there adds its own length and nothing more.

**The one that is structural, and was not predicted:** the pool's per-clip time
is **2m10 per account**, against the serial arm's **1m28**. Three accounts do not
buy 3x because each account's own clips got ~48% slower.

**Correction, 2026-09-20.** This entry first blamed `POLL_EVERY_MS = 20000` for
part of that gap — a finished job being noticed only on its next poll turn.
**That is wrong, and it is wrong in the informative direction.** The serial
path's own waits are COARSER than the pool's: `Wait Video` is **30 s** and each
`Wait Retry` is **15 s**, against the pool's 20 s. If detection latency were the
story the pool would come out AHEAD, not 42 s behind. Polling cannot be why.

Tick contention does not cover it either. With three jobs in flight a job's
effective poll interval is 20 s plus the couple of ticks spent on the other
two — call it 8 s at a few seconds a tick. That is not 42 s.

What the run does say, and it is the useful part:

| jobs in flight | land-to-land on one account |
|---|---|
| 3 (waves 1–3) | 2m08 – 2m30 |
| **1** (scene 105, after the other accounts had finished) | **1m26** |

The pool's LAST clip, running alone, was indistinguishable from serial's 1m25.
Same machinery, same film, same hour — only the concurrency differed. So the
penalty **scales with the number of jobs in flight**, and with polling and tick
cost both too small to carry it, the leading explanation is now that three
concurrent generations really are slower at Google, on three separate accounts
under one useapi tenant.

That is still an inference from one run, not a measurement. But it points the
next experiment somewhere different from where this entry first sent it.

So the ceiling with three accounts at one job each is not 3x; on these numbers it
is closer to **1.5x**, and the measured figure is 1.31x because of the re-roll.

### What this means for a real film

At the measured rates, a film whose clip work is evenly split three ways:

| scenes | serial | pool |
|---|---|---|
| 9 | 13m | 10m |
| 80 | ~2h | ~1h |

**Do not carry the "80 scenes = 6.7 h" figure from the Etapa 2 plan forward** —
that implies about 5 minutes per clip, and this film measured 88 seconds serial.
Either the older number covered more than clip generation, or these clips are
cheaper than a real film's. It is not reconciled, and the honest reading is that
the RATIO above is the transferable part, not the absolute minutes.

### Next, in order of what it buys

1. **Find out whether Google is slower when three of our accounts generate at
   once.** This is worth more than any other change here: if the 42 s is ours,
   closing it takes the same three accounts from 1.5x to nearly 2.5x; if it is
   Google's, no amount of tuning helps and the honest ceiling is 1.5x.
   **Do NOT start by lowering `POLL_EVERY_MS`** — that was this document's first
   instinct and the correction above shows why it cannot be the cause.
   The experiment is a submit-to-land stopwatch, not a land-to-land one: submit
   ONE clip alone and time it, then submit three on three accounts within a few
   seconds and time each. Same scenes, same model. If the three are each
   markedly slower than the one, it is Google and this line of work is done.
2. The probe for whether one account holds two generations at once. With an even
   split that turns 3 in flight into 6 — but only after (1), or it compounds the
   per-clip penalty instead of the gain.
3. Nothing here justifies raising `videoPoolPerAccount` yet.

### 2026-09-20 — the submit-to-land experiment, attempted and stopped

The test film `rec1rkfxvBeMCFDRj` this whole file measures **no longer exists**:
by 16:42 on 09-20 the project row and all nine scenes were gone, along with
every other disposable film (`%test%`, `%disposable%`, `%probe%` all return
nothing). Someone cleaned up. The `resume-project` fired at it ran 15 ms and
did nothing — `Fetch Project For Resume` returned zero rows, and a node that
returns zero rows stops everything after it, silently.

A fresh film was created instead, through the LIVE brief path with the new
control — `recGea91h5CGUvTeB`, "ZZ DELETE pool timing", `flowAccounts: 3`,
`videoPool: true` confirmed in Editing Options — which would have been the
first film to go through replication and the pool from creation. Its scripting
(execution 15511) wrote the Story Bible and one script row at 16:45:30 and then
**nothing for 24 minutes** — the same shape as `db/port/scripting-timeout/`,
with the per-call timeout armed this time — and was **cancelled from outside at
17:09:33**, before any ceiling could fire and name the node. No execution
started after it, so it was a Pause or a manual stop, not a restart.

So the experiment is still owed, and so is the stall's diagnosis, and both for
the same reason: **four timing runs in three days were stopped by someone else
on a shared instance, and a cancelled execution keeps no data.** Running it
again unattended while others are working is throwing away runs. It needs a
quiet window — or, better, one real film the producer makes with "All accounts
at once" and leaves alone, whose Media Generation execution can then be READ
after its video gate is approved.

`recGea91h5CGUvTeB` is left in place on purpose: it is the one film that
reproduces the scripting stall with the guard armed, so a "⟳ Restart writing"
on it is the cheapest possible chance of the timeout finally naming the node.
Delete it once that has been tried.
