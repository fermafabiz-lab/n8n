# Graphic styles — the pipeline half (2026-09-25)

The render draws five graphic styles (`remotion/src/graphics/`, Stage 1):
classic, reportage, editorial, cinematic, handwritten. This folder is what
makes a real film carry one: who chooses the style, and what the graphics SAY.

## The flow

1. **The brief** (`NewVideoForm`, Story and Documentary only) offers
   "✨ AI picks" (the default, stores nothing) or one of the five. The pick
   travels as `graphic_style` to the orchestrator, where
   **`Normalize Webhook Input`** stores it as `Editing Options.graphicStyle`
   only when it is one of the five.
2. **When the last scene text is approved** (`approveAllScenes`, which hands-off
   also uses, or the last single `saveSceneScript` approval) the site POSTs
   `{project_id}` to **`graphic-plan`** — workflow **`5oSW8UaZeOHVUOSx`
   "Graphic Plan"**. Once per film: a plan that exists is not replaced except by
   "⟳ Choose again" in Final touches (`requestGraphicPlan`).
3. **Graphic Plan** loads the film and every scene's narration (`Load Film`),
   asks gpt-5.4 for a style by THEME (when nothing was picked) and for the
   people, places and figures worth a graphic (`Build Plan Prompt`), then
   **checks every proposal against its scene** (`Parse Plan`): the model's
   `quote` must be words that scene says, a name must appear in it, nothing on
   the cold open, one graphic per scene, a person or place once, a tag per
   ~20 s and a figure per ~60 s, no range squeezed into a unit. What survives
   is merged into `Editing Options.graphicPlan`
   `{style, source, why, items[{kind, sceneOrder, …}], at}` (`Save Plan`,
   base64). A failed answer writes nothing — the film stays classic.
4. **Final touches** shows the resolved style and the list, lets the producer
   pick another style (`confirmFinalSettings` → `graphicStyle`), and re-plans.
5. **The render props.** Since `FINAL_ASSEMBLY_ENGINE=code` the film is
   assembled by `engine/`, where `src/assembly/graphicStyles.ts` does it
   right after `captionColour` (`engine/check.mjs` holds it equal to the n8n
   body below). **Final Assembly's `Caption Colour`** — still the path when
   the switch is `n8n` — sends `graphicStyle` (the pick, else
   the plan's style) and `graphicItems` (sceneOrder → the render's scene index,
   the way `Attach Motif Cards` maps cards). Absent = classic = today's film.

Kids story and Cinematic are skipped everywhere on purpose (the producer:
their graphics come later).

## Files

- `paste/` — the committed source of every node body (CLAUDE.md rule).
  `orch-Normalize_Webhook_Input.js` and `fa-Caption_Colour.js` are the live
  nodes plus one additive block each; `original/` holds what they replace
  (identical to `db/port/motion-packs/paste/`, verified against the live
  versions orchestrator `c9384794`, Final Assembly `362a9c56` on 2026-09-25).
- `gen.mjs` composes `graphic-plan.workflow.js` from `paste/`.
- `check.mjs` (in `npm run check` as `check:graphic-styles-node`) runs all four
  bodies on fixtures and proves both live-node edits are purely additive.

Note: the live `Parse Plan` holds the accent range as the literal characters
U+0300–U+036F where the file has the `̀-ͯ` escape — an MCP
round-trip decoded it. Same regex.

## Verified

Manual executions 17327 and 17328 on the Rome film `recq9Ttq2izgGB5lJ`
(60 s, story): 3 s each; editorial, "a brisk historical explainer";
Augustus (101), Sardinia (102), Portus (103). The first run exposed a range
("20 to 40 million") coming back as value 20 + suffix "–40M" — now refused in
the prompt and in code. That film carries the plan now.

## Owed

- The first real film with the plan in its render (`GRAPHIC PLAN` in the
  Graphic Plan log, `graphicStyle` in the `Caption Colour` output).
- A stat and a derived figure card on the same figure: `placeGraphics` never
  stacks them in one scene, but the same number can appear twice in a film.
- Scene text regenerated AFTER the plan leaves a tag that may no longer be
  spoken; "Choose again" is the manual fix.
