# Plan: Final Assembly moves out of n8n into code

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

## Final Assembly in code

### Architecture
- **New package `engine/`** in the repo: TypeScript on Node 22.
  - It runs as its own container, `engine`, in `infra/docker-compose.yml` on the `n8n_net` network.
  - It is **not** inside `web`, so a site deploy does not kill a render.
  - It is lightweight (~100 MB). It only calls Railway and Postgres.
- **The queue is graphile-worker** on the existing `hov` Postgres: durable jobs, retries, resumes after a restart.
- **New migration `db/016_render_job.sql`, table `hov.render_job`:**
  - Columns: `id`, `project_id`, `phase` (assemble|graphics|store|done|failed|stopped), `assemble_job_id`, `graphics_job_id`, `progress`, `verify` jsonb, `error`, `started_at`, `updated_at`.
  - At most one active job per project, enforced by a partial unique index. That is the dedup the double-render history asks for (`CLAUDE.md`, "The site is the ONLY thing that starts a render").
- **Pure TS modules**, one per n8n Code node, with the same logic:
  - `normalizeInput`, `prepareClips`, `pickMusicTrack`, `buildTimeline`, `buildProps`, `captionColour`, `attachMotifCards`, `sourceWatermark`.
  - They read `hov.scene` / `hov.project` / `hov.script` columns directly (`platform/lib/data/postgres.ts` shows the columns and `PROJECT_COLS`).
  - `Provenance` is built as in `db/009_visual_provenance.sql:147`.
- **Railway client:** the same contract n8n uses today.
  - `POST /assemble`, then poll `/assemble/:id/status`: every 5 s, at most 1 h, and a 404 means lost, so resubmit.
  - `POST /render`, then poll: at most 3 h, or 6 h at 1080p; `retiming` passes through.
  - `speed` is now sent (D2), from `Editing Options.speed`, falling back to `Pace`, as `docs/lessons-render.md` "Playback speed" describes.
- **Store (D1):**
  - Download `outputUrl` and write it into the site's media store with the same layout as `platform/lib/media-store.ts`: shared `/opt/n8n/media` volume, served by Caddy at `MEDIA_BASE_URL`.
  - Then write `project.final_video_url` and `status = 'Finalizat'`, which is what `Update Project Status` does today.
  - Drive is no longer touched.
- **Music:** the Drive `Muzica` folder listing moves into code through the Drive API with an API-key or service-account read.
  - If that credential is too much for the pilot, phase 1 calls the existing `list-music` webhook instead (it already exists for the site).
- **Secrets:** Railway URL and `RENDER_API_KEY` go into GitHub Secrets. A new `deploy-engine.yml` workflow is copied from `deploy-platform.yml` / `deploy-site-dev.yml` (GHCR image, SSH `compose pull engine && up -d engine`).

### Site changes (`platform/`)
- **`fireAssembleWebhook`** (`app/actions.ts:1688`) becomes `startAssembly(projectId)`. Behind env `FINAL_ASSEMBLY_ENGINE=code|n8n` (default `n8n`), it inserts a graphile-worker job plus a `render_job` row, or calls the old webhook.
  - Callers: `confirmFinalSettings`, `retryAssembly`, `rerenderWithSound`, hands-off auto-approve.
- **`getAssemblyState`** (`lib/n8n.ts:359`) reads `hov.render_job` **for this project** when the engine is `code`. The answer order stays: failed outranks running.
- **`AssemblyStatus.tsx`** shows real phase and progress from the row, instead of the elapsed-time estimate.
- **`stopAssembly` / `retryAssembly`** set the row to `stopped` (the worker checks it between polls) and start a fresh job.
- **New `POST /api/ops/assemble`**, behind `x-hov-key` like `/api/ops/restart`. The upscale-film n8n workflow is repointed to it.

### Phases
1. **Pure modules plus golden tests.**
   - Port each Code-node body to TS.
   - `engine/check.mjs` runs the **committed n8n bodies** with the stub harness from `db/port/story-close/check.mjs` next to the TS functions, on fixtures, and requires identical outputs:
     - `db/port/motif-rescue/peking-props.json`;
     - the Rome film's real inputs and outputs from Final Assembly 16974, captured through the n8n MCP `get_execution`;
     - `remotion/motif/boyd-props.json`.
   - The source of truth for the bodies is `db/port/story-close/Final Assembly.after.json`, with `Source Watermark` taken from `db/port/watermark-open-once/paste/`.
   - Verify against live `309157bd` with `get_workflow_version` before starting.
   - **DONE 2026-09-24** (branch `claude/engine-final-assembly`), `engine/README.md` has the detail:
     - **Live version.** Checked first: live is still `309157bd`, the only history entry. Its 40 nodes and its connections equal `Final Assembly.after.json` plus the watermark paste, apart from the paste's trailing newline.
     - **Modules.** The 11 ported Code nodes live in `engine/src/assembly/` (Set Final Link and Probe Prep are left out on purpose), plus `speed.ts` for D2 and `planAssemble` / `planRender`.
     - **Assertions.** `npm run check` gives `RESULT: OK 1068/1068`.
       - The n8n bodies reproduce 16974 at every node.
       - TS equals n8n on Rome, 60 mutations, and Peking and Boyd rebuilt as synthetic inputs.
       - The composed requests equal 16974's.
     - **The check can fail.** Each layer was sabotaged once and caught it. The sabotage for position-matched provenance passed at first, because Rome's scenes all carry one label, so a distinct-provenance mutation was added.
     - **The one behavioural difference.** With no script row, n8n stops silently after `Fetch Script Titles`; the engine renders without chapter titles.
2. **Worker, table, Railway client and store.** Run it locally against PGlite (`db/port/lib/local-pg.mjs`) and a local render server (`node remotion/server/index.mjs`).
   - **DONE 2026-09-24**:
     - **Built:** `db/016_render_job.sql` (**not applied to the live database**), plus the worker, the Railway client, music through `list-music`/`share-music`, the streamed `/media` store, the CLI and `src/main.ts`.
     - **One departure from the plan:** **no graphile-worker — the `render_job` row is the queue** (claim with `FOR UPDATE SKIP LOCKED` + a lease). The reasons are in `engine/README.md`.
     - **Tests:** `npm test`, 16 scenarios on PGlite with a fake Railway. `npm run e2e` makes a real Hyperframes render on the Mac: 14 s, stored, Finalizat, speed 1.1 applied.
     - **Left for phase 4:** the container (Dockerfile, the compose service, `deploy-engine.yml`) and the site half.
3. **Shadow run.** On a real finished film, the engine computes `/assemble` and `/render` bodies and diffs them against the n8n execution's bodies, without submitting. Only intended differences are allowed: `speed`, and the store.
   - **DONE 2026-09-24**:
     - **What ran:** five finished films (story ×3, cinematic, kids; 11–54 scenes). Their live rows were read through a read-only throwaway (execution 16999, archived).
     - **Result:** `/assemble` identical on all five; `/render` identical except `speed`.
     - **Speed in practice:** the kids film ("The Missing Blue Scarf") was briefed at 0.8 and rendered by n8n at 1.0.
     - **Detail:** `engine/README.md` and `engine/shadow/`.
4. **Deploy with the default still `n8n`.** Then one real film with `FINAL_ASSEMBLY_ENGINE=code`, watched end to end. Then flip the default.
5. **Retire** the `assemble` webhook, the orchestrator's disconnected `Execute Final Assembly*` nodes, and the probe branch. Update `CLAUDE.md`.

Rough size: phase 1 is 1–2 days of session work; phases 2–4 are 2–4 days. Each phase ends in a commit and a report.

### Verification (Track A)
- `engine/check.mjs`: identical outputs to the n8n bodies on every fixture. `npm run check` stays green in `remotion/` and `platform/`.
- A local end-to-end render: PGlite with a fixture project, the local render server with Hyperframes, and the file lands in the local media dir.
- The shadow diff on a real film is empty apart from `speed` and the store.
- The first real film:
  - one `render_job` row going assemble → graphics → store → done;
  - `final_video_url` served by Caddy;
  - the site panel shows real progress;
  - no n8n Final Assembly execution.


## Note from the animation track (2026-09-24)

Final Assembly's `Caption Colour` node now also sends **`category`** and
**`motionPack`** in the render body (`db/port/motion-packs/paste/fa-Caption_Colour.js`).
The engine's `captionColour` / `buildProps` port must send the same two fields,
with the same rule: `category` when it is a non-empty string, `motionPack` only
when it is one of `classic | editorial | punch | lowerThird`.
