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
     - **6b — the batch's clip stage:**
       - `Current Scene` (the frozen prompt);
       - serial submit/poll;
       - the pool with `Pool Tick` / cooldown and work stealing;
       - the VP ladder (audio arm, fresh seed, regenerate the still with a steer);
       - end frame and motion judge (shared with 4).
     - **6c — setup:** user reference upload, cast sheets, set plates, sheet ingest, cross-account replication (`Replicate *`, `Build Flow Refs`, `Save Flow Refs`), `Assign Accounts`.
     - **6d — the production job:**
       - `db/018 production_job`;
       - a worker that walks setup → voices → images → asset gate → clips → video gate → Finalizat → settings gate;
       - resume from any phase, Pause = this film only;
       - the orchestrator's two `Execute Media Generation*` nodes replaced by a call to `/api/ops/produce` behind a per-film flag (`PRODUCTION_ENGINE`), exactly as Final Assembly moved.
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
