# Hands-off by step (2026-09-24)

The ask, verbatim: *"As vrea la butonul de hands-off sa ai optiunea de a alege
la ce sa se dea automat accept (Script / Scene / Imagini / Audio / Video / Tot)
si sa existe de asemena la fiecare pas un buton de "Auto accept this step" in
cazul in care uit sa dau la pagina de "Start a new vid""* — choose which gates
sign themselves off, and switch a step on from its own page when it was
forgotten on the brief.

## What it is

- **On the brief** (section 08): the Hands-off switch, and under it — while it
  is on — **All · Script · Scenes · Audio · Images · Video · Final render**.
  Switching it on picks every step (what the one switch always meant); any
  step can then be taken out; unticking the last one turns the switch off. A
  silent category (Cinematic) has no Audio chip. The rail says which steps are
  automatic.
- **On every step of the project page**: "⚡ Auto-accept this step" above the
  panel on screen (named — "Auto-accept Audio" — when two steps share the live
  page). Pressed, the step joins the film's list, AutoPilot mounts and signs
  off what is waiting within seconds, then everything that lands after it.
  The button becomes "**Images** accepts itself as it lands · Stop".
- **The banner** names the steps ("Hands-off for Images and Video — …");
  every step reads as before. Turn off clears them all.
- **The chime** stays quiet only for a gate that signs itself off.

`Final render` is Final touches' automatic form — the render press with the
settings saved for the film — which hands-off always did at the end. It is a
choice of its own now rather than a hidden sixth part of "All".

## How

| piece | where |
|---|---|
| the vocabulary, the reading, one owner | `platform/lib/hands-off.ts` (`AUTO_STEPS`, `autoStepsOf`) |
| stored | `Editing Options.autoApproveSteps` + `autoApprove` (true when the list is not empty), written together by `writeAutoSteps` |
| read | `derive.ts` → `project.editing.autoApproveSteps` |
| the hand | `autoApproveTick` — approves only the chosen steps, through the same actions as before |
| the brief | `NewVideoForm.tsx` posts `auto_approve_steps` (comma-separated); `createProject` whitelists it and still sends `auto_approve` |
| n8n | orchestrator `8CienBFfG6SgbB1A`, version **`00ea9681`** (rollback **`4f022248`**): `Normalize Webhook Input` stores `autoApproveSteps`; body from `paste/orch-Normalize_Webhook_Input.js` |
| series | a show freezes the list (`SeriesSettings.autoApproveSteps`); an episode's brief starts from it |
| the button | `components/AutoStepToggle.tsx`, placed by `page.tsx` for the steps on screen (`autoHere`) |

**Old films keep their promise.** A film with only `autoApprove: true` — every
hands-off film made before this — reads as every step. The list, when there is
one, wins over the switch, even when empty. The switch stays strict (`=== true`).

**The n8n change is purely additive**: for any brief that does not send the
field the node's output is byte-identical to the old body's. So it was
published first, while the old site was still live, with nothing to wait for.

## Verified

- `node db/port/hands-off-steps/check.mjs` (`npm run check:hands-off-node`,
  19): the REAL node body against fixtures — byte-identical to the old body on
  four briefs without the list (one sends every field the brief has), the list
  stored whitelisted and in order, the switch following it, the node's list
  equal to the site's `AUTO_STEPS`, and the site posting and reading the field.
- **In n8n itself, without creating a film**: `test_workflow` on the
  orchestrator with the webhook, the Postgres writes and every Execute
  Workflow node pinned. Before the change (execution 16783) the live node's
  output on the full fixture equalled the committed body's byte for byte —
  proof the committed copy was not stale. After the change, on the draft,
  the same fixture came back byte-identical again (16785), and a brief with
  `images,video` came back exactly as the new body computes it (16786). That
  draft is the version published (`00ea9681`).
- `npm run check:hands-off` (35): the reading, the whole read path through
  `buildProject`, and the page's joints. `check:series` gained four cases.
- **The production build in Chromium** against a local engine,
  `browser/drive.mjs`, 26/26: the Images step offers itself; pressed, the
  film's list is exactly `["images"]`, the banner says "Hands-off for Images",
  AutoPilot signs off all three waiting images and NOT the takes; Stop takes it
  back out and the banner goes; an old hands-off film reads as every step and
  its takes are signed off; Turn off clears everything; the brief starts off,
  switching on picks all six, unticking leaves `images,video`, and a stand-in
  n8n received `auto_approve_steps: "images,video"` with `auto_approve: "yes"`;
  All on a full list clears it and the switch goes off; 390px in both themes.

## Live

- **n8n**: orchestrator `00ea9681`, published 2026-09-24 ~09:07 UTC, before
  the site. Being additive, it needed nothing to wait for.
- **The site**: deploy #185, merge `d66c124` into the trunk. The build ran
  09:30:46 → 09:32:53, and `web` was pulled and restarted by 09:33:09 UTC.
  The trunk had gained the Cinematic writing path from another session in
  the meantime (`CLAUDE.md` conflicted, resolved by keeping both entries).
  `platform/lib/data.ts` and `derive.ts` merged cleanly. The merged tree was
  re-checked before the push: `tsc`, all of `npm run check`, and `next build`.
- **Proof that the served page runs it**: `db/port/lib/served-css.workflow.js`
  (execution 16798, 09:33:50). The login page, fetched from inside n8n,
  links `/_next/static/css/532290fefe8b70b4.css`. That file carries
  `.autostep{`, it is the same content hash the local build of the same tree
  produced, and its `last-modified` (09:31:14) falls inside the build.
- **Nothing was running in n8n at the push.** The two Claude Scripting runs
  that had been parked at the scene gate (16776 and 16603) were stopped at
  09:23:30 by a Delete on the site. The film "De ce motorul are limitator de
  turație?" is gone from `hov.project`. `deleteProjects` stops EVERY running
  execution, as Pause does, so the disposable "ZZ DELETE cinematic continuity"
  film's run went with it. Neither was restarted: one was deleted and the
  other is a test film.
- **Owed — the end-to-end proof on a real film.** The first film made from
  the brief after 09:33:09 carries `editing_options.autoApproveSteps`, even
  when hands-off is off (`[]`). The old site never sent the field, so the
  key being present at all means the new brief made it. Read it back with a
  hands-off film's choice of steps, and watch AutoPilot sign off only those.
