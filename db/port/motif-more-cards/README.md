# One drawn card in six minutes (2026-09-23)

The producer, on the finished New York remote-work film
(`rec7U8PbMS8MUYQcW`, 54 scenes, 6 min 12 s): *"nu exista nicio animatie cu
remotion pe videoclip, desi eu am activat drawn cards"*.

## What was measured before anything changed

Frames were pulled from the DELIVERED cut — the Remotion output
`720c81af`, not the montage `ff4aecff` that feeds it (the first attempt
inspected the montage and saw no captions either, which is the tell) —
through a throwaway n8n workflow calling the render server's `/inspect`
with the `x-api-key` header the live nodes use.

| | on the delivered film |
|---|---|
| hook slate "BROOKLYN APARTMENT" | drawn, 0.45–5.45 s |
| captions | on every scene |
| drawn cards | **one** — a compare bar 42% / 35% at 311.1–314.5 s |
| chapter cards, end screen | none: `chapterCards: false`, `endScreen: false` in the film's own Editing Options |

So "Drawn cards" was on and worked, and produced one card at minute five.
The producer is right that nothing shows.

## Why only one

Scripting execution 15882 proposed **three** cards:

1. **route** Brooklyn → Manhattan at scene 23 — exactly the animation the
   producer keeps asking for. Refused: *"a chapter card already owns this
   scene"*. **The film has chapter cards OFF.** `Validate Motif Cards`
   called `validateMotifCards({cards, scenes, evidence})` with no
   `chapterCardsOn`, so the default `true` applied to every film ever made,
   and any card on a chapter's first scene died regardless of the setting.
2. compare 1.181 M / 798 k at scene 42 — refused correctly, it quoted scene
   48 (the no-spoiler rule).
3. compare 42% / 35% at scene 46 — accepted.

Then the render made it worse: `buildTextCards` in `remotion/src/textCards.ts`
returned the explicit list AS the whole answer whenever it was non-empty.
With zero motif cards this film would have had figure cards on its ~20
spoken figures (77%, 9.206 million, 21.5%, 53%, 800,000…); with one accepted
motif card it got exactly one card. **A partial success produced fewer
animations than a failure.**

And two caps agreed with each other that more was never wanted: the writer's
prompt said *"Aim for one to three cards on every film"*, and the validator
carried `MAX_CARDS = 3` — so even a perfect answer topped out at three cards
on a ten-minute film.

## What changed

**Remotion** (`remotion/src/textCards.ts`, pinned by `npm run check:cards`,
six assertions):

- explicit and derived cards are **merged**, one card per scene, the explicit
  one winning its scene; the planner's 9 s gap and 16 % budget still bound
  the total;
- an explicit card on a chapter's first scene is dropped only while chapter
  cards are ON — re-checked at render time because Final touches can flip
  the switch after Scripting validated the card;
- an explicit card whose `sceneIndex` is outside the film is dropped rather
  than thrown on.

**Claude Scripting** `8186ec33` (rollback `7a865309`; the version this was
built on, which another session had published at 12:08 for `DS Apply` —
`get_workflow_history` before the diff is what caught that):

- `Validate Motif Cards` reads `Editing Options.chapterCards` off
  `Fetch Project Record` (the node `Draw Cards?` reads its own switch from)
  and passes `chapterCardsOn`; the cap is `maxCardsFor(minutes)` — one card
  in roughly every two minutes, never under three — with the minutes from
  the trigger's `Lenght` (seconds) or, failing that, 7 s a scene. The body
  also carries the parser-error report and the slim `motifReport` from the
  2026-09-13 generator, which had never reached the live node.
- `Prep Motif Input` puts `LENGTH: about N minutes, M scenes` in the brief.
- `Choose Motif Cards` asks for one card in roughly every two minutes,
  spread across the film, instead of "one to three".

`remotion/motif/validate.mjs` owns the cap (`MAX_CARDS`, `maxCardsFor`) and
the generator `db/port/motif-cards/add-motif-nodes.mjs` owns the prompt,
the prep body and the glue; `emit.mjs` here writes the three node bodies
from those into `paste/`, and each was byte-compared with the draft before
publish. Diff against `7a865309`: 136 → 136 nodes, changed 3, connections
identical, settings identical on every node.

## What is owed

- **The next film.** Read its `motifReport` (in Editing Options) for what
  was proposed and what was refused, count the cards on the delivered cut,
  and look at whether one every two minutes reads as rhythm or as
  interruption. The number was chosen, not measured.
- The cap is only a ceiling: the writer still decides. If a ten-minute film
  comes back with two cards, the prompt is the next thing to read, not the
  validator.
- The render-side guard means a card Scripting accepted can vanish if the
  producer turns chapter cards ON after the script gate. The panel in Final
  touches does not say so.
