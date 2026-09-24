# Plan: motion packs per film category (Hyperframes)

Written 2026-09-24 and agreed with the producer. The two tracks run in parallel, in separate chats and separate git worktrees (section below). Update this file as phases land; CLAUDE.md's Open work points here.

## Context

The producer asked two things:
- **Move the pipeline out of n8n into code, step by step.** Today's session showed why.
  - Editing one n8n node meant pulling 1 MB of JSON and pasting 21 KB by hand.
  - Prompts and rules live in several copies each.
  - A running execution cannot be watched.
  - Pause and Delete stop every film at once.
  - Four people work on it and n8n has no merge.
- **Work together on better Hyperframes animations for each type of film,** in parallel with the migration.

**Pilot for the migration: Final Assembly.** It is 40 nodes, the smallest workflow, and was measured today. Media Generation comes later, then Claude Scripting.

The producer's decisions:
- **D1: the final film is stored on the site's own `/media` store, not on Google Drive.**
- **D2: restore the lost playback speed.** PACE and "re-render with speed" have been dead since August. The site still saves `speed`, but `Build Remotion Props` stopped sending it.
- **D3: animations start with Story.**

## How to run the two tracks: two chats, two folders

Two Claude chats in the **same folder** would switch branches under each other. So each track gets its own git worktree:

```
cd "/Users/alexlinte/Desktop/Code - House of Videos"
git -C n8n worktree add ../n8n-engine -b claude/engine-final-assembly claude/hello-7o90qh
cd n8n-engine && (cd platform && npm ci) && claude
# first message: "Read docs/plans/engine-final-assembly.md and CLAUDE.md, do phase 1"
```

- **Chat A (new, `n8n-engine` folder): migration.** It is long and mostly autonomous, and it asks before deploys.
- **Chat B (this one, `n8n` folder): animations.** It is interactive with the producer, who looks at renders and picks.

**The only seam between the two tracks is the render props contract**, `remotion/src/types.ts` `FinalVideoProps`.
- Any new prop is optional, with a default that reproduces today's picture.
- During the overlap, a new prop is added in `Build Remotion Props` (n8n) **and** in the engine's `buildProps`.
- Both chats obey the deploy rule: before merging anything touching `remotion/**` or `platform/**`, check the n8n `search_executions` tool.

## motion packs (Hyperframes), starting with Story (D3)

### Design
- **Contract.** Add optional `category?: string` and `kidsStyle?: string` to `FinalVideoProps`.
  - `Build Remotion Props` sends `opts.category` / `opts.categoryOptions.visual_style`; that node already parses `opts`.
  - Track A's `buildProps` sends the same.
  - When the field is absent, the picture is exactly today's.
- **`remotion/src/motion/`: a `MotionPack` per category**, alongside the tone presets in `style.ts`, not replacing them. Tone keeps fonts and colours; the pack owns motion:
  - caption behaviour (entrance, emphasis, chunking);
  - card entrance and exit;
  - chapter card treatment;
  - hook card treatment;
  - transitions and flashes;
  - film grain and grade intensity;
  - end-screen entrance.
  - `packFor(category, kidsStyle)` returns `classic`, which is today's motion exactly, unless a pack is enabled.
- **Enablement:** env `MOTION_PACKS` on Railway, for example `story`. It is read by `server/index.mjs` and passed into the page. Rollback is one variable, like `RENDER_ENGINE`.
- **Authoring:** motion is still frame-driven React through the shim. GSAP is allowed only as a deterministic tween computed from the frame (`gsap.timeline({paused:true}).seek(t)` inside render). No wall-clock and no randomness, per the Hyperframes contract.
- **Rules every pack must pass**, from `docs/lessons-render.md`:
  - non-linear easing only (`easing.ts`);
  - `TITLE_LINE_HEIGHT` / diacritics clearance;
  - `latin-ext` fonts;
  - one text element at a time (captions hidden under cards);
  - reveal finishes 0.35 s before exit;
  - one owner per transition;
  - no masked reveals.

### Working loop with the producer
1. **A storyboard for Story.** Three short animation directions, each rendered on the same 40–80 s Story fixture (the Rome film's props plus a synthetic or real montage) with `scripts/render-local.mjs --engine hyperframes`, about 20–80 s each on the Mac.
   - The clips and a side-by-side contact sheet are shown to the producer, who picks one direction.
2. **Build the chosen pack fully** (captions, cards, chapter, hook, end screen).
   - `compare-engines.mjs`-style regression: every category other than Story renders identical to `classic`.
   - `npm run check`, plus a new `check:motion` that asserts `classic` === today's output for the non-Story fixtures, and the timing rules.
3. **Ship.** Merge (it is a Railway deploy, so check executions first), set `MOTION_PACKS=story`, and watch one real Story film. Then Documentary, Kids, Cinematic in turn.

### Verification (Track B)
- Local renders of every fixture (Story 16:9 and 9:16, Rome, Boyd, the watermark fixture). Frame counts are unchanged, and there is no text overlap or diacritic clipping, checked by eye on the contact sheets.
- Non-Story categories match `classic` (a flat diff, as `compare-engines` measured today).
- The first real Story film with `MOTION_PACKS=story` is watched by the producer.


## Status (2026-09-24 evening)

- **Storyboard done and chosen.** The producer saw three Story directions on the
  Rome film (`remotion/out/storyboard/`, local only) and asked for all three to
  be available, with Punch toned down (overshoot 1.70 → 0.6, grows from 85%
  instead of 55%, slam title 1.3 → 1.15).
- **Four packs, picked per film:** `classic`, `editorial`, `punch`,
  `lowerThird`. Chosen on the brief ("Animation style", Auto by default) and in
  Final touches; stored as `Editing Options.motionPack` only when explicit.
  **Auto = the category's default: Editorial for Story, Classic elsewhere.**
- **Where the rule lives (three copies, move together):**
  `remotion/src/motion/packs.ts` (`npm run check:motion`),
  `platform/lib/motion-packs.ts` (`npm run check:normalize`), and n8n —
  orchestrator `Normalize Webhook Input` stores `motion_pack`, Final Assembly
  `Caption Colour` sends `category` + `motionPack` to the render
  (`db/port/motion-packs/`, `node db/port/motion-packs/check.mjs`).
- **Rollback:** `MOTION_PACKS=off` on Railway puts every film on classic.
- **Measured locally:** a Documentary film with no pick renders identical to
  classic; a Story film with no pick renders as Editorial.
