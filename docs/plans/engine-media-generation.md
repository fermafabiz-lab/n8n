# Plan: Media Generation moves out of n8n into the engine

Written 2026-09-25, after Final Assembly moved (`docs/plans/engine-final-assembly.md`,
live since 2026-09-25 19:20 UTC). This is the second workflow of three. The
producer's order: Final Assembly, then Media Generation, then Claude Scripting.

## What Media Generation is today (live `527c67b7`, measured)

**Size:** 248 nodes and 254 KB of Code-node JavaScript — about six times Final
Assembly. **Entry points:** two.
- `Receive Batch Input` — the film's production pass, called by the orchestrator.
- `Video Regen Webhook` — `scene-video-regen`, one scene's clip.

| Stage | Nodes | Code | External services |
|---|---|---|---|
| Dead mux chain (reachable from nothing) | 25 | 0 KB | — |
| 1. Setup: user refs, cast sheets, set plates, cross-account replication | 33 | 30 KB | useapi (Flow assets/images), site `/api/media/ingest` |
| 2. Voices (`AB *`) | 20 | 5 KB | ElevenLabs, Railway `/tts-multi`, **Drive** |
| 3. Images: account routing, cooldowns, refusal ladder, consistency judge, **image approval gate**, image regen | 43 | 52 KB | useapi, OpenAI (judge, rewrite) |
| 4. Clips: serial loop and the 3-account pool with stealing, end frames, motion judge, the VP refusal ladder, **video approval gate** | 61 | 103 KB | useapi, OpenAI, Railway `/inspect`, **Drive** |
| 5. Clip regen (webhook tail, `RG *` / `VRW *`) | 41 | 51 KB | same as 4 |
| 6. Voice regen inside the batch (`VR`) | 7 | 0 KB | ElevenLabs, Drive |
| 7. Orchestration: batches of scenes, **final-settings gate**, `Finalizat` | 18 | 9 KB | Postgres |

**The three approval gates are `Wait` loops polling every 15 s inside one
execution that lives for hours.** That single fact is behind most of what
CLAUDE.md warns about in this workflow:
- A running batch is pinned to its version, so a fix does not reach it ("A
  pipeline fix does not reach a batch that is already running").
- Pause and Delete stop every film's run.
- `runData` is empty while the batch runs, so nothing can be watched.
- Regeneration flags are stranded when an execution dies.

## The shape in the engine

Same approach as Final Assembly (a Postgres row is the state and the queue, a
worker drives it), with one difference that matters:
- **The gates are not waits.** A film's production is a `production_job`
  row, plus per-scene work rows (`voice`, `image`, `clip`).
- Where the batch now polls for an approval, the engine **stops and records
  the gate**.
- The site's approve button, which today writes the flag n8n polls for,
  queues the next work directly.
- Nothing is alive while a producer thinks. So:
  - there is no pinned version;
  - Pause touches one film;
  - a fix reaches the next scene.

**Regenerations become the same work rows, queued by the site.** They are
not separate webhooks, so a regen cannot be stranded: its row says what
happened to it.

## Phases

Each phase ends in a commit, a report and — from phase 2 on — something the
producer can use. They are ordered by independence and value, not by the
order the batch runs in.

1. **Inventory and golden harness.**
   - Port each live Code-node body to TS, in the same way as for Final
     Assembly (`engine/check.mjs`: the committed n8n bodies against the TS,
     plus real execution fixtures).
   - Delete nothing from n8n.
   - The 25 dead mux nodes are listed and not ported.
2. **Voice (first to go live).**
   - The `AB *` synthesis (ElevenLabs direct, multi-voice through `/tts-multi`)
     and voice regeneration as engine work.
   - `requestVoiceRegen` on the site queues it behind a flag.
   - It is the smallest stage (20 nodes, 5 KB) and has no gate.
   - **Proposal:** store the voiceover in `/media` rather than Drive. It is
     the open item in CLAUDE.md ("Give voiceovers a real attachment row"):
     Drive-served takes cost 593–1383 ms a seek against 25 ms local, and they
     are why scene review stalled on 2026-09-20.
   - **DONE 2026-09-25**:
     - **Built:** `engine/src/voice/` (one picker for both n8n copies, checked against both), `hov.media_job` (db/017) and the media loop.
     - **Site:** `VOICE_ENGINE=code`. Takes are stored in `/media/voices/`.
     - **First real take, pressed by the producer (Rome film, scene 2):** 3.1 s click to take, served from `/media`.
3. **Images.**
   - Flow image generation, account choice (`IMG Account`, cooldowns on 403
     `UNUSUAL_ACTIVITY`, `captchaRetry = 5`), the refusal ladder, the
     consistency judge.
   - Image regeneration as engine work.
   - Image regen lives today in Claude Scripting's `IR *` tail; it moves too.
   - **Image regeneration DONE 2026-09-25**:
     - **Built:** `engine/src/image/`. `check-image.mjs` has 128 assertions, including the three live REFERENCE ASSEMBLY copies being identical; 12 image scenarios.
     - **Deployed:** the engine at `50d6a99`. The site half (`IMAGE_ENGINE`) waited for a scripting run to finish before it went out.
     - **Still in n8n, moving with the production pass:** the batch's image loop (account routing, cooldowns, the consistency judge).
4. **Clips — the largest part.**
   - Submit and poll (10-minute ceiling), end frames, motion judge, the VP
     ladder (audio-filter arm, fresh seed after a refusal, regenerate the
     still), the pool with work stealing.
   - `scene-video-regen` becomes engine work.
   - Clips land in `/media` (already ingested today; Drive is dropped).
   - **Clip regeneration DONE 2026-09-25**:
     - **Built:** `engine/src/clip/`. `check-clip.mjs` has 144 assertions (counters included, three sabotages caught); 15 clip scenarios.
     - **Deployed:** the engine at `f6092b6`. The site half (`VIDEO_ENGINE`) goes out with `IMAGE_ENGINE` once no production batch is running.
     - **Still in n8n, moving with the production pass:** the batch's clip loop (pool, stealing, VP ladder).
5. **Setup:** reference upload, cast sheets, set plates, cross-account
   replication.
6. **The production pass.**
   - A per-film `production_job` walks setup → voices → images → gate →
     clips → gate → final settings → Final Assembly, which is already on the
     engine.
   - The orchestrator's `Execute Media Generation` (and its Resume twin) is
     replaced by queueing it, behind a per-film flag, like
     `FINAL_ASSEMBLY_ENGINE`.
   - A shadow run on real films, then one film end to end, then the flip.
   - **Phase 6, broken down** (written 2026-09-26, after reading the live batch `527c67b7`). The batch is one execution. From `Receive Batch Input`:
     - setup;
     - `Sort & Cap Scenes` (the whole film, pending first, cap 200);
     - `Assign Accounts` (contiguous blocks; a scene stays on the account that minted its image);
     - the audio loop, then the image loop;
     - the **asset gate** (`Evaluate Image Approval` every 15 s: every image approved AND present, every voice approved where there is speech);
     - the clip loop (serial, or the 3-account pool);
     - the **video gate** (`Evaluate Video Approval`: every clip approved AND present);
     - `Mark Scene Finalizat`, and `More Batches?` for another pass while clips are missing (at most 12);
     - the **final-settings gate** (status leaves `Setări Finale`, or 2 h pass), which bounces once per flagged scene for a missed video regen.

     **All three gates are pure reads of the database**, so in the engine they are checks a worker runs on a `production_job` row, not waits held open inside a process.
     - **6a — the batch's image stage:**
       - `Build Image Request` (the shared REFERENCE ASSEMBLY, already ported and held to all three copies);
       - `IMG Account` and the cooldown guard on 403 `UNUSUAL_ACTIVITY`;
       - the refusal ladder (`Rewrite Prompt AI` / `Apply Rewritten Prompt`);
       - the consistency judge and its re-roll.

       Golden-tested like the regen ports.
       - **DONE 2026-09-26**:
         - **Ported:** `engine/src/produce/images.ts` has the build (n-1 chain and strict re-roll), account choice, the per-account reference remap, silent-refusal decode, error routing, the rewrite ladder, the cooldown with failover, and the consistency judge. `engine/src/produce/gates.ts` has Sort & Cap, Assign Accounts, both approval gates, More Batches? and the settings gate.
         - **Checked:** `check-produce-images.mjs` has 156 assertions against the live nodes, static-data counters included. Six sabotages all fail it, after a threshold case was added for the one that did not.
     - **6b — the batch's clip stage:**
       - `Current Scene` (the frozen prompt);
       - serial submit/poll;
       - the pool with `Pool Tick` / cooldown and work stealing;
       - the VP ladder (audio arm, fresh seed, regenerate the still with a steer);
       - end frame and motion judge (shared with 4).
       - **DONE 2026-09-26**:
         - **Ported:** `engine/src/produce/clips.ts` covers Sort Scenes For Video, Current Scene, the pool (Pool Tick / Pool Record / Steal Record, including work stealing, the per-account rest and the fresh still), Submit Video's overrides, Submit Cooldown Guard with its end-frame pause, Check Job Status, Extract Video URL, Resubmit Guard, the motion judge (Prep / Verdict / Resubmit), the VP ladder (Prep, the steer, Image Ready, the person-only prompt rewrite, the four writes) and Update Scene Record's fields.
         - **Checked:** `check-produce-clips.mjs` has 320 assertions. The pool is driven through a whole three-account film tick by tick. Of 16 sabotages, 15 fail the check. The 16th (the donor's `length < 2` guard) is dead code in n8n too, since `best` starts at 1.
         - **Not shared with `src/clip/regen.ts`, on purpose:** the two chains differ in keys (`regen:`), seeds (`:rgmotion:`), ceilings (4 resubmits against 5) and where the motion comes from.
         - **Dropped:** Drive (Upload/Share/Set Scene Result). Per D1, clips land in /media through ingest.
     - **6c — setup:** user reference upload, cast sheets, set plates, sheet ingest, cross-account replication (`Replicate *`, `Build Flow Refs`, `Save Flow Refs`), `Assign Accounts`.
       - **DONE 2026-09-26**:
         - **Ported:** `engine/src/produce/setup.ts` covers User Ref? / Extract Asset Id, Cast Sheet Prep (tiers by appearances, turnaround / portrait / object sheets, the producer's photo as the protagonist's base, the kids styles), Collect Cast Refs, both ingest preps, Set Plate Prep, Collect Set Plates, Replicate Prep, Collect Replicated (filed under the account the id names) and Build Flow Refs.
         - **Checked:** `check-produce-setup.mjs` has 198 assertions. It includes a whole replication loop, each side accumulating its own table. All 13 sabotages fail it; four needed a targeted case first (the 10% lead rule, a stored turnaround never downgraded, objects matched by full name only, the three-object cap).
         - **One deliberate change: Save Flow Refs merges** the stored table with this pass's copies. n8n's `jsonb ||` REPLACES `flowRefs`, and Replicate Prep skips what is stored. So an execution that copies only new sheets throws the older copies away, and the next execution copies them again. The check asserts the difference.
         - **Not ported:** `Find Audio Folder` (Drive; voices are in /media).
     - **6d — the production job:**
       - `db/018 production_job`;
       - a worker that walks setup → voices → images → asset gate → clips → video gate → Finalizat → settings gate;
       - resume from any phase, Pause = this film only;
       - the orchestrator's two `Execute Media Generation*` nodes replaced by a call to `/api/ops/produce` behind a per-film flag (`PRODUCTION_ENGINE`), exactly as Final Assembly moved.
       - **BUILT 2026-09-26, not live**:
         - **The run is a row.** `db/018_production_job.sql` holds `stage`, `pass` and a `state` that carries everything n8n kept in an execution and in static data. That includes the pool with its jobs in flight at Google, so a restart resumes them.
         - **The worker** (`engine/src/produce/worker.ts`) walks the stages with the ported steps.
           - Voices, and the regenerations the gates used to fire as webhooks, are `media_job` rows.
           - Images are drawn inline, one at a time (the n-1 chain).
           - Clips run serially or through the pool.
           - It is started by `src/main.ts` only when db/018 is readable, so an engine deploy never waits on the migration.
         - **The site.** `lib/production-engine.ts` plus `POST /api/ops/produce` answer the orchestrator with `{engine: "code" | "n8n"}` according to `PRODUCTION_ENGINE`.
           - Under `code`, Resume queues a row.
           - Pause stops THIS film's run.
           - The project page counts an active run as "running".
         - **Tests.** `engine/test/produce.test.mjs` runs 8 whole films against PGlite and a fake Flow / OpenAI / site, with the media worker beside it and a fake producer approving:
           - serial;
           - three accounts with the pool and replication;
           - the VP ladder;
           - image rewrites and a strict re-roll;
           - a throttle;
           - held gates dispatching a regeneration;
           - **a restart mid-clip that polls the job in flight instead of submitting it again**;
           - the settings gate sending a pass back.
         - **Deliberate differences from n8n:**
           - **The n-1 image** is the previous BUILD's decode. n8n indexes Decode and Build by the same `$runIndex`, and the two drift apart after a failed Generate or a cooldown retry.
           - **Submit Video's "latest run" overrides** (end frame, cooldown, motion re-roll) are kept as the latest of each, as `.first()` reads them.
           - **The batch's first voice take** keeps `Observații Scenă`, as AB Write Voice does.
           - **A failed voice take** no longer kills the run. The gate simply waits for it.
         - **Owed for 6d to be live:**
           1. Merge to the trunk (site + engine deploy).
           2. Apply db/018.
           3. In the orchestrator, an HTTP node before each of the three `Execute Media Generation*` nodes (Batch, Resume, Restart). It calls `/api/ops/produce` with `onError: continueRegularOutput`, and an If on `$json.engine === 'code'` stops there. A 404 or error falls through to n8n, so the change is inert until `PRODUCTION_ENGINE=code`.
     - **6e — shadow then cutover.**
       - The engine computes the image and clip requests for a real film's scenes, and they are diffed against what n8n sent (the executions keep them).
       - Then one real film end to end on the engine, watched.
       - Then the flip.

7. **Retire** Media Generation in n8n. It stays the rollback until a few
   films are good.

## Decisions for the producer

- **D1:** voiceovers (and the clips' Drive copies) move to `/media` and stop
  being uploaded to Drive. Recommended: yes. It fixes playback lag and
  removes a dependency on the Drive OAuth token.
- **D2:** start with voice (phase 2) as the first live piece, before images
  and clips. Recommended: yes. It is small, and a regeneration with no gate
  proves the work-row model on a real button.

## Secrets the engine will need

| Secret | Status |
|---|---|
| `ELEVENLABS_API_KEY` | already in GitHub Secrets |
| `OPENAI_API_KEY` | new |
| `USEAPI_TOKEN` | new. It is hard-coded in several n8n nodes today; CLAUDE.md asks for it to be rotated |

## Verification (per phase)

- **Golden:** identical outputs to the n8n bodies on real fixtures, as for
  Final Assembly.
- **Shadow, where a stage builds requests:** the request the engine would send
  equals the one n8n sent on the same scene.
- **One real use by the producer before any flag is flipped**, e.g. a voice
  regenerated from the audio panel.
