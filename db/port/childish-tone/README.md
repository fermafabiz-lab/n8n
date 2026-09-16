# Childish — a tone for Kids story (2026-09-16)

The producer, over the Tone row of the brief: "vreau aici o categorie nouă
pentru kids, eu ziceam ceva de genu CHILDISH."

Tone is not an adjective here. `Tonalitate` selects a **genre profile** — a
row of `hov.genre_profile` that Claude Scripting reads at the start of every
run (`Fetch Genre Profile` via the `/api/at` shim, then `Genre Profile`,
which falls back to its built-in table and, past that, to DOCUMENTARY). A
tone chip with no row is silently written as a documentary. So a new tone is
one row plus one chip, and the row comes first.

## The row

`genre-childish.json` is the row as written; `insert.sql` is what inserted it
(every literal base64-encoded — the structure starts with `1)`, and a
dollar-quoted `$hov$1)` is the `$<digit>` shape CLAUDE.md warns a Postgres
node can read as a parameter). Inserted through a throwaway manual workflow,
read back in the same execution's `returning`, and diffed field by field
against the JSON before the chip shipped. Row id `recpa1ZmZmXFnGjDi`,
inserted 2026-09-16 13:51 UTC. Rollback:
`update hov.genre_profile set active = false where id = 'recpa1ZmZmXFnGjDi'`.

What the profile says, in short: no research, invention required, one small
consistent world; a lovable hero → a small problem → tries with new friends,
silly never scary → the brave-small thing works → home, the lesson said once,
a goodnight. Storyteller voice, present tense, sentences a four-year-old
follows, repetition on purpose, feelings named simply. 110 wpm, montage
intensity 0, picture-book visuals whose day moves from breakfast to bedtime.
The voice ends with the same "THE VOICE SAYS WHAT THE PICTURE CANNOT" tail
every other row carries — that rule is the pipeline's, not the genre's.

It composes with the kids category rather than duplicating it: `Voice Mode`'s
KIDS STORY MODE (narration, segment, hook rules) still appends to whatever
tone is chosen; this row is what the OUTLINE and the narration are shaped by.

## The chip

`platform/app/new/page.tsx`: "Childish" is the twelfth tone. Choosing Kids
story selects it when the tone is still on its default, and leaving Kids
story puts the default back — the same rule the storyteller voice and tone
preset follow, and only an untouched control moves. The film's title
typeface falls to the default register on both the site (`tone-type.ts`) and
the render (`presetForTone`), which stay in lockstep by both matching
nothing; a dedicated picture-book look for chapter cards is a render change
and is not here.

## What is owed

The first Childish film: read the outline against the five beats above, and
listen to whether the storyteller voice reads as a bedtime story rather than
a narrator being gentle.
