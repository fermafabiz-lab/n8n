# Announce each source once — the provenance mark opens, then stays a chip

The source watermark used to print its label as plain text. It now draws the
designer's provenance mark: a square chip holding the origin's glyph, which
opens sideways into a capsule carrying the label — and **stays open** for the
rest of the band.

On top of that, one new Editing Options switch: **`watermarkOpenOnce`**. With
it on, only the FIRST band of each kind of source opens; every later band of
that kind stays the small chip. A documentary that runs twenty archive shots
says ARCHIVAL FOOTAGE once and then keeps a quiet mark in the corner.

## Why the pill is built rather than blitted

The asset pack ships flattened pill PNGs. They are not used. A real opening
needs the container's WIDTH and CORNER RADIUS to be live values; two flattened
images can only be cross-faded, and a cross-fade reads as one mark replacing
another rather than as the same mark opening. Only the bare glyph is taken
from the pack, inlined as path data in `provenanceGlyphs.ts` — which is also
what lets it take its colour from the element around it instead of shipping an
on-dark and an on-light copy.

The label's width is MEASURED via `delayRender`/`continueRender`, not estimated
from its character count: the eight labels differ by more than half a pill's
width ("ARCHIVAL PHOTO" against "ILLUSTRATIVE FOOTAGE"), and a guess clips the
long ones.

## What the switch does NOT touch

- **The licence credit.** Drawn under a collapsed chip exactly as under an open
  pill. It is a legal obligation and no switch on this screen reaches it — the
  same separation `sourceWatermark` already has
  (`docs/source-watermark-license-separation.md`).
- **A kind's first appearance.** Only repeats collapse.

The courtesy "Source: …" line DOES collapse with the label, in both the render
and the preview: a long line under a small chip reads as a broken pill rather
than a deliberate one.

## Keyed on the ORIGIN, not the label

A second archival band from a different archive has a different source line and
is therefore its own band — but it is the same KIND of source, so it stays
collapsed. `archival_footage` and `archival_photo` are distinct origins with
distinct labels, so each gets its own opening even though the pack gives them
one glyph by design.

The merge check runs BEFORE the decision, so consecutive scenes that merge into
one band cannot consume an origin's opening twice.

## The five copies, and what pins them

| File | Holds |
|---|---|
| `remotion/src/provenance.ts` | `planWatermarkBands` + `mark` geometry + open timing |
| `remotion/src/provenanceGlyphs.ts` | the eight glyphs, `DASHED_ORIGINS` |
| `remotion/src/components/SourceWatermark.tsx` | the animation |
| `platform/lib/provenance.ts` | exact mirror of the planner and the geometry |
| `platform/lib/provenance-glyphs.ts` | exact mirror of the glyphs |

`npm run check:watermark` (remotion) and `npm run check:footage` (platform) each
assert the same six cases for the new rule plus "every origin has a glyph", and
both pin the `mark` geometry literally. Change one side, change the other.

## n8n

One line, in Final Assembly's own `Source Watermark` node — the node exists
precisely so this kind of change does not touch `Build Remotion Props`:

```js
body.watermarkOpenOnce = opts.watermarkOpenOnce === true;
```

Body taken verbatim from `paste/Source Watermark.js`. Applied 2026-09-18,
active version `9ac11cd0-444b-4cc7-9510-cc6ab463dfef`, diffed against the
version it was built on with `db/port/lib/diff-workflow.mjs` — 40 nodes,
`Source Watermark` the only one that differs, connections identical.

**Note on that diff**: the tool wants the workflow object itself, and
`get_workflow_details` wraps it in `{workflow: …}`. Handed the raw tool output
it reads "before 0 nodes → after 0 nodes, changed 0" and still prints
`RESULT: OK` — a pass that means nothing. Pipe both sides through
`jq '.workflow'` first and check the node count is not zero.

Publishing the n8n half before the render half is deployed is safe: the
composition has no zod schema, so Remotion merges `inputProps` over
`defaultProps` and an unknown key is ignored.

## The label was not centred in the pill, three separate ways

Found by the producer on the review reel — "scrisul si logoul sa fie centrate
si sa incapa in pastila" — and fixed 2026-09-18. Worth writing down because
all three defects look IDENTICAL on screen, so finding one is no reason to
stop looking, and because none of them was visible in the stills that had been
used to sign the mark off.

Every number below was measured in a real Chromium against the real component,
by walking the DOM in a `renderStill` and logging through `onBrowserLog` —
never by counting pixels in a screenshot, which cannot tell a border from a
scrim and cannot see an advance box at all. Landscape, 16px label, Chromium's
`ui-monospace` (DejaVu Sans Mono).

| | before | after |
|---|---|---|
| border → glyph box, left | 10 | 10 |
| last letter → border, right | 11.6 | 9.8 – 10.4 |
| label ink against the pill's midline | 1.5px high | 0 |

**1. The trailing letter-space.** CSS letter-spacing is added after EVERY
character, the last one included. So a laid-out label is one whole letter-space
(0.14em = 2.24px) wider than its own ink, and a capsule sized to that
measurement is that much roomier on the right than on the left. The old code
then compensated with `padX * 1.15` on the right — a fudge in the SAME
direction, making it worse, and one that also hid the third bug below. Now
`labelTrailingSpace()` is subtracted from the measured advance in the render
and cancelled with a negative right margin in the preview.

**2. The label was measured once per MOUNT, not once per label.**
`SourceWatermark` keeps ONE `Mark` in the tree and hands it a new label at
every band change; the measuring effect had `[handle]` as its dependency, so
it ran on mount and never again. Every band after the first was drawn in a
capsule cut for the first band's label. **`renderStill` cannot see this** — it
opens a fresh page per still, one band each, which is exactly why the mark was
signed off on stills that were all correct. It reproduces under `renderFrames`
with `concurrency: 1`, one page seeking across band boundaries, which is also
what `renderMedia` does. The fix is a fresh `delayRender` per measurement
round, and the answer tagged with the label it belongs to so a stale one is
simply not believed.

**3. A web font that has not loaded yet is a different typeface.** Remotion
holds the frame for OUR handle, not for the font's, so a measurement taken in
`useLayoutEffect` can be of the fallback face and then drawn in the real one.
The round is now repeated after `document.fonts.ready`.

And one that was not a bug: **`labelLineHeight` moves nothing**. A line box's
half-leading is distributed evenly above and below, so centring the box and
setting its height to the pill's inner height put the baseline in exactly the
same place. The text rode high because an all-caps label has no descenders and
the line box is built for a font that does — a typeface-dependent amount
(1.5px here, 5% of the pill), which is why `labelInkDrop()` reads the REAL ink
box from a canvas `TextMetrics` instead of assuming a cap-height ratio. It
refuses to answer when the canvas resolved a different face than the DOM did,
which it detects by cross-checking the advance widths: a canvas draws no
letter-spacing, so its width must come out exactly one space per character
under the span's.

The arithmetic lives in `provenance.ts` on both sides (`labelTrailingSpace`,
`markPillWidth`, `markChipPadX`, `labelInkDrop`) rather than in either
component, so the eleven new cases in `npm run check:watermark` and
`npm run check:footage` can pin it with plain numbers and no browser.

**`markChipPadX` also fixed a half-pixel**: the chip's padding was
`(height - glyph) / 2`, which ignores that under `box-sizing: border-box` the
two 1px borders come off the space the glyph has to sit in.

**What is NOT fixed, deliberately.** The `unknown` glyph — a bare "?" — is
drawn 8 units wide in the pack's 24-unit box where the others are ~19, so its
border-to-INK gap reads 15px against ~10 elsewhere. Padding by the glyph's ink
box instead of its layout box would even that out at the cost of a pill whose
width depends on the artwork and a left edge that shifts between bands. Icons
are set by their box; this is the artwork's own proportion, and it reads fine
at 2.8×.

## What is owed

Two things, and the first is the older of them.

One real film. The animation has been rendered locally against synthetic bands
(`db/port/watermark-open-once/` has no fixtures — the probe lived in a
scratchpad), never on a documentary with genuine archive scenes, and the
opening has never been seen at 1080p over moving footage rather than over a
flat gradient.

And the centring above has only been measured at the landscape sizes. Portrait
is a different font size (17px) into a different pill (32px), so its trailing
space and its ink drop are both different numbers; the arithmetic is shared and
`markChipPadX` is pinned for both, but no portrait frame has been looked at.
