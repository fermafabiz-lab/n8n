# Video regeneration gets its own webhook (2026-09-17)

The producer: *"dai webhook propriu la regenerare construieste o dar sa o faci
corect si sa te verifici sa fie totul absolut ok si corect."*

Status: **APPLIED, PUBLISHED and VERIFIED END TO END.** Media Generation
`yHG4DBCDjR3RJzav` active `549d982d-6897-4b6a-a5a1-7f9d2685fd5d` (was
`4ecc8330-81ed-41bf-a4bb-28701d8aa9ac`). The site half is on this branch.

## Why

Video was the ONLY regeneration without a webhook of its own. Scene text,
image and voice each have one on Claude Scripting and start in seconds; a
clip could only be re-shot by a live Media Generation batch noticing
`Regenerează Video` from inside its video gate — after that batch had already
walked the whole film. So it was slow to start, invisible while it waited,
and destroyed by anything that stopped the batch.

That is the whole of "regenerate does nothing, and it has always been like
this" (`db/port/regen-unstick/README.md`): four stop-start cycles were
measured in four hours on 2026-09-17, each four to seven minutes in, none
long enough for a Veo generation. Nothing was broken. Every attempt was
working and every attempt was stopped.

**Measured after this change: click to new clip in 2 minutes 57 seconds, on
its own run.** (Execution 14316, below.)

## The design, and why it is not a copied tail

CLAUDE.md's restart-scripting precedent says a new entry point needs its OWN
tail, because the shared one reaches back to nodes only the first entry point
executes. That was true here — walking forward from `Prep Video Regen` and
scanning every `$('Node')` reference found exactly three outside names:

| reference | read by | for |
|---|---|---|
| `Receive Batch Input` | `RG End Frame Prompt`, `Submit Video Regen` | `Aspect_Ratio` |
| `IMG Load Project` | `Prep Video Regen`, `RG End Frame Prompt`, `RG Motion Prep` | `Editing Options` |
| `Fetch Scene Videos` | `Prep Video Regen` | `Versiuni Media`, to count takes |

(A fourth apparent hit, `$('Fetch Scene Videos')` in `RG End Frame Prompt`,
is a comment about a lookup deleted on 2026-09-14. Comments are not calls;
`check.mjs` strips them before it scans.)

Copying thirty nodes satisfies that rule and is the worse way to do it here.
The tail carries the world-consistency guardrail and the motion judge's
700-word question, each of which already lives in more copies than anyone can
hold — CLAUDE.md, *"A prompt fragment always lives in more copies than the one
you found"*. A third copy of the judge is a liability, not a safeguard.

So the rule was applied to its CAUSE instead: **the tail was made
self-contained.**

* `Prep Video Regen` becomes the single node that asks the outside world
  anything, and it asks whichever entry point actually ran (`isExecuted`, the
  idiom this workflow already uses sixteen times). It then carries `opts`,
  `aspectRatio` and `viaWebhook` in its output.
* The other three read that context off `Prep Video Regen`, which is inside
  the tail and therefore always executed.

After this the tail has exactly ONE node with an outside reference, guarded on
both sides. **Any third entry point now needs to feed that one node**, not
copy thirty.

```
Video Regen Webhook → VRW Load Scene → VRW Build Regen → VRW Can Regen?
   ├─ true  → Prep Video Regen → … the whole existing RG tail …
   │            ├─ Write Regen Video   → VRW Video Done?    ├ webhook → VRW End
   │            └─ Mark Regen Filtered → VRW Filtered Done? ┘ batch  → Wait Video Approval
   └─ false → VRW Refuse? ─ write → VRW Refuse → VRW End
                          └ no    →              VRW End
```

The two terminals need a path switch because the batch arm goes back to
`Wait Video Approval`, and that gate reads `$('Sort & Cap Scenes')` — a node
only the batch executes. A webhook run that fell into it would die there.

## What changed

**Nine nodes added**, all built by `build-ops.mjs` from committed files:
`Video Regen Webhook`, `VRW Load Scene`, `VRW Build Regen`, `VRW Can Regen?`,
`VRW Refuse?`, `VRW Refuse`, `VRW Video Done?`, `VRW Filtered Done?`,
`VRW End`.

**Four node bodies edited**, each a single named replacement in
`build-paste.mjs`:

| node | change |
|---|---|
| `Prep Video Regen` | the door discriminator; reads the project row and the scene row from whichever entry point ran; carries `opts` / `aspectRatio` / `viaWebhook` downstream |
| `RG End Frame Prompt` | `rb` and `opts` now come from `Prep Video Regen`, not from the orchestrator trigger and `IMG Load Project` |
| `RG Motion Prep` | `opts` likewise |
| `Submit Video Regen` | the aspect comes from `Prep Video Regen` |

**The webhook answers `onReceived`, and that is the one deliberate deviation
from its three siblings**, which all take n8n's default `lastNode`. Those
finish in seconds. This one is a Veo submit plus a poll loop, and the site
aborts a webhook after 15 s — `lastNode` would report a failure on every
successful regeneration. `onReceived` is also the honest answer: the request
was accepted, not completed.

`VRW Build Regen` REFUSES rather than throws. `Prep Video Regen` throws on a
scene with no Flow image id or no motion prompt; on this path a throw would
end the run with `Regenerează Video` still true and nobody left to clear it —
the stranded-flag dead end CLAUDE.md names once per in-flight flag. So every
reason to stop is decided before the tail, and each one either clears the flag
with an explanation or leaves a flag that was already gone alone.

### The one place duplication was unavoidable, and how it is held

`Evaluate Video Approval` composes the regeneration brief — strip the legacy
`Negative:` tail, suppress a machine note sitting in the producer's feedback
slot, append their correction as an `ADJUSTMENT REQUEST`. The webhook path has
to produce the byte-identical string or the two doors would shoot different
films from the same click.

It is **not retyped**: `build-paste.mjs` EXTRACTS that block from the live
body at build time and splices it into `VRW Build Regen`. Change
`Evaluate Video Approval`, re-run the builder, and the copy follows.
`check.mjs` then runs BOTH bodies against the same recorded rows and fails if
their output differs by a byte.

## The site half

`fireVideoRegenWebhook` in `platform/app/actions.ts`, derived from
`N8N_NEW_PROJECT_WEBHOOK_URL` like its three siblings, fired from all three
places that set the flag: `approveScene(video, regenerate)`, `chainVideoRegen`
(the clip queued when an approved image made it stale) and
`restartVideoRegen`. Each falls back to the old `nudgeProduction` where the
webhook is not configured.

**`pauseProduction` now spares a single scene's regeneration.** This is not
cosmetic: Pause stopped every running execution, so the button the producer
pressed when a regeneration looked stuck was guaranteed to kill the
regeneration. Giving video its own webhook only removes that if Pause then
leaves it alone. The rule is narrow and reads off the execution's `mode`,
newly carried through `ExecutionSummary`: a `webhook` run on Media Generation
or Claude Scripting is one scene's work; everything else is the film's.
Final Assembly's `assemble` webhook is a render of the whole film and Pause
still stops it; a run whose mode is unknown is treated as production.

`RegenBadge` gains `standalone`, and the image, voice and video badges all
pass it. The old copy told the producer a regeneration is "only ever picked up
by a live production run" — true when it was written, and for video it was the
sentence that sent them to the button that threw the work away.

## Verified

Unit level, `node db/port/video-regen-webhook/check.mjs` — **86 checks**, run
against rows read out of Postgres (project `recqbPJ7aZu0a21mt`, scene
`recJtw0a2oGzyKaIz`). It pins three things: the two doors compose the
byte-identical brief across seven field shapes; the batch path did not move
(every edited node run the way the batch runs it, compared against the
ORIGINAL body, with the three new keys as the only permitted difference); and
no node after `Prep Video Regen` calls a one-door node. Five deliberate
mutations were injected to confirm the check is not vacuous — all five caught.

Shape level, `node db/port/video-regen-webhook/check-live.mjs <snapshot>` —
**94 checks** against the applied workflow.

Apply level: `simulate.mjs` applied `ops.json` to the live snapshot offline,
`diff-workflow.mjs` compared the published draft against that simulation —
0 nodes changed, connections identical, no dangling `$('…')` references, 12
Drive nodes keeping `resource`/`operation`.

**Live, all four paths:**

| what | execution | result |
|---|---|---|
| flag already false → stop, write nothing | 14312 | 124 ms, both Ifs took their FALSE branch, `Prep Video Regen` never reached |
| no `scene_id` in the body | 14320 | threw loudly, as designed |
| no Flow image id → refuse AND clear the flag | 14326 | 105 ms; flag false, `REJECTED — …` written, `Aprobare Video` deliberately untouched |
| **a real regeneration** | **14316** | **16:38:28 → 16:41:25, 2 min 57 s** |

The real one, on the disposable film `recZHr8go7vcYiQZp` scene
`reclw7OP6c7dpTvhf`, with a producer note attached ("the beam should sweep
left to right, not right to left"): the POST was accepted in 108 ms, the clip
changed from Drive `1QQGyA1sE06…` to `1994KH4oUSd9kvo…`, `regen_video` went
false, `regen_video_at` cleared, status back to `Așteaptă Aprobare Video`.

**That is the measurement CLAUDE.md has owed since 2026-09-17 morning** — "no
real video regeneration has yet been watched from click to new clip".

## Two traps found on the way, both worth knowing

**`addConnection` accepts `sourceOutput: 1` and silently ignores it.** The
key is `sourceIndex`. With `sourceOutput` every edge lands on output 0, which
on an If node puts BOTH branches on `true`. Here that would have sent every
refusal into `Prep Video Regen` (a throw) and every webhook run back into the
batch gate — the exact failure this change exists to prevent. Nothing
complained; the workflow validated clean. It was caught only by diffing the
live draft against the simulated one, edge for edge, and `check-live.mjs` now
asserts it directly. **Never trust a branch index you did not read back.**
(`from`/`to`/`fromOutput`, by contrast, is rejected outright and rolls the
whole call back — that one is safe.)

**`updateNodeParameters` MERGES, it does not replace.** Verified on a
throwaway: sending one key left the node's other parameters untouched. That is
what lets `Submit Video Regen` be edited by sending `jsonBody` alone — its
other parameters include a useapi bearer token typed into a header, which the
API does NOT redact (only credential bindings come back as `None`), so sending
the whole object would have copied that token into `ops.json` and into this
commit. `build-ops.mjs` refuses to emit a query containing `$hov$$` or a `$`
followed by a digit for the same class of reason.

`addNode`, however, DROPS `alwaysOutputData` — `check-live.mjs` caught it and
`setNodeSettings` applied it.

## Files

- `build-paste.mjs` → `paste/` from `original/`, idempotent
- `build-ops.mjs` → `ops.json`, the exact operations, with SQL guards
- `simulate.mjs` → `mg.expected.json`, and walks both paths offline
- `check.mjs` (86), `check-live.mjs` (94), `fixtures.mjs` (real rows)
- `original/` — the five live bodies this was built on, byte-identical to
  version `4ecc8330` when extracted

The full workflow snapshots are `.gitignore`d: 600 kB each, and the useapi
token sits in them unredacted. Regenerate with `get_workflow_details` when
this is next touched.

## Rollback

`restore_workflow_version` to `4ecc8330-81ed-41bf-a4bb-28701d8aa9ac`. The
nine new nodes go with it; the site's `fireVideoRegenWebhook` then answers
"off" (the path 404s) and every call site falls back to `nudgeProduction`,
which is exactly the old behaviour — so the site does not have to be reverted
in the same breath.

## What is owed

- **One regeneration watched from the site itself**, not from a webhook fired
  by hand. Everything above proves the chain; nobody has yet clicked
  "Regenerate video" in the browser and watched the badge clear.
- The disposable film `recZHr8go7vcYiQZp` now carries the demonstration:
  scene order 1 has a clip re-shot through the webhook, and scene order 2 had
  its `image_media_id` blanked on purpose to exercise the refusal and still
  carries the `REJECTED …` note. Delete the film when it has served its
  purpose; nothing else reads it.
- The batch still notices `Regenerează Video` at its own video gate, so a
  scene can in principle be picked up by both doors at once — wasteful, not
  corrupting, and the same race the image and voice regenerations have always
  had. Left as is, deliberately.
