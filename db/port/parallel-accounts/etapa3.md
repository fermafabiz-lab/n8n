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
