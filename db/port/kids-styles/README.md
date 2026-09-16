# Eight kids styles, both halves shipped (2026-09-16)

The producer's list, agreed the day before (styles named by what they are —
brick-built, plasticine, paper cut-out, felt and wool, crayon and chalk,
classic 2D — and never by brand):

| key | site label | first words of every frame |
|---|---|---|
| `illustrated` | Storybook — soft watercolour | Children's storybook illustration, soft watercolor and gouache textures… |
| `crayon` | Crayon and chalk — drawn by a child | Children's crayon and chalk drawing, thick waxy strokes, visible paper tooth… |
| `papercut` | Paper cut-out — layered collage | Paper cut-out collage animation still, layered coloured paper with visible torn edges… |
| `cel` | Classic 2D — hand-painted cel animation | Classic hand-painted 2D cel animation still for children, clean confident ink outlines… |
| `cartoon3d` | 3D animation — more realistic | High-quality 3D animated film still for children, soft rounded character design… |
| `brick` | Brick-built — plastic toy bricks | Scene built from interlocking plastic toy bricks, glossy moulded minifigures… |
| `clay` | Clay stop-motion — plasticine | Stop-motion clay animation still, hand-modelled plasticine characters with visible fingerprints… |
| `felt` | Felt and wool — soft toys | Needle-felted wool and soft-toy animation still, fuzzy fibre textures… |

## The n8n half — live

Claude Scripting `gkEtGMecv4TC3ZHp`: was `d0f07af5`, now
**`6e21cddc-7c4a-45d6-a915-bdf0f24d1304`**. The draft had been staged by the
previous session (2026-09-15 17:02 UTC) and parked unpublished; this session
diffed it node by node against the active version (`diff-workflow.mjs` on
the two snapshots here: 110 → 110 nodes, changed 1 — `Voice Mode`, connections
identical, no dangling references), syntax-checked the body, confirmed its
return shape is unchanged, confirmed no scripting execution was running, and
published it with its own `versionId`. `paste/Voice Mode.before.js` is the
active body as read back before the publish; `.after.js` is what is live.

What the one node changes: the two-key prefix (`kidsIllustrated ? … : …`)
becomes the eight-key `KIDS_STYLES` table, an unknown `visual_style` falls
back to `illustrated`, and for `clay` / `brick` / `felt` the segmenter gets a
fourth rule — the film is animated frame by frame by hand, movement carries
the small deliberate steps and slight pose-to-pose snap of stop motion, the
camera moves in short simple pushes. That clause is the answer to "stop
motion is a cadence, not a texture": Veo always renders smooth 24 fps, so the
cadence has to be asked for in the motion prompt, as motion. Whether Veo
honours it is the thing to watch on the first clay film.

The two original keys keep their exact old strings, so every kids film made
before today renders byte-identical prompts.

The sheets and plates were already drawn in the film's style since the
morning — `../sheet-style/`, Media Generation `0f418e8e` — for all eight
keys, because that table was copied from this draft.

## The site half

`platform/lib/categories.ts`: the kids `visual_style` select offers the
eight keys, in `KIDS_STYLES` order, 2D first. The hint says what the style
governs (every scene, character sheet and set plate) and that brick, clay and
felt are animated as stop motion. `db/port/sheet-style/check.mjs` now also
parses this file and asserts the choices equal the table's keys in order —
the fourth copy of the list, kept in lockstep by a check rather than by
memory.

**Merged into the trunk** (`claude/hello-7o90qh`) as `4c2c6c9` on 2026-09-16,
after waiting out a Media Generation run and the render that followed it —
a deploy restarts the container that four Media Generation nodes read the
project through.

## What is owed

The first film in each of the six new styles, and in particular the first
`clay` one: does the stop-motion clause read as stop motion in the clip, or as
smooth CGI over a clay-looking still (the failure the clause exists for)?
`brick` is the one to watch for content refusals — the prompt names no brand,
but the look is unmistakable.
