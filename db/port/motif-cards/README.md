# Motif cards — the n8n half

**APPLIED 2026-08-27.** Both workflows are live and verified; what follows
describes what went in, and how to take it back off.

It went in through the **n8n MCP connector**, not the REST API — atomic
operations, one version entry per step, and no API key anywhere. The builders
and the `.original.json` snapshots below are still the rollback and still the
source of truth for the next edit.

Live state, checked by diffing the running workflows against this directory:

| | |
|---|---|
| Claude Scripting | 107 nodes (was 100), all 7 added nodes **byte-identical to the repo**, chain wired, old direct edge removed |
| 4. Final Assembly | 38 nodes (was 37), `Attach Motif Cards` byte-identical, **no pre-existing node altered** |

**One transcription bug was caught by that diff, and it is the reason the diff
exists.** The combining-mark range in the validator went across as
`\u0300` with one backslash too few, so JSON decoded it into the two
invisible combining characters themselves. The regex still matched — it would
have worked for months — but an editor normalising the file would have changed
the range under it. Fixed at the source by stripping marks with `\p{M}`
instead, which is ASCII all the way down and cannot be mangled in transit.
**Any future MCP apply must end with the same diff**: the failure mode is a
node that works and is not what you wrote.

The rest of this file is why each piece sits where it does, and the procedure
if it has to be re-applied or removed.

| file | what it is |
|---|---|
| `Claude Scripting.original.json` | verbatim GET, 100 nodes, versionId `8211a0e5…` |
| `Final Assembly.original.json` | verbatim GET, 37 nodes, versionId `c9c3eaca…` |
| `add-motif-nodes.mjs` | builds `Claude Scripting.motif.json` (+7 nodes) |
| `patch-final-assembly.mjs` | builds `Final Assembly.motif.json` (+1 node, nothing edited) |

Both builders are re-runnable and idempotent: edit the prompt, run again, PUT
again. Both fail loudly if an anchor has moved, because a patch that silently
finds nothing writes a file that looks applied.

## What it does

**Scripting** gains a chain between `Save scenes To Airtable1` and
`Wait For Scene Approval`:

```
Save scenes To Airtable1
  → Prep Motif Input      one item (or the agent runs once per scene)
  → Choose Motif Cards    gpt-5.4 + structured parser, onError: continue
  → Validate Motif Cards  remotion/motif/validate.mjs, inlined
  → Save Motif Cards      merge into project.editing_options, onError: continue
  → Motif Done            restores the scene stream
  → Wait For Scene Approval
```

Three things about that wiring are load-bearing:

- **In-line, not a parallel branch.** n8n flushes parallel branches at the very
  end of a run, which is how a cancelled scripting execution once kept its
  scenes and silently lost its evidence rows. Same reason `Save Evidence` sits
  in the chain rather than beside it.
- **`Motif Done` hands the scenes back.** The chain collapses to a single item
  on its way through, and `Wait For Scene Approval` is wired to receive one
  item per scene. Same move `Evidence Done` makes, for the same reason.
- **Both failure-prone nodes are `onError: continueRegularOutput`.** A film
  with no cards is a fine film; a scripting run that dies because a graphic
  could not be chosen is not.

**Final Assembly** gains no model call and no edit: one node, `Attach Motif
Cards`, sits between `Build Remotion Props` and `Submit Graphics` and turns the
stored cards into the `textCards` prop. It reads the scene order from
`Fetch Approved Scenes` and the rendered order from `Prepare Clips`, so neither
of those had to change either.

That shape was chosen after the first version rewrote `Build Remotion Props` —
the most delicate node in the render path, forty lines of accumulated
corrections about captions, silent films and montage intensity, every one paid
for. Appending a node buys the same behaviour and is removable by deleting one
box.

## Why the card is anchored on Ordine Scenă

The model is shown a numbered list and answers with an index into it. That
index is only meaningful next to the list it came from, and the two lists are
built by different workflows on different days: `Prepare Clips` **drops every
scene without a final clip**, so authored index 6 and rendered index 6 are not
the same scene whenever a clip is missing. The validator therefore stamps
`sceneOrder` (chapter × 100 + scene) on every accepted card, and `Attach Motif
Cards` maps it back to an index against the rendered array. Simulated on a
five-scene film
with one clip missing: an authored index of 3 correctly becomes a rendered
index of 2, and the card belonging to the missing scene is dropped rather than
landing on its neighbour.

## Re-applying, or applying somewhere else

Both PUTs are live immediately, so do this in a window with nothing running.
Note that `apply.mjs` will now REFUSE by design: the live `versionId` no longer
matches the snapshots, which is exactly the guard telling you the workflows
have moved since. Re-save the originals first, read the diff, then apply.

1. **Check nothing is in flight.** `search_executions` for running/waiting on
   both workflows. A Final Assembly render in progress is a hard stop.
2. **Re-save the originals** if they are older than the last edit anyone made:
   `GET /workflows/{id}` → `*.original.json`. The builders read these, so a
   stale original silently reverts someone else's work.
3. `node db/port/motif-cards/add-motif-nodes.mjs`
   `node db/port/motif-cards/patch-final-assembly.mjs`
4. `PUT /workflows/gkEtGMecv4TC3ZHp` with `Claude Scripting.motif.json`
   `PUT /workflows/BY22Vlhh20Xdkr5Z` with `Final Assembly.motif.json`
   Both bodies already carry `settings: {executionOrder: "v1"}` alone — PUT
   rejects the `binaryMode` and `availableInMCP` that GET returns.
5. **Verify on the next real film**, in this order:
   - the scripting execution logs `MOTIF OK|REVIEW|REJECTED …` lines — that is
     the only record of why a card did not make it, and a dropped card is
     invisible on screen by definition;
   - `select editing_options->'motifCards' from hov.project where id = '…'`;
   - the render's props carry `textCards`, and the card lands where the log
     said it would.

**Rollback** is one PUT each from the `.original.json` files, and it took about
ninety seconds the last time it was needed.

## Known consequences, before you apply

- **Explicit cards switch the derived ones off.** `buildTextCards` returns
  `explicit` untouched when it is non-empty, so a film that gets a motif card
  gets no `figure` cards that run. That is the existing documented contract
  ("these bypass every gate below"), not something this change introduced — but
  this change is what makes it reachable, and it is worth deciding whether the
  two should merge instead.
- **`review` cards reach a panel that is now live.** The validator
  separates "proved" from "provenance is real but the transformation is
  unprovable" on purpose, and the second set is badged *worth a look* in Final
  touches, where the producer can switch it off before the render. If the
  badge ever proves too quiet, change one line in `Validate Motif Cards` to
  accept only `ok`.
- **The prompt has never met the model.** Every rule was tested against the
  validator, and the validator against a real film — including rejecting the
  two cards written by hand for it. What has not happened is a gpt-5.4 call
  actually choosing cards. The node is live now, so **the next film scripted is
  the test**; compare what it picks against `remotion/motif/candidate-mine.json`
  (scene 3 and scene 6), and read the `MOTIF …` lines in the execution log.
- ~~The site is not deployed yet.~~ **Shipped 2026-08-27** in `fbc24e9`, along
  with the render server (the push touches `remotion/`, so Railway rebuilt too
  — which it had to: without `RouteCard`/`ScheduleCard` on the box a `route`
  card would have rendered as a blank ink rectangle). Site deploy green, render
  server `/health` ok, so the whole path is live: choose → validate → store →
  review in Final touches → draw.
