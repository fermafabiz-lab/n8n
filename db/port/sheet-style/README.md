# The reference sheets were photorealistic on a drawn film (2026-09-16)

**APPLIED and LIVE.** Media Generation `yHG4DBCDjR3RJzav`: was `6412a267`,
now **`0f418e8e-cb4b-4289-a1b0-2c1642d8c064`**. Draft equalled active before
the edit, so the publish shipped this and nothing else. Two nodes changed,
`Cast Sheet Prep` and `Set Plate Prep`; `diff-workflow.mjs --expect` on the
two snapshots here confirms nothing else did, connections identical, all
twelve Drive nodes intact, no dangling references. Rollback:
`restore_workflow_version` to `6412a267`, or `Media Generation.before.json`.

## What was wrong

`db/port/consistency/` made every character, hero object and location a
reference picture, once per film, and attached it to every scene it is in —
and a gpt-4o judge re-rolls a frame that disagrees with its references in
STRICT MATCH mode ("the references win"). All three sheet prompts ended,
hard-coded, in **"Photorealistic, … sharp focus."**

The kids category (2026-09-07) makes the film's look ONE mandatory prefix at
the head of every scene's `image_prompt` — watercolour, or 3D animation —
and the sheets knew nothing about it. So on a kids film the identity anchor
of every character was a photorealistic turnaround, the scenes were asked to
be watercolour, and the two fought in every frame: the reference pulls toward
photography, and a frame drawn correctly in watercolour scores low against a
photographic sheet and gets re-rolled toward the sheet. The exact opposite of
what the storybook prefix exists for (its "no photorealistic humans" is also
what starves Veo's people filter).

Found by reading `cast_sheet_prep.js`, not by watching a film: whether a kids
film had actually gone through the sheet chain yet is unknown. It becomes
structural the moment a series reuses its sheets across episodes, which is
why it was fixed first.

## The change

Both nodes now resolve the style exactly as `Voice Mode` (Claude Scripting)
does — `Editing Options.category === 'kids'` and
`categoryOptions.visual_style`, unknown key → `illustrated` — and:

- every sheet and plate prompt **opens with the same prefix every scene
  opens with** (`styleHead`), and
- the photorealistic finish becomes "Drawn in exactly that style in every
  view, the same medium as every frame of the film, clean and sharp." (its
  three-view and plate variants).

Any other category emits **byte-identical** request bodies — `check.mjs`
proves it by running the before and after bodies against a stubbed film for
five non-kids shapes and `deepEqual`-ing the output. The same script proves
the kids side (prefix leads every prompt for six keys including the
fallback, no "photorealistic" left) and that the `KIDS_STYLES` table in both
after files is byte-identical to the one in the Voice Mode file kept here.

The producer's own photo still works on a kids film: the GROUND TRUTH
sentence follows the style prefix, so the protagonist's sheet is that face
drawn in the film's medium.

## The table has three copies now

`KIDS_STYLES` — the eight style prefixes — lives in `Voice Mode` (Claude
Scripting), `Cast Sheet Prep` and `Set Plate Prep` (Media Generation).
**Change one, change all three**, and run `node db/port/sheet-style/check.mjs`
after updating `paste/Voice Mode.cs-draft-6e21cddc.js` to the new Voice Mode
body. It was copied verbatim from the parked Claude Scripting draft rather
than the live node, see below, so the six new keys light up in the sheets the
day that draft goes live, and the two live keys keep their exact strings.

## Found on the way: the eight styles are half-shipped

Claude Scripting `gkEtGMecv4TC3ZHp` carries an unpublished draft
**`6e21cddc`** (17:02 UTC on 2026-09-15, the Iustin session's last act) whose
only change against the active `d0f07af5` is `Voice Mode`: the two-key
prefix becomes the eight-key `KIDS_STYLES` (illustrated, crayon, papercut,
cel, cartoon3d, brick, clay, felt) plus a stop-motion motion clause for
clay/brick/felt. **The site half does not exist**: `platform/lib/categories.ts`
on the trunk still offers only `illustrated` / `cartoon3d`, and no branch
carries more. Publishing that draft alone changes nothing a producer can
choose; the site change is what would. Neither is done here.

## Files

| file | what |
|---|---|
| `code/sheet_style.js` | the fragment inserted into both nodes |
| `gen.mjs` | builds `paste/*.after.js` from `paste/*.before.js` + the fragment; every anchor must match exactly once |
| `check.mjs` | the offline proof above |
| `paste/<Node>.before.js` | the live bodies read back through `node-body.mjs` before the edit |
| `paste/<Node>.after.js` | what was sent, and what read back byte-identical afterwards |
| `paste/Voice Mode.cs-draft-6e21cddc.js` | the source of the eight strings |
| `Media Generation.{before,after}.json` | the two snapshots the diff ran on |

`../consistency/code/cast_sheet_prep.js` and `set_plate_prep.js` are updated
in the same commit so that directory keeps describing what is live (the
plate node had already drifted from it — the cap is 10, not 6, since a later
edit that folder never recorded).

## What is owed

One kids film through Media Generation. Look at `SHEET PLAN …` in the
execution log, open the sheet ids written to `castSheets` /
`locationPlates`, and confirm the portraits and plates are in the film's
medium. Then watch whether the consistency judge re-rolls fewer frames on a
kids film than it would have — that is the measurement, and it does not
exist yet.
