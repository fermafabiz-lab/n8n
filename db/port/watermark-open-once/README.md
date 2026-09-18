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

## What is owed

One real film. The animation has been rendered locally against synthetic bands
(`db/port/watermark-open-once/` has no fixtures — the probe lived in a
scratchpad), never on a documentary with genuine archive scenes, and the
opening has never been seen at 1080p over moving footage rather than over a
flat gradient.
