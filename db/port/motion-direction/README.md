# Which way things travel — the wrong-way car

**APPLIED 2026-09-03.** Live and published:

| workflow | node | live version |
|---|---|---|
| Claude Scripting (`gkEtGMecv4TC3ZHp`) | `Segment Chapter Into Scenes`, rule 6 | `1f486803` |
| 3. Media Generation (`yHG4DBCDjR3RJzav`) | `Submit Video`, `Submit Video Regen` | `94bde390` |

Diffed against the files here after publishing; no other node changed in
either workflow. `*.before.*` is the rollback.

## The report

A race film came back with one car driving the wrong way down the track. Not a
stylised shot, not a request — an error that makes the film unpostable, in a
pipeline that otherwise produces good clips from good stills.

## What the prompts actually said

The motion prompts name a camera move and an action and stop there. From a real
film in the database (a BMW driving in Dubai):

> "Tracking shot as the BMW M8 Competition Gran Coupé lunges forward **from a
> low front three-quarter angle**, its headlights intensifying through the
> glare while wheels spin and reflections race across the body; **heat haze
> ripples above the highway and towers streak past**."

Read that as a rendering model has to. The camera sees the car's FRONT. The car
"lunges forward". The towers "streak past". Which way is the world moving —
toward the lens, or away from it? Nothing in the sentence settles it, so the
model settles it, and it settles it differently in different scenes. Another
scene in the same film says "rolls from freer pace into **thicker boulevard
traffic**" and never says which way the traffic moves.

Veo starts from the still and fills in everything the words leave open. A car
framed from behind, told to "race", can be given oncoming traffic; a lane can
be given a car coming the other way.

## What went in

**Rule 6 of the segmenter now makes direction mandatory**, and ties it to the
still rather than to taste: whenever anything travels — a person, a vehicle, a
boat, a crowd — the prompt must say WHICH WAY relative to the frame and to the
camera ("moves left to right", "recedes away from the camera", "the camera
paces alongside at the same speed"), and it must agree with the composition the
image prompt already fixed: **a car framed from behind drives away, a car
framed head-on comes toward the camera.** Everything else that moves — traffic,
competitors, crowds, machinery — travels the same way as the subject unless the
narration says otherwise.

The negative clause carries the same rule from the other side: *nothing travels
against the flow — no oncoming vehicles, nobody walking or driving the wrong
way, no reversed motion; no subject appears, disappears, duplicates or changes
identity.*

**And the same continuity clause is appended at SUBMIT time**, beside the audio
clause that was already there. That is the half that matters this week: the
segmenter rule only reaches films written after it, while the submit clause
covers every film already in the database and every regeneration of a clip
whose motion prompt was written months ago. Both submit paths carry it and must
keep agreeing — a regenerated clip obeying a different rule from its neighbours
is the same defect wearing a different hat.

## What this does not do

- **It reduces the failure; it cannot eliminate it.** A negative is a
  preference, not a constraint, and `veo-3.1-lite-low-priority` is the weakest
  model on offer. The producer's video approval gate is still the backstop, and
  a re-roll now inherits the same clause instead of repeating the old one.
- **The model string is the bigger dial and it is not a code decision.** Lite
  low-priority is free on the Ultra plan; anything better spends credits. It
  lives in `Submit Video`, `Submit Video Regen` and the gate's regen path —
  three places that must agree, exactly like the image model string.
- **Nothing re-renders an existing clip.** The film that prompted this keeps
  its wrong-way car until that scene is regenerated.
