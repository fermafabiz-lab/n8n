# Cinematic: the treatment parser stops requiring a field nobody reads (2026-09-24)

The first REAL Cinematic film died at `Cine Treatment Parser`. That was
execution 16640, on 2026-09-23 at 21:40, for *"The commute of an average
person to work in cyberpank"* (`recA0UObjuWIU0H07`), and it ran on Claude
Scripting `ca03c4d1`.

**What the model returned** (read from the execution, not guessed):

- valid JSON with **six** chapters;
- chapters 1–2 without `narrator_script`;
- then chapters 1–3 again, each with `"narrator_script": ""`.

The parser's `fromJson` schema makes every key in its example required. The
treatment prompt asked for the field as *"empty string"*. The model dropped
it, noticed, and repaired by re-emitting the whole list. The schema then
rejected the output: *"Model output does not match the expected schema"*.

**Nothing reads the field.** On the Cinematic path the chapters' narration is
the shot list. `Cine Guard` builds `narrator_script` from the shot lines
itself. `Combine Chapters` reads it from Cine Guard's output, not from the
treatment. `Cine Shot List` reads only `concept`, `chapter_number`,
`chapter_title`, `shot_count`, `energy` and `chapter_summary`. The field was
left over from the Story outline's shape.

## The change

Two files, both built from the live version `1f77881f` (`original/`):

| Node | Change |
|---|---|
| `Cine Treatment Parser` | `narrator_script` removed from `jsonSchemaExample` |
| `Cine Treatment` | the `narrator_script: empty string` line removed; one line added: *"The chapters list holds each sequence exactly once, numbered from 1 in order, with exactly the five fields above."* |

## Status

**LIVE as Claude Scripting `5312207f` since 2026-09-24 12:24 UTC**
(rollback `1f77881f`).

**Probe 16868**, run on the failed film's own inputs, came back clean on the
first pass:

- 3 sequences, 7 + 8 + 5 = 20 shots for 160 s;
- each sequence listed once;
- no `narrator_script` key.

The two earlier attempts could not run. 16816 and 16841 hit the empty
OpenAI account. 16865 was stopped from outside at 12:21:49, by the same
stop-everything sweep that paused a real film a moment earlier (see below).

The draft was read back and diffed against a simulation built from
`paste/`: 155 nodes, changed 0, connections identical. Against live, only
`Cine Treatment` and `Cine Treatment Parser` differ. Nobody else had edited
the workflow since `1f77881f`.

**The film that died got through without it.** After the account was topped
up, "⟳ Restart writing" on `recA0UObjuWIU0H07` (orchestrator 16846, 11:33)
re-rolled the old version and passed (Scripting 16847, 5 min).

**It is the first real Cinematic film through the no-hook / continuity path**
(`db/port/cinematic-continuity/`):

- `hookPlan` null, chapters 1–3 with no chapter 0, 20 scenes (101–106,
  201–209, 301–305).
- Four `loc:` runs: 4 in the apartment, 3 on the ramp, 7 in the street,
  6 in the lobby. So the previous still was attached as the previous shot
  on 16 of the 19 scenes that have one.
- Every image was generated and is waiting for approval.

Its Media Generation batch (16850) was stopped at 12:21:35, together with
the orchestrator, while two scene-image-regen webhooks survived. That is
exactly how Pause behaves. **After the images are approved, Resume carries
it on to the clips.**

A cancelled execution keeps no data, so its `IMG refs` log lines cannot be
read. The first uncancelled Cinematic batch is where to confirm
`continuity` in that log.
