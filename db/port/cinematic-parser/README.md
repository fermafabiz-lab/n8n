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

**Written, NOT published.** Probe 16816 (throwaway `ncFvkRNS4rSyaL3s`, kept)
runs the new prompt and parser on the failed film's own inputs:

- its bible and brief, read from Postgres;
- its Tema, length 160 s and style.

It could not run: at 10:09 UTC on 2026-09-24 the OpenAI account answered
*"You have no credits remaining"*. A prompt change nobody has run is not one
to publish, so this waits.

**To finish:**

1. Once the account is topped up, execute `ncFvkRNS4rSyaL3s`. Expect one
   entry per sequence and no `narrator_script` key.
2. `update_workflow` on Claude Scripting (see below).
3. Read the draft back and diff it: exactly these two nodes may differ.
4. Publish.
5. Press "⟳ Restart writing" on `recA0UObjuWIU0H07`.
6. Archive the probe.

The update itself:

- `Cine Treatment`: `updateNodeParameters` with `text` = `paste/Cine_Treatment.txt`;
- `Cine Treatment Parser`: `updateNodeParameters` with `jsonSchemaExample` =
  `paste/Cine_Treatment_Parser.json`.
