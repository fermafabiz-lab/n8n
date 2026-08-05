# Handoff — production visibility on the site

Scope for a session working **only** in `platform/`. Another session (Dan's)
owns the n8n workflows: a new node in Claude Scripting, SFX, and real photos
for Documentary. **Do not touch any n8n workflow, and do not touch
`remotion/server/assemble.mjs`** — Dan's SFX work lands there.

Read `CLAUDE.md` first. It is the durable memory of this project and it
already explains n8n's behaviour, the Airtable rules, and the traps.

## The three items, in order

### 1. The false "render stopped" panel (diagnosed, not fixed)

`platform/app/projects/[id]/page.tsx` computes:

```ts
missing={!!assembly && !assembly.running}
```

`getAssemblyState()` in `platform/lib/n8n.ts` deliberately returns **no
verdict** when an upstream worker workflow is still alive — meaning "the
render hasn't started because production is still upstream, this is not a
failure". The expression above collapses that into "render stopped", which
is why the manual Restart button keeps appearing and why every video needs
one extra click.

Fix the caller so the no-verdict case is distinct from a genuine stop.
`AssemblyStatus` already has a 75s sessionStorage-backed grace period for
healthy gaps between executions — keep it.

Note the separate, deeper problem recorded in `CLAUDE.md`: auto-assembly has
never actually fired on wf7 (every Final Assembly execution is
`mode: webhook`). The in-memory Wait timer in the orchestrator appears to
die. That fix is in n8n and is **out of scope here** — this item only stops
the site from lying about it.

### 2. Show what production is actually doing

Today the project page shows checkboxes and a "Regenerating" flag. It never
shows which scene the batch is on, how many are left, or that fal/Flow
refused something. Read the executions through the existing helpers in
`platform/lib/n8n.ts` and surface progress.

Traps, both already documented in `CLAUDE.md`:
- `waiting` means alive, not idle — a polling loop spends most of its life
  there. See `getAliveProduction()` for the zombie-vs-alive rule.
- Count **approvals**, not asset existence. Counting clips that merely exist
  made "Video" tick green before review.

### 3. Make the batch cap visible

`Sort & Cap Scenes` in Media Generation caps each batch at 8 scenes. A
20-scene project therefore needs several passes, and from the interface that
is indistinguishable from being stuck. Show "8 of 20 in this batch, 2 more
runs needed" and offer a button to trigger the next batch.

The cap itself stays where it is — that is Dan's file. This is display plus
a trigger only.

## Ground rules while two sessions run

- Split is by directory: this session owns `platform/` and `remotion/src/`.
- `git pull --rebase` before every push. Never force-push.
- `CLAUDE.md` is the guaranteed conflict point — both sessions write to it.
  Write only in your own sections and rebase often.
- Before running an end-to-end test, tell Dan. n8n executions are
  version-pinned, and `publish_workflow` publishes the whole current draft —
  a test started mid-edit runs against half-finished work.
