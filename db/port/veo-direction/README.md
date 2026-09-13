# Veo direction: the clip that plays the shot backwards

The producer's report, 2026-09-13: *"scena spunea cum mașina iese din curte,
iar mașina mergea cu spatele către curte"* — the prompt said the car pulls
out of the yard, the clip showed it reversing into the yard. Not a one-off;
"rateuri cu lucruri fără logică" on `veo-3.1-lite-low-priority`, which is the
tier every film runs on and is staying on (the producer's explicit call:
*"vreau să rămână full veo lite low priority"*).

Three changes, none of which touch the model tier.

| | What | Where | State |
|---|---|---|---|
| **B** | Drop the continuity clause that contradicted the shot | `Current Scene`, `Submit Video Regen` | **LIVE** — version `b4dec1a9` |
| **A** | Draw the END frame and send `startImage + endImage` | 4 new nodes + `Submit Video`, `Submit Cooldown Guard` | draft `281e9134` |
| **C** | Judge the clip's motion, re-roll when it is wrong | 6 new nodes + `Submit Video`, plus `/inspect?save=1` | draft |

Baseline for both: `Media Generation.original.json`, a `get_workflow_details`
dump at `b9779578` (177 nodes) — the version B was built on. Every node body
in `paste/` is the file that was pasted, and `original/` holds what it
replaced, per the `db/port/lib/README.md` convention.

---

## B — the rule that fought the shot

The motion prompt written by the segmenter was never the problem. A query
against live scenes shows rule 6 works: *"surges right to left out of the
substation"*, *"advances away from the camera"* — direction is stated.

What was appended underneath it was the problem. The old tail opened with

> everything that moves travels the same way as the subject — no oncoming
> vehicles, nobody walking or driving against the flow

which is not a general truth but a rule that **forbids shots this pipeline
legitimately writes**. Scene 101 of the LEGO chase film asks for the cruiser
right-to-left with the Ferrari left-to-right ahead of it: the clause bans it
outright. So does a crossing, and so does a car pulling into traffic. Handed
a prompt and a rule that contradict each other, the weakest model on the tier
resolves the contradiction whichever way it likes — a coin flip on every clip,
which is exactly the symptom reported.

`no reversed motion` went with it: it reads two ways (reverse PLAYBACK, or a
vehicle driving backwards) and it is a negation, which is a poor way to not
get a thing. What replaced it is positive and sits at the FRONT of the prompt,
where a model weights it most:

> Single continuous shot, no cuts and no scene changes. Begin exactly on the
> given frame and play the action below as written, in the direction written.

Solidity, drivers, no-popping-in-and-out and the audio guardrail all stay.
Parallax stays too, rephrased as the background agreeing with the camera
rather than as a ban on anyone moving the other way.

**Both submit paths changed identically** — the batch's `Current Scene` and
the gate's `Submit Video Regen`. A fix applied to one of them only would make
a regenerated clip disagree with its neighbours.

## A — the end frame

Veo on the free tier gets a start frame and a sentence and invents the rest.
When the sentence says the car pulls out of the yard and the still shows it
parked nose-in, the model has to choose *how*, and it chooses differently
every time.

useapi supports **I2V-FL on every Veo variant**, ours included: `startImage`
plus `endImage`, "video ends with this frame". (End-frame-ONLY is not
supported, which is why this chain is useless on a scene with no
`Image Media ID`.) Given both, direction stops being rhetoric and becomes
geometry — a car that must END outside the gate cannot get there by driving
in.

```
Mark Generare Video → End Frame Prompt → End Frame? ─true→ Generate End Frame → Attach End Frame ─┐
                                              └──────false──────────────────────────────────────→ Submit Video
```

The end frame is drawn by the same image model that drew the first one
(`nano-banana-2`) with the **start frame as `reference_1`**, so composition,
wardrobe, light and style carry over and only what moves has moved. It is
scaffolding: never stored on the scene, never re-hosted, never shown to
anybody. Images are free on the Ultra plan, so it costs queue time only —
and that is the real price of this feature, roughly one extra image
generation per scene.

**Why Characters (option E) was dropped rather than added alongside.**
`reference_*` and `character_*` both trigger R2V (Ingredients) mode on Veo
and, in useapi's words, "cannot be combined with startImage / endImage". The
approved still is worth more than either, so start+end is the shape we take.

### Every failure degrades to today's behaviour

This sits on the happy path of the whole batch, so nothing in it may ever be
able to kill a film:

- `Generate End Frame` carries `onError: continueRegularOutput`;
- `Attach End Frame` never throws — every failure returns an empty
  `endImage`;
- `Submit Video` merges `endImage` only when it is non-empty AND its
  `sceneId` matches the scene in hand. That guard matters because
  `.first()` returns a node's **latest run**, not the run belonging to the
  current item: on a scene that skipped the end frame, the latest
  `Attach End Frame` run is the PREVIOUS scene's.

### Two kill switches, because a rejected end frame must not cost 80 minutes

If the tier turned out not to accept I2V-FL after all, every scene would burn
20 cooldowns of 60s and then kill the batch. So `Submit Cooldown Guard` — the
node that already catches a failed submission — learned two levers, one for
each way `Submit Video` is reached:

- **`dropEndFrame`**, read by `Submit Video`'s expression. The retry that
  comes back from `Wait Submit Cooldown` does NOT pass through
  `End Frame Prompt`, so a Code node cannot reach it; the expression can.
  That scene's retry goes out as a plain start-frame submission.
- **`sd.endFrameOffAt`**, read by `End Frame Prompt`. Every later scene skips
  the end frame. It trips only when the failure looks systematic: the reason
  names the end frame, or three submissions carrying one have failed inside
  an hour.

`sd.endFrameOffAt` is a **timestamp, expiring after six hours**, and is
deliberately NOT reset by `Sort & Cap Scenes` where every other per-pass
counter is. Static data is global and outlives the execution, so a plain
boolean set once would disable end frames for every future film until
somebody noticed — and adding a reset line means editing the node that owns
scene ordering and the batch cap for a feature that has nothing to do with
either.

The producer's own switch is `endFrame: false` in `Editing Options`.

### Still owed

- Mirror the chain onto the regen path (`Submit Video Regen`) once the batch
  path is proven, so a regenerated clip gets the same direction the batch
  gave its neighbours.
- Watch the first real film for **morphing**: I2V-FL interpolates, so two
  frames that differ too much give a dissolve rather than a move. The end
  frame prompt leans hard on the reference for everything that must NOT
  change precisely because of this, but it has not been seen on a long film.

---

## Verified live before publishing — 2026-09-13, execution 12930

A throwaway workflow (`zz endframe probe`, archived) drew a start frame, drew
the end frame from it, and submitted one clip on the free tier. Every step of
the design was confirmed by Google's own echo of the request, not by a green
tick:

**The end frame took the start frame as a reference.** The images call came
back with `imageGenerationImageInputs: [{ imageInputType:
IMAGE_INPUT_TYPE_REFERENCE, mediaId: 5947ff58-… }]` — `reference_1` is the
right parameter name for a Flow media id, as `Build Image Request` already
uses it for cast sheets and set plates.

**The free tier accepts I2V-FL.** This is the whole question A rested on, and
the answer is in the video request Google echoed back:

```
videoModelName:        veo_3_1_interpolation_lite_low_priority
videoModelCapabilities: [VIDEO_MODEL_CAPABILITY_START_AND_END_IMAGE]
videoGenerationMode:   VIDEO_GENERATION_MODE_IMAGE_TO_VIDEO
videoGenerationImageInputs:
  - IMAGE_USAGE_TYPE_START_IMAGE  5947ff58-…
  - IMAGE_USAGE_TYPE_END_IMAGE    efd54edf-…
```

Note the model name: given two frames, Google routes `veo-3.1-lite-low-priority`
to its **interpolation** variant automatically. Same tier, same request,
different engine — which is also why morphing is the failure mode to watch
for rather than a wrong direction.

**It finished, and it was free.** `MEDIA_GENERATION_STATUS_SUCCESSFUL`, 8s at
720p, 6,984,446 bytes, submitted 16:45:42 and done 16:46:37 — 55 s.
`remainingCredits: 23880`, i.e. the clip cost nothing, exactly as the tier is
supposed to.

**What it costs is queue time, and now we know how much.** Start frame
16:44:49→16:45:05 (16 s), end frame 16:45:15→16:45:38 (23 s), each paying a
~5.5 s CapSolver captcha on the way. So an end frame adds roughly **25–30 s
per scene** before the clip is even submitted. On an eighty-scene film that
is a real addition to the pass, and it is the reason `endFrame: false` exists.

Published as `281e9134` immediately after this run.

**Not yet judged: whether the clip is BETTER.** The probe proves the API
accepts the shape and the pipeline can build it; whether a car that must end
outside the gate now actually drives out rather than reversing in is a
question only the producer watching clips can answer. The probe's own clip
(red hatchback pulling out of a walled yard, the exact failure they reported)
is the first thing to watch.


---

## C — the judge that looks at the clip

A and B both do the same thing: ask Veo more nicely. Nothing in either of
them LOOKS at what came back. This repo's hardest-won rule, already written
into `Judge Prep` one stage upstream for the stills, is that **an instruction
in a prompt is not a constraint** — if it matters, something after the model
has to say whether it happened. So the clip gets what the still already gets:
a contact sheet, a vision model, and a score rather than a hope.

```
Extract Video URL → Motion Prep → Judge Motion? ─true→ Motion Sheet → Motion Judge ─┐
                                        └─────false──────────────────────────→ Motion Verdict
Motion Verdict → Motion Reroll? ─true→ Motion Resubmit → Submit Video
                          └────false→ Download Clip   (exactly the old path)
```

`Motion Sheet` asks Railway for `/inspect?mode=sheet&interval=1&save=1` — one
frame a second from the 8-second clip, tiled in time order. `save=1` is new
(see `remotion/server/inspect.mjs`): the sheet is written under the key-free
`/output` and only its URL travels, because base64 in the request body would
put hundreds of kB per clip through n8n's execution data on a node that runs
once per scene of an eighty-scene film. `Consistency Judge` already feeds
gpt-4o a URL for exactly this reason.

### What is scored, and why those three

- **direction** — the reported bug. The brief said the car leaves the yard;
  the clip had it reversing in. The wording asks only whether the clip does
  what the SENTENCE claims, never whether the shot is good: a judge given
  licence to have taste will re-roll half the film.
- **morph** — the risk A introduced, and the reason C is not optional now.
  Given two frames Google routes this tier to
  `veo_3_1_interpolation_lite_low_priority`, and an interpolator handed two
  frames too far apart dissolves between them instead of moving anything.
  That failure is **invisible to a direction question** — the car does end up
  outside the gate, by fading there.
- **coherent** — the catch-all for what the producer called *"lucruri fără
  logică"*: solid things passing through each other, a moving vehicle with no
  driver, people popping in and out between frames.

Thresholds are deliberately low (`direction < 0.5`, `coherent < 0.45`). A
re-roll costs a whole Veo generation and a place in the queue, so it fires
only when the judge is confident the shot contradicts its brief, not when it
is merely unenthusiastic.

### A plain resubmit would have done nothing

`Current Scene` derives the seed from the scene id and the number of takes
already **filed**, and a take rejected by the judge is never filed — so a
second submission would carry the same seed, the same prompt and the same two
frames, and Veo would return the same clip. `Motion Resubmit` therefore hands
`Submit Video` a fresh seed, and resets `sd.polls[sceneId]` so the new job is
not declared timed out on arrival (the same thing `Resubmit Guard` does, for
the same reason).

**Morph is the one verdict a different seed cannot fix**, so that verdict
drops the end frame instead: the same two frames dissolve into each other at
any seed, and animating freely from the still is exactly what the film did
before end frames existed. `Submit Video`'s expression now carries three
levers — attach the end frame, drop it after a failed submission, and
seed/drop on a motion re-roll — each of them guarded by a scene-id match,
because `.first()` returns a node's latest run rather than the current item's.

### Failure is always "keep the clip"

Skipped, unreadable, sheet unavailable, OpenAI down — every one of them
returns the take untouched, carrying `Extract Video URL`'s own fields on to
`Download Clip`. A judge that can take a film down by being unavailable is
worse than no judge. Bounded to one re-roll per scene per pass; off entirely
with `motionJudge: false` in `Editing Options`.

### What it costs

Per clip: a Railway download and ffmpeg pass (the clip is ~7 MB), plus one
gpt-4o call with the sheet at `detail: 'high'` — about 850 image tokens, so
on the order of a cent a scene. `detail: 'low'` would be cheaper and is what
`Consistency Judge` uses, but it downscales the whole grid to 512 px, which
is exactly where the movement lives. A re-roll costs a full generation on top.


### Verified live before publishing — 2026-09-13, execution 12947

A throwaway ran the whole chain against the clip the I2V-FL probe had just
made, and the whole chain took **3.2 seconds**: Railway fetched the 7 MB clip,
tiled eight frames, answered
`{file, url: …/output/inspect-69132284-….jpg}`, and gpt-4o read it for 1,410
prompt tokens — about a third of a cent, so roughly 30 cents for an
eighty-scene film.

The verdict on that clip is the interesting part:

```json
{"direction": 1, "coherent": 1, "morph": false, "problems": []}
```

The brief was *"the red hatchback pulls forward out of the yard, through the
open gate, and turns onto the street toward the camera"* — deliberately the
producer's own failure, a car leaving a yard — and with a start frame and an
end frame it left. One clip is not a measurement, but it is the first
evidence that A does the thing it was built to do, and it was produced by the
machinery that will now be checking every clip.

Published as `6a79f422`, which also carries the `setNodeCredential` binding
for `Motion Judge`: `addNode` does not carry a credential, so without it the
judge would have answered 401 on every clip and the verdict would have
silently kept everything — the exact shape of failure this feature is
designed around, which is why it would have been invisible.
