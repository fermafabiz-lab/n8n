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

**Probe 16598** (throwaway, archived). The new treatment and shot list ran on
the Hobbit film's real bible at 95 s. The result was 12 shots, clean on the
first pass, with lines that start where the last one ended: *"From where the
cord settled…"*, *"Where the barrow stopped…"*, *"Match on the terrace
curve…"*. (An earlier run, 16596, died at `Cine Treatment Parser` because
the model returned an empty answer, 0 completion tokens. It was a one-off,
but the production agents have no `retryOnFail`.)

**Applied** through `update_workflow` from `ops-cs.json` (in three batches,
since it is too large for one call) and `ops-mg.json`. Each draft was read
back and diffed against the simulation before it was published:

| Workflow | Draft = published | Rollback | Diff against `*.expected.json` |
|---|---|---|---|
| Claude Scripting | `ca03c4d1` | `e45ef4c1` | 155 nodes, changed 0, connections identical |
| Media Generation | `8dc9f448` | `b9527072` | 247 nodes, changed 0, connections identical; against live only `Build Image Request` and `Evaluate Image Approval` differ |

Nobody else had edited either workflow since the versions this was built on.
The real film on Media Generation (16578) was running at publish time and
keeps the version it started with.

**End to end on the live versions**, disposable film **`rec7Fb9iLTFviELpp`**
(*"ZZ DELETE cinematic continuity - Bag End"*). It uses the same Tema, brief
and 95 s as the first Cinematic check (`reczDC7RrgnX8SKsq`), so the two can
be read side by side. Scripting ran as execution 16603; the script was
approved by SQL and the real segmenter ran.

- **No hook.** `editing_options.hookPlan` is null. The script starts at
  `[CHAPTER 1: Breaking the Hill]`, with no chapter 0. The scenes are
  **101-106 and 201-206: 12 = ceil(95/8)**. The first check had 3 hook
  scenes plus 11 shots.
- **Continuity in the shot list.** Every line after the first picks up the
  one before:
  - *"At the same marked center, Togo … levers up the first sod flap"*
  - *"Bungo's spade lifts that same slab"*
  - *"The opened patch widens into a raw bite"*
  - the sequences are joined by *"Match cut: the departing wheel becomes the
    centered bright brass knob"*
  - *"Pulling back reveals Bungo stepping left away from the polished
    door"*
  - *"From the doorway now opened inward…"*
  - *"The round green front door now stands closed"*

  The light moves only as the arc moves it: dew morning → late morning →
  noon → late afternoon → dusk → lamplight.
- **Continuity in the image prompts.** The segmenter carried the state
  forward:
  - 102: *"the hill still mostly intact except for the first ragged cut"*
  - 103: *"now showing a torn opening in the turf"*
  - 104: *"the same rounded hillside … now visibly opened by labor"*
  - 106: the removed earth *"visibly read as banks and outlines"*
  - 206: the door *"now closed"*
- **The places repeat, so the reference applies.** The `loc:` tags come in
  four runs: 101-103 untouched slope, 104-106 excavation, 201-204 exterior,
  205-206 interior. Under the new reference block the previous still is
  attached as the **previous shot** on **8 of the 11** scenes that have a
  previous one (102, 103, 105, 106, 202, 203, 204, 206). It stays a palette
  on the three that change place (104, 201, 205).

**Not exercised live: the image stage itself.** No stills were generated
for the disposable film. Doing so spends Flow credits and shares the
accounts with the real film that was rendering. The assembly logic is pinned
offline by `check.mjs`. It covers continuity vs palette by place, a missing
previous place, the similarity guard, and byte-identical output for every
other category, in all three copies. The first real Cinematic film's `IMG
refs` log lines should show `continuity` on same-place scenes.

**A trade-off this run made visible.** The brief asked for *"every single
step from digging to the inside of the house"*. The first check covered
shell, plaster and door fitting. This one goes from the wheelbarrow at noon
straight to the finished door, on a match cut. In 12 eight-second shots,
consecutive moments of one action and every stage of a build compete for
the same shots. The treatment chose continuity, which is what it is now
told is the spine. A longer film, or a brief that names the stages, gets
both.
