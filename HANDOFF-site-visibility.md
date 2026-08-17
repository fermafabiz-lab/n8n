# Handoff — production visibility on the site

Scope for a session working **only** in `platform/`. Another session (Dan's)
owns the n8n workflows: a new node in Claude Scripting, SFX, and real photos
for Documentary. **Do not touch any n8n workflow, and do not touch
`remotion/server/assemble.mjs`** — Dan's SFX work lands there.

Read `CLAUDE.md` first. It is the durable memory of this project and it
already explains n8n's behaviour, the Airtable rules, and the traps.

## The three items, in order

**All three are DONE and on the trunk** — they landed by `6baac96`
(2026-08-13) and are ancestors of `claude/hello-7o90qh`. Verified again
2026-08-17 against the working tree. What follows is the original diagnosis
plus what shipped, kept because the diagnoses are the durable part.

### 1. The false "render stopped" panel — DONE

`platform/app/projects/[id]/page.tsx` used to compute:

```ts
missing={!!assembly && !assembly.running}
```

`getAssemblyState()` in `platform/lib/n8n.ts` deliberately returns **no
verdict** when an upstream worker workflow is still alive — meaning "the
render hasn't started because production is still upstream, this is not a
failure". The expression above collapses that into "render stopped", which
is why the manual Restart button kept appearing and why every video needed
one extra click.

**Shipped:** `AssemblyState` gained an explicit `stopped: boolean`, true
**only** when n8n answered AND no assembly execution is alive AND no worker
workflow is alive AND there is no assembly failure in the last 20 minutes.
The three not-a-verdict cases each return `stopped: false` by their own
branch: n8n unconfigured, a render actually running, and production still
upstream. The caller is now `missing={!!assembly?.stopped}`
(`page.tsx:504`), so the panel needs a real verdict rather than the absence
of one.

`AssemblyStatus`'s 75s sessionStorage-backed grace period (`useSettled`) is
untouched and still covers the two healthy gaps a verdict cannot see: the
batch releasing before the orchestrator starts the render, and the render
finishing before `Link Video Final` lands.

`renderLocked` keys off `assembly.running`, not off `stopped` — so the two
states that are not a live render unlock the stepper by themselves.

Note the separate, deeper problem recorded in `CLAUDE.md`: auto-assembly has
never actually fired on wf7 (every Final Assembly execution is
`mode: webhook`). The in-memory Wait timer in the orchestrator appears to
die. That fix is in n8n and is **out of scope here** — this item only stops
the site from lying about it.

### 2. Show what production is actually doing — DONE

The project page used to show checkboxes and a "Regenerating" flag, and
never which scene the batch was on, how many were left, or that fal/Flow
refused something.

**Shipped:** `platform/components/ProductionActivity.tsx`, rendered from the
project page once media generation is the phase. It lists every alive
execution (labelling `waiting` as "working (in a wait step)", never as
idle), names the stage and its `done/total` **within the batch**, estimates
which scene is being worked on — labelled as an estimate, because the batch
reports no per-scene progress — and aggregates refusals through
`platform/lib/refusals.ts`, which translates a pipeline refusal code into a
next step.

Both traps are respected: `alive` comes from `getAliveProduction()`, so the
zombie-vs-alive rule is the shared one, and every count is of **approvals**,
not of assets that merely exist.

One thing it does that was not asked for, and the reason is in `CLAUDE.md`:
past `FROZEN_MIN` (12 minutes) it offers `restartProduction()`, because an
execution that never started is indistinguishable from a healthy one and the
site must not decide that by itself.

### 3. Make the batch cap visible — DONE

`Sort & Cap Scenes` in Media Generation caps each batch at 8 scenes, so a
20-scene project needs several passes and looked stuck from the interface.

**Shipped:** the same panel. `MEDIA_BATCH_CAP` in `platform/lib/n8n.ts` is a
**display mirror** of the CAP in that node — if Dan changes the cap in n8n,
change the constant too or the "N more runs needed" hint goes stale. The
panel re-derives the batch with the same sort the node applies (pending
scenes first, then order, sliced to the cap), shows `runsAfterThis`, and
offers "start the next batch" via `resumeProject()` — but only when n8n
answered AND nothing is alive, since resuming beside a live batch would
start a duplicate.

The cap itself was not touched; this is display plus a trigger.

## Ground rules while two sessions run

- Split is by directory: this session owns `platform/` and `remotion/src/`.
- `git pull --rebase` before every push. Never force-push.
- `CLAUDE.md` is the guaranteed conflict point — both sessions write to it.
  Write only in your own sections and rebase often.
- Before running an end-to-end test, tell Dan. n8n executions are
  version-pinned, and `publish_workflow` publishes the whole current draft —
  a test started mid-edit runs against half-finished work.
