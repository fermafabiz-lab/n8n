# The story layer — one writer, one editor, a spine (2026-09-02)

Status: **APPLIED and LIVE** on Claude Scripting `gkEtGMecv4TC3ZHp` — active
version `e9675be4` (`6eb817ad` was the story layer itself; `e9675be4` adds the
location-label rule below), was `bafbe64d` (saved here as
`Claude Scripting.original.json`).
`applied/01-claude-scripting-story-layer.json` is the exact `update_workflow`
operation list; `applied/diff-against-active.js` is the node-by-node diff that
was run on the draft before `publish_workflow`. Rollback:
`restore_workflow_version` to `bafbe64d`, and `genre-motivational.before.json`
back into `hov.genre_profile`.

## What was wrong, measured on the 71-scene Vegas film (`recnyQ92QsXehZ98S`)

1546 words, 185 sentences, **73 of them under four words** ("Green felt. Brass
ashtrays. A wall clock."). The same eight facts retold in every chapter:
"1941, dealer" ×4, "1962, Eldorado" ×4, "Joe Crowley" ×5, "narrow doors/room"
×5, the two purchase prices ×2, "1975 Boyd Gaming" ×3. Nothing HAPPENS in any
scene — no incident, no decision with a cost — and the producer's fictional
"Bill" became the historical Bill Boyd of Boyd Gaming.

Four causes, all in the pipeline:

1. **Each chapter was written by a separate model call that never saw the
   other chapters.** `Split Outline Chapters → Write Chapter Narration` ran N
   times with the same bible, the same claims list and only its own summary.
   Nobody held the whole film; nobody could know what had already been said.
2. **Word count was "THE MOST IMPORTANT RULE"**, with an explicit instruction
   to fill from the Story Bible when short. The model obeyed: it recited the
   bible's `visual_description` inventories as narration.
3. **The Motivational genre profile's `structure` was an essay** ("name the
   moment of resistance … return to the opening moment, changed"). Four
   chapters that each return to the same moment cannot help repeating.
4. **Its `invention` rule ("use only real examples; never invent a person's
   story") plus web research replaced the Tema's protagonist** with a real
   company's founders, and a thin fact pack (8 dated facts) was then
   stretched over eight minutes.

## What changed

```
Generate Outline  →  Write Full Narration  →  Edit Full Narration  →  Narration Guard  →  If Narration Retry
   (+ story_spine)     (ONE call, all chapters)   (whole draft)          (code)              true → Edit Full Narration
                                                                                             false → Combine Chapters → Generate Hook → …
```

- **`Generate Outline` now writes a STORY SPINE first** — protagonist, want,
  obstacle, stakes, 3–7 turning points that are EVENTS, ending, throughline —
  and chapters that each own their turning points and never re-explain what
  another chapter established. `Outline Parser` gained `story_spine`.
- **`Write Full Narration` writes the whole film in one call** with the
  `[CHAPTER n: title]` markers the rest of the pipeline already speaks
  (`Parse Approved From Airtable` and `Rewrite Script` used them before this).
  Rules: say everything once; events, not inventory; cause and effect;
  concrete; 8–20-word sentences in ~22-word beats; time and place move
  forward. Length is stated as a window, not as the top rule.
- **`Edit Full Narration`** (new `Editor Model`, gpt-5.4) reads the whole
  draft with the spine and the plan and removes repetition, fragments,
  inventories and mid-story sermons.
- **`Narration Guard`** (Code) parses the markers, checks chapter count and
  the length window (target ± 10 / 12 %), and sends the draft BACK to the
  editor with the problems spelled out — at most twice (`$runIndex`), then
  accepts and logs. `Combine Chapters` reads the guard's chapters and the
  outline's summaries; `Split Outline Chapters` and `Write Chapter
  Narration` are gone. Downstream (hook, save, approval loop, segmentation)
  is untouched.
- **`Generate Story Bible`** keeps the Tema's own protagonist ("a man Bill
  who…" stays Bill); research supplies the world, never a replacement.
  `Generate Outline` says the same thing in its own words.
- **`Generate Hook`** receives the spine. **`Rewrite Script`** (the
  producer-rejected-script path) carries the same story rules.
- **`hov.genre_profile` row Motivational**: `structure` is now a narrative
  arc (stuck → decision and its cost → one new obstacle per chapter → the
  turning point → payoff, lesson said once at the end), `voice` is third
  person present close on the protagonist (the viewer addressed at most
  twice: hook and last beat), `invention` keeps real facts real but tells
  the Tema's protagonist's story. Old values in
  `genre-motivational.before.json`; editable in `/admin`.

## What did not change, on purpose

`Plan Scene Splits` still cuts the chapter text into ~22-word scene chunks
by code, `Segment Chapter Into Scenes` still writes the image and motion
prompts per chapter, the script approval loop and the scene-text regen path
are as they were. The per-chapter segmentation is fine: it only needs the
chapter's own text and plan, and those are now consistent by construction.

## First run — the disposable test film, 2026-09-02 16:57 UTC

`restart-scripting` on *A race between a snail and a turtle* (32 s, one
chapter, Motivational / Nature), execution 9355. The script landed in
`hov.script` 46 seconds after the webhook fired: research, bible, outline
with spine, one-pass narration, editor pass, guard, hook.

Before (the approved script of 08-16, the old per-chapter writer, second
person, essay structure):

> You are already in it: dew jumps on the grass, the garden snail stretches
> over black soil, and the freshwater turtle hits roots and loose stones
> ahead. The gap looks finished, but the snail's silver line keeps catching
> light, and the turtle's claws dig deeper when rhythm breaks. Here, harder
> means nothing. Pick the next inch, the next root, the next bare patch, and
> keep moving. In the warm clearing light, both bodies still advance, and
> persistence keeps the race alive.

After (one writer, one editor, spine, narrative arc):

> Milo the Snail moves low along the Forest Starting Path, staying beside
> Tara the Turtle on rough dirt, not safer moss. At the Creekside Stretch, a
> muddy rut grips him as Tara keeps moving. Milo braces against a wet pebble,
> drags free, and reconnects his silver trail to firm earth. He crests the
> Hilltop Finish Clearing and slides onto packed ground as Tara arrives beside
> him.

66 words on a 66-word target, a choice with a cost, an obstacle, an action,
a payoff, no fragments, no sermon, nothing said twice. One defect: the
Story Bible's location LABELS were spoken as proper nouns ("the Forest
Starting Path", "the Hilltop Finish Clearing"). `e9675be4` tells the writer
that labels are pipeline names, not speech, and tells the editor to replace
any the draft says aloud. Segmentation produced four scenes whose image
prompts paste the bible descriptions in full, as before.

**Restart on a finished film keeps the old scenes.** The restart created
its four scenes beside the five Finalizat ones from 08-16 — the path is
offered by the site only before any scene is approved, so nothing guards
against this; the old rows were deleted by hand for the test.
