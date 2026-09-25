# Kids story and Cinematic graphics (2026-09-25)

The producer picked every element of two sampler reels
(`remotion/out/sampler/kids-reel.mp4`, `cine-reel.mp4`) and asked for them as
bundles with "AI picks", like Story/Documentary
(`db/port/graphic-styles/README.md`).

| Category | Style | What it draws |
|---|---|---|
| Kids story | `kidsStorybook` | handwritten chapter titles, a character's still in a drawn frame, confetti on the happy ending |
| | `kidsPlayful` | speech bubbles, a drawn contour naming a character, stickers, confetti |
| | `kidsAll` | all of it (first character a card, the next a contour, alternating) |
| Cinematic | `cineFilm` | the film's title over its first shot, typed location slates, 2.39:1 bars, calm chapter titles |
| | `cineNeon` | the same with glitch chapter titles |
| | `cineMemory` | the title, warm light leaks on chapter changes, calm chapter titles |

Render: `remotion/src/graphics/Kids.tsx`, `Cine.tsx`, placed by
`placeGraphics` (a graphic whose scene opens under a full-frame title starts
after it). `npm run check:graphics` (remotion) pins the placement.

Plan: Graphic Plan now plans graphics for every category. For Kids story the
model is SHOWN each story scene's still (low detail) and returns a box
`[x, y, w, h]` for each character and speaker, so a contour or a bubble lands
on them; `Parse Plan` refuses a box that is the whole frame and a line the
scene text does not say. A character card uses the scene's own still
(`https://house-of-videos.com/media/<path>`). Cinematic plans location slates
from the shot descriptions, never two in a row. The site offers each category
its own styles (`graphicStylesFor`).

`paste/` supersedes `db/port/transitions/paste/`. `check.mjs` here is the one
`npm run check` runs.

Found on the way: Hyperframes' experimental fast capture on macOS silently
dropped two of the six elements of the Kids sampler. Railway (Linux) never
uses it; local renders here set `PRODUCER_EXPERIMENTAL_FAST_CAPTURE=false`.
