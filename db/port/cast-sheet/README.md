# The cast sheet — identity that does not travel through the film

**APPLIED 2026-09-03.** Live and published:

| workflow | change | live version |
|---|---|---|
| 3. Media Generation (`yHG4DBCDjR3RJzav`) | 5 new nodes, `Build Image Request` rewritten, `User Ref?` reads the project by name | `29933981` |
| Claude Scripting (`gkEtGMecv4TC3ZHp`) | rule 3 of both Story Bible prompts | `f27fb7e2` |

Every touched node was diffed against the files here after publishing, and no
other node in either workflow changed. `*.before.*` is the rollback.

## What was actually wrong

The only thing carrying a face from scene to scene was the **n-1 chain**: the
previous scene's picture handed to Flow as "use this ONLY for character
identity". Measured on the 71-scene Boyd film, that works — the same man is
recognisably the same man in scenes 102, 203, 307 and 417, four chapters apart.

It cannot carry a **cast**, and the reason is structural rather than a tuning
problem:

- **The reference is whoever was in the last frame.** On a two-hander, a scene
  about Bill whose predecessor was a close-up of Sam tells the model, in as
  many words, to take Bill's identity from a picture of Sam.
- **Names never reach the image model.** The segmenter's output-hygiene rule
  strips them, so all 71 prompts of that film say "White American man" and not
  one says Bill or Sam. The prose cannot disambiguate what the reference got
  wrong.
- **The bible licensed the drift itself.** Sam was described as "late 40s to
  early 60s **depending on scene era**", Bill as "early 30s to early 50s
  depending on scene era" — and that description is pasted verbatim into every
  prompt he appears in. It is an instruction to draw a different man in every
  scene, written by us, and the model obeyed it.

## What went in

**One portrait per character, once per film.** `Cast Sheet Prep` reads the
Story Bible off the project, skips any character that already has a sheet, and
emits one Flow image request each; `Generate Cast Sheet` runs them one at a
time 8s apart (the pace the port notes record for staying under Google's
unusual-activity throttle); `Collect Cast Refs` pairs each result with its
character; `Save Cast Refs` merges `castRefs` {name: mediaGenerationId} into
the project's editing options. Free on the Ultra plan, and a later pass finds
the sheets and generates nothing.

**Who is in a scene comes from `Prompt Vizual`** — the segmenter's own
`visual_scene_description`, which is stored per scene, is never sent to any
model, and *does* name people ("Sam stands at the desk"). On the Boyd film it
names Bill in 27 scenes, Sam in 26 and Crowley in 3. Matching is by full name,
or by the given name where it is unique among the cast: a shared surname is not
an identifier, and "Boyd" matches Sam, Bill and the company.

Matched sheets become `reference_1..2` and the n-1 frame moves to last, for
palette and film look only — the prompt names those roles positionally, so the
list is built rather than assumed. Flow takes up to ten references and we were
using one.

**And the bible now has to state one appearance.** Rule 3 of both prompts
(`Generate Story Bible` and `Rebuild Story Bible`, edited in lockstep because a
script rewrite goes through the second) demands a single age and a single
outfit, and says why. A film that spans decades takes the age at its centre of
gravity and lets the narration carry time.

## What was verified before it shipped

- **Matching, against the real 71 scenes**: 22 scenes match exactly one
  character, 17 match two, and the 32 that match none are genuinely people-free
  — exteriors, tabletop inserts, a pair of hands. Those keep today's behaviour
  byte for byte.
- **The API contract, with a real call**: `POST /google-flow/images` with the
  portrait body answers `media[0].image.generatedImage.{fifeUrl,
  mediaGenerationId}`, and the returned picture is one man, neutral backdrop,
  one outfit — the "use the FIRST alternative only" clause did its job on a
  description that offered two.

## What is deliberately NOT here

- **No new scene field and no migration.** The first design had the segmenter
  emit a `characters` list per scene, which would have needed a column, a view
  mapping and a write mapping. `Prompt Vizual` already carries the names, on
  every film ever made, so the smaller design also works retroactively.
- **A third person in a shot gets no sheet.** Two is the cap; past that the
  references crowd out the composition. Scene 116 of the Boyd film ("the three
  men gather") is the case that loses one.
- **Nothing re-renders old films.** `castRefs` is written on the next media
  pass, so an existing project picks this up only when it generates images
  again.
