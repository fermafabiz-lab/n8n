# Rendering the watermark

`remotion/src/components/SourceWatermark.tsx`, drawn inside `FinalVideo`'s
footage Sequence.

## How the props get there

`Source Watermark`, a Code node in Final Assembly (`BY22Vlhh20Xdkr5Z`), between
`Attach Motif Cards` and `Submit Graphics` — the same one-key-per-node idiom as
`Caption Colour`, and its own node for the same reason: `Build Remotion Props`
is large and actively edited, and this needs nothing from it but the body it has
already produced.

```js
body.showSourceWatermark = opts.sourceWatermark !== false;
// per scene, matched on the scene ID from Fetch Approved Scenes
body.scenes[i].provenance = fields['Provenance'];
```

It **decides nothing**. `hov.at_scene` emits `Provenance` already in the render's
own shape (db/009), so the node copies it across. Matching is by scene **id**,
not by position: `Prepare Clips` drops every scene without a final clip, so the
database index and the rendered index part company the moment one clip is
missing — the same anchor rule `Attach Motif Cards` follows.

## Placement

Bottom-left, on the same left edge the captions keep (90px landscape, 44px
portrait), and below the band they occupy — captions are bottom-anchored at 84
(landscape) / 280 (portrait), the badge at 30 / 232. In portrait the bottom
fifth belongs to the platform's own UI, which is why it is lifted rather than
pinned to the corner.

Up to three stacked lines, each on its own translucent ground with a 6px radius:

1. the **label** (`kickerFont`, uppercase, tracked) — omitted when the producer
   switched it off;
2. an optional **source line** — `Source: NASA · Ceuta · 31 Jul 2026`;
3. the **licence credit**, when one is required — drawn whatever the switch says.

## Bands, not scenes

`planWatermarkBands` merges consecutive scenes carrying the same badge into one
continuous band. A documentary that runs six archive shots together shows one
steady label instead of six identical ones blinking apart and back at every cut;
a change from ARCHIVAL FOOTAGE to AI GENERATED still fades, which is the one
moment a viewer needs to notice it. The band is visible for the whole run — not
one or two seconds.

Fades are 0.2s at each end on `inOutCubic`: this is not an arrival, it is a
label becoming legible and then stopping. There is no delay at a band's start.

## When it is not drawn

- **Over a full-frame card** (a chapter card or a motif/text card). The card
  *replaces* the picture, so labelling that frame's provenance would describe
  something the viewer cannot see. `FinalVideo` gates on the same
  `!activeCard && !chapterCardUp` the captions use.
- **Under the hook title**, for the film's first few seconds — the same "one
  text element at a time" rule the captions follow.
- **Over the end screen.** The badge lives inside the footage Sequence, which
  ends when the footage does.
- **On any scene with no `provenance`** — a project rendered before this
  existed, or one whose database has not had db/009 applied. Silence rather than
  a guess.

## Defaults and backward compatibility

`showSourceWatermark` defaults to **true** in `FinalVideoProps`. That is safe
precisely because a scene with no provenance draws nothing: old props carry
none, so nothing appears; new renders of existing films pick the label up.

**Worth knowing before the next render:** every film re-rendered from now on
gains the label unless its producer switches it off, including Story films,
where every scene reads AI GENERATED. That is the intended behaviour, not a side
effect.

## Known limitation

The watermark is drawn in the Remotion graphics pass, so it exists only in the
final film. The site's rough cut and the per-scene previews play the raw clips
and show no badge. Adding one there would mean a second implementation of the
same claim in a different renderer, which is exactly the divergence the "one
stored classification" rule exists to prevent — the Inspector's Footage type
panel is where the site says it instead.
