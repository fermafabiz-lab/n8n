# Cinematic: no hook, and continuity from shot to shot (2026-09-23)

The producer, the same evening the Cinematic writing path went live
(`db/port/cinematic-mode/`):

> inca o chestie la cinematic nu ar trebui sa fie hook si ar trebui sa fie
> continuitatea extrem de mare din scena in scena

Two changes, both confined to Cinematic films. `check.mjs` proves every
other category gets the same output as before from every edited node.

Built on Claude Scripting `e45ef4c1` and Media Generation `b9527072` (the
live versions; `original/` holds their bodies).

## 1. No hook

A Cinematic film opens on its first shot.

- **Claude Scripting.** After `Combine Chapters`, a new `Hook Wanted?`
  (`$('Voice Mode').first().json.cinematic !== true`) sends a Cinematic film
  past `Generate Hook`, `Hook Guard`, `Prepend Hook To Chapters` and
  `Save Hook Plan`, to two new nodes:
  - `Clear Hook Plan` removes any `editing_options.hookPlan` an earlier run
    wrote, because the render draws from it.
  - `No Hook Done` restores `Combine Chapters`' item, because a Postgres node
    replaces `$json`.

  From there the film goes to `Save Script To Airtable`, which reads
  `$json.output` exactly as `Combine Chapters` emits it. The script has no
  chapter 0 and the scenes start at 101.
- **The scene is given back.** The film no longer holds one scene back for a
  teaser. `Cine Treatment` asks for `ceil(L/8)` shots (was `ceil(L/8) − 1`)
  and says there is no teaser, and `Cine Guard` counts the same.
- **The render needs nothing.** A film with no `hookPlan` is what every film
  before 2026-09-11 was. `Build Timeline` and `FinalVideo` treat it as "no
  hook".
- **The site** (`platform/`): `noHook` on the Cinematic entry in
  `lib/categories.ts` is the one owner.
  - The brief drops its "Cold open" row and stops pricing the teaser's ~40
    Fast credits.
  - The film page never renders the hook panel, so it cannot offer to add a
    hook back.

## 2. Continuity from shot to shot

"Consistency" already existed: a cast sheet per character, a set plate per
place, and tags. What did not exist was *continuity*, the next shot
starting where the last one ended. Three layers now ask for it, from the
plan down to the picture.

- **The treatment** (`Cine Treatment`) is told continuity is the film's
  spine:
  - one continuous flow of time and space;
  - each sequence picks up exactly where the last one ended, with no jump to
    an unrelated place and no skipped stage;
  - time moves only as far as the light arc moves it;
  - few places, and the film stays in each long enough to be continuous in
    it.
- **The shot list** (`Cine Shot List`) gets a CONTINUITY rule placed above
  the craft rules:
  - (a) Shots in a sequence are consecutive moments of the same action,
    seconds apart. Subject, props, clothes with their dirt, weather and
    light carry over exactly.
  - (b) Nothing teleports. Where the subject stood, faced and travelled is
    where the next shot finds it.
  - (c) Every cut is motivated: a cut on action, a move closer, or a reveal.
  - (d) Sequences join on a match cut.

  Its three example lines are now three CONSECUTIVE shots of one action (a
  potter carrying clay → dropping the same slab on the wheel → thumbs into
  that clay). The old examples were three unrelated shots, which taught the
  opposite.
- **The segmenter** (`Voice Mode`, cinematic `segmentRules` (f)). Before each
  image prompt it works out where the previous scene's motion LEFT
  everything, and composes this scene's first frame from exactly that state,
  seen from the new angle. The same place carries the same location tag.
- **The picture** (the shared REFERENCE ASSEMBLY block, in all three copies:
  `Build Image Request` and `Evaluate Image Approval` in Media Generation,
  `IR Build Request` in Claude Scripting).
  - Until now the previous scene's image was attached last as *"only for
    colour palette and film look, never for layout and never for who or
    where anyone is"*. It was dropped entirely when two prompts were more
    than 55% the same words, which on a Cinematic film is exactly the
    continuous case.
  - For a Cinematic film whose previous scene is in the SAME place (the
    `loc:` tags agree), that image is now the **previous shot**: *"the same
    place in the same state, the same light, weather and hour, the same
    people in the same clothes with the same dirt and wear, and every object
    in the state and position it was left in. This shot is the NEXT MOMENT
    of that action, seen from the new angle and distance the text
    describes."* The similarity guard no longer drops it.
  - Across a change of place it stays a palette.
  - Where the previous place is unknown, it also stays a palette, never a
    guess. That covers the first batch run after the deploy, whose earlier
    run emitted no `locTags`.
  - `Build Image Request` emits its scene's `locTags` on a Cinematic film,
    so the next run can compare.

### What was not done, and why

**Frame chaining**, where each clip starts from the last frame of the clip
before it, is the strongest continuity there is. It was deliberately not
built here, because it changes how a film is made, not only what it says:

- Every clip would have to wait for the previous one, so there is no
  parallel pool and the clip phase goes serial.
- The image gate stops meaning anything, because the start picture is no
  longer a still anyone approved.
- Regenerating one clip invalidates every clip after it.

That is a production decision with a real cost in hours per film, and it is
the producer's to make. What shipped keeps every scene independently
generated and approvable, and makes each one START where the last one
left off.

## Files

| File | |
|---|---|
| `original/` | the live bodies (CS `e45ef4c1`, MG `b9527072`) |
| `paste/` | built by `build-paste.mjs`; the shared block is identical in all three copies |
| `build-ops.mjs` | `ops-cs.json` (14 ops) and `ops-mg.json` (2 ops) |
| `simulate.mjs` | applies both offline → `*.expected.json`, walks the hook branch |
| `check.mjs` | 77 assertions: non-Cinematic identity for all three reference copies and Voice Mode; continuity vs palette by place; similarity guard; no hook scene; examples pass the guard |
| `probe.mjs` | the throwaway that runs the new prompts on the Hobbit film's real bible |

## Verification

(below)
