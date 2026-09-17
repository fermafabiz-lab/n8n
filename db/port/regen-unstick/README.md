# "Regenerate does nothing, and it has always been like this" (2026-09-17)

The producer: *"am dat regen la doua scene la ultimul clip si nu se intampla
nimic e blocat mereu am avut problema asta, diagnostica de ce se intampla si
repar o nu numai temporar."*

Status: **the n8n half is APPLIED and LIVE** — Media Generation
`yHG4DBCDjR3RJzav` active `6735a96a-e724-4a35-a988-e43ddf707957` (was
`71b42624-f8a8-4001-adc9-f6919a861293`), published 14:19 UTC. The site half is
NOT done; see "What is still owed".

## What was measured

Project `recqbPJ7aZu0a21mt`, *The Roman slave who conquered Egypt*, 48 scenes.
Two scenes carry `regen_video` set at **13:47**: order 2 (`recJtw0a2oGzyKaIz`)
and order 5 (`recN7ZFQetIKKrFjz`), both with a clip already, both
`image_approved` and `voice_approved`, neither `video_approved`.

Today's Media Generation executions for that film:

| execution | started | ended | verdict |
|---|---|---|---|
| 14199 | 10:51 | 10:55 | canceled |
| 14202 | 10:55 | 11:10 | **error** at `Decode Scene Image` |
| 14208 | 11:20 | 11:27 | **error** at `Decode Scene Image` |
| 14215 | 11:38 | 13:52 | **canceled** — and it had done the work: clips landed 12:14 → 13:40 |
| 14246 | 13:52 | still running at 14:18 | the current one |

Every one of the 48 scenes now has an image, a voiceover AND a clip. The film
is parked at the video-approval gate with nothing approved.

## Two separate causes, and the second is the one that made it "always"

### 1. A Flow refusal that arrives as HTTP 200 killed the whole film

`Generate Scene Image` carries `onError: continueErrorOutput`, so a refusal
that comes back as an HTTP error is routed into a real ladder: `IMG Error
Router` sorts it, `Prep Flow Reject` builds a rewrite brief, `Rewrite Prompt
AI` rewrites the prompt, and the scene is retried in place up to four times
before being handed back to a human.

**Flow also refuses quietly.** It answers HTTP 200 with a `generatedImage`
carrying the prompt and the seed and nothing else — no `fifeUrl`, no
`mediaGenerationId`. The HTTP node calls that a success, so the ladder never
sees it, and `Decode Scene Image`'s `throw new Error('No image in Flow
response…')` was uncaught. An uncaught throw ends the **entire execution**:
the image loop, the audio loop, the video loop and both gates, for all 48
scenes. Executions 14202 and 14208 died exactly there, on one scene whose
prompt opens *"Reference image 1 is a character sheet of Lazarus shown from
several angles…"* — the cast sheet itself is what the filter objected to.

While that is happening, a `Regenerează Video` flag cannot be cleared by
anybody: the only writer that clears it (`Evaluate Video Approval` →
`Prep Video Regen` → … → `Write Regen Video`) lives past the image gate.

**Fixed.** `Decode Scene Image` and `Decode Regen Image` now carry
`onError: continueErrorOutput`; the first routes into `IMG Error Router`, the
second into `Mark Image Regen Rejected` (where its HTTP sibling's failures
already go). The throw carries the marker `FLOW_NO_IMAGE`, and `IMG Error
Router` matches that marker FIRST and classifies it as a refusal — never as a
throttle, because the throttle branch re-asks the byte-identical prompt twenty
times over twenty minutes and a filter's verdict does not change on a re-ask.
`Prep Flow Reject` gives the rewriter a reason that says the refusal named no
cause and to assume the strictest reading.

### 2. Pause is the button that destroys a regeneration, and the site tells you to press it

This is the part that answers "mereu".

A video regeneration has **no webhook of its own**. The flag is noticed only by
`Evaluate Video Approval`, polling every 15 s from inside a live batch, and
only after that batch has walked the whole film. Once noticed, the work is a
Veo submit plus a poll loop — minutes, sometimes far longer — and none of it is
written to the database until it finishes.

So from the producer's side the badge reads "Regenerating video…" and looks
**identical at second one and at minute forty**, whether a batch is working on
it or nothing is running at all.

`resumeProject` answers a click with *"if it looks stuck for more than a few
minutes, use Pause first, then Resume"*. `pauseProduction` stops every running
execution and says *"Nothing is lost: every finished asset is already in
Airtable/Drive, and Resume picks up exactly where this left off."*

**That claim is false for a regeneration in flight.** A submitted Veo
generation is not a finished asset: it dies with the execution, and Resume does
not pick it up — it restarts the pass from the top and must walk the entire
film again before it reaches the video gate, where it submits a brand-new
generation. The timeline above is that loop in the concrete: 14215 had produced
every clip in the film and was sitting at the video gate when the flags were
set at 13:47; it was stopped at **13:52:16**, five minutes later, and 14246
started at 13:52:17 — the Pause-then-Resume the site recommends.

Do that once and you lose the regeneration. Do it whenever the badge looks
stuck — which is always, because the badge cannot look like anything else —
and a regeneration can never finish.

## What changed, exactly

Four node bodies, built by `build-paste.mjs` from `original/`, plus two node
settings and two connections:

| node | change |
|---|---|
| `Decode Scene Image` | the throw carries `FLOW_NO_IMAGE`; `onError: continueErrorOutput`; new edge `[1] → IMG Error Router` |
| `IMG Error Router` | matches the marker first, as a refusal, never a throttle; emits `imgNoImage` |
| `Prep Flow Reject` | a reason of its own for a refusal that names no cause |
| `Decode Regen Image` | same marker; `onError: continueErrorOutput`; new edge `[1] → Mark Image Regen Rejected` |

`check.mjs` runs all four bodies (and `original/` as the control) against the
verbatim 200-with-no-image response that killed 14208: 37 checks. What it pins
is not only the new behaviour but the old — every loud refusal, every throttle,
every 503 and the deliberate fatal 402 classify byte-identically to the live
router, so the only thing that moved is the case that used to kill the film.

Verification of the apply: all four bodies byte-identical to `paste/` in the
published draft (`node-body.mjs` + `cmp`), `diff-workflow.mjs --expect` clean
(only those four nodes differ, only those two nodes' edges changed, 12 Drive
nodes keep `resource`/`operation`, no dangling `$('…')`).

## What is still owed — and it is the bigger half

The n8n fix stops the film dying. It does **not** fix cause 2, which needs the
site:

1. **A regeneration must be legible.** The badge should say whether a batch is
   alive and how long the flag has been set. `regen_video_at`,
   `regen_image_at` and `regen_voice_at` exist for exactly this — `db/001`
   says so in as many words ("the `*_at` columns make staleness a query …
   One rule covers every flag, including the ones added later") — but
   `hov.at_scene` does not emit them and `RawScene` has no field for them, so
   the site cannot see them yet. That is the one schema change this needs.
2. **Pause must stop lying.** `pauseProduction` should count the scenes
   carrying a regen flag before it stops anything and say plainly that a
   regeneration in flight will start over.
3. **`resumeProject` must stop recommending it.** "Use Pause first, then
   Resume" is the correct cure for a wedged execution and the wrong one for a
   slow regeneration, and the message does not distinguish them.
4. **The image and voice regen badges still have no local exit** (video got
   one; CLAUDE.md has carried this note since the video pair was added).

Until 1–3 exist, the practical advice is the one thing that actually works:
**after asking for a video regeneration, do not press Pause.** Leave it; the
batch reaches the video gate on its own.

## Rollback

`restore_workflow_version` to `71b42624-f8a8-4001-adc9-f6919a861293`, or
`update_workflow` the four bodies from `original/` and remove the two error
edges. `Media Generation.before.json` is the exact draft this was built on
(`versionId == activeVersionId`, so nothing was parked).
