# engine/ — the pipeline in code

`docs/plans/engine-final-assembly.md` is the plan. Final Assembly is the pilot:
it is n8n workflow `4. Final Assembly` (`BY22Vlhh20Xdkr5Z`), and it moves here
step by step. **Nothing in this directory runs in production yet.**

## Phase 1 (landed 2026-09-24): the logic, pinned to n8n

Every Code node of the live version (`309157bd`) is a pure TypeScript
function in `src/assembly/`, with no I/O. `npm run check` proves each one
gives what its n8n body gives.

| Module | n8n node |
|---|---|
| `normalizeInput.ts` | Normalize Assemble Input (+ `resolveTrigger`, the trigger precedence two nodes repeat) |
| `prepareClips.ts` | Prepare Clips |
| `music.ts` | Match Tone Folder, Pick Music Track (`random` injected) |
| `buildTimeline.ts` | Build Timeline: the `/assemble` body |
| `guards.ts` | Render Guard, Graphics Guard (`polls` = n8n's `$runIndex`) |
| `buildProps.ts` | Build Remotion Props |
| `captionColour.ts` | Caption Colour |
| `attachMotifCards.ts` | Attach Motif Cards |
| `sourceWatermark.ts` | Source Watermark |
| `editingOptions.ts` | the `Editing Options` parse seven nodes each copy |
| `speed.ts` | not a node: D2, the playback speed n8n stopped sending in August |
| `index.ts` | `planAssemble` / `planRender`: the two requests, composed |

Not ported, on purpose: `Set Final Link` (Drive; the engine stores to
`/media`, D1) and `Probe Prep` (a diagnostic branch, retired in phase 5).

**The inputs are the `hov.at_*` view rows**, the Airtable-shaped `{id,
createdTime, fields}` n8n's Postgres nodes read, with the Romanian field
names. That is what makes the comparison exact, and phase 2's loader reads
the same views, so there is no translation layer to drift. Moving to base
table columns is a later change of its own.

Runs on Node 22 with `--experimental-strip-types`, the way `remotion/`'s
checks already do: no build step, no dependencies. Only erasable TypeScript
(no enums, no namespaces, `.ts` in imports). Typecheck with
`../platform/node_modules/.bin/tsc -p tsconfig.json`.

## `npm run check`

- **Layer 0.** `fixtures/n8n-309157bd/` still equals the committed sources
  (`db/port/story-close/Final Assembly.after.json`, plus the Source Watermark
  paste).
- **Layer 1.** The n8n bodies, run in a `$` stub, reproduce execution
  **16974**'s recorded output at every node. 16974 is the Rome film, the
  first Hyperframes film. This layer is what proves the harness is faithful.
- **Layer 2.** The n8n chain and the TS chain run side by side. The worlds
  are:
  - Rome itself;
  - every edit in `fixtures/mutations.mjs` (~60, one per branch);
  - two synthetic films rebuilt from `peking-props.json` and `boyd-props.json`.

  They are compared step by step, and a thrown error is compared by its
  message. The webhook bodies and the poll guards get their own tables.
- **Layer 3.** `planAssemble` / `planRender` equal the `/assemble` body
  16974 sent, and the `/render` body Submit Graphics built from it.
- **Speed.** `normalizeSpeed` agrees with `remotion/server/speed.mjs`, and
  the site resolves speed in the same order.

Each check was proven able to fail by sabotage: a changed constant, the
trigger precedence, a drifted fixture body, provenance matched by position,
and a motif card anchored by index. The sabotage for position-matched
provenance passed at first, because every Rome scene carries the same label.
That is why the "distinct provenance" mutation exists. **A mutation that
cannot fail proves nothing — sabotage any new one once.**

### Refreshing the fixtures

When Final Assembly changes in n8n, pull the new version and a real
execution through the n8n MCP connector:
- `get_workflow_history` → `get_workflow_version`: write every `jsCode`
  into a new `fixtures/n8n-<version>/`, and update `manifest.json`;
- `get_execution(includeData: true)`: keep each node's last run, as
  `rome-16974.json` does.

Only the bodies are committed, never the whole workflow: its HTTP nodes
carry the Railway key.

## Quirks ported faithfully, not fixed

These are kept identical on purpose. A fix belongs after the cutover, as
its own change, measured.

- **Prepare Clips' chapter fallback.** A scene with no `Ordine Scenă` is
  chapter 0 if it sorts first and chapter 1 otherwise.
- **Build Timeline and Build Remotion Props resolve the trigger
  differently.** Props also keeps the orchestrator's trigger when it
  carries only `No_Captions`. The orchestrator path has been disconnected
  since 2026-09-02, so today only the webhook matters.
- **A project with no `Tonalitate` gets the first music subfolder.** The
  normalised tone is `''`, and every name contains it.
- **No script row stops n8n silently.** `Fetch Script Titles` returns no
  items, so every node after it is skipped and the execution ends
  "success" with no film. The engine's `buildProps` renders instead, with
  no chapter titles. This is the one known behavioural difference, and it
  is untested against n8n because n8n produces nothing to compare.
- **Hard-coded values.** The Railway media proxy URL
  (`https://n8n-production-55dd.up.railway.app/media?id=`) and
  `channelName: 'Video Factory'` are literals, as in n8n. The proxy URL
  becomes configuration in phase 2.
