# Handoff: House of Videos — visual refresh (Landing, Start a video, Project workspace)

## Overview
A full visual language for the House of Videos platform (the n8n + Airtable faceless-video factory): a light, Apple-grade look — soft grey ground, floating pill buttons, cushioned cards, near-black panels, one purple accent — applied across three screens: the marketing landing page, the "Start a video" brief form, and the per-project production workspace with stage steppers and approval gates.

## About the Design Files
The files in this bundle are **design references created in HTML** — prototypes showing intended look and behavior, not production code to copy directly. The task is to **recreate these designs in the existing codebase** — the Next.js app at `platform/` in the `fermafabiz-lab/n8n` repo (App Router, plain CSS in `app/globals.css`, server actions) — using its established patterns. The real app has more controls and states than the prototypes; restyle what exists rather than deleting features: keep every button/flow, and apply this system's tokens and shapes to them.

The `.dc.html` files open directly in a browser (keep `support.js` next to them). Interact with them to see hover, press, and state behavior.

## Fidelity
**High-fidelity.** Colors, type, radii, shadows, spacing and motion are final. Recreate pixel-perfectly with the codebase's existing CSS approach (custom properties in `globals.css` + component classes).

## Design Tokens

Ground & ink
- Page ground: `#ececed`; hero/shell gradient: `linear-gradient(154deg, #f2f2f5 0%, #e2e2e8 46%, #d3d3db 72%, #eeeef1 100%)` plus a light source: `radial-gradient(90% 70% at 18% 12%, #fdfdfe 0%, transparent 60%)`
- Card fill: `linear-gradient(160deg, #fbfbfc, #e6e6ea)`; inner/nested cards: `#fdfdfe`
- Ink: headings `#2a2a30`, body `#55555e`, muted `#63636e`, faint labels `#6f6f7c`, disabled `#a5a5b0` (never for functional text — keep functional labels ≥ 4.5:1)
- Dark panels: `radial-gradient(120% 90% at 50% 120%, #4d3484 0%, #1a1a1f 55%, #0f0f12 100%)`; dark-panel body text `#b7b7c2`; near-black buttons `#17171a`

Accent (one hue, three steps)
- Accent: `#7a4fd6`
- Deep (dark mixes, panel glows): `#4d3484` (accent mixed 42% toward `#0f0f12`)
- Lift (text/marks on dark): `#b299e7` (accent mixed 42% toward white)
- Accent tints: `rgba(122,79,214, 0.12–0.28)` for chips/ghost fills; selected-chip shadow `0 8px 20px rgba(122,79,214,0.34)`
- Theme options shipped in the prototypes (Tweaks): accent may be swapped to `#c9482f`, `#2f6bd6`, or mono `#17171a` — derive deep/lift by the same mix rule.

Type
- Display/headings: **Outfit** 500 (300–600 loaded), letter-spacing −0.025 to −0.045em; hero 92px, page titles 52–62px, card titles 24–27px
- Body/UI: **Inter** 400/500, 13–16px
- Meta/labels: **IBM Plex Mono** 400/500, 10.5–12.5px, uppercase labels letter-spacing .08–.12em

Shape & elevation
- Pills (buttons, chips, tags): `border-radius: 999px`
- Cards: 24–28px radius; inner cards 16–18px; hero shells 30px
- Shadows: cards `0 12–16px 28–38px rgba(24,20,40,0.13)`; floating dark buttons `0 12px 26px rgba(23,23,26,0.34)` + `inset 0 1px 0 rgba(255,255,255,0.14)`; nav pill `0 10px 30px rgba(24,20,40,0.13)`
- Surface variants (Tweaks): "Cushioned" (default, above), "Crisp" (14–16px radius, hairline `1px rgba(24,20,40,0.10)`, tight shadows), "Flat" (6–8px radius, borders only, no shadows)

Motion
- Standard ease: `cubic-bezier(.2,.8,.2,1)` at ~0.38s (transform, box-shadow, background, color)
- Hover: buttons/cards lift `translateY(-2px … -3px)`; press returns to −1px/0
- Ambient: hero arc drifts (18–24s loop); decorative tiles bob 6–8s; all ambient motion must respect `prefers-reduced-motion`
- Motion variants (Tweaks): Floaty (default) / Calm (45% amplitude, ~1.8× duration) / Still (no ambient motion, 0.18s transitions)

Signature background element — "the lit arc"
- An oversized blurred ring bleeding off a corner: `radial-gradient(closest-side, transparent 0 52%, deep 63%, accent 76%, lift 86%, rgba(20,18,28,0.3) 94%, transparent 100%)`, `filter: blur(18–22px)`, opacity ~0.9, slow drift. Keep its lit band clear of any text column; a dimmer counter-phase echo may sit on the opposite corner.

## Screens / Views

### 1. Landing (`House of Videos Landing.dc.html`)
- **Nav**: centered frosted pill (`rgba(252,252,253,0.86)` + `backdrop-filter: blur(18px)`), brand mark (17px circle, accent/ink split diagonal), links 14.5px `#55555e`, near-black "Start a video" pill.
- **Hero** (1280×760 shell, 30px radius): eyebrow pill; Outfit 92px three-line headline; a purple capsule (214×66 pill, accent gradient) inline with the last line carrying three floating 54–60px tiles (▶, "● REC" mono chip, ✦) that bob; 16px/1.6 subcopy at 560px max; two pill CTAs (dark solid + white); "Scroll for more" tab notching out of the shell's bottom edge.
- **Pipeline section**: left column — eyebrow pill, "Four steps, no crew" 54px, body, "Today's floor" stat card (3 label/number rows). Right column — 4 accordion cards: closed = light card, 30px Outfit title `#6c6c78`, `(0N)` index; open = dark radial panel, 38px white title, body `#b7b7c2`, tag pills (accent tint fills). One open at a time; 0.45s ease.
- **Stats band**: left dark panel ("34 clips in flight / across 3 films" with lift-colored second line, ghost button, decorative striped dome); right stack — big quote card with oversized ghost "$2.32" figure, and a testimonial card (132×168 striped portrait placeholder — replace with a real photo).
- **Closing CTA**: dark radial panel, 52px headline, white pill + ghost pill.
- **Footer**: brand mark + three links `#63636e`.

### 2. Start a video (`House of Videos Start.dc.html`)
Two-column: form (1fr) + sticky 396px rail.
- **Form cards** (numbered 01–04): "What is it about" — textarea (`#fdfdfe`, inset shadow, 16px radius) + dashed suggestion chips; "How it should feel" — Tone chips, Look chips (the 8 genres), Pace segmented control (pill track `rgba(24,20,40,0.05)`, white raised thumb); "Who narrates it" — 3 voice cards (selected = dark gradient card with lift waveform stripes; idle = white) + Language chips; "How long" — 54px Outfit time readout, custom scrub track (8px, accent gradient fill, 26px white knob with accent shadow, click-to-set, snaps to 30s) + preset chips. Selected chip = accent fill, white text, accent shadow; idle = white pill, hairline border. All chips `white-space: nowrap`.
- **Estimate rail** (dark radial panel, sticky): "Estimate" pill, live headline from the theme text, blurb from selections, mono value rows separated by `rgba(255,255,255,0.09)` hairlines (length, scenes at 8s = ceil(seconds/8), words ≈ scenes×22, keyframes = scenes×2, gates = 2), 38px cost figure, "≈ Nh to first cut" chip, white submit pill → sent state (accent fill, "Brief sent — writing the script").
- **"What happens next" card**: 4 dot-led steps, first dot accent and bobbing.
- **The genre pole** (signature piece, sits in the rail between estimate and next-steps, ~396×560): a cylinder whose surface carries the 16 genre stills (`platform/public/genres/*.webp`) on a 2-start helix — big frames (each spans half the circumference), spinning (~46s/turn) while the whole stage descends one full image period so new genres arrive from the top seamlessly; frames drift vertically inside themselves (background sized 128% tall, 19s ease loop) so stills read as footage; no panel behind it — masked fades top/bottom, specular band + blurred sheen overlays, `saturate(0.5) hue-rotate(-18°)` grade; frosted mono caption pill. Port `platform/components/GenreSpiral.tsx` geometry (LEAN 30°, R 152, 16 slabs/turn, FRAME_SLABS 8, STARTS 2). Pause everything under reduced motion.

### 3. Project workspace (`House of Videos Project.dc.html`)
- **Header**: status pill with pulsing dot, 54px title, mono meta line (length · scenes · tone · voice), right-aligned progress label + 220px accent bar.
- **Stage stepper**: 5 equal cards (Script, Scenes, Keyframes, Clips, Assembly) — active = dark gradient card, white 16px Outfit name, lift badge; done = accent-tinted numbered badge; pending = white card. Clicking switches the main panel.
- **Panels per stage**: Script — chapter accordion (active chapter = dark card with full narration); Scenes — large striped preview frame with mono badges, play/pause + scrub row (timecode `0:0X.X / 0:08.0`), narration + motion-prompt inner cards with Edit/Regenerate ghost buttons, 5-across scene tile grid (thumb, `Scene NN` mono, 2-line clamped text, circular approve toggle top-right of thumb: accent-filled ✓ when approved) + "Approve all"; Keyframes — first→last frame pair rows with ready/generating chips and the chaining note; Clips — render strip (20 cells, done = striped, active = accent ring + pulse, queued = grey) + ETA row; Assembly — readiness stats + "Render the final cut".
- **Right rail (sticky)**: gate card (dark panel; title/headline/body/buttons rewrite per stage — the scene gate counts down "N scenes still hold the gate"), Activity feed (dot-led, newest accent), Spend card ($ of estimate + accent progress bar).
- Map states to real data: statusKind wait/run/done/err from `lib/data.ts`; approvals = Airtable checkboxes (`Aprobare Scenă`, `Script Status`); the stepper mirrors `?stage=` navigation in `app/projects/[id]` with `StageNav`'s optimistic pending-stage behavior.

## Interactions & Behavior
- Every interactive element: hover lift + shadow deepen (0.38s standard ease), pressed settles −1px, `:focus-visible { outline: 2px solid #7a4fd6; outline-offset: 2–3px }` (never default blue).
- Accordions/steppers animate size/color, never display:none jumps.
- Scene approve toggles flip instantly and update the gate counter; "Approve all" fills every toggle and flips the gate card to its open state.
- Scrub track: click sets value from pointer X; knob eases with the standard curve.
- Ambient (arc drift, tile bob, pole spin/descent/pan, pulsing dots) pauses under `prefers-reduced-motion` and in the "Still" theme.

## State Management
- Landing: one `openStep` index.
- Start: `{theme, tone, look, pace, voice, lang, seconds, sent}`; derived: scenes = round(seconds/8), words = scenes×22, keyframes = scenes×2, cost ≈ scenes×0.34+1.20, hours ≈ scenes×1.6/60. Submit posts the existing n8n form payload (`Lenght` in seconds).
- Project: `{stage, selectedScene, playing, playhead, approvals{}, chapter}` on top of the app's server data; approvals write back to Airtable as today.

## Assets
- `genres/*.webp` — the 16 genre stills, already in the repo at `platform/public/genres/`.
- Google Fonts: Outfit (300–600), Inter (400/500), IBM Plex Mono (400/500).
- Striped placeholders (`repeating-linear-gradient`) stand in for scene/keyframe imagery — the real app should use its generated frame URLs.

## Files
- `House of Videos Landing.dc.html` — landing page prototype
- `House of Videos Start.dc.html` — brief form + genre pole prototype
- `House of Videos Project.dc.html` — production workspace prototype
- `support.js` — runtime the prototypes need to open in a browser (not for production)
- `genres/` — the 16 stills so the pole renders standalone

## Suggested repo mapping (fermafabiz-lab/n8n)
1. `platform/app/globals.css` — replace the token layer first (colors, radii, shadows, fonts, focus ring, motion).
2. `platform/app/page.tsx` + `ProjectsGrid`, `OpsPanel`, `ProductionTicker` — landing/dashboard restyle.
3. `platform/app/new/page.tsx` + `CategoryPicker`, `VoicePicker`, `LanguagePicker`, `GenreSpiral`, `FormProgress` — Start screen.
4. `platform/app/projects/[id]` + `StageNav`, `SceneBoard`, `ScriptReview`, `AudioReview`, `AssemblyStatus` — workspace.
Keep every existing control; restyle, don't remove.
