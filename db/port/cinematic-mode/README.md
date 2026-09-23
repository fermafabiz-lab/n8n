# Cinematic mode gets its own writing path (2026-09-23)

Claude Scripting `gkEtGMecv4TC3ZHp`, built on `538a914c`.

## The complaint

> la cinematic face scriptingul pe baza de story practic cu personaje etc si
> doar nu mai adauga dialogul … ar trebui sa fie abordat total in alt mod sa
> dea quality content pe vizuale

A Cinematic film was a Story film with the voice switched off.

## What the films show

Seven Cinematic films exist (`editing_options->>'category' = 'cinematic'`).
The two that matter:

- **The Hobbit film** (`rec0w52EKvBoBlBLF`, 2026-09-20, 95 s). Its chapter
  1 is narrated prose: *"By the late Third Age, most hobbits build with wood
  or brick, so every stroke here must justify the older way."* Nothing in
  that sentence can be filmed. Each scene then illustrated one sentence of
  that prose, so the film was a list of plot beats: the bank collapses, he
  gives up width, the chamber runs damp, he cuts a drain. The brief asked
  for *"every single step from digging to the inside of the house"*. The
  film went from the drain straight to the door, and the interior was never
  built.
- **The astronaut film** (`recVf7NKhSv1weLGb`, 2026-09-06, 300 s). This one
  was written BEFORE 09-13, and its lines are at least visual (*"His
  off-white suit cuts small beneath ribbed stone arches"*). But it is still
  a plot: a signal, a hidden fracture, a reserve check with "nothing left
  for delay". It also has one sentence per shot. And a prompt instruction
  leaked into the film as a line of its own: *"The astronaut visor is not
  see through; it stays black with reflection."*

## Why (read in the live prompts, not guessed)

A Cinematic film ran the Story chain, with Voice Mode's "SILENT FILM MODE"
paragraph appended to ONE of its prompts:

1. **`Generate Outline`** received no Cinematic rules at all. It asks for a
   STORY SPINE: protagonist, want, obstacle, stakes, turning points. It
   says *"This is a STORY plan, not a shot list — never say how anything
   looks, moves or is lit"*. The film was planned as a plot before a
   picture was considered.
2. **`Write Full Narration`** got the silent rules, and wrote a beat sheet.
3. **`Edit Full Narration`** never got them. Its rule 2b replaces any
   sentence that *"tells them what they can see"* with *"the intent, the
   stake, the cost, the cause, the consequence"*. The Cinematic genre
   profile's voice says the same (*"THE VOICE SAYS WHAT THE PICTURE
   CANNOT"*). Both came in with the 09-13 anti-bland rewrite. That is why
   the Hobbit film (after 09-13) is prose and the astronaut film (before)
   is not: **the editor turned the shot list back into narration.**
4. **`Plan Scene Splits`** cut the text into ~22-word chunks. A shot was
   whatever the word arithmetic produced, not something anyone designed.
5. **The segmenter** is told it is cutting *"a documentary-style film"*.
   Rule 5 says the narration *"deliberately does NOT describe the picture"*,
   so the segmenter invents every shot itself.

The genre profile itself was left alone. The tone `Cinematic` is also used
by Story films, and its narration voice is correct for them.

## What changed

A Cinematic film now leaves the Story chain right after the Story Bible and
rejoins it at Deep Search:

```
Save Story Bible → Cinematic? ─[false]→ Generate Outline → … (Story, untouched)
                               └[true]→ Cine Treatment → Cine Shot List → Cine Guard → If Cine Retry
                                                              ↑                      │[true]
                                                              └──────────────────────┘
                                                                    If Cine Retry[false] → FC Prep
```

| Node | What it does |
|---|---|
| `Cinematic?` | `$('Voice Mode').first().json.cinematic === true` |
| `Cine Treatment` (+ Model, Parser) | The director's plan. A **concept**: subject, feeling, visual arc (how the light, scale and palette change first shot to last, which replaces a plot), 3-5 signature images, sound world, ending image. Then **sequences**, each with a shot count (they add up to `ceil(L/8)-1`), an energy (calm/building/peak/release), and a note to the camera crew ending in `OPENS ON:` / `ENDS WITH:`. The producer's brief is binding: a named process gets every step, in order. |
| `Cine Shot List` (+ Model) | One shot per line, five fields: `SHOT SIZE AND ANGLE · CAMERA MOVE · WHAT HAPPENS · LIGHT · Sound: …`. Twelve craft rules: coverage (wide → medium → insert, a new shot size at every cut), one idea per 8-second shot, a motivated camera, named light following the arc, screen direction, texture against scale, sound in every shot, pictures only, match cuts between sequences, signature images, a held last shot, real process order. |
| `Cine Guard` | Emits `Narration Guard`'s exact shape (`min: 0`). Parses the list tolerantly (bold markers, numbering, bullets). Checks the shot count per sequence, the five-field form, speech (quotes, "says", "narrat…"), and lines too thin or too long. One retry with the problems listed. The second pass is accepted, and surplus shots are cut from the MIDDLE of a sequence, because its first and last shots are the match cuts. |
| `If Cine Retry` | `[true]` back to the writer, `[false]` into `FC Prep`. |

Four existing nodes change, and **each changes only on its Cinematic arm**.
`check.mjs` runs the original and new bodies on the same inputs and
requires identical output for Story, Documentary, Kids, dialogue and faces-off
projects:

- **`Voice Mode`**: `segmentRules` for Cinematic. The line is now a shot
  the director designed. The segmenter EXECUTES it (shot size, move, action,
  direction, light, sound) and adds the bible's descriptions, instead of
  inventing a shot. The old beat-sheet `narrationRules` stays in the code
  but nothing reads it for a Cinematic film any more.
- **`Plan Scene Splits`**: a Cinematic chapter is cut on its LINES. One
  line is one scene, as the hook already was.
- **`Combine Chapters`**: reads the plan from `Cine Treatment` when the film
  is Cinematic, because `Generate Outline` never ran and referencing it
  would throw. The concept stands in for the story spine the hook is shown.
- **`Rewrite Script`** (reject with feedback): its system message said
  *"output flowing spoken narration only"*. That would turn a shot list
  back into prose on the first rejection. A Cinematic film gets a shot-list
  editor instead. The Story message is kept verbatim as the other arm.

Downstream nothing changes. Deep Search skips (`not-documentary`) and still
writes its row. The hook keeps its silent styles. Save scenes stores the shot
line as `Script Scenă`, which the site shows as the scene's text. Media
Generation already skips TTS for a silent film.

## Files

| File | |
|---|---|
| `original/` | the live bodies at `538a914c` |
| `paste/` | what goes live: the three new bodies, the parser, and four built from `original/` |
| `build-paste.mjs` | original/ → paste/ for the four edited nodes; every edit anchored to exactly one occurrence |
| `build-ops.mjs` | paste/ → `ops.json`, the `update_workflow` operations |
| `simulate.mjs` | ops.json applied offline to `cs.live.json` → `cs.expected.json`, plus the path walks |
| `check.mjs` | 85 assertions: non-Cinematic byte-identity, Cinematic behaviour, guard fixtures, both prompts compile |
| `probe.mjs` | the throwaway that runs the real prompts on a real film's bible |
| `fixtures.json` | text from the two real films |

`cs.live.json` / `cs.expected.json` are gitignored. The workflow dump holds
header parameters the API does not redact.

## Verification

**Probe 16582** (throwaway `tUwzERABvH7FO64n`). These are the committed
prompts on gpt-5.4, fed the Hobbit film's real Story Bible from Postgres,
its length (95 s → 11 shots) and its brief. It took 48 s end to end.

- The treatment was titled *Under the Hill*. Its visual arc runs "crisp
  spring morning … hard noon excavation … overcast and rain-dark as the
  smial shell takes shape … golden dusk and finally blue hour outside with
  warm amber lamplight inside". It had five signature images and two
  sequences (6 + 5 shots), and the brief's "every step" was honoured in
  order: mark, measure, sight, turf, mattock, barrow, then shell, plaster,
  door, finished rooms.
- The shot list came back 11 of 11, every line in the five-field form, and
  the sequences are joined by a match cut: spoil tipped into the terraces,
  then *"Wet packed earth fills the frame … lifts to reveal the
  half-finished circular masonry opening"*. For comparison, the live
  pipeline wrote *"By the late Third Age, most hobbits build with wood or
  brick…"* for the same film.
- The first pass was sent back by the old whole-line ceiling of 70 words.
  That cap was miscalibrated, not the list (good lines run 42-70 words), so
  the ceiling moved to the action field (40) and a `then` check was added.
  Two lines in this run chained actions ("run the wheelbarrow … then tip").

**Probe 16583**, on the same throwaway, used the astronaut film's bible at
300 s: 37 shots in 6 sequences, 37 of 37 written. The arc runs noon on the
plain → prismatic basin → copper ridge → blue hour at the fissure →
bioluminescent cavern. Screen direction holds left to right through the
first three sequences. The retry fixed a chained `then`. The guard also
flagged *"Sound: drone hover, scanner whisper"* as speech twice, so
`whisper` left the speech list, and `check.mjs` pins that line (85
assertions).

**Published** as Claude Scripting **`e45ef4c1`** (rollback **`538a914c`**).
It was applied through `update_workflow` from `ops.json`. Before the
publish, the draft was read back and diffed against `cs.expected.json`:
152 = 152 nodes, **changed 0**, connections identical, both If nodes on the
right outputs. Nothing was running on Claude Scripting at either moment.

**End to end on the live version**, disposable film **`reczDC7RrgnX8SKsq`**
(*"ZZ DELETE cinematic path - Bag End"*: the Hobbit film's Tema and brief,
95 s). It was fired at the real `new-project` webhook (runner
`noKc2QTFxUrl9wKs`, archived) as scripting execution **16589**:

- The script parked at the gate **~2 minutes** after the POST. It had two
  sequences (6 + 5 shots), every line in the five-field form, and a silent
  cliffhanger hook. `hov.fact_check` got its `not-documentary` row, which
  proves the path runs through Deep Search and writes the report as every
  film must.
- The script was approved by SQL (runner `VvlbxrFBvlpIMxRG`, archived), and
  the real segmenter wrote **14 scenes** (3 hook + 11), one per shot line.
  Every `Script Scenă` is the shot line verbatim. Every image prompt opens
  with the designed size ("Wide low Hobbit-eye shot…", "Close-up low side
  angle…"). Every motion prompt uses the designed camera move and carries
  the Sound field ("the chip of iron into wet clay and a dull tear of
  turf"). The place states come in order: untouched → open excavation →
  half-built smial → finished. `Aprobare Voce` is pre-checked on all 14.
- The film ends on the treatment's ending image, a held centered axis down
  the finished hall with the open green door in golden morning light.

The execution sits in `Wait For Scene Approval`, as every unapproved film
does. The project is disposable and can be deleted.

## What is owed

- **One real Cinematic film watched end to end**, made by the producer.
  The clips have not been generated. What to watch for: whether a
  five-field shot line survives Veo as the shot it designs (the camera move
  in particular), and whether 8-second shots that follow coverage read as
  a cut rather than a slideshow.
- ~~**The hook still speaks Story.**~~ Moot since the same evening: a
  Cinematic film has no hook (`db/port/cinematic-continuity/`).
- **`Rewrite Scene Text` / `Rewrite Scene Standalone`** (the per-scene "✎
  rewrite" buttons) were not touched. On a Cinematic scene they rewrite the
  image and motion prompts and keep the line, which is the right behaviour,
  but nobody has pressed one on a shot line yet.
