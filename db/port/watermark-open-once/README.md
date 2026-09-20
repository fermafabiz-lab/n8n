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

## The choice moved onto the brief, and became two named options

2026-09-19. It was a switch at Final touches only, which meant it could not be
decided when the film was specified — and as a second numbered row directly
under "Source watermark" it read as an equal decision rather than as a detail
of that one, offered at the top level of the list even on a film whose badge
is switched off.

It is now **one control in two places**: `WatermarkOpenPicker`, nested under
the Source watermark row on the brief (`/new`) and at Final touches, shown only
while the badge is on — the same rule the effects volume follows, because a
control for something that is switched off is a decision with no subject.

**Two named choices, not an on/off switch.** Neither side is an absence: "off"
would have to mean "announce every time", which is a positive behaviour and the
busier of the two. A switch leaves the producer working out which way round it
goes every time they meet it.

| | |
|---|---|
| **Every time** (default) | Every run of shots opens the full label |
| **Once per source** | The first archival shot says ARCHIVAL FOOTAGE in full; after that the same kind keeps just its mark |

The stored key is still `watermarkOpenOnce` and the ONCE side is still `true`.
Renaming it would have meant an n8n edit, a render change and a migration for
every film that carries it, to change a word the producer never sees.

### It rides the webhook, and `sourceWatermark` beside it does not

This is the one decision here worth reading twice, because the two keys sit in
the same row and travel differently.

`Merge Ref Into Options` rebuilds the WHOLE Editing Options blob from
`Normalize Webhook Input`'s value and PATCHes it back seconds after the webhook
answers. So anything the site merges in between is **overwritten on any film
carrying a reference photo** — which is why `createdBy` rides the webhook body,
and why `sourceWatermark`, which does not, silently loses a refused watermark
on exactly those films (`docs/lessons-site.md`, and the note in
`createProject`). That file's own warning is explicit: *any new key the site
merges right after creation has the same hole.*

A key added today has no history to protect, so it does not inherit the defect:
the brief posts `watermark_open_once`, `createProject` forwards it in the
webhook payload, and the orchestrator's `Normalize Webhook Input` stores it.
Applied to `8CienBFfG6SgbB1A` on 2026-09-19, active version `0759685a`, from
`paste/orch-Normalize_Webhook_Input.js`, diffed with
`db/port/lib/diff-workflow.mjs` against `1bde883f`: 32 nodes both sides, one
node changed, connections identical.

**Publish the n8n half BEFORE the site deploys.** The other order leaves a
window where the brief posts the choice and nothing reads it — the producer
picks "Once per source", the film announces every source, and there is no
error anywhere to say why.

### What makes the drift loud

`node db/port/watermark-open-once/check.mjs` — 11 assertions. It runs the
orchestrator's REAL node body (the file that was pasted into n8n, through
`new Function`, not a paraphrase) against fixtures with no n8n and no network,
and then checks the site's two spellings against it.

That exists because this key crosses a webhook body, a Code node and a jsonb
column with **no loud failure anywhere on that path**. A drift between the
posted name and the read name would look exactly like "the feature does not
work": the brief would post the choice, n8n would drop it, and the film would
come back announcing every source in full. Same reasoning as
`npm run check:created-by` next door.

The refusals are pinned too — `'true'`, `1` and a missing key all resolve to
**every time**. Absence must never quieten a film's provenance labels by
itself, and that rule is stated in three places (`Normalize Webhook Input`,
`derive.ts`, the picker's own doc comment) precisely so it cannot be softened
in one of them by accident.

### One trap it walked into on the way

Moving the switch out of `OPTIONS` took it out of `changedKeys`, which is what
Final touches uses to decide whether the button reads "Keep initial settings"
or "Apply N changes". Picking "Once per source" and nothing else would have
left the panel believing nothing had changed and **thrown the choice away** —
the identical failure the effects volume and the caption colour each carry a
hand-written `…Moved` flag to prevent. `watermarkOpenMoved` is the third.

Verified in a real Chromium on both screens rather than by reading: on the
brief the hidden field posts `no` → `yes` → `no` as the two buttons are
clicked, the control disappears with its parent switch while still posting what
was chosen, and comes back holding it; at Final touches the old row is gone,
the button flips to "Apply 1 change & render", and the `changed` chip appears
on the Source watermark row.

## The preview moves now, and the clock moved with it

2026-09-19. The producer asked for a preview that shows the badge **with its
animation**. The preview was static on purpose — "a looping animation in a
settings panel competes with the decision being made" — and that reasoning is
still right, so the conclusion changed rather than the reasoning: it plays
**once**, on demand, and then rests. No loop.

**The expensive part was not the animation, it was making it honest.** A
preview animating on its own curve, on its own clock, would be showing a
different overlay — which is the one thing this whole preview exists not to
do. So the timing left `SourceWatermark.tsx` and became shared, mirrored code:
`markOpenSpan`, `markOpenAt`, `markRevealAt`, `bandOpacityAt`,
`markSettleSeconds` and `WATERMARK_EASE`, in `provenance.ts` on both sides
beside the geometry that moved there for exactly the same reason.

`WATERMARK_EASE` is `Easing.bezier(0.65, 0, 0.35, 1)` — Remotion's
`CURVES.inOutCubic` — solved by hand, because the site cannot import Remotion.
**Verified rather than assumed**: against Remotion's own over 101 samples, the
largest disagreement is **3.9e-16**.

**The refactor was proved to change no frame before it was kept.** The old
inline formulas were recomputed with Remotion's `Easing` and `interpolate` and
compared to the new shared functions over 4846 samples — band lengths 0.3s to
48s, every frame at 24fps, both `expand` states:

| | max &#124;old − new&#124; |
|---|---|
| `open` | 1.1e-16 |
| `reveal` | 2.2e-16 |
| `opacity` | 2.8e-16 |

Eight points of that clock are now pinned on both sides, so a rewrite of the
solver cannot quietly change the feel.

### Two previews, because they answer different questions

| | |
|---|---|
| **Final touches** — `WatermarkPreview` | this film's OWN bands. Auto-plays when the preview opens and on every band change, with a `↻` to replay. Both badges — the framed one and the actual-size strip — run off ONE clock, so they cannot drift from each other |
| **The brief** — `WatermarkMotionPreview` | there are no scenes yet, so a three-band synthetic sequence: archive, AI, archive again. **The repeat is the point** — one band cannot show what "once per source" does, because the difference only exists on a kind's SECOND appearance, and the AI band in the middle is there because `planWatermarkBands` would otherwise merge the two archive bands into one |

Driven in a real Chromium rather than read: on the brief the mark grows
**30px → 239px** (chip to pill) while the size picker's sample beside it stays
at 239 throughout — which is the check that the animated one is animating and
the static one is still static. The first four samples sit at 30: that is the
0.18s the badge waits for its fade before it opens. At Final touches the
preview auto-played on open and replayed on the button, both badges together,
no page errors.

## It is a Documentary feature now — a decision taken against the rule

2026-09-19, Final Assembly `309157bd`. The producer asked why the badge shows
on films that are not documentaries and said it should be documentary-only.

**Why it showed everywhere**: every scene gets a provenance, and a scene with
no stored classification reads `ai_generated` (`buildProvenance` in
`derive.ts` — "Every film this pipeline made before Documentary mode is AI").
Consecutive same-origin scenes merge into one band, so a Story film — all Veo
— drew ONE continuous `✦ AI GENERATED` pill for its entire length. The
original reasoning was that a film saying nothing about where its pictures
came from reads as a claim that they are real. The producer's counter is
better: a label that never changes distinguishes nothing, which is the
opposite of what this overlay is for.

**The gate they chose is one CLAUDE.md explicitly warns against.** "A gate
that tells two kinds of film apart must not trust `category`" — `story` is the
site's default, so genuine documentaries carry it, and of eleven researched
films in the database only three say `documentary`; Burj Al Arab, Peking to
Paris and Tupac are all filed as Story. That was put to them with the count,
alongside a category-free alternative (draw it only when the film MIXES kinds
of source), and `category === 'documentary'` was chosen anyway. It is a
decision, not an oversight, and this section exists so the next session does
not "fix" it back.

**What makes it survivable is that it is not silent.** The known failure —
a documentary filed as Story shipping unlabelled — is now visible before the
render instead of after it:

| Where | What happens |
|---|---|
| The brief | the Source watermark row is dropped; no note, because the category control is a few rows up on the same screen and picking Documentary brings it straight back |
| Final touches | the row is dropped AND a line says "No source labels on this film", naming the category it was filed as |
| The run log | `watermark off (not a documentary: category=story)` — greppable afterwards |

Dropped rather than disabled, the same call Captions makes on a silent film:
a control you can reach and find inert is worse than one that is not there.

**The licence credit is untouched.** `showSourceWatermark` owns the LABEL;
a credit is decided from the provenance itself, and no category reaches it.
Pinned.

**If a documentary ever does ship unlabelled because of this**, the fix is not
to widen the category list. It is the alternative that was on the table:
draw the badge when the film contains more than one kind of visual origin,
which needs no category at all and cannot be filed wrongly.

## And how big it is drawn — a slider, not three named sizes

2026-09-19. The badge is deliberately the least decorative element in the
render: a claim about truthfulness that draws attention to itself stops being
read as one. But "quiet" is a judgement about a particular film, on particular
footage, watched on a particular screen — not a constant — and the producer is
the one looking at it.

**A slider rather than Small / Normal / Large**, because there is no natural
set of steps here: three names would be three numbers somebody picked. What IS
real is the two ends, and both are the artwork's rather than arbitrary:

| | |
|---|---|
| **0.7×** | below this the 15px glyph falls under 11px and the pack's thin strokes start dropping out at 1080p |
| **1.6×** | above this the capsule for the longest label ("ILLUSTRATIVE FOOTAGE", 280px at 1×) passes 448px and reads as a banner rather than a mark |

`step` is 0.05 and is the SLIDER'S grid only — nothing downstream enforces it,
because refusing an off-grid value would be refusing a film that was rendered
before the grid existed.

**Shown with a live sample at the render's real pixel size**, on both screens,
for the same reason `WatermarkPreview` draws the badge at 1:1 under its frame:
a percentage is not a size. "110%" means nothing until you can see that it is
the difference between a mark you notice and one you do not, and the second
thing is what is being chosen.

### One function scales it, not a multiplication at each reader

`scaleWatermark(geometry, scale)` in `provenance.ts` (both copies). Everything
that is part of the MARK scales — height, glyph, both paddings, the three font
sizes, the gap between the stacked lines. What does NOT:

- **`left`, `bottom`, `frame`** — where the badge sits is about the
  composition, not the mark. A badge that walked towards the corner as it grew
  would be two decisions wearing one control.
- **`maxWidth`** — a budget measured against the frame, and the widest capsule
  at the largest size is still well inside it. `check:watermark` asserts that
  rather than assuming it.
- **the 1px border** — a hairline is a hairline. Scaling it would make the
  largest badge look heavy-handed, which is the opposite of the point.

`1×` returns the base object itself, not a rebuilt copy: every film rendered
before this existed goes through here, and a rounding that moved one pixel
would change all of them. Pinned.

### Refused, not clamped — in four languages

`normalizeWatermarkScale` follows `normalizeSpeed`: out of range falls back to
**1**, it does not pull to the nearest end. A stored 4 is a mistake, not "as
big as possible", and a badge silently drawn at the maximum would be a worse
answer than the standard one.

The rule exists four times — `platform/lib/provenance.ts`,
`remotion/src/provenance.ts`, the orchestrator's `Normalize Webhook Input`,
Final Assembly's `Source Watermark` — and `check.mjs` parses the bounds back
out of each shipped text and asserts all four agree. **That parser caught a bug
in itself first**: an unanchored `n >= … && n <= …` matched `normalizeSpeed`'s
`0.5 … 2` six lines above, and reported the copies as disagreeing. A regex over
a whole file finds the first thing shaped like the answer, which is not the
same as the answer. It is anchored to the key's own clause now, and the pin was
proved by deliberately drifting one copy and watching it fail.

### Applied

| Workflow | active version | node |
|---|---|---|
| Master Orchestrator `8CienBFfG6SgbB1A` | `fec6369c` | `Normalize Webhook Input` — stores `watermarkScale` from the brief |
| Final Assembly `BY22Vlhh20Xdkr5Z` | `0ed5da71` | `Source Watermark` — passes it to the render props |

Both from `paste/`, both diffed with `db/port/lib/diff-workflow.mjs` against
the version they were built on: 32 and 40 nodes either side, one node changed
each, connections identical, no Drive node losing `resource`/`operation`.

**What is owed**: the slider has been seen on a locally rendered reel at all
five stops and in the browser on both screens, but no real film has been
rendered at anything other than 1×. The thing to look for is the largest sizes
over BUSY footage — the scrim is tuned for a 30px pill, and at 48px it covers
enough of the frame that a shot with detail in the bottom-left may need the
badge smaller rather than larger.

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
