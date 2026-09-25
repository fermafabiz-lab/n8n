# Transitions — Stage 3 of the graphics work (2026-09-25)

How the picture hands over at a FEW cuts of a film, one family per film,
chosen by theme for **every category** (the producer: transitions belong to a
theme, not to Story / Documentary / Kids / Cinematic). The families are the
catalog blocks picked in the sampler (`remotion/out/sampler/tr-*.mp4`):

| id | variants (alternating) | block |
|---|---|---|
| `push` | Push Slide, Vertical Push | push 01, 02 |
| `crossfade` | Crossfade | dissolve 01 |
| `blur` | Blur Through, Directional Blur | blur 01, 02 |
| `shutter` | Shutter | mechanical 01 |
| `glitch` | Glitch, Ripple | distortion 01, 03 |
| `none` | plain cuts | — |

## Where it happens: the graphics pass, not /assemble

The plan said `ffmpeg xfade` in `/assemble`. It is not there, on purpose: an
overlap transition SHORTENS the film by its length at every cut, which moves
every scene start after it — the captions, the cards, the sound mix and
`verify.sceneStartsSeconds` all ride on those. Drawn over the montage instead,
nothing about its timing changes:

- `server/cut-stills.mjs` writes the last outgoing and the first incoming
  frame of every story cut (`cuts/c<i>-out.jpg`, `c<i>-in.jpg`) in one ffmpeg
  pass, and names them in the props (`transitionStills`). Hyperframes only.
- `src/transitions/plan.ts` picks the cuts: sparse (12 s apart), chapter
  changes first, never in the cold open, never on a cut something else owns
  (full-frame chapter card or title, chapter flash, text card, hook card,
  black punctuation), never without stills.
- `src/transitions/families.ts` holds each block's own durations and eases;
  `TransitionLayer.tsx` draws them: before the cut the LIVE footage is the
  outgoing shot and a still plays the incoming one, after it the reverse, so
  each side is frozen only while it is the smaller part of the move. It uses
  FinalVideo's half-frame lead — without it a cut a hair after a frame
  boundary (Rome's 12.416667 vs frame 298) laid the incoming still over the
  incoming footage.

`npm run check:transitions` (remotion) pins the variants' start and end
states and the planner; it would have caught the first glitch, which laid its
incoming still opaque over the whole jolt.

## Who chooses

Same path as the graphic styles (`db/port/graphic-styles/README.md`):

- brief + Final touches: "✨ AI picks" (default) or a family; `none` is
  stored as a real choice. `Editing Options.transitionStyle`.
- `Normalize Webhook Input` stores `transition_style`.
- **Graphic Plan** (`5oSW8UaZeOHVUOSx`) now runs for every category: graphics
  for Story/Documentary as before, and the transition family whenever the
  producer did not pick one. A Kids or Cinematic plan carries
  `style: 'classic'` (draws nothing) and `transition`.
- The render gets `transitionStyle` from `engine/src/assembly/graphicStyles.ts`
  and, on the n8n path, `Caption Colour`: the pick, else `plan.transition`,
  never `none`. `engine/check.mjs` holds them equal.

`paste/` supersedes `db/port/graphic-styles/paste/` (whose files are what
`original/` holds). `check.mjs` here supersedes that folder's and is the one
`npm run check` runs.

## Owed

- The producer's look at `remotion/out/transitions/comparatie-tranzitii.mp4`.
- The Remotion engine (the rollback) extracts no stills, so it draws no
  transitions — a film rolled back to Remotion simply has plain cuts.
- The first real film with transitions, watched: whether one every ~12 s
  reads as punctuation or as noise.
