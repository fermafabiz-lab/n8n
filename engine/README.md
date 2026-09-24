# engine/ — the pipeline in code

`docs/plans/engine-final-assembly.md` is the plan. Final Assembly is the pilot:
it is n8n workflow `4. Final Assembly` (`BY22Vlhh20Xdkr5Z`), and it moves here
step by step. **Nothing in this directory runs in production yet.**

## Phase 2 (landed 2026-09-24): the worker

`src/worker.ts` drives one `hov.render_job` row (`db/016_render_job.sql`)
through Final Assembly's steps. Every step is written down, so a restart
resumes where it stopped:

    queued → assemble → graphics → store → done      (or failed / stopped)

| File | Role |
|---|---|
| `src/worker.ts` | `drive(job)`, the state machine; `runWorker()`, the loop (CONCURRENCY at once, graceful SIGTERM) |
| `src/db.ts` | every statement: `enqueue`, `claim` (FOR UPDATE SKIP LOCKED + lease), `save` (patch + heartbeat, refused once the row is not ours or not active), `loadInputs` (the same `hov.at_*` queries n8n ran), `markFinished` (`hov.at_write`, as `Update Project Status` did) |
| `src/railway.ts` | the render server: submit, status. A 404 comes back as the same error object n8n's HTTP node produced, so the guard reads it as `lost` |
| `src/musicSource.ts` | the Muzica library through n8n's `list-music` / `share-music` (the Drive credential stays in n8n for now) |
| `src/store.ts` | the finished film into `/media`, streamed, content-addressed `<project>/final/<sha256-32>.mp4` (D1) |
| `src/config.ts` | the environment, read once |
| `src/main.ts` | the container's entry point (`npm start`) |
| `src/cli.ts` | `npm run cli -- enqueue|status|stop <projectId>` |

**Decisions made here, which differ from the plan or from n8n:**
- **The row is the queue; there is no graphile-worker.**
  - A second queue would hold a second copy of what the row already
    records: the job, the phase and the poll count.
  - The resume logic has to read the row anyway.
  - PGlite serves every connection through one session, so graphile's
    transactions and LISTEN could not have been tested here.
- **At most one active render per project, enforced by the database.** A
  partial unique index does it, so a second click is refused rather than
  racing (the double-render history in CLAUDE.md).
- **Stop is `phase = 'stopped'`.** The worker's next save is refused, so it
  lets go within one poll. The Railway job itself keeps drawing, because
  there is no cancel endpoint, as before.
- **The inputs are frozen when the job starts** and stored in `inputs`. A
  resumed job renders what it began with, and any render can be replayed
  offline.
- **Network failures on a poll are weather.** Up to
  MAX_POLL_NETWORK_ERRORS in a row is tolerated (24 = two minutes); n8n
  died on the first one. Railway's own `error` status is fatal at once,
  exactly as before.
- **`speed` is sent (D2)**, from Editing Options.speed, falling back to
  Pace. The render server strips it off the props and re-times the drawn
  film.
- **Music:**
  - A film with music off never lists or shares anything.
  - A pinned track is shared but never listed.
  - A tone folder with no audio in it cannot be seen through `list-music`,
    so the pick falls to Default (see `musicSource.ts`).
- **No script row still renders**, without chapter titles. n8n stopped there
  silently.

### Tests

- `npm test` (in `npm run check`) runs 16 scenarios of the real worker. It
  uses PGlite with every `db/NNN_*.sql` applied and a fake Railway plus
  n8n. The scenarios:
  - the happy path, where both requests must equal `planAssemble` /
    `planRender` (+ speed) built from the same rows;
  - a 404 mid-assemble and mid-graphics;
  - an error in either phase;
  - a Stop;
  - a worker killed mid-graphics and resumed by another on the SAME
    Railway job;
  - a stale worker locked out;
  - flaky polls;
  - one active render per project;
  - no clips, no script;
  - pinned, off and tone-folder music;
  - speed from Pace;
  - the loop draining a queue.

  Sabotaging the lease check or the speed makes them fail.
- `npm run e2e` makes one REAL render on this machine:
  - ffmpeg makes three clips and three voiceovers, and PGlite holds the film;
  - the actual `remotion/server/index.mjs` runs with Hyperframes, and the
    worker drives it;
  - first run 2026-09-24: 14 s end to end, a 12.4 s 1280x720 film with a
    chapter card from the script, captions and the end screen. The server
    reported `speed: 1.1` applied.

  It needs `ffmpeg` and `remotion/node_modules`.

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
