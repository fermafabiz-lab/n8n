# House of Videos

AI faceless-video production line. A producer fills in a form on the website,
and the pipeline writes the script, splits it into scenes, generates images,
narration and video clips, then assembles the final cut — pausing at every
step for human approval.

This file is the durable memory of the project. Chat sessions get compacted
and lost; whatever a future session needs to know belongs **here**, not in a
conversation. Keep it updated when a hard-won lesson is learned.

## The pieces

| Piece | Where | Role |
|---|---|---|
| **Website** | `platform/` — Next.js on the Hetzner box, `house-of-videos.com` | The producer's whole interface: create projects, approve each stage, watch progress |
| **n8n** | self-hosted at `wf7.house-of-videos.com` | All orchestration. 4 workflows, see below |
| **Airtable** | base "Database Video" | The single source of truth for project + scene state |
| **Render server** | `remotion/server/` on Railway | ffmpeg + Remotion: `/assemble`, `/tts-multi`, `/media`, `/transcript`, `/inspect` |

External services: **ElevenLabs** (TTS), **fal.ai** (images), **Google Flow via
useapi** (video clips, Veo 3.1), **OpenAI** (scripting), **Google Drive**
(asset storage).

### n8n workflows — ids matter

`Execute Workflow` nodes reference these **by id**, so an id that changes
during an import silently breaks orchestration.

| Name | id on n8n Cloud (dead) | id on self-hosted |
|---|---|---|
| 1. Master Orchestrator | `a9eyVteQcP1ZxtZH` | `8CienBFfG6SgbB1A` |
| Claude Scripting | `auz2GejSQAhvLkCA` | `gkEtGMecv4TC3ZHp` |
| 3. Media Generation (Batch) | `u5eVcB6VOGNdTMom` | `yHG4DBCDjR3RJzav` |
| 4. Final Assembly | `y8ZPxgUFOxdRpva8` | `BY22Vlhh20Xdkr5Z` |

**The import did NOT preserve ids** — every workflow got a new one, while the
`Execute Workflow` nodes kept pointing at the cloud ids. That combination
fails silently: the orchestrator starts, then calls into nothing. The cloud
column is kept only so a stale reference is recognisable on sight.

All five `Execute Workflow` nodes in the Master Orchestrator now point at the
self-hosted column and are published. Note the **resume path is a second set
of references** — `Execute Media Generation (Resume)` and `Execute Final
Assembly (Resume)`, fed by the `resume-project` webhook. Fixing only the three
on the happy path leaves Pause/Resume broken while new projects look fine.

**`restart-scripting` now exists** (built 2026-08-08, orchestrator
`8CienBFfG6SgbB1A`). `resume-project` enters the pipeline at Media
Generation, because it was built for a project whose scenes exist. A run that
dies while the script is still being WRITTEN therefore had no way back: Pause
stopped it, and nothing could start it again. The site shows "⟳ Restart
writing" for that phase and posts `{project_id}` to `restart-scripting`.

The chain is **self-contained**, nine nodes on their own canvas row:

```
Restart Scripting Webhook → Fetch Project For Restart → Prepare Restart Data
  → Execute Scripting (Restart) → Fetch Project Status (Restart)
  → Check Script Status (Restart) → Execute Media Generation (Restart)
  → Execute Final Assembly (Restart) → Mark Finished (Restart)
```

**It could not simply join the happy path**, which is what the plan here used
to say ("→ then into `Fetch Project Status`"). Every node in that tail —
`Fetch Project Status`, `Execute Media Generation (Batch)`, `Execute Final
Assembly`, `Update Status to Finished` — identifies the project as
`$("Create Project in Airtable").item.json.id`. On a restart that node never
executes, so the expression throws and the run dies one step after scripting.
The resume path had already solved this by duplicating the tail off
`$('Fetch Project For Resume')`; restart does the same off
`$('Fetch Project For Restart')`. **Any third entry point needs its own tail
for the same reason** — the shared tail is only shareable by the form.

Two consequences worth knowing: `Lore` is passed empty, because it arrives
with the creation form and is never stored on the project, so a restart
cannot recover it; and restart re-runs Claude Scripting from the top, so it
rewrites the script and its scenes. The site only offers it before any scene
is approved — past that point Resume is the right door.

**The same trap exists once per "in flight" flag, and there are several.**
Every regeneration works by the site setting a flag and the n8n run clearing
it — from `Write Scene Rewrite` on success, `Mark Scene Regen Failed` on a
refusal. Both live INSIDE the execution, so any death before either one
(n8n restarted, the POST never landed, or one of the executions n8n creates
and then never runs) strands the flag with nobody left to clear it. That
alone would be survivable; what makes it a dead end is that the UI shows the
in-flight state **instead of** the button row, so the stranded scene cannot
be approved, edited, or retried. Per-scene rewrite now carries its own way
out — "⟳ Send the rewrite again" and "Cancel — keep this text"
(`restartSceneRewrite` / `cancelSceneRewrite`). Video regen now has the same
pair (`restartVideoRegen` / `cancelVideoRegen`) because approving an image
queues one automatically — see below. The image and voice regen states in
`SceneBoard` still have the identical shape and no escape yet.
**When you add a state whose exit is written by someone else, give it a
local exit too.**

There is also an inactive legacy `2. Scripting Sub-Workflow`
(`5YWpycnnL6OaDWIx`) — superseded by Claude Scripting, referenced by nothing.
Leave it alone or archive it; do not repoint anything at it.

Webhooks the site calls: `new-project`, `resume-project`, `restart-scripting`
(all three on the Master Orchestrator), `scene-text-regen`,
`scene-image-regen`, `scene-voice-regen` (all three on Claude Scripting) and
`assemble`. The site derives all of them from `N8N_NEW_PROJECT_WEBHOOK_URL`
by string-replacing the last path segment, so they must live on the same host
— and each new one must be a plain `path` with no path parameters, or the
derived URL will not resolve.

Run `node scripts/check-n8n.mjs` (needs `N8N_API_URL` + `N8N_API_KEY`) to
verify all of the above in one shot — ids, active state, webhooks, every
`Execute Workflow` target, credentials, Railway health.

**It has to be run from a machine that can reach `wf7.house-of-videos.com`.**
Claude Code web sessions egress through a proxy that answers 403 to that host,
so the script cannot run there — the n8n MCP connector still works, and is the
way to check things from inside such a session.

## Hard-won lessons — read before debugging

These each cost hours. Do not rediscover them.

### n8n

- **Executions are version-pinned.** A running execution keeps the workflow
  snapshot from when it started. Publishing a fix does *not* affect work
  already in flight — only new executions. When a fix "didn't work", check
  whether the execution predates it before assuming the fix is wrong.
- **`waiting` means alive, not idle.** Work paused in a Wait node reports as
  `waiting`. Polling loops spend most of their life there. Treating it as
  "nothing is running" produces duplicate concurrent executions.
- **But the instance accumulates zombies:** orchestrator parents stuck
  `waiting` with `waitTill` in the year 3000, for sub-workflows long dead.
  Counting those as alive breaks Pause/Resume permanently. `getAliveProduction()`
  in `platform/lib/n8n.ts` threads this needle: `running` always counts;
  `waiting` counts only for worker workflows with a genuinely near wake-up.
- **`execute_workflow` targets the first enabled webhook** in a workflow.
- **`runData` is EMPTY for the whole life of a healthy running execution**,
  and mistaking that for "it never started" cost a full day of the producer
  fighting the site. n8n does not persist node progress mid-run
  (`saveExecutionProgress` is off), so `data.resultData.runData` is `{}` from
  the first second until the execution FINISHES or suspends into a Wait node
  — at which point the whole thing lands at once. Proven by execution 2485:
  `running` with empty `runData` after 75s, then a clean render at 4 min.
  Corollary for debugging: **you cannot watch an execution's progress through
  the API.** Fetching a live execution tells you nothing; wait for it to end.
- **Some executions really never start at all** (5639; 1175 on the Vikings
  project): `runData` stays `{}` and the execution never terminates either.
  From the API a live render and a dead one are **indistinguishable** while
  running — the old `isStalled()` claimed otherwise ("a healthy execution
  runs its first node within seconds") and therefore declared every render
  older than 3 minutes STUCK, dropped it from `getAliveProduction()`, and let
  the next Resume STOP it. That is what "it keeps stopping and the render
  starts over from the beginning" was: the site killing its own healthy work,
  every few minutes, on a false premise. Every one of those failures reads
  "The execution was cancelled manually" in the ops panel.
  `isStalled()` is now age-only (45 min), advisory, and NEVER removes
  anything from `getAliveProduction()` — a running execution counts as alive,
  full stop. Do not reintroduce a progress-based test; there is no signal.
- **The never-started execution is not rare, and it wedges the whole project
  because Resume refuses to run beside it.** Specimen: 2704, a Media
  Generation child created by a resume webhook at 12:43:56, still `running`
  twenty minutes later with `runData: {}` **and its `nodeExecutionStack` still
  holding the trigger node** — not one node executed. Its parent (2703,
  webhook mode) was in the same state, so the webhook never even answered.
  The instance was fine throughout: a 5-minute cron on `wmGLHkNssLAyZHKX`
  succeeded every five minutes right through it, so this is not a wedged
  runner and not a concurrency cap — it is that one execution never being
  picked up. Note the node stack is **not** a usable discriminator: n8n saves
  execution data at creation and not again until the run ends, so a healthy
  running execution shows exactly the same empty stack. There is still no
  signal.
  What that costs: `resumeProject` refuses while anything is alive (correctly
  — it would start a duplicate batch), and `getStalledProduction()` only
  reaches 45 minutes, so between minute 0 and minute 45 the project has no
  door at all. The producer's only way through was Pause then Resume, by hand,
  guessing. `restartProduction()` is now that door in one press — pause, wait
  for the alive list to clear, resume — offered by `ProductionActivity` once
  the oldest live execution passes 12 minutes, with the cost stated. It is
  **manual on purpose**: the site must never decide this by itself, which is
  the lesson directly above.
- **`WEBHOOK_URL=https://wf7.house-of-videos.com`** must be set as an env var
  on the instance. Without it n8n hands out `localhost` webhook URLs and
  Vercel can't start anything — which presents as "the site is broken".
- **A missing `wf7` DNS record reads as a broken site, not a DNS problem.**
  The page loads and lists every project — Airtable is a different host and
  keeps working — while "Can't reach the n8n API: fetch failed" sits at the
  top and every approval button is dead. Resolve the name before debugging
  the app: `dig +short A wf7.house-of-videos.com`, and NXDOMAIN is the answer.
  This happened on 2026-08-13, when the two Vercel A records were deleted
  during the cutover and `wf7` went with them.
- **The n8n host is `wf7.house-of-videos.com`, not the bare domain.** The bare
  domain is the website. Everything that must reach n8n — Vercel's three env
  vars, the Google OAuth redirect URI, the MCP connector — needs the `wf7.`
  prefix, and fails in a way that looks unrelated when it's missing.
- **Credentials never survive an export/import** (encrypted per-instance).
  They must be recreated and re-attached to nodes by hand. Four exist on the
  self-hosted instance and every node that needs one has been re-bound:
  Airtable PAT `TPSvrVbCvTyOfNpL`, OpenAI `oPGuXelJ6pnDePIs`, Google Drive
  `dv4yT9vojdPQoO17`, FAL (`httpHeaderAuth`) `0gWTGtLd2dJKO4Yc`.
- **The API redacts per-node credential bindings.** Neither the REST API nor
  the MCP connector returns a node's `credentials` object — every node reads
  back as if it had none. So you cannot *verify* a binding by reading it; you
  can only set it (setting is idempotent) or open the node in the UI. Do not
  conclude from an empty read that credentials are missing.
- **ai33 / useapi / Railway keys are hardcoded into node headers**, not
  credentials — `Submit Render`, `Check Render`, `Submit Mux*`, `Poll Mux*`,
  `Upload*To Flow`, `Submit Video*`, `AB Submit Multi`, `VR Submit Multi` and
  friends carry a literal `x-api-key` / `Authorization`. They work, but they
  live in the workflow JSON, so a rotation means editing nodes and any export
  leaks them.
- **The import also strips `parameters.operation` from Google Drive nodes**,
  leaving them with no resolvable action rather than an error. Every upload
  node needed `resource: file` + `operation: upload` re-set by hand, and
  `VR Find Audio Folder` needed `operation: search`.

### TTS: ElevenLabs direct — written 2026-08-27, LIVE since 2026-08-28

ai33 was an ElevenLabs **reseller** — same `xi-api-key` header, same voices,
ids wearing an `elevenlabs_` prefix. Going direct was a change of endpoint and
of FLOW, not of concepts, and it removed more than it added.

Note the two dates, and that this heading said "since 2026-08-27" for a day
while production was still calling ai33: the repo half deployed and the two
n8n halves stayed parked as unpublished drafts. Everything below describes
the workflows as they now actually run, verified against `activeVersionId`.

- **The poll loops are gone.** ai33 worked on tasks: submit, wait, poll every
  3s, guard against a runaway loop, then download a URL. ElevenLabs answers
  with the mp3. Thirteen nodes across two workflows became three native
  `@elevenlabs/n8n-nodes-elevenlabs` nodes (`AB Speak`, `Speak VR`,
  `VR Speak`), and Media Generation went 162 → 148 nodes, Scripting 107 → 103.
  Five of those deletions were a chain that had had **no input at all** for
  months — the leftover CLAUDE.md used to say to ignore.
- **Stored voice ids survive, and that was checked before anything moved.**
  `hpp4J3VqNfWAUOO0d1Us` resolves at ElevenLabs to Bella, so no project lost
  its narrator. The `elevenlabs_` prefix STAYS in the database and is stripped
  at the call: it is also the validity test in five places
  (`voice_id.includes('_')`), so removing it would make an empty id
  indistinguishable from a missing one.
- **The audio lands where the uploads already look.** The speech node writes
  binary `data`, `audio/mp3` — verified on a real synthesis, 32 kB from one
  Romanian line — which is the default the Google Drive upload nodes read, so
  not one upload node changed.
- **`VR Download Audio` / `AB Download Audio` stay.** They look like part of
  the ai33 path and are not: the multi-voice path still fetches a URL from the
  render server. Check inbound edges before deleting a node that "obviously"
  belongs to the thing you are removing.
- **Model is `eleven_multilingual_v2`** in all three nodes AND in
  `server/tts.mjs`. ai33 never let us choose one, so this is the closest
  equivalent — and the four must agree, or a regenerated line comes back in a
  different voice character from the batch that made its neighbours.
- **The key left the node bodies.** `/tts-multi` used to take the TTS key in
  its JSON body, which meant a plaintext secret sat inside an n8n expression —
  visible on opening the node, and carried into every export. The render
  server now reads `ELEVENLABS_API_KEY` from its own environment. **The old
  ai33 key was exposed in a transcript on 08-27 and must be revoked.**
- Two environments need the key: **GitHub repo Secrets** as
  `ELEVENLABS_API_KEY` (the deploy writes `platform.env`, used by
  `/api/voices`) and **Railway** as the same name. n8n uses its own typed
  `ElevenLabs account` credential (`VbtLxHjVO7QySxfz`) instead.
- **That line described an intention, not the pipeline — the deploy did not
  write the key, and the voice picker was dead because of it** (found
  2026-08-28, from the producer's screenshot of `/new` reading
  "ELEVENLABS_API_KEY is not set in the environment"). `platform.env` is
  regenerated from scratch on every deploy by a heredoc in
  `.github/workflows/deploy-platform.yml`, and `ELEVENLABS_API_KEY` was
  simply not one of its lines — so no value in GitHub Secrets could ever
  have reached the container. The migration changed the *reader*
  (`/api/voices`) and never the *writer*. **Whenever a route starts reading a
  new env var, grep that workflow in the same commit**: the heredoc is the
  only path onto the box, and a missing line there fails at runtime, on one
  screen, with no build error anywhere.
- **`AI33_API_KEY` was removed from the workflow in the same pass**, and it
  was worse than dead weight: nothing in the platform has read it since the
  migration, yet it sat in the required-secrets gate — so revoking the ai33
  key, which the note below says to do, would have failed every deploy for a
  secret nobody uses.
- **`ELEVENLABS_API_KEY` is deliberately a WARNING in that gate, not an
  error.** Without it only the voice picker breaks (`/api/voices` answers 503
  and the screen says exactly which variable is missing); the site and
  production are unaffected, so it must not be able to block a deploy that
  has nothing to do with voices. The warning in the run log is also the
  cheapest way to find out whether the secret exists at all, since its value
  can never be read back.
- **Voices can finally be looked up by id.** ai33 had no such endpoint
  (`/v3/voices/<id>` answered 404), so `resolveNames` scanned eight pages and
  then abused the free-text search with the id as the needle — and a cast from
  a large library sat past the scan, which is how a project printed
  "elevenlabs · …oKomo" at the producer. `GET /v1/voices/{id}` answers
  directly; a miss now means the voice is gone, not merely far down a list.
- **Pagination changed shape**: `/v2/voices` is cursor-based
  (`next_page_token` + `has_more`), not numbered. `/api/voices` still speaks
  page numbers to the picker and walks tokens to reach the window.

### Content filters — deterministic, never blindly retry

- Google Flow / Veo rejects with `PUBLIC_ERROR_PROMINENT_PEOPLE_FILTER_FAILED`.
  **The trigger is the START IMAGE, not the prompt.** Proven: a fully generic
  prompt with no names still failed on the same image. Fix the image, not the
  words.
- Therefore, for anything photorealistic with people — especially Documentary —
  **faces must never be in frame**: people from behind, distant silhouettes,
  crowds at distance, detail inserts. This is the only form Veo accepts. It
  still needs codifying into the Documentary image prompts in Scripting.
- `PUBLIC_ERROR_MINOR_UPLOAD` at the Flow upload step used to kill the whole
  batch. Now handled with `onError: continueErrorOutput` → rewrite chain.
- **Image regen used to reuse the previous scene's image as an edit
  reference**, faithfully reproducing the very content that was refused — five
  identical failures in a row. Regen now drops `prevUrl` unconditionally after
  any rejection.
- A refusal is deterministic. Resubmitting the same input burns retries and
  then kills the batch. Always rewrite before retrying.
- **fal refuses too, with HTTP 422 `content_policy_violation`** — and until
  2026-08-08 `Generate Scene Image` had no `onError`, so one refused prompt
  killed the whole media batch and every scene after it went untouched. The
  symptom does not look like a crash: each Resume redoes the finished scenes,
  makes at most ONE new image, and dies again, so the producer sees image
  generation that "takes forever" rather than one that is failing. Five runs
  over thirteen minutes produced four of six images that way (project
  `recCoZWsZBOrIU69L`). Its error output now enters the SAME chain Google
  Flow's upload refusals already used:
  `Prep Flow Reject → Already Rewritten? → Rewrite Prompt AI → Apply
  Rewritten Prompt`. That reuse is only possible because `Prep Flow Reject`
  reads every scene field from `$('Loop Images')` and touches `$json` only to
  sniff the reason — a chain that had read its context from the *upstream
  node* could not have been shared. It now reports which service refused
  (`service` in its output), because the two notes used to blame Google Flow
  for fal's refusals.
- **Note the two services fail at different moments**, which changes what the
  scene looks like afterwards: Flow refuses at UPLOAD, so the image exists and
  the rewrite replaces a picture; fal refuses at GENERATION, so there is no
  image at all and the scene sits at "Așteaptă Aprobare Imagine" with an empty
  frame until the regen loop fills it. Both are handled by the same chain
  because the cure is identical — rewrite, never resubmit — but do not read
  the empty frame as a second bug.
- **On a scene flagged for regeneration, `Observații Scenă` is PROMPT, not a
  comment.** `Evaluate Image Approval` appends it as
  `ADJUSTMENT REQUEST — the new image MUST follow this: …` so reviewer
  feedback can steer the re-roll. The trap: the natural thing to write in
  that box after a refusal is a description of what was refused, which
  re-injects the banned content and makes the retry fail for a reason the
  writer added. Caught while unblocking `recCoZWsZBOrIU69L` — a note reading
  "the depiction of hands seizing the man was replaced with…" would have been
  sent straight back to fal. Clear the field, or write only what the new
  image SHOULD contain.
- **The refusal often is not in the shot, it is in the Story Bible.** The
  location description is appended to every scene set there, so one flagged
  phrase refuses every one of them. On `recCoZWsZBOrIU69L` the location
  carried "dark skeletal hands forcing their way up through the fractured
  ground", which alone refused scenes 103, 104 and 105. The per-scene rewrite
  clears the scene it runs on and cannot clear the source, so when several
  consecutive scenes refuse, edit the LOCATION in the Story Bible — otherwise
  every new scene on that set is born already refused.

### Airtable

- **The status TEXT field is display-only and lags.** The site must trust the
  **checkboxes** (`Aprobare Imagine`, `Aprobare Voce`, `Aprobare Video`),
  never the status string. `toScene()` in `platform/lib/data.ts` now DERIVES
  the whole scene status from checkboxes + asset existence and keeps the
  stored text only for what cannot be derived: an error, `Regenerare Text`,
  and the phase before the scene text is approved.
- **`Status Producție Scenă` is not a progress field — it is a set of result
  stamps, and it lies loudest on the scenes nobody has reached.** Grep every
  node that writes it and you find only *outcomes*: `Așteaptă Aprobare
  Imagine/Voce/Video` and `Finalizat`. Nothing anywhere writes "Generare
  Imagine" or "Generare Voce" onto a scene. So a scene the batch has not
  touched still carries what Scripting set at creation — **"Generare Script",
  which the site rendered as *Writing script***, the one stage that is
  provably finished for it (its text is written AND `Aprobare Scenă` is
  checked). Invisible while a film fitted in one batch of 8; past the cap it
  is what the producer mostly sees — on a 15-scene film seven scenes sit at
  "Writing script" indefinitely, which reads as scripting being stuck and
  sends the search into the wrong workflow entirely. It cost exactly that
  here. Derived, those scenes read **Queued**, and which one is being worked
  on right now stays where it belongs: the estimate in `ProductionActivity`.
- Use `typecast: true` on writes. Airtable re-hosts uploaded attachment URLs,
  which is what keeps assets alive after Flow's signed CDN URLs expire (~hours).
- **A numeric field left in an Airtable node's column mapping with no value
  writes a literal `0`.** It does not skip the field — it destroys it. Fifteen
  nodes across all three workflows were silently zeroing `Ordine Scenă`,
  `Durată Scenă (secunde)` and the project's `Lenght` on every single write.
  The damage always surfaces far from its cause: scenes shuffled on the site,
  the render built from zero-length scenes, and scripting computing chapter
  counts from a length of 0. If you add a mapped field, either give it a value
  or take it out of the mapping. Nothing warns you.
- **A sixteenth one survived that sweep, and it was the worst placed:**
  `Update Status to Finished` (Master Orchestrator) mapped `Lenght: 0`
  *explicitly*, not as an empty cell — so every project that reached the end
  of the happy path had its length wiped at the finish line. Silent while the
  project stayed finished, and lethal the moment it was restarted: scripting
  derives chapter count from `ceil(Lenght / 120)` and scene math from the
  same number, so a restarted film would be written against a length of 0.
  Removed 2026-08-08 while building `restart-scripting` — which is exactly
  the feature that would have made the damage visible. `Mark Finished
  (Resume)` and `Mark Finished (Restart)` map only `id` + `Status General`,
  and must stay that way.

### Approving an image queues a new clip (and why that is delicate)

A picture approved under a clip that was made from the PREVIOUS picture leaves
the two disagreeing, with nothing downstream ever comparing them — the same
silent drift the narration/take pair had. `sceneAction('image','approve')`
now asks for a new clip itself. Four things make this safe, and all four are
load-bearing:

- **It only fires when a clip already exists.** On the first pass through the
  pipeline `Scene Final URL` is empty, so every approval is a no-op and the
  normal flow is untouched. `Needs Clip?` generates that first clip anyway.
- **The inputs are READ BEFORE the flag is written.** `Prep Video Regen` is
  `onError: null` and throws when the scene has no `Image Media ID` or no
  motion prompt (`Video Scenă URL`) — and a throw there does not skip the
  scene, it **kills the whole batch** mid-generation. `readSceneVideoInputs`
  is what stops an approval from doing that.
- **The site's image regen keeps `Image Media ID` fresh.** The clip's start
  frame is that Flow asset id, not the image URL, so a chained regeneration
  would silently rebuild from the OLD picture if it were stale. It is not:
  `IR Write Image` (Claude Scripting) writes the new id, exactly like
  `Write Regen Image` does inside the batch.
- **The flag also writes `Status Producție Scenă: 'Generare Video'`.**
  `Sort & Cap Scenes` treats `Așteaptă Aprobare Video`/`Finalizat` as DONE and
  sorts them behind pending scenes, where CAP=8 can drop them. A scene owed a
  regeneration is outstanding work and has to read as such. That field is the
  ONLY thing in the workflow that reads the status text — every gate keys off
  checkboxes plus asset existence — so writing it changes ordering and nothing
  else.

**Video regen is the only regeneration with no webhook of its own.** Image,
voice and scene-text each have one; video is seen solely by
`Evaluate Video Approval`, polling every 15s from inside a live
media-generation execution. So it strands in four ways: no batch alive, a
batch already past the video gate (final settings, assembly), another
project's run making the instance-wide `getAliveProduction()` answer "alive",
or the scene falling outside the cap. `nudgeProduction()` fires
`resume-project` when nothing is alive, which covers the first case only —
hence the local exit on the badge. Do not promise this always starts.

**The second of those four — a batch already past the video gate — is now
covered inside n8n.** The final-settings gate is where a batch spends the
longest stretch of its life (a 15s Wait loop that holds for up to two hours
waiting for the producer to press render), and until 2026-08-14 a flag raised
during that window had nobody left to read it: `Evaluate Video Approval` is
several nodes upstream and the run never goes back. The gate now looks for it
on every cycle — `Fetch Final Settings → Fetch Regen Flags → Settings Gate
Guard → If Settings Confirmed → If Video Regen Pending` — and routes a
flagged project back to `Fetch Approved Scenes`, i.e. one more pass, which is
exactly the path `Another Pass?` and the site's `nudgeProduction()` already
use. The flagged scene carries `Status Producție Scenă: 'Generare Video'`, so
`Sort & Cap Scenes` sorts it as outstanding work and it lands inside the cap;
`Needs Clip?` skips it (it has a clip), the video gate polls, and
`Evaluate Video Approval` picks the flag up.

Three details are load-bearing:

- **The regen check runs on the "keep waiting" branch only.** `If Settings
  Confirmed` still decides first, so a confirmed render is never sent back
  for a regeneration — the change adds an exit from the waiting loop and
  alters nothing else.
- **One automatic bounce per scene per execution**, remembered in workflow
  static data under `sgBounced_<executionId>`. Without that bound the two
  gates ping-pong forever whenever a pass cannot clear the flag; with it, a
  scene that fails to regenerate falls back to today's behaviour and the
  site's own local exit (`restartVideoRegen` / `cancelVideoRegen`).
- **`Fetch Regen Flags` is `alwaysOutputData` + `continueRegularOutput`.** An
  Airtable search that returns nothing stops the chain dead, and this one
  sits *inside* the gate loop — an empty answer would strand every project at
  final settings. On error it passes the project record through, which has no
  `Regenerează Video` field, so it fails closed rather than into a false
  positive.

`Settings Gate Guard` now reads the project record from
`$('Fetch Final Settings')` **by name**, because its `$input` is the scene
list. Anything inserted between those two nodes must keep that reference
valid.

### The batch cap

`Sort & Cap Scenes` in Media Generation ends with `items.slice(0, CAP)`,
CAP = 8 — and the cap is applied **before** anything checks what is already
done. A project with more approved scenes than the cap used to be unfixable:
every run picked the same finished head, found nothing to do, and the tail
stayed invisible rather than pending. Regenerating did nothing, because the
scene was never in the batch to begin with.

Pending scenes now sort ahead of finished ones, so the cap always covers
outstanding work and repeated runs converge. The drop is logged — do not
make it silent again.

**The passes are automatic now; the cap is an internal chunk size, not a
stopping point.** It used to be one: the batch walked from the last approved
clip straight to the final-settings gate, so a 15-scene project produced 8
scenes and stopped dead — *with the execution still alive*, which also hid
the site's own "Start the next batch" button, whose whole condition is that
nothing is running. Pause + Resume was the only way through, once per 8
scenes. After marking its scenes Finalizat the batch now re-counts the
project's approved scenes (`Fetch Scenes After Batch` → `More Batches?` →
`Another Pass?`) and loops back to `Fetch Approved Scenes` while any still
lack a clip. Capped at 12 passes so a permanently-refused scene cannot spin
it forever — it falls through to the gate and shows as unfinished.

Note the loop re-enters at `Fetch Approved Scenes`, which is BEFORE
`Warm-up Cooldown` and `Sort & Cap Scenes` — that is deliberate: Sort & Cap
resets the per-batch static data (`prevImageUrl`, poll counters), so each
pass starts clean and the n-1 image chain does not leak across passes.

This interacted viciously with the zeroing bug above: processed scenes lost
their order to `0`, so the one *un*processed scene held the only non-zero
order, sorted last, and fell off the end forever.

**Every gate in the batch counts the BATCH's scenes; every gate on the site
counted the PROJECT's — and that mismatch deadlocked any film bigger than 8
scenes.** `Evaluate Image Approval` (since 2026-08-18 the one combined asset
gate — the separate voice gate is gone) scopes itself to
`$('Sort & Cap Scenes').all()`, so n8n only ever asks "are the
scenes of this pass signed off". The site asked "are ALL the scenes signed
off", which on a 15-scene project is unreachable by construction: seven
scenes have no picture and no take until a later pass, and a later pass only
starts after this one is approved. Four places had the same shape, and all
four had to move to "of the scenes that have the asset":

- `audioPanel` (`projects/[id]/page.tsx`) required `scenes.every(imageApproved)`
  — so the Voice review panel **never rendered**, and the producer could not
  approve the takes the batch was polling for.
- `AudioReview`'s `missing` counted every voice-less scene in the project, so
  "Approve all" stayed disabled with "still being synthesized" forever.
- `SceneBoard`'s bulk-review cards required `imagesMissing === 0` /
  `clipsMissing === 0`, replacing both buttons with a notice that could never
  clear.
- the stepper's `act` marker sat on `Images · 8/15` while the thing actually
  blocking production was an unapproved take.

The "nothing starts half-done" guard those checks existed for is redundant:
both n8n gates count a scene as approved **only when its asset exists**, so
an early sign-off cannot open a gate on something that was never made. The
fractions in the stepper stay project-wide (the film really does need all 15);
only the "you are here" marker and the approval controls follow the staged
scenes. Symptom to recognise: production frozen with a healthy `running`
execution in n8n, no error anywhere, and a Wait loop polling for an approval
the UI offers no way to give.

### Multi-voice

`chapters` mode needs **no tags in the script** — `AB Pick Voice` derives the
chapter arithmetically from `Ordine Scenă` (`chapter*100 + scene`), so the
model never has to know a cast exists. It was dead until the zeroing bug
above was fixed: with the order wiped to `0` every scene read as chapter 0
and quietly used the default narrator.

But chapter count is `ceil(Lenght / 120)`, so **anything under two minutes is
one chapter** and a per-chapter rule could only ever reach the first voice.
When there are fewer chapters than voices the voices now rotate per scene, so
every voice the producer picked is heard; with enough chapters the original
per-chapter behaviour is untouched. The count is read from the project's
linked `Capitole`, never counted inside the loop — `Sort & Cap` hands it at
most 8 scenes, so a locally-counted total would differ per batch and a
chapter could change narrator halfway. `AB Pick Voice` and `VR Pick Voice`
hold the same rule and must be edited together, or a regenerated scene gets a
different voice from the one the batch gave it.

**The cast is picked before the characters exist, so the name→voice binding
is a GUESS until someone makes it.** The form asks for cast voices while the
script is still unwritten; `castAssign` is empty; `AB Pick Voice` and
`VR Pick Voice` therefore fall back to first-appearance order, which has no
relationship to which voice the producer meant for whom. On a two-hander it
is a coin flip, and it lands after the takes are synthesized — the first
signal is someone listening. Seen 2026-08-13 on `rec1GITgUCq4mEsUd`: Victor
Marin (first to speak) got Bella, Elena Ionescu got a male Romanian VO.

The audio panel could not have caught it either, and that is the part worth
remembering: `resolveNames` scanned the first 800 voices and gave up, so three
of the four ids printed as `elevenlabs · …oKomo`. There is **no lookup-by-id
endpoint** — `/v3/voices/<id>` answers 404 — but `q=<bare id>` matches and
returns the one row, so misses are now resolved that way, with `gender`
alongside the name. Cast options read "ZaTurk — male", and a character with
no explicit assignment is labelled `auto — picked by speaking order`.
Fixing an existing project means writing `castAssign` **and** re-recording
the affected lines: a changed voice only applies to takes regenerated after
it.

`characters` mode splits on `[NARRATOR]` and `[CHARACTER: Name]` markers in
`Script Scenă`, and Scripting **does** ask for them — the chain is
`Receive Project Data → Fetch Project Record → Voice Mode`, where `Voice Mode`
reads `Editing Options` and emits `narrationRules` + `segmentRules`, which
`Write Chapter Narration` and `Segment Chapter Into Scenes` interpolate. Both
TTS paths already strip `[...]` before synthesis, so a tag is never spoken.
It was blocked only by `/tts-multi` missing on Railway; that endpoint now
exists. Untested end to end.

Do not conclude a prompt lacks an instruction because grep does not find the
literal text in it — the writing prompts are assembled from expressions
(`{{ $('Voice Mode').first().json.segmentRules }}`), so the words live in a
different node. Follow the expression, not the string. This exact mistake
produced a confident and completely wrong "the feature was never built".

### Scene splitting is code, not a prompt request

`Plan Scene Splits` (between `Create Chapter Records` and `Segment Chapter
Into Scenes`) cuts each chapter's `Script Capitol` into scene-sized chunks
and hands the segmenter a numbered list to copy **verbatim**. Do not move
this back into the prompt.

Why: the prompt used to compute `SCENE COUNT: output EXACTLY N scenes` and
trust the model. Execution 877 proves that fails — the prompt correctly
said 5, gpt-5.4 returned **one** scene holding the first sentence, and the
other 83 of 96 narration words vanished. A 32s video shipped as 2 scenes
(hook + 1). The failure is silent: no error, valid JSON, just less film.

The chunker is sentence-aware, falls back to clause punctuation and then to
word boundaries for run-ons, folds runt chunks (<40% of average) into a
neighbour so no 8-second shot carries four words, and is **lossless** — the
chunks rejoin to exactly the input. Tags like `[CHARACTER: X]` survive it.
`Validate Evidence Refs` logs `SCENE SHORTFALL` if the model still returns
fewer scenes than were planned.

Note the count can differ from the naive `ceil(words/22)` after runt
folding (95 words → 4 scenes, not 5). That is intended.

### Evidence retrieval (Claude Scripting)

Scripts on researched topics are written against a pack of sourced claims,
not from model memory. The chain, all inside Claude Scripting:

```
If Needs Research → Research Tema ──┐
                    No Research ────┴→ Extract Claims → Prep Evidence Rows
   → Save Evidence → Evidence Done → Generate Story Bible
Split All Scenes → Validate Evidence Refs → Save scenes To Airtable1
```

Save Evidence is deliberately IN-LINE before the Story Bible, not a side
branch: n8n flushes parallel branches at the very end of the run, so a
scripting execution canceled mid-way (844) kept its scenes but silently
lost its evidence rows. In-line, claims land in Airtable during the first
minute. `Evidence Done` collapses the per-batch items back to the Extract
Claims payload so the Story Bible prompt keeps reading `$json.output`;
`Prep Evidence Rows` emits a `records: []` passthrough when there are no
claims so fiction projects flow through unharmed.

- `Research Tema` (GPT with built-in web search — no Tavily/Brave, no extra
  keys) outputs `NOTES:` plus a `CLAIMS:` section, one claim per line:
  `CLAIM: … | SOURCE: … | URL: … | DATE: …`. Claims without a resolvable URL
  are dropped by `Extract Claims`, never invented.
- `Extract Claims` assigns refs `E1..E20` and sits on BOTH branches, so
  `$('Extract Claims')` is always safe to reference downstream — the
  fiction/No-Research branch just yields zero claims. Its `output` field
  (notes + claims list) is what `Generate Story Bible` reads as
  RESEARCH NOTES; do not rename it.
- The claims list is interpolated into `Write Chapter Narration`
  (VERIFIED FACTS) and `Segment Chapter Into Scenes` (EVIDENCE TAGGING).
  The segmenter marks each scene `evidence_required` + `evidence_ref`.
- `Validate Evidence Refs` keeps only refs that exist in the pack; a scene
  that claimed a fact it can't back gets `Needs Fact Check` in Airtable.
  This validation is code, not another model — an invented ID cannot survive.
- Evidence rows live in Airtable table `Evidence` (`tblU26cUiQQV2eNdg`),
  linked to the project. Fewer than 6 claims on a researched topic sets the
  project's `Research Thin` checkbox (script proceeds, human reviews).
- `Save Evidence` is `onError: continueRegularOutput` — evidence storage is
  an audit trail and must never kill scripting. It writes via HTTP with the
  Airtable PAT credential, batched 10 records per request.
- Known gaps: re-running scripting for the same project duplicates its
  Evidence rows, and the scene-text regen path rewrites narration without
  revalidating its `evidence_ref`.

**The bible the film is made from was not the bible stored on the project.**
`Generate Story Bible → Save Story Bible` writes to Airtable. When the
producer then rewrites the script, `If Script Changed → Rebuild Story Bible`
builds a new one — and until 2026-08-08 that rebuilt bible existed only in
memory: `Choose Bible` handed it to the segmenter and nothing ever saved it.
So the scenes and their images came out right, while the project record kept
the bible the producer had just REJECTED.

It stays invisible until someone regenerates one scene, because that is the
only path that reads the stored copy (`Load Project Bible` for text,
`IR Load Project` for images). On `recCoZWsZBOrIU69L` a scene rewrite
returned a prompt describing a dying woman in an apartment stairwell for a
film about a man on a night road — a perfectly coherent prompt for the wrong
story, which reads as the model malfunctioning and is not.

`Save Rebuilt Bible` now persists it in-line between `Rebuild Story Bible`
and `Choose Bible`. Inserting a node there is safe **only** because
`Choose Bible` reads `$('Rebuild Story Bible')` by name rather than `$json` —
check that before putting anything else in that chain. It is
`onError: continueRegularOutput`: a failed bible write must never kill a
scripting run.

### Sound effects (the `sfx` toggle)

`Scene Final URL` is the RAW Veo clip re-hosted on Drive — there is no
per-scene mux. The `Submit TTS` / `Submit Mux*` chains in Media Generation
are dead leftovers (no input; CLAUDE.md already said to ignore them), and
the narration is layered onto the clips only at Final Assembly (`/assemble`
takes videoUrl + audioUrl per scene). The site's MediaPlayer does the same
trick client-side, which is why scene previews have voice without any mux.

So "sound effects" = the Veo clips' own generated ambience:

- Both `Submit Video` nodes append a hard audio direction to every Veo
  prompt: natural ambient sound effects only — no speech, no voices, no
  singing, no narration, no music. Unconditional, so voices can never leak
  into a clip regardless of the toggle.
- `Editing Options.sfx` (set on the creation form and again in Final
  Settings, merged — never overwritten — into the JSON) drives
  `Build Timeline`: ON → `nativeAudio: 0.25`, OFF → `nativeAudio: false`,
  always explicit. The server sidechain-ducks the ambience under the
  narration, so narration stays predominant by construction. **Default ON**
  — footage under a voice with no sound of its own is dead air.

**Music is a SEPARATE, opt-IN switch (`Editing Options.music`)**, and it
covers two things that both come from us rather than from the scene: the
background track from the Drive `Muzica` folder, and the synthesized
boom/whoosh/riser accents at the hook, the chapter cuts and the end screen.

Those accents used to be added to **every** render unconditionally, while
`sfx` defaulted off — so a film could carry a low boom and a 2-second riser
that had nothing to do with its footage, over clips whose own sound had
been stripped. That combination is exactly what "music that has nothing to
do with the clip, and the clip's effects are gone" was. `Build Timeline`
now sends `stingers: musicOn` and only resolves `musicUrl` when music is
on; `/assemble` defaults `stingers` to **false**, and every stinger index
is built only inside that guard (a `-1` input index would break the graph).
- `confirmFinalSettings` used to REPLACE the whole Editing Options JSON
  with three overlay keys, silently wiping `category`/`cast`/
  `multiVoiceMode` at the final-settings step. It now merges via
  `updateEditingOptions`. Never write that field wholesale.
- **Railway auto-deploys `claude/hello-7o90qh` on push** — verified against
  the deployment list: each deploy names the commit that triggered it,
  landing a minute or two after the push. An earlier note here said deploys
  were manual; they are not. So a change to `remotion/server/` is live once
  the branch is pushed and the build goes green, and the way to check which
  code is running is the deployment's commit hash, not a guess.
- **Never push while a final render is running — ANY push, not just one that
  touches `remotion/`.** A commit changing only `db/` triggered a Railway
  build on 2026-08-27 (deployment `bbf90578`, commit `cad28c1`), so the path
  filter below cannot be relied on as a safety rule. Treat every push as a
  container replacement. A Railway deploy replaces the container, which kills
  a render in flight — and the producer sees a
  film that simply never arrives, with nothing in the site to explain it.
  Since 2026-08-14 Railway watches `["/remotion/**"]`, so commits touching
  only `platform/` or documentation no longer rebuild it; anything under
  `remotion/` still does. Check for a live Final Assembly execution before
  pushing there, and hold the push if one is running.
- If SFX are enabled and the final video still has none, check whether the
  veo-3.1-lite clips actually carry an audio stream (`/inspect`). Verified
  once (2026-08-10): a real veo-3.1-lite clip probed `aac, 2ch, 48kHz` —
  the ambience track exists.
- **`SIGKILL` from the compositor is the container running out of memory, and
  the default OffthreadVideo cache is what fills it.** Two renders of the
  15-scene Tahiti film died at `Graphics Guard` with "Compositor exited with
  signal SIGKILL / Remotion render failed" — a message that names neither
  memory nor a cache. Railway metrics settle it in one look:
  `MEMORY_USAGE_GB` peaked at **7.91 against a limit of 8**, CPU at 7.4 of 8.
  `offthreadVideoCacheSizeInBytes` defaults to `null`, which Remotion
  documents as HALF the system memory at render start — 4GB on this box —
  and that sits on top of Chrome under swangle plus the ffmpeg encode.
  `server/index.mjs` now caps it at 1GB. It stayed invisible for months
  because every earlier film fitted: the successful renders all finished in
  2-4 minutes, and the failures ran 8-10 before dying, so LENGTH is the
  trigger. **Check the metrics before reading the error text** — and note the
  first suspicion here was a mid-render deploy, which was wrong: the second
  render died with no deployment in flight at all.
- **A Railway deploy mid-render used to kill the render**: render/graphics
  jobs live in the server's memory, the deploy swaps the container, the
  next status poll answers 404 "job not found" and the execution died —
  proven by 1877 (the first-ever successful music mix, lost this way) and
  1883, both 404ing minutes after a git push. `Check Render`/`Check
  Graphics` now `continueRegularOutput`, both Guards classify that 404 as
  `lost`, and `Render Lost?`/`Graphics Lost?` loop back to `Build
  Timeline`/`Build Remotion Props` to rebuild and resubmit. The poll caps
  still bound the loop. Corollary: pushing to the branch DURING a render
  is safe now, but still costs a full resubmit of that stage.
- **Where a final assembly's minutes actually go — measured, not guessed.**
  Execution 3599 (a ONE-scene, ~8s cinematic film) took 2m35s end to end.
  The n8n API cannot show this (`runData` lands only at the end), but
  Railway's **http** log stream can: every `POST /assemble`, `POST /render`
  and status poll is timestamped, so the stage boundaries fall straight out
  of it (`mcp__Railway__get-logs` with `types: ["http"]`). The split was
  3.6s Airtable + the Drive music walk + Build Timeline · 20.3s assemble
  (ffmpeg was already finished at the FIRST poll) · 9.5s Remotion bundle +
  `selectComposition` + Chrome start · **~2m00s the graphics render itself**
  · 8.1s download + Drive upload + share + Airtable. So ~78% is the Remotion
  pass, and it is real work rather than waiting.
  It is NOT flat in length: that is ~240 frames at roughly 2 fps, because the
  render is headless Chrome on software GL (`gl: 'swangle'`, no GPU on
  Railway) at `concurrency: 1`. A 60s film is ~1800 frames, which is why the
  15-scene Tahiti film took ~11m50s. What makes a short film FEEL flat is a
  fixed floor of about 45s that it pays in full.
  **Do not reach for `concurrency` as the speed-up.** Memory is no longer the
  constraint — since the OffthreadVideo cap, peak is 2.48GB against 8 — but
  CPU peaked at 6.85 of 8 cores, so the headroom is about one core. More
  vCPU is the lever, not more tabs. (Caveat: that 4-hour metrics window also
  contained a Docker build, and Railway's sampling cannot be narrowed to the
  render alone, so treat the CPU figure as an upper bound and measure before
  changing it.)
- **The two poll loops slept 20s BEFORE their first check**, so a one-scene
  film waited a full 20s on an ffmpeg job that was already done, and every
  stage was rounded up to a 20s step. Now 5s. **The interval and the guard's
  cap are one setting in two places**: `Render Guard` and `Graphics Guard`
  bound the loop by poll COUNT, so dropping the interval without raising the
  cap would have cut the assemble ceiling from 15 min to 3m45s and the render
  ceiling from 30 min to 7m30s — killing exactly the long films that need
  them. Caps went 45 → 180 and 90 → 360, both ceilings unchanged, and each
  guard now names the arithmetic in a comment. Note each guard tests
  `$runIndex` TWICE (lost-job recovery and timeout); both had to move.
- **Sound is changeable after the render**: `SoundSettings` (under the
  final video player) writes the two switches via `updateEditingOptions`
  and re-fires the assemble webhook — the only path to different sound on
  a finished project, since Final touches is gone by then.
- To probe a media URL through the pipeline's own plumbing: temporarily
  disable `Assemble Webhook` in the FA **draft** (do not publish), run
  `execute_workflow` manual with `{media_url}` — it lands on `Probe
  Webhook` → fal metadata — then re-enable. `execute_workflow` always
  targets the first enabled webhook.
- The ffmpeg bundled with Remotion in `node_modules` is a **stripped build**
  — no `sidechaincompress`, `alimiter`, `asplit`, `afade`, `anullsink`,
  `aloop`. The mix graph cannot be rehearsed locally with it; validate the
  graph by reading it, and test on Railway. **A Claude Code web session has no
  system ffmpeg at all** — the only binary on the box is Playwright's, built
  `--disable-everything` (pad/crop/scale, vp8, png; no `setpts`, no `atempo`,
  no x264). So a filter graph written here cannot be run here either way.

### Playback speed — what PACE finally means

`Editing Options.speed` re-times the finished film, and it is the **first real
effect the brief's PACE control has ever had**. The word is the decision and
the multiplier is the degree: Slow offers **0.9× or 0.8×**, Fast **1.1× or
1.25×**, Normal is one thing. One number could not be both safe and noticeable
— 0.9/1.1 is a real change but modest (a podcast at 1.1×), 0.8/1.25 is
unmistakably a different film — so picking one for everybody meant either a
control that gets called inert again or one that overshoots.

**Widening the range needed no change outside `SpeedPicker.tsx`**, which is the
property to preserve: the refusal rule takes any rate inside `[0.5, 2]` that is
not within 0.01 of 1, so the rates are never enumerated downstream. A fifth
rate is a one-file change as long as it stays in that window. `SPEED_BY_PACE`
still maps the three WORDS to the gentle defaults, because it doubles as the
fallback for a project whose only stored signal is `Pace: Slow` — if the
picker's default and that map disagreed, clicking Slow would give a different
film from a project that arrived with Slow and never touched the control. Before
2026-08-17 `Slow | Normal | Fast` reached exactly two places: a bare
`Pace: Slow` line interpolated into `Generate Outline` and `Write Chapter
Narration`. A hint to a model with no rule attached, and nothing else read the
field — so the producer's "it doesn't change anything" was simply correct.
Worth remembering as a shape: **a value that is stored, passed through several
workflows and interpolated into a prompt can still be inert**, and it looks
implemented from every angle except the film.

Applied by `remotion/server/speed.mjs` (a NEW file — `assemble.mjs` is
untouched) after Remotion draws, `setpts=PTS/rate,fps=24` plus
`atempo=rate`. `/render` strips `speed` off the body, so the props the
composition receives are byte-identical to before.

**The obvious place is the wrong one, and the reason is the retime.** In
`assemble.mjs` every scene already lasts as long as its own narration
(`eff = voiceDur + 0.35`) and the clip is time-stretched to fill it, so slowing
the narration would stretch the picture for free. Three things kill it: that
stretch is clamped to `[0.65, 1.5]` and spills into a **frozen tail** past the
top, so "slow" would mean slower in some scenes and stuttering in others; it
moves only the picture, leaving the pauses, the music bed and the graphics on
their old timing; and the scene times computed there feed the graphics pass, so
captions, chapter cards and the end screen would all need rescaling in lockstep.
On the finished file there is one stream of each left, so nothing can drift.
`atempo` resamples without shifting pitch — a slowed narrator sounds slower,
not deeper.

Four things are load-bearing:

- **A failed speed pass must keep the film.** The job completes un-retimed and
  reports `speedError`. The render is minutes of headless Chrome at ~2 fps; the
  re-time is seconds. Losing the former to save the latter is a bad trade.
- **`Graphics Guard` sees a new status, `retiming`.** It only throws on
  `error` and otherwise passes through, so this reads as "keep polling" — but
  the retime shares the render's poll budget (`MAX_POLLS = 360` at 5s = 30 min).
  Long film plus a slow re-encode both come out of that ceiling.
- **Editing Options is the OVERRIDE, the project's `Pace` field the DEFAULT.**
  Two sources on purpose: falling back to `Pace` means all 56 films already in
  the database honour the choice their producer made, with nothing to migrate,
  while a later change on the site writes `speed` and wins. `Build Remotion
  Props` and `buildProject()` in `platform/lib/data/derive.ts` resolve it in
  exactly that order — out of step, the site would show a rate the render is
  not using.
- **The refusal rule exists in FOUR copies** — `speed.mjs`, `derive.ts`, and
  the n8n nodes `Build Remotion Props` and `Normalize Webhook Input` — because
  it runs in three languages at four points on the path: out of range,
  unparseable, or within 0.01 of 1 → leave the film alone. Verified to agree on
  25 inputs. Change one, change all four.

The site sets it in THREE places, and the brief is the one that was missed
first: `/new` posts `speed` beside `pace` — the WORD still goes to the two
writing prompts that read it, and is DERIVED from the rate so the pair can
never contradict each other — and `Normalize Webhook Input` puts the number
into Editing Options at creation. Without that last hop the brief could only
ever choose a word, and the degree (0.8 versus 0.9) had nowhere to live; the
first version of this feature shipped with the picker on the project page only,
which reads as "nothing changed" from the screen the producer actually starts
on. Then the **audio step**, which is where the decision is actually made, and
`SoundSettings` ("Sound and speed of this film") after the render, which writes
the merged options and re-fires the assemble webhook.

**`FinalSettings` no longer touches it** (2026-08-28). It used to carry a
`SpeedPicker` as a numbered row, which is why the paragraph above used to talk
about `ToggleKey` narrowing `keyof EditingOptions` and a separate `changeCount`
"so Apply 1 change cannot omit the one change that alters the film's whole
length" — none of that is about speed any more. `ToggleKey` stays, because
`speed` is still a number in `EditingOptions` and `keyof` would still widen
`opts[o.key]` to `number | boolean`; note it now also admits `speedLocked`,
harmlessly, since `OPTIONS` is an explicit list.

**`confirmFinalSettings` omits `speed` from its payload entirely, and that is
load-bearing rather than tidy.** `updateEditingOptions` MERGES, so an absent
key leaves the stored rate alone — while a settings object still carrying a
defaulted `speed: 1` would have overwritten the producer's choice on every
single render. Same shape as the Airtable bug where a mapped numeric field
with no value wrote a literal `0`: the field that destroys data is the one
nobody meant to send.

**The audio step is the only door that is cheap** (2026-08-28). The brief comes
before any take exists and `SoundSettings` after every clip has been paid for,
so "this film is too slow" was a discovery that cost a re-render at best. At
the voice gate the takes exist and no picture does, which makes it the one
moment the decision is free — `AudioReview` carries the `SpeedPicker` and
writes `Editing Options.speed` through `savePlaybackSpeed`. One stored value
behind three doors; there is no separate setting, and **the refusal rule still
has exactly four copies** — this added a surface, not a rate semantic.

**Nothing is stored until Save.** The picker sets a DRAFT, so the rates can be
tried against the takes without writing; `savePlaybackSpeed` commits the rate
and sets `speedLocked` in the same write (two writes could leave a project
signed off at a pace it never stored, and only one of those halves is visible
on screen). Once locked the picker is gone and the card offers **`✎ Make
changes`** → `reopenPlaybackSpeed`, which clears the lock ONLY and leaves the
rate — reopening means "let me look again", not "throw away what I chose".
`speedLocked` is read strictly as `=== true`, so every film made before it
existed reads as unlocked rather than arriving frozen.

**The draft is backed by `sessionStorage` (`vf-pace:<projectId>`), and it has
to be**: this page re-renders itself every 10 seconds, so an unsaved choice
held in component state alone would be thrown away mid-listen — the one thing
an audition control cannot survive. It is read after mount, never in the state
initializer, or the server render and the hydration disagree.

**Each take shows `3.0s → 3.3s`**, its own length and its length in the film,
alongside the same figure for the whole narration. The raw number stays rather
than being replaced, because `flagFor` and `fitProblem` both judge the
RECORDING — against its word count, and against its shot — and neither
question is about the pace: the retime scales picture and voice together, so a
take that fits its shot at 1× fits it at every rate. Replacing the number
would have made those two flags read as though they measured the retimed value.

What makes it a real audition rather than a label is that every take the panel
plays is retimed to the chosen rate. Three things are load-bearing:

- **`preservesPitch` is set explicitly, not left to the default.** The render
  re-times with `atempo`, which resamples WITHOUT shifting pitch. A preview
  that let the browser drop pitch along with the rate would audition a slowed
  narrator as a *deeper* one — a different voice, not a slower reading — so
  the producer would be judging something the film will never do. Both vendor
  spellings are set too; older WebKit and Gecko read those.
- **`playFrom` reads the rate from a REF, not from its closure.** "Play all"
  schedules the next take from inside the current one's `onended`, so the
  callback holds whatever rate was current when that element was built. A
  rate changed mid-run would apply to the line playing and to nothing after
  it. Verified in a real browser: a take started after the change carries it.
- **The picker is disabled while its write is in flight.** The lit chip is
  optimistic and only clears once the server's value agrees, so two writes
  landing out of order would leave storage on the loser with nothing left to
  correct it. Serializing is cheaper than reconciling.

Changing the pace while a take is playing retimes it on the spot — that is
the point, and it is what the panel says out loud, because hearing the
difference on the line already playing is the whole reason the control is
there rather than two screens later.

### The Cinematic category (silent film)

`category: 'cinematic'` in Editing Options = no spoken words anywhere. How
each piece handles it:

- **Site**: the category has `noNarration: true` in `categories.ts` — no
  narrator/cast pickers; `createProject` force-clears `voice_id`/`cast` and
  forces captions off server-side.
- **Scripting**: `Voice Mode` emits silent-film rules. The "narration" is
  written anyway but as an unspoken VISUAL BEAT SHEET — the word-count
  math still drives scene count, so do not remove it. Scenes are created
  with **`Aprobare Voce` already checked**.
- **Media Generation**: `AB No Speech?` (after `AB Load Project`) loops
  past TTS entirely; the combined asset gate (`Evaluate Image Approval`)
  waives the Voiceover-URL requirement for cinematic. The audio stage
  therefore completes on its own and only the images gate the pass.
- **Final Assembly**: scenes have no `audioUrl`; `/assemble`'s `it.a ??
  it.v` fallback makes each clip's own track the scene's main audio (the
  Veo prompt guardrail keeps it speech/music-free), scene length = clip
  length (no elastic retime). `Build Remotion Props` forces
  `showCaptions: false` for cinematic — `Script Scenă` holds the beat
  sheet, and captioning it would print stage directions on screen.
- **Captions were only the visible third of that.** `narratorText` reaches
  THREE surfaces in the render, and all three treated it as spoken: captions
  print it, `ImpactCard` borrows its first eight words as a chapter title
  whenever the chapter has no `[CHAPTER n: title]` marker, and
  `figureCardFor` lifts figures out of it — a year or a duration inside a
  stage direction matches those patterns exactly like a fact the narration
  speaks. Only captions were fixed, because only captions were something the
  producer could see. `narrationIsSpoken` (props, default true) now carries
  the fact once and all three read it: the card falls back to nothing rather
  than to the beat sheet, and figure cards are not derived at all. Claim
  cards are untouched — their text comes from the Evidence rows, not from
  the scene. **Any fourth reader of `narratorText` must ask the same
  question.**
- **A title-less chapter card still renders, on purpose.** Dropping it would
  be the obvious fix and it is wrong: with cards on, `ImpactCard`'s own light
  leak IS that boundary's transition and `Transitions` skips every boundary
  it holds, so a skipped card leaves the cut with no owner at all. The
  eyebrow becomes the whole statement instead — a full-frame "CHAPTER II",
  which is what an intertitle is. `titled` in `ImpactCard` gates the fitter,
  the eyebrow size (`px(52)`, not the title-proportional one) and the gap
  between them. Verified as stills at 1280x720 and 720x1280 through
  `src/probe.tsx`'s existing `CardLandscape` / `CardPortrait`, which take
  `keyLine` as a prop — `--props='{"keyLine":""}'` is the whole test.
- **The Final touches panel dropped its Captions row for cinematic.** The
  toggle was inert — the render forces captions off whatever it says — and an
  inert control reads as a decision. `FinalSettings` marks that row
  `spokenOnly` and filters it out, the same call the stepper makes about the
  Audio step. The Opening title is NOT dropped: `displayTitle` comes from the
  project name, never from narration, so it is purely visual and is the most
  silent-film-native element on the list.
- **The site had known this only on the /new form.** `noNarration` was read
  by `CategoryPicker` and nowhere else, so the project page still built an
  Audio step, still rendered the voice panel, and `ProductionActivity` still
  announced "next pass starts with the voiceovers" for a film that has none.
  The page now derives `silent` from the category and drops the Audio step
  from the stepper entirely — not greyed, absent, because a chip you can
  click into and find nothing is worse than no chip.
- **A silent film cannot survive a voice un-approval, and `reopenStep` was
  doing one.** The cascade cleared `Aprobare Voce` on any scene sent back to
  the script step. On cinematic that builds a gate nothing can satisfy: n8n
  waits for every voice to be approved, no TTS will ever run, and the site
  offers no take to listen to — the project stops for good. Caught on
  "Working engine" (`recrlkONIpkgkYxzw`), whose single scene was reopened and
  never moved again. `reopenStep` now reads the project's category and leaves
  the voice alone on a silent film. **Any new cascade must do the same.**

### The stage chain in Media Generation — audio first, ONE asset gate (2026-08-18)

Takes and images are independent — the image loop never reads a voice field,
the audio loop never reads an image — so the batch no longer holds a human
gate between them. It synthesizes **every take first**, generates **every
image second** in the same uninterrupted pass, and waits at a single combined
gate before video. The producer reviews a scene's take and picture together:
one visit before the expensive stage instead of two, and takes are listenable
minutes after scene approval, while images are still being generated.

```
Sort & Cap Scenes → Refetch Scenes For Audio → Sort Scenes For Audio → Loop Audio
Loop Audio  out[0] → Replay Scenes For Images → Loop Images   (out[1] is the loop body)
Loop Images out[0] → Wait Image Approval → Fetch Scene Images
  → Evaluate Image Approval → If Any Regen → If All Images Approved
If All Images Approved out[0] → Refetch Scenes For Video → …video stage…
If All Videos Approved → Prep Finalizat List
```

Despite its name, **`Evaluate Image Approval` is the combined gate**: it
counts image AND voice approvals (each requiring the asset to actually
exist), carries the cinematic waiver (`AB Load Project` may not have run when
every scene was already voiced — the try/catch default of `noSpeech = false`
is correct then), and keeps the in-batch image-regen dispatch. Voice regen
raised while the gate polls is covered by the standalone `scene-voice-regen`
webhook, exactly as it covered the old separate voice gate. The old gate
(`Wait Voice Approval` / `Fetch Scene Voices` / `Evaluate Voice Approval` /
`If All Voices Approved`) was removed after a by-name audit found zero
references.

**`Replay Scenes For Images` is load-bearing, not a formality.** Loop Audio's
done output must never feed Loop Images directly: items that skip synthesis
re-enter the audio loop carrying the PROJECT record (`Needs Voice?` → `AB
Current Scene` → `AB Load Project` → `AB No Speech?` → back), and one of
those reaching `Build Image Request` kills the whole batch with "no image
prompt". The replay re-emits `$('Sort & Cap Scenes')` verbatim — same
records, same pending-first order (the n-1 image chain and the regen's
`recs[i-1]` both assume it), and the audio stage between them writes only
voice fields, so no freshness is lost. It is a Code node on purpose: the
ported Postgres nodes carry `{{ }}` without the `=` prefix and run fine, but
the MCP validator flags that form, and a new query node written either way
was a coin-flip — a replay has no expression-format question at all.

A history lesson that still applies: the voice gate was once **unreachable in
both directions** (nothing fed it, its approved output went nowhere), and an
orphaned gate does not error — the branch just ends in mid-air. When touching
this chain, check each loop's **out[0] (done)** actually reaches the next
stage, and each gate's **out[0] (approved)** actually reaches the one after.
`Submit TTS` and the `Submit Mux*` nodes are leftovers from an older inline
audio path and are deliberately disconnected — n8n warns about them on every
publish. Ignore those four; do not wire them back.

The site mirrors the order: `audioPanel` (project page) unlocks on scene
approval alone — requiring approved images there would hide the takes for
exactly the window they now exist to fill — the stepper shows Audio before
Images with each card keyed to its own asset (both can be "act" at once),
and `SceneBoard` routes the active scene voice → image → clip.

### Remotion / the edit

- **A blind planner will fight the footage, and the framing ladder was sized
  for a goal that no longer exists.** Rungs ran 1.08 / 1.26 / 1.44 spaced 0.18,
  with `MIN_SCALE_STEP` at 0.14, because the framing step was expected to MAKE
  the cut — big enough for a scene detector to register. That premise died when
  the planner went to one shot per scene: the footage now cuts at every scene
  boundary on its own. What the wide spacing did instead was **invert the
  footage's own framing**, which it cannot help, because `planMontage` never
  sees a frame. Measured on a real film: Veo generated scene 1 as a wide shot of
  the whole room and scene 2 as a close-up of one face — the planner punched the
  wide one to 1.44 and left the close-up at 1.08, so at that cut the picture went
  wide→close while the framing went close→wide. Two changes pulling against each
  other on one frame is what the producer reported, twice, as random zooms that
  "look like bugs". Rungs are now 1.05 / 1.11 / 1.17 (85% of the picture at the
  tightest, not 69% — which also stops the resample softening 720-wide AI
  footage), `MIN_SCALE_STEP` 0.04, `HELD_PUSH` halved to 0.015 because a
  ten-second scene visibly crept inward for its whole length. Framing is
  composition and breathing now; the picture change is the cut.
- **Scene times are floats; frames are a grid. One frame of lag between them is
  visible and reads as a bug.** `Sort`-style rounding is not enough: a boundary
  at 17.141s whose picture actually cuts at 17.133s (frame 514) falls BETWEEN
  frames, so `shotAt` kept the old shot for frame 514 and switched at 515 — one
  lone frame showing the NEW scene at the PREVIOUS scene's framing, then a jump.
  Reported exactly as "one frame is zoomed compared to the rest of the scene".
  `FinalVideo` now calls `shotAt(shots, seconds + 0.5 / fps + 1e-6)`, which
  lands a boundary on the NEAREST frame rather than the next one. **The
  epsilon is load-bearing, and it took a second sighting to find.** Both sides
  reduce to the same inequality (`f >= cut * fps - 0.5`), so they can disagree
  only on a tie — and a 24fps source in a 30fps composition produces ties by
  construction: every cut lands on .0/.25/.5/.75 of a frame, and the .5 ones sit
  exactly on the comparison. There the decoder's arithmetic and this
  expression's break the tie differently whenever the cut's seconds value is not
  representable in binary. On the tahiti film that was 3 of 13 cuts — 33.9167,
  38.9167, 63.4167, all of the form k/24 with a repeating fraction — each
  showing one frame of the NEW scene at the OLD scene's framing. **It had been
  invisible because the scene dip was drawing 40% black over exactly that
  frame**; removing the dip exposed it the same day, which is the "an opaque
  overlay hides bugs underneath it" lesson a second time.
  **How to measure it without eyes:** temporarily amplify the drift in the
  intensity-0 shot (`driftX: 10`), render the frames either side of a boundary
  as a PNG sequence, and read the black band down the left edge — the band IS
  the framing, to the pixel, and it tells you which frame the transform
  switched on while a coarse thumbnail diff tells you which frame the picture
  switched on. Frame-accurate, and a still can never show it. **The detector is how
  you find this**: `ffmpeg scdet` reported two changes 0.04s apart at 17.13/17.17
  where the film has one, and narrowing the ladder alone did NOT remove the pair
  — only the half-frame lead did. Two adjacent detections where the edit has one
  cut is the signature of a one-frame pop; look for it after any change to shot
  boundaries.
- **A cut is a change of picture. Zooming the same clip is not a cut, and
  optimising a detector taught us it was.** The montage planner was built to
  close a measured gap: five reference documentaries register 43-126 cuts per
  4 minutes, our edit registered ONE. The gap was real; the target was not.
  Cut counts come from a scene-change DETECTOR, which cannot tell a new shot
  from a hard zoom on the old one — so the planner learned to jump scale and
  position on a single unbroken clip several times per scene. It reached 18.6
  cuts/min, `npm run check:montage` printed OK on every acceptance target, and
  the producer's reaction to the result was "acele cut-uri si zoom-uri random
  par a fi bug-uri". On a 42s film it planned 13 cuts where the picture changed
  5 times, including four rapid zoom jumps inside ONE clip. The whole class of
  error is worth naming: **when a proxy metric is cheap to satisfy without
  doing the thing it stands for, a generator will satisfy it, and the green
  check is then evidence of nothing.** `planMontage` now emits one shot per
  scene and cuts only where the footage actually changes; `intensity` controls
  how hard the framing contrasts across a real cut and deliberately cannot add
  cuts. The checker asserts placement (`pictureChanges`), not count — the
  rhythm numbers are still printed but are informational, because they describe
  the script's pacing, which the planner does not control and must not fake.
  Fewer cuts than the references is the material telling the truth: one clip
  per scene can only yield one shot per scene. More cutting needs Faza 2 (the
  scene clips passed to Remotion separately), not a bolder planner.
- **Framing rungs must clear MIN_SCALE_STEP *plus* the within-shot push, or one
  of them is a dead end.** A shot drifts 0.03 tighter while it plays, so two
  framings 0.16 apart cut at 0.13 — under the threshold. The old four-rung
  ladder (1.02/1.18/1.34/1.50) had no adjacent pair that cleared, so `medium`
  could be entered and not left, and the planner fell back to an invisible cut
  without complaining. Three rungs spaced 0.18 (`wide` 1.08, `medium` 1.26,
  `close` 1.44) make every pair cut. `detail` was dropped with the bursts it
  existed for — held for a whole scene it is not an insert, just too much zoom.
- **A framing offset larger than its overscan tears the frame.** The picture is
  moved up to `spread` percent plus 1.5 of drift; if `scale` does not cover
  twice that, the footage slides off its own edge and a black band shows down
  one side. `wide` sat at 1.02 against offsets reaching 3.5%, so the calmest
  framing was the one that could tear. `framingOverscan()` states the rule and
  `check:montage` asserts it.
- **Nothing that moves may be linear.** `remotion/src/easing.ts` holds the whole
  vocabulary — `outExpo` for entrances, `outQuart` for settles, `inOutCubic` for
  exits and sweeps — plus `eased()` (clamped + eased interpolate) and
  `curveAt()`. Constant-speed ramps are the clearest tell that a graphic was
  generated rather than designed. The one deliberate exception is the base Ken
  Burns push in `kenBurnsTransform`: a constant-velocity zoom is what a real
  rostrum move looks like, and easing it makes it visibly decelerate for no
  reason. Punch-ins are discrete events and do get shaped.
- **A display face is chosen in English and breaks in Romanian, and line-height
  is where it breaks.** The site and the render moved from Fraunces to Outfit
  together (2026-08-15). `HookTitle` set `lineHeight: 1.04`, which had always
  been fine — and was fine by accident. What hangs below a line here is not a
  descender, uppercase has none; it is the comma under **Ș** and **Ț**.
  Measured off the fonts: Fraunces' reaches -0.288em, Outfit's -0.397em, while
  caps top out at ~0.71em. A mark collides when `lineHeight < depth + 0.71`, so
  Fraunces needed 1.00 and cleared 1.04 by 0.037em; Outfit needs 1.107 and did
  not. The result was one line's commas sitting ON the next line's letters,
  reading as stray marks rather than diacritics — invisible in English, obvious
  the first time a Romanian title is rendered. Now `TITLE_LINE_HEIGHT = 1.12`.
  **Re-check this rule for any future display face, in Romanian**, and note the
  rule is stated against cap-height: Î/Â carry a circumflex to 0.968em, which by
  the same arithmetic would want 1.365 — deliberately not paid, because it only
  crowds and never overlaps.
- **The type fitter's metrics are measured from the font binary, not guessed —
  and there is a way to do it without a browser.** `fontTools` reads `hmtx`
  advances straight out of the TTF (instantiate the variable font at the weight
  first), which gives the exact fraction of em that `titleAdvance` wants. The
  method reproduces the codebase's own hand-measured Poppins numbers to three
  decimals (0.5873 vs the documented 0.59; space ratio 0.3610 vs 0.36), which is
  how you know it is right before trusting it on a new face. Outfit 700
  uppercase measures **0.66**, against Fraunces' 0.7333 — so inheriting 0.72
  would have made the fitter overestimate every line and drop a size for
  nothing. Note the proxy blocks `fonts.gstatic.com` for a Chrome we launch, but
  plain `curl` to it works, so the TTF is one request away.
- **`DEFAULT_SPACE_RATIO = 0.58` in `fitType.ts` is a tuning constant, not a
  measurement, and CLAUDE.md used to describe it as one** ("a word space at 0.58
  of that advance, which is 0.42em in Fraunces"). Fraunces actually sets its
  space at **0.2105em** — a ratio of 0.287 against its uppercase advance, 0.367
  against title-case. Nothing about it is 0.58. So the hook has always assumed a
  word gap about twice as wide as the face sets, which makes it wrap early and
  pick a size SMALLER than needed — conservative, never overflowing, which is
  exactly why it survived. It is deliberately NOT corrected globally: every
  preset's `titleAdvance` was tuned with 0.58 in place, so changing the default
  would resize the titles of all five tones at once. `StylePreset` gained an
  optional `titleSpaceRatio` instead (Outfit sets 0.29), which is the same
  pattern the Poppins chapter card already used, and presets that omit it are
  byte-identical to before.
- **`latin-ext` is mandatory on every font load.** ș (U+0219) and ț (U+021B) are
  not in `latin`, so a Romanian chapter title renders as missing-glyph boxes
  without it. Naming subsets also cut one family from 21 network requests per
  render down to a handful — left to its default it pulls cyrillic, greek and
  vietnamese too. The subset list is repeated at each `loadFont` call on purpose:
  every family declares its own subset union, so a shared constant will not
  typecheck.
- **Anton has exactly one weight (400).** Asking for 700 makes the browser
  synthesise a fake bold, which smears the letterforms. Same care for any
  single-weight display face.
- **A chapter boundary has exactly one owner.** With cards on, `ImpactCard`'s own
  light leak IS the transition, so `Transitions` skips that boundary entirely —
  that is what the `chapterCards` prop is for. With cards off, `Transitions`
  flares instead of dipping to black. Wire a second effect onto the same frame
  and you get a flash inside a dip.
- **An ordinary scene boundary has an owner too, and it is the FOOTAGE.**
  `Transitions` used to dip the luminance ~40% for a third of a second at every
  scene cut when the montage was off (`sceneDips={intensity === 0}`) — a rule
  written when the film was one unbroken clip and a scene boundary had no
  picture change to announce it. The assembled montage is one clip per scene
  concatenated, so the picture cuts there by itself at EVERY intensity, and the
  dip had become a second transition over a real one: the outgoing scene faded
  down, the incoming faded up, and the cut sat in the trough. Reported as "the
  frames move badly at the transitions, it looks like an error", and measured on
  a render as 39-56% of the frame's luminance at all thirteen cuts. The scene
  dip is gone; `Transitions` now handles chapter boundaries only. **Verify this
  class of bug numerically**: `ffmpeg signalstats` per frame over a low-res
  render of the whole film shows a brightness trough sitting exactly on every
  cut, which no still can, and `ffmpeg select='gt(scene,0.25)'` on the source
  proves the picture really does change there.
- **The card is revealed by light, not by movement.** It used to slide in on a
  linear `translateX`; now it swaps at the peak of a `LightLeak` flash
  (`FLASH_PEAK`), where the frame is blown out and the change cannot be seen.
  `LightLeak` owns no timing — the caller passes the envelope — and
  `mixBlendMode: 'screen'` goes on each layer, never the wrapper, or the layers
  blend with each other first and most of the light is lost.
  `IMPACT_CARD_SECONDS` is exported because FinalVideo's Sequence must cover the
  whole window; a shorter one cuts the exit flash off mid-burn.
- **A shrink-to-fit flex item ignores `maxWidth`.** Captions were a `<div>`
  with `maxWidth: '90%'` centred by `alignItems` inside an `AbsoluteFill`, and
  a four-long-word chunk ran clean off the right edge, cut mid-word, at
  720x1280 — reproduced on a still. Percentages are not a wrapping guarantee:
  the safe margin now lives as padding on the frame, and the text box is an
  explicit `width: 100%` flex-wrap row. Check overlays at **720x1280**, not
  1280x720 — vertical is the narrow case and every overflow shows up there
  first.
- **`src/probe.tsx`** renders the overlays over synthetic bands as stills
  (`CaptionsPortrait`, `CaptionsLandscape`, `TitlePortrait`) so typography can
  be inspected without any footage. It is not part of the production bundle
  (`src/index.ts` is) — change its text/dimensions freely.
- **Verifying a render from a Claude Code web session:** the proxy answers 403
  for `remotion.media`, so Remotion cannot download its Chrome Headless Shell.
  Use the Playwright one that is already on the box —
  `--browser-executable=/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell`
  — plus `--ignore-certificate-errors`, because headless Chromium does not trust
  the proxy CA and every `fonts.gstatic.com` fetch fails with
  `ERR_CERT_AUTHORITY_INVALID` otherwise. Neither flag is needed on Railway.
  `npx remotion still` on a throwaway probe entry that renders the overlays over
  synthetic bands is the fastest way to actually look at typography and the leak
  without real footage; the Playwright ffmpeg on the box has no PNG decoder, so
  fabricating test footage with it does not work.
- **The opening title is a statement card, and it judges its own text.**
  `HookTitle` fills the frame: type sized to the text, words rising and fading
  in on one curve, a scale-and-blur settle, no rule. The typewriter reveal and
  the glowing underline it replaced were the two clearest "generated by a
  template" tells in the whole render. `isTitleLike()` gates it — at most 7
  words and 46 characters — because the form's Tema field usually holds a
  brief ("A man and a woman talking about equality"), and a brief set 100px
  tall is worse than no card. Those projects now open clean; that is
  deliberate, not a bug. A `hookTitle` prop from Scripting bypasses the gate
  entirely, and wiring it is the remaining half of the fix (Dan's side).
- **A masked reveal shows its own edge.** The words used to slide up inside an
  `overflow: hidden` box, so a hard line cut across the letterforms for the
  whole travel — and nothing on screen explains that edge, so it reads as a
  rendering fault rather than an entrance. Growing the clip box with padding
  (the earlier fix for sliced ascenders) only moves the edge, it never removes
  it. Rise plus opacity on the SAME curve needs no mask at all: every frame
  shows whole glyphs, just lower and lighter. Travel stays short (`RISE_EM`,
  0.38em) because the fade is what reveals — a long slide would only make the
  word look late.
- **Fitting type means simulating the line breaks, not dividing by a character
  count.** The hook picks its size by running the same greedy wrap the browser
  will, descending from the maximum until the title lands in three lines and
  60% of frame height. Two constants make or break it, both MEASURED off real
  renders rather than assumed: `titleAdvance` per preset (Fraunces caps 0.72,
  Anton 0.46 — condensed faces are nearly half a serif's width) and a word
  space at 0.58 of that advance, which is 0.42em in Fraunces, far wider than
  the 0.25em a body face uses. Getting either wrong put a five-word title on
  four lines. The wrap width also carries a 6% margin so residual error shrinks
  the type instead of spilling a line. The pass lives in `src/fitType.ts` and
  is shared with the chapter card — one owner, because the two surfaces set the
  same faces and would drift apart. A word WIDER than the whole line counts as
  `ceil(width / wrapWidth)` lines, not one: both surfaces set `overflow-wrap:
  anywhere`, so the browser splits it mid-word and a naive count approves a
  size that then overflows.
- **An opaque overlay hides bugs underneath it, and they surface the day it
  stops being opaque.** `FinalVideo`'s caption suppression reads `!activeCard`,
  and `activeCard` only ever covered the planner's TEXT cards — the caption was
  always drawn under the CHAPTER card too. Invisible for as long as `ImpactCard`
  painted a solid cream panel over it; plainly readable the moment its ground
  became a translucent backdrop, with the spoken line showing through the card
  that exists precisely so the screen is not saying the same thing twice. Fixed
  with `chapterCardUp` beside `activeCard`. Worth generalising: when you make a
  covering layer transparent, everything it was hiding becomes yours to check.
- **Measure a face's metrics with that face loaded; never inherit another's.**
  The chapter card moved to Poppins Bold, centred, no rule, over a dimmed blur
  of the footage itself (producer's call — note Poppins is the face `style.ts`
  argues against for the display role, and that objection still stands for the
  hook title). It initially kept the preset's `titleAdvance` and the shared 0.58
  word-space, both of which belong to high-contrast serifs. Canvas `measureText`
  on loaded Poppins 700 gives an advance of 0.59 and a space of **0.36** — a
  geometric sans sets spaces far tighter than a serif — so the fitter was
  overestimating every gap and dropping a size for nothing.
  `CARD_TITLE_ADVANCE` / `CARD_SPACE_RATIO` in `style.ts` hold the measured
  pair, and `fitTitleSize` takes an optional `spaceRatio` whose default stays
  0.58 because that is what the hook was tuned on. The card's ground is a
  `CardBackdrop` constant — `blur` (chosen), `ink`, `duotone` — flip it and
  render a still to compare. Its eyebrow is a single `EYEBROW_INK` (vermilion
  `#E2533B`), no longer the per-tone accent: at eyebrow size and tracking a
  label separates from the white title by VALUE before hue, which is why the
  brighter yellow and gold candidates lost despite more chroma.
- **A flash hides a change only if its brightest instant sits ON the change,
  and "brightest" is not where the envelope peaks.** Two separate errors, both
  live, found by rendering the card window and reading per-frame luminance
  (`ffmpeg signalstats`) rather than by eye:
  (a) `ImpactCard`'s Sequence began AT the chapter start, so the flash could
  only start there — the picture cut played completely naked and the light
  arrived a fifth of a second later, over footage that had already changed.
  `CARD_FLASH_LEAD` (= `IN * FLASH_PEAK`) now leads the whole window, and
  `cardWindowStart()` in FinalVideo is the single owner of that offset, shared
  by the Sequence and the caption suppression.
  (b) Even then the measured peak was 3 frames late, because `LightLeak`'s
  flare is SWEPT: at the envelope's peak it was still at -3% of frame width,
  entirely off-picture. Intensity peaked on time; brightness did not.
  `flashSweep()` bends the sweep to reach frame centre exactly at the attack.
  Measured result: luminance peak moved 233 → 229 against a cut at 230, and the
  cut frame itself went from 118 to 147 — a quarter more light on the one frame
  that matters. `Transitions` carried the same pair on the cards-off chapter
  path (its window was CENTRED on the boundary, so it flashed brightest before
  the cut) and was corrected with the same two tools.
  **The outro runs the identical entrance**, and `FLASH_IN` / `FLASH_LEAD` live
  in `LightLeak` rather than on either card so the two cannot drift. The end
  screen used to fade its opacity up over 0.4s while sliding 24px linearly —
  the same dissolve, on the most total cut in the film. Its Sequence is led by
  `FLASH_LEAD` and its duration grown by the same amount, so the film still ends
  on the frame it always did (1375 for the 42s fixture, unchanged); the lead is
  borrowed from the tail of the footage, which the flash covers anyway. The
  subscribe pill's spring now starts a beat AFTER the card lands — an accent on
  something already on screen, not part of the arrival.
  **Neither end of the card crossfades any more**, and the entrance is the one
  that mattered most. Both ends used to ease over 0.07s as "insurance against a
  pop on a bright shot". On the way out it ghosted the title over the returning
  footage. On the way IN it was worse *because* the alignment above succeeded:
  the card now arrives exactly on a picture cut, so a half-opacity card sat over
  a SHARP new scene for two frames and read unmistakably as a graphic that had
  fired by mistake — reported as a bug, and it was one. A hard swap under a
  flash peak is the whole premise of the effect; a crossfade is a dissolve
  competing with the light that is supposed to hide the change. The card renders
  only for `appearAt <= t < vanishAt`, at full opacity, and nothing fades.
  **Any "insurance" easing added around a flash swap re-creates this.**
- **An entrance curve can make a position animation invisible.** The card's
  typewriter reveal was replaced with a per-WORD stagger of rise + opacity —
  a typewriter is a literal depiction of typing, which a chapter card is not
  doing, and it is one of the loudest template tells available. Written first
  with `outExpo`, the hook's entrance curve, which spends nearly all its travel
  in the first few frames: the fade staggered beautifully and the RISE could not
  be seen at all, so what shipped would have been an opacity animation wearing a
  transform. `outQuart` decelerates over a distance the eye can follow. Verify
  this numerically, not by eye — computing the per-frame offset gave 49.5px of
  travel on a 90px title, which a still cannot show you. The "reveal must FINISH
  inside the hold" rule carries over unchanged: the stagger compresses so the
  last word lands 0.35s before the exit flash (measured: lands at 0.99s, card
  gone at 2.40s).
- **A card that holds a variable-length line cannot have a fixed type size.**
  `ImpactCard`'s title was a flat `px(52)`, picked for the long case — the
  eight-word narration excerpt it falls back to on projects rendered before
  chapter titles were passed in. A real chapter title is three words, so
  "What Fairness Costs" sat tiny in the middle of a full-frame card and read
  as a mistake. It now fits itself with the same `fitTitleSize`, and the
  eyebrow, rule and margins are proportional to the result so the layout keeps
  its shape at any size. The ceiling is deliberately higher than anything
  reached in practice: the wrap and height tests decide, and a low ceiling
  silently caps short titles before either test has an opinion.
- **A reveal must FINISH inside the hold.** The impact card lights its title
  character by character at the preset's typing rate, and on a long line the
  last characters were still arriving when the exit flash began — the card
  left before it could be read, which defeats the entire point of stopping on
  it. The rate is now `min(preset rate, budget / characters)` where the budget
  ends 0.35s before the card vanishes. Verified on a still at t=2.1s: the old
  version showed "actual" mid-word, the new one is complete.
- **A dead source video cannot be caught, only pre-empted.** `SourceVideo`
  guards the footage layer, and it took three attempts to get right: the
  `<video>` element's own failure is suppressed by passing `onError` (Remotion
  calls the handler instead of raising MediaPlaybackError), but a dead URL
  ALSO fails as a rejected promise inside OffthreadVideo's own effect — which
  neither `onError` nor a React error boundary can intercept, so Studio's
  global handler shows "NetworkError: A network error occurred." and the whole
  composition disappears. The only fix is a pre-flight `fetch(src, {Range:
  'bytes=0-0'})` and never mounting the video until it answers. CORS is not a
  problem: the render server sends the headers and public/ files are
  same-origin, and if a probe is blocked, Remotion's own fetch is blocked too.
  `getRemotionEnvironment().isRendering` gates all of it — a real render keeps
  no guard at all and fails loudly (verified: a 403 source aborts the render
  with the status code and writes no file), because shipping graphics over a
  test backdrop is far worse than a failed job.
- **`Link Video Final` means two different files depending on when you read it.**
  Before the Remotion pass it holds the raw montage from `/assemble`; after the
  render, `outputUrl` OVERWRITES it with the finished film. So on any completed
  project the field yields the graphics-baked version — and `remotion/public/`'s
  own README told you to download exactly that for Studio test footage. It was
  right when written, and silently became wrong the day the render step was
  wired in. The result is two sets of captions and a chapter card from a
  DIFFERENT project (seen: props said "What Fairness Costs", the frame showed
  "CHAPTER I — The Price of the Island"), which reads as a rendering bug and is
  not one — `FinalVideo` is drawing over a frame that already has graphics.
  Studio test footage must be the raw montage, or a single scene clip. **To
  test any file: turn `showCaptions` and `showChapterCards` off in the props
  panel. Text still on screen means it is baked in, so it is the wrong file.**
- **Studio answers 200 + text/html for every path it does not know.** Its
  single-page-app fallback means a status check can never tell a served video
  from a path that does not exist — `curl -I localhost:3000/test.mp4` returns
  `200` and looks fine, while the bytes are the Studio HTML page. This defeated
  the pre-flight probe above, whose whole job is that distinction: it passed,
  `OffthreadVideo` then choked on HTML, and the box reported "Source video
  unreachable" — a URL that was perfectly reachable and simply was not a video.
  The probe now rejects `text/html`, and the box names the URL it tried and how
  it failed. **When that box appears, read the URL in it before touching props,
  codecs or localStorage.** The real address is `/static-<hash>/<file>` (the
  hash changes per Studio start; `window.remotion_staticBase` in the page source
  holds it) — never `/file.mp4` and never `/public/file.mp4`.
- **A stale Studio outlives every fix you make.** The instance that showed this
  bug had been up since before the fixing commit existed. `npm run studio`
  refuses to start when 3000 is busy and says so loudly — but the refusal
  scrolls past, the old tab keeps rendering the old bundle, and it looks exactly
  like "the fix did nothing". Before debugging a Studio symptom at all, check
  `ps -o lstart -p $(lsof -ti:3000)` against the commit date. `git log -1
  --format=%cd` on the fix is the other half of the comparison.
- **A symlink in `public/` 404s in a render.** Remotion's static server does not
  follow it: `staticFile()` resolves, the compositor gets `404 while downloading
  file .../public/x.mp4`, and the render dies. Only relevant when wiring up test
  footage — copy the file, do not link it.
- **Remotion Studio cannot be inspected from a Claude Code web session.** The
  proxy resets `fonts.gstatic.com` for any Chrome we launch (with or without
  `--proxy-server`/`--ignore-certificate-errors`), and a failed font fetch
  throws NetworkError before anything renders — so a Studio screenshot shows
  the error overlay no matter what the composition does. Remotion's OWN Chrome
  during `remotion still` does get the fonts, so verify through stills, not
  Studio. Also note Chromium's `--screenshot` flag hangs forever on Studio (a
  live app never goes idle); driving CDP directly is the way to capture it.

### The montage (`remotion/src/montage.ts`)

Read the "a cut is a change of picture" entry above first — it is the rule this
file exists to obey, and the whole account of how it was got wrong. What
follows is only what remains true after that correction.

- **`npm run check:montage` asserts PLACEMENT, not count.** Every planned cut
  must sit on a real change of picture (`pictureChanges()`); the rhythm figures
  are printed but informational, because they describe the script's pacing,
  which the planner does not control and must not fake. It also derives the
  text cards exactly as `FinalVideo` does, so the report measures the edit that
  will actually render.
- **The pipeline already generates material we never put on screen.** Every
  scene has an approved `Imagine Scenă` (used only as Veo's first frame) and
  researched projects have a whole `Evidence` table. Before paying to generate
  anything new for variety, spend what is already bought. Text cards are the
  first of that (below); scene stills are the obvious next one, though the
  still IS the clip's first frame, so it can only be used decalat or it reads
  as a freeze.
- **A text card is the one mid-scene cut the planner may invent**, and it
  passes the rule rather than dodging it: the frame is replaced outright, so
  nothing about the two pictures either side matches. The framing DOES change
  across a card, and that is not a punch-in through the back door — the two
  footage shots never touch on screen, so there is no zoom jump to see.
  Returning on the SAME framing is what would look wrong: it makes the card
  read as a splice into one static shot rather than as a cutaway.
- **Cards are placed by the planner, not at fixed points.** Dropped at "always
  the chapter start" they land next to the rhythm instead of in it. It respects
  `CARD_MIN_GAP` (9s), `CARD_MAX_SHARE` (16% of runtime) and a `CARD_LEAD` of
  footage before the card, and it places TIME only — it never sees a card's
  content. `toMontageCards()` is the whole interface.
- The `cutsWithAudioAccentPct >= 40` acceptance target cannot be checked here:
  it needs a rendered file, and it is **Dan's side** — SFX accents have to land
  on the cut times. `auditCuts()` is where to get them from.
- Pixel-diffing a cut against the Studio fixture proves nothing:
  `PreviewBackdrop` is a near-featureless gradient, so adjacent frames differ
  by 0.07 vs 0.11 of 255 either way. That is a defect of the test, not the
  montage — verify numerically, or over real footage.

### Text cards (`remotion/src/textCards.ts`)

The second source the montage cuts to, and the only honest way we have to cut
more often than the footage changes. Cost zero: both kinds are built from data
the pipeline already produces.

- **A card must show what the narration is NOT saying.** Reprinting the spoken
  sentence is worse than no card, because the captions already print it —
  three copies of one line. That single test is what rules out the obvious
  "key phrase from the script" card, and it is why captions are suppressed for
  the frames a card is up.
- Two kinds, both derived in CODE so a card can never be invented:
  - `claim` — a row from the `Evidence` table, with **its source and date**.
    The attribution is the entire point; a claim with no `source` produces no
    card. Needs `evidence[]` + per-scene `evidenceRef` in the props (Dan's
    side); until then researched projects fall back to figures.
  - `figure` — a number the narration speaks, set large. Gated narrowly:
    percentages, plausible years, scaled quantities (million/miliarde/…), and
    bare numbers only from three digits up. "three days" and "7 birds" produce
    nothing, deliberately.
- **Which side the figure's context is on is decided by punctuation, not by
  preference.** A quantity usually governs the noun after it ("16 billion
  hours every day"), but when the figure closes its clause the noun is behind
  it — "raise global output by 26%, according to the same modelling" first
  produced the card "26% — according to the same modelling", which says
  nothing. Backward windows are also tighter than forward ones (4 words / 28
  chars), or they pick up the start of a different phrase.
- The kicker is bounded by **width, not word count**: a fixed six-word cap cut
  one phrase mid-clause while truncating a good six-word label on another.
- The card is ink with the accent, revealed by a fast settle — **not** the
  light leak, which belongs to the chapter boundary. Two full-frame light cards
  would be confusable, and reusing the leak blurs which element owns a frame.
- The planner may **squeeze** a card to fit its scene, so `TextCard` takes its
  duration from the SHOT, not from the spec. Without a `minSeconds` floor to
  shrink to, every claim card — long by nature — was silently dropped on 4-5s
  scenes. The bug first appeared in `check-montage.mjs`, which hand-rolled the
  spec→planner projection and forgot the field; that is why `toMontageCards()`
  exists as the single owner.
- An explicit `textCards` prop bypasses every gate above, same pattern as
  `hookTitle`. That is where Scripting-authored cards will land.
- **Motif cards: a card may DRAW instead of setting type.** `route`
  (`RouteCard`) unfolds a chart and traces the journey's stops; `schedule`
  (`ScheduleCard`) flaps two times onto a departure board and states the gap
  between them. The planner needed no change at all to gain either — it places
  TIME and is written never to see what a card holds — so the only wiring is
  the variant dispatch in `FinalVideo`'s `renderCard`. Three rules came out of
  building the first two:
  - **A motif must know something the footage cannot show.** The idea started
    as "the narration says map, so unfold a map" — over Veo footage that was
    already showing a man unfolding a map, under a caption already printing
    the word. Three copies of one fact. What the picture cannot show is the
    SHAPE of the journey and the SIZE of the gap between two times; that is
    what the two cards draw, and it is the whole difference between a motif
    and decoration.
  - **The content is AUTHORED, never derived.** A distance and a margin are
    nowhere in the script and no rule could compute them, so they live in the
    explicit `textCards` prop for that film. Code that invented a figure here
    would be inventing a fact — the one thing this pipeline is built not to do.
  - **A progress-triggered reveal cannot reveal the endpoint.** `RouteCard`
    first revealed each stop when the drawn fraction passed it, which is
    unsatisfiable at the destination: it sits at 1, the draw clamps at 1, and
    Tahiti never appeared on a card whose entire subject is Tahiti. The fix is
    to invert the eased draw (`timeAtProgress`) and give every stop a clock of
    its own. Any "reveal B once A has passed it" has this bug at the last B.
    Anything with `Math.random()` has a worse one — the render must be
    reproducible, so the split-flap's digit sequence is arithmetic.
- **Who authors a motif: a model in Scripting, behind a code validator.**
  `remotion/motif/` holds the prompt and `validate.mjs`; neither is wired into
  n8n yet. It belongs in **Claude Scripting** — the only workflow that knows
  the whole story and the only one that runs once per film (Media Generation
  runs in batches of 8 and would ask three times for a 15-scene film; Final
  Assembly is the render path and must not grow a model call). A card is
  anchored on `sceneIndex`, never on seconds, so it needs no timings and can be
  written long before `/assemble` invents them. Store it in-line like
  `Save Evidence`, and have `Build Remotion Props` read it into `textCards`.
  Not an "AI Agent" node: one structured call plus a Code node.
  The validator is the whole point, and it is `Validate Evidence Refs`'s
  pattern — **an invented value cannot survive code, and survives any second
  model.** Every string on a card carries provenance: a `quote` that must be a
  substring of a scene at or before the card's own (no card may print a word
  the film has not spoken yet), `arithmetic` the code recomputes, or an
  `evidence` ref that must exist and carry a source. Durations are computed
  from the content, not taken from the model. Verdicts are ok / review /
  rejected, where **review means the provenance is real but the transformation
  is unprovable** — that is the set the producer should see in Final touches.
  Proof it bites: run on the two cards written BY HAND for the tahiti film, it
  rejected the route, because the card says "Feribot" at 23s and the film has
  only said "ferry" by then. It also rejects the `≈ 16.700 km` on that card —
  a distance is nowhere in the script, so its only honest door is the research
  pack with a source.
- **The n8n half is LIVE since 2026-08-27: `db/port/motif-cards/`.** Two
  builders, two saved originals, one README with the window. Scripting gains
  seven nodes between `Save scenes To Airtable1` and `Wait For Scene Approval`
  (prep → gpt-5.4 + structured parser → the validator inlined from
  `remotion/motif/validate.mjs` → a jsonb merge into `project.editing_options`
  → a node that hands the scene stream back, exactly as `Evidence Done` does);
  Final Assembly gains no model call at all, just `order` on `Prepare Clips`
  and a lookup in `Build Remotion Props`. **A card is anchored on `Ordine
  Scenă`, never on the array index the model was shown** — `Prepare Clips`
  drops every scene without a final clip, so the authored index and the
  rendered index part company the moment a clip is missing, and the card would
  land on its neighbour. Two things are deliberately unfinished and written up
  in that README: a `review` card has nowhere to be reviewed until Final
  touches gets a panel, and explicit `textCards` still switch the derived
  figure cards off for that film.
- **Applied through the MCP connector, not the REST API — and the diff
  afterwards is not optional.** No API key is involved (the connector is
  already authorised), operations are atomic, and each step lands as its own
  version entry. The trap is escaping: a `\uXXXX` written with one backslash
  too few is decoded by JSON into the CHARACTER, so the validator's
  combining-mark range arrived in the live node as two invisible combining
  marks instead of an escape. It matched. It would have worked for months, and
  broken the day an editor normalised the file. Caught only by fetching both
  workflows back and diffing every touched node against the repo, which found
  six identical and one twelve bytes short. **Always end an MCP apply with that
  diff** — the failure mode is a node that works and is not what you wrote — and
  prefer forms that cannot be mangled: the range is now `\p{M}`, ASCII all the
  way down.
- **Final touches now reviews the animations, and that is not a formality.**
  `FinalSettings` lists every card the pipeline chose — what it will DRAW, not
  what kind of object it is ("Digul → Ferry → Avion → Tahiti", not "route
  card") — and any of them can be switched off before the render. A `review`
  verdict is badged *worth a look*. The drops ride along with the existing
  confirm rather than saving on each click, because this is a finishing screen
  and a card removed here must not become a separate write someone has to
  remember. `Project.motifCards` is parsed defensively in `derive.ts` (it comes
  from a model, through a validator, through jsonb), so both backends get it
  and a malformed card is dropped rather than drawn as an empty rectangle.
  The panel is absent entirely when there are no cards: an empty "no
  animations" box only invites adding some.
  **Why a person still decides:** a motif is a decision of TASTE, and the one
  expensive lesson this repo already paid for is a system making a taste
  decision alone — the montage planner that passed every acceptance target
  while producing what a viewer read as a rendering fault. The validator can
  prove a card is truthful. Only a producer can say it is wanted.
- **"An animation on every film" is answered by MORE MOTIFS, not a looser
  rule.** The prompt aims for one to three per film and looks hard for them,
  but it may not force one: with only `route` and `schedule` built, plenty of
  films genuinely offer neither, and a card that repeats the narration ships
  while an empty array only asks a question. So an empty answer must carry
  `none_because` — one line naming what the film DID offer that no motif could
  draw — and `Validate Motif Cards` logs it as `MOTIF NONE: …`. That log is the
  backlog: it is how the third motif gets chosen, and it is also what stops "no
  cards" and "the node is broken" from looking identical.

### The site

- The project page auto-refreshes every 10s, which remounts components. Drafts
  in progress must be backed by `sessionStorage` to survive it.
- **The app and the render share one type system.** **Outfit** / Inter / IBM
  Plex Mono are loaded in `platform/app/layout.tsx` via `next/font` and mirror
  `remotion/src/style.ts`, so the site looks like the films it makes.
  `latin-ext` is required here for the same reason as in the render — Romanian
  project names carry ș and ț. Review and approval surfaces deliberately kept
  their density — only the chrome changed.

  **This bullet used to say Fraunces / Inter Tight and "editorial", and it was
  wrong from 2026-08-15 to 2026-08-17** — the Daylight refresh (below) moved
  both the site and the render to Outfit on the 15th and nobody corrected the
  memory. A stale line here is worse than a missing one: it is read as current
  and reasoned from. Anything that names a face or a direction gets corrected
  in the same commit that changes it.
- **The design system is "Daylight" (2026-08-15), and the token layer at the
  top of `globals.css` is its single owner.** Light grey ground `#ececed`, one
  purple accent `#7a4fd6` with a deep `#4d3484` and a lift `#b299e7` derived by
  a fixed mix rule, pill buttons (`999px`), cushioned cards (24–28px radius,
  soft shadows), near-black radial panels for anything that must feel like a
  gate, and `cubic-bezier(.2,.8,.2,1)` at ~0.38s as the one ease. The
  reference prototypes and the full token list live in
  `design/handoff-visual-refresh/README.md` — **that file, not this section, is
  the spec**; what belongs here is only where the rebuild stands and what bit.
  It replaced the previous dark "editorial" direction wholesale, so a component
  that draws its own colours instead of reading tokens had to be found by hand
  (`721215f`) — the token layer cannot invert what does not ask it.
- **The Daylight rebuild is three screens, and only two and a half are done.**
  Landing (`platform/app/landing`, and it is now the site's front door),
  the brief (`platform/app/new`, including the genre pole), and the projects
  library (hero, cards, toolbar with search + segmented view + count,
  pagination at 15/page) have all landed. **The per-project workspace —
  screen 3, the stage stepper and the approval panels in
  `platform/app/projects/[id]` — has NOT been rebuilt**: it still wears the
  token layer and nothing more. That is the largest open piece of site work,
  and it is the screen every approval gate lives on, so restyle it rather than
  rewriting it: `SceneBoard`, `AssemblyStatus`, `ProductionActivity`,
  `AudioReview`, `ScriptReview` and `StageNav` each carry hard-won behaviour
  documented above, and the handoff's own rule is "keep every existing
  control; restyle, don't remove".
- `platform/lib/tone-type.ts`'s comments still describe the empty case as
  "inherit Fraunces". It inherits **Outfit** now. The behaviour is correct —
  an empty class means "inherit the display face" — only the name in the
  comment is stale.
- **Generic class names are already taken.** `globals.css` has app-wide
  blocks like `.empty` (an empty-state with `padding: 80px 0`), `.card`,
  `.field`, `.chip`. Using one as a local modifier silently inherits it: the
  /new call sheet's "no title yet" state was `sprev empty` and picked up 80px
  of phantom padding, dropping the title into the middle of a hole. Modifiers
  get their own word (`sprev blank`). Measure the computed box before blaming
  the rule you just wrote — `getComputedStyle` plus a walk over
  `document.styleSheets` naming every rule that matches the element finds this
  in seconds, guessing does not.
- **Project titles wear the film's own typeface.** `platform/lib/tone-type.ts`
  mirrors `presetForTone()` from the render (Bodoni for dark, Anton for
  motivational, etc. — keep the two maps in lockstep) and dresses the project
  page title and the /new call-sheet preview. Anton is single-weight: nothing
  may force a font-weight onto `.ptitle` (the old `.roomhead h1` rule did
  exactly that and was deleted for it). Titles in the LISTS are Poppins
  (`--f-title`) instead — at 17px a high-contrast serif costs legibility on a
  line that is scanned, not read.
- **The language belongs to the FORM, not to the voice picker.** Putting the
  selector inside `VoicePicker` looked right and was wrong twice over: a
  silent (`cinematic`) film renders no voice picker at all and still needs a
  language for its script, and a multi-voice project renders TWO voice pickers
  — narrator plus cast — so the control appeared twice. `LanguagePicker` now
  sits once in section 01 and drives a hidden `language` input; the voice
  pickers only read it, and their sole control is "show every language" (a
  local widening, not a change to the film). The posted value is the ENGLISH
  name, which is safe because n8n only ever interpolates `Language` into
  prompts and never compares it — checked across all twelve nodes that touch
  it in Claude Scripting. The free-text field it replaced was also `required`
  with no default, so clearing it blocked submission with a browser tooltip.
- **English is not filtered, on purpose.** Most of the library is English and
  most of it never says so in its metadata, so narrowing on the label drops
  far more than it finds and hands back an odd subset instead of the familiar
  default list. `narrowsUsefully()` in `lib/languages.ts` owns that rule — the
  picker sends no `lang` at all for a baseline language, and the route guards
  the same thing for direct callers. One owner, two readers.
- **A list that is still loading must not be clickable.** During the fetch the
  rows on screen belong to the PREVIOUS language, and they look exactly like
  valid choices — so a click picked a voice that does not speak the film's
  language, silently. The box is dimmed and `pointer-events: none` while busy,
  the row handler checks `loading` as well, and once a language-filtered list
  lands, a selection that is not in it moves to the first voice that is. That
  last part is deliberately narrow: never in controlled mode (it would change
  a project's saved voice behind the producer's back) and never on the
  unfiltered English list, which keeps its historical default voice.
- **The provider selector is gone, and it had been LYING rather than merely
  idle** (2026-08-28, spotted by the producer). ai33 was an aggregator, so
  `VoicePicker` offered ElevenLabs / Minimax / Edge / Kokoro; going direct left
  one provider, and `/api/voices` stopped reading the `provider` parameter
  altogether — it survives only in a comment. So choosing Minimax returned an
  ElevenLabs list, and the label claimed the voice was something it was not,
  with that claim following the id into the film. This is the Captions-toggle
  rule again — a control that cannot change the outcome reads as a decision —
  except one step worse, because this one asserted a falsehood instead of
  doing nothing. **The database was audited before assuming it was cosmetic**:
  22 project narrator voices and 6 cast voices, every one `elevenlabs_`, so
  nobody ever picked one and there is nothing to repair. Worth knowing why
  that check mattered — a stored `minimax_…` id would pass the
  `voice_id.includes('_')` validity test in all five places that use it and
  then fail at ElevenLabs, which is a silent break, not a loud one.
- **`/v2/voices` is the ACCOUNT's own voices — 21 English premades — and
  pointing the language filter at it killed the feature** (2026-08-28). The
  ElevenLabs migration replaced ai33's aggregated catalogue with that endpoint,
  so the filter was searching a set that could not contain the answer:
  `has_more: false`, every label `en`, zero Romanian voices reachable by any
  scan or search. It then fell through to its own "nothing mentions Romanian,
  so every voice is shown" branch, and the producer correctly read that as the
  selector not working. **The library is `/v1/shared-voices`**, which takes
  `language` as an ISO code natively — 4811 Romanian voices, Mihai
  (transylvanian), Cornel, Roxana. Its rows are FLAT where `/v2/voices` nests
  under `labels`, which `shape()` already tolerates (`labels[k] ?? v[k]`), so
  no second shaper was needed.
  Two things were verified against the live API before the rewrite, because
  each could have failed at the take rather than at the click: a shared voice
  id **synthesizes directly**, no "add to library" step (HTTP 200, audio/mpeg,
  billed), and `/v1/voices/{id}` **resolves** it, which is what the audio
  panel's name labels need.
  **And upstream's language filter is FUZZY, which is measured, not assumed**:
  `language=ro` returned 68 Romanian out of 100, and `language=ro&search=warm`
  only 33 — a multilingual voice labelled `en` is offered for `ro` because it
  is verified to read it. Right as a SET, wrong as an ORDER, so
  `voiceMatchesLanguage`/`voiceMentionsLanguage` still rank the result exactly
  as they did pre-migration. Deleting them because "upstream already filtered"
  would also have made the picker's "N labelled with the language, the rest
  matched by name or description" line a lie.
- **A metadata-only filter is not the search a human does.** The first
  language filter scanned pages with an empty query and kept only voices whose
  `language`/`accent` named the language — it surfaced TWO Romanian voices on
  a library that visibly holds many, while typing "romanian" into the box
  found them all. Lesson: **ai33's own `q` search reaches deeper than any
  bounded scan and reads fields we cannot see**, so the route now runs BOTH
  (`q=<language name>` plus the scan), merges, and ranks metadata-confirmed
  voices above ones that only matched by name or description — without
  discarding the latter, which is precisely what threw away the ones the
  producer could see. The language is chosen by ISO code from a searchable
  list of the 32 ElevenLabs multilingual languages (`LANGUAGES` in
  `lib/languages.ts`); the code is what ElevenLabs itself thinks in, so "ro"
  plus Enter is the whole interaction. Note that list is the MODEL's coverage,
  not a promise the library holds a natively-labelled voice for each.
- **Voice pickers narrow to the film's language, and two vocabularies had to
  be reconciled to do it.** The form's Language field is a free-text input
  whose datalist offers ENDONYMS ("Română", "Deutsch"), while ai33 relays each
  provider's own labels — "Romanian", "ro", "ro-RO", "Romanian (Romania)", or
  nothing at all in `language` with the useful word in `accent` instead.
  `platform/lib/languages.ts` is the single place that maps both sides, and it
  matches on whole words: a naive substring test made "ro" match *Roger* and
  "Rock ballad voice", which is exactly the bug the feature exists to fix.
  Unknown languages still filter — the input becomes its own alias — because
  the datalist is a suggestion, not a closed list. Three rules hold it up:
  **filtering must scan pages**, since one page of 24 in a mostly-English
  library can hold zero Romanian voices while the library holds a dozen (the
  route walks 6×100, cached an hour, exactly like `resolveNames`); **a filter
  must never empty the picker**, so no match falls back to the full list with
  a line saying so; and the narrowing is threaded to EVERY picker — the
  creation form via `CategoryPicker`/`CastPicker`, and `AudioReview` via the
  new `Project.language`, or swapping a narrator later would offer the English
  library again. **Whether native voices actually appear is unverified**: a
  Claude Code web session gets a 403 for `api.ai33.pro` like every other
  house-of-videos host, so the metadata's real coverage per provider could not
  be checked here — the "no voice is labelled X" branch exists precisely
  because it may be common.
- **Enter must not start a film.** An HTML form with a submit button submits
  on Enter from any text field, and here submitting writes a project to
  Airtable, starts scripting and spends model credits. Typing a title and
  pressing Enter — or pressing it to accept a voice search — started a real
  production run. The form's `onKeyDown` now blocks Enter, but **only when the
  target is an `INPUT`**: a textarea's Enter is a newline and never submitted
  anyway, and a button's Enter is that button's own activation, so blocking it
  wholesale would break "Start production" from the keyboard along with every
  `type="button"` chip and toggle. `isComposing` is checked too, or IME entry
  loses its commit key. Verified in a real Chromium (playwright-core against
  `/opt/pw-browsers`, installed with `--no-save`): Enter in the title, the
  language field and the voice search do nothing, while both clicking the
  button and pressing Enter on it still start the project.
- **The /new form's field names are a frozen contract.** `createProject()`
  posts `name, category, cat_*, cast_voices, language, length, tone, pace,
  speed,
  style, voice_id, aspect, captions/hook_title/chapter_cards/end_screen/sfx
  (yes|no)` to the n8n webhook. Any redesign keeps those names and value
  vocabularies byte-identical — the 2026-08 editorial rebuild moved them into
  hidden inputs bound to React state, nothing more. Every non-submit button
  inside the form must carry `type="button"`.
- **The filmstrip splits by chapter, and the chapter rule has ONE owner.**
  Paging the strip by 8 fixed the crowding a 44-scene film caused but not the
  navigation — "page 3 of 6" says nothing about where you are in a film. The
  strip is now cut by chapter on the Images and Video steps, with a tab per
  chapter carrying `approved/total` **for the step being reviewed**, so the
  row answers the question it is looked at for: which chapter still needs me.
  Paging survives *inside* a chapter for the rare one over 8 scenes.
  Three things are load-bearing:
  - **The current chapter is DERIVED from the selected scene, never held as
    state.** A tab and a selection that can disagree is a strip showing one
    chapter while the monitor below reviews a scene from another. Clicking a
    tab selects a scene (the first still owing a decision for this step, else
    the first of the chapter); selecting from anywhere else moves the tab.
  - **A film with one chapter keeps the plain paging.** Orders are not always
    chapter-encoded — a short film numbers its scenes 1, 2, 3, which all fall
    in the hook, and `ceil(Lenght / 120)` makes anything under two minutes one
    chapter by construction. `groupsByChapter()` owns that test; a row holding
    a single "Hook" button is noise.
  - **`lib/chapters.ts` is the single owner of `floor(order / 100)`.** It had
    been written by hand in three places (the voice panel, the narration-bundle
    route, `castIndexFor`) and n8n's `AB Pick Voice` / `VR Pick Voice` derive
    it the same way. A fourth copy is how "Chapter 2" comes to label one set of
    scenes while the download named "chapter 2" produces another. Note the
    numbered chapters sort NUMERICALLY — a lexical sort puts 10 before 9.
- **A `<video>` cannot be given a corner its own controls respect, so the clip
  has to be masked by its holder.** The Images/Video monitor drew the asset
  edge-to-edge, which was invisible while it held a picture and obvious the
  moment it held a clip: the black 16:9 rectangle squared off the card's
  rounded corners, and the bubble stopped being a bubble at exactly the frame
  the producer is judging. The radius belongs on `.scr` with `overflow:
  hidden`, not on the media — `MediaPlayer` fills its parent absolutely, and
  the same mask then also serves the fallback art, the drafts preview and the
  scrim.
- **A grid item's `min-width: auto` outranks every overflow rule inside it.**
  `.stage`'s two columns kept their desktop width on a phone and the monitor
  ran a full screen past the right edge — while the filmstrip's own
  `overflow-x: auto` sat there doing nothing, because nothing was ever
  narrower than its contents for it to scroll. `min-width: 0` on the items is
  the whole fix, and the symptom to recognise is a child that *can* scroll
  and doesn't. Measure the item against its track (`getBoundingClientRect`),
  not the page: the page-level scrollWidth blamed the stepper, which was only
  being dragged along.
- **A step you stepped back to must show ITS OWN asset.** `SceneBoard`'s
  monitor played the clip whenever one existed, so revisiting Images put a
  video player over the picture being judged — the wrong asset for the
  decision. `focus` (from the `?stage=` param) keeps the image in the monitor
  on the Images step; everywhere else the clip still wins, because there it is
  the fuller answer.
- **…and ONLY its own controls.** The same board carried every control whose
  asset happened to be unapproved, so the Video step asked you to approve the
  clip while also offering to re-record the line, rewrite it with AI and
  re-roll the picture — four buttons for three unrelated decisions under one
  heading. That was defensible while a step was a one-way door; once the
  stepper made every step its own page, it was just clutter, and the producer
  said so. `SceneBoard` now derives a single `step` — `focus` when the
  producer navigated to one, otherwise the first thing the active scene still
  owes (image → voice → clip, the pipeline's own order) — and renders that
  step's block alone. The three status rows stay, because the state of the
  whole scene is worth seeing from anywhere; only the row for the current step
  carries its "Make changes". **Removing a control means checking it has a
  home, not just a replacement**: the take belongs to `AudioReview` (which is
  strictly richer — duration flags, fit-vs-shot warnings, per-scene voice pin)
  and the line to `SceneReview`'s "↻ Regenerate scene", so nothing was lost.
  The one coupling this creates: the board may route a scene to the audio step
  only when `AudioReview` is actually rendered, hence the `audioPanel` prop —
  routing to a step that isn't on the page shows no controls at all.
- **A step-scoped panel needs step-scoped EVERYTHING**, and three things were
  missed the first time. (a) The bulk-review card fell through one chain of
  conditions — images missing → images to approve → clips missing → else
  videos — so the Images step, with only its last image unreviewed and no
  images branch to take, landed on "Approve all 6 videos": a one-click
  sign-off of the whole next stage, offered from the page before it. Each step
  now owns its own card. (b) The monitor keyed off `focus` (set only by
  `?stage=`), so on the LIVE page a scene whose picture was still awaiting a
  decision showed its clip instead; keying off the derived `step` means the
  live page already shows the picture, and clicking "Images" changes nothing
  rather than flashing the clip first. (c) The filmstrip dot came from the
  Airtable status TEXT, which is display-only and lags the checkboxes — so the
  strip could not answer the one question it is looked at for. It is now
  per-step approval: green approved, grey awaiting, dimmed only when nothing
  is generated yet. Note selection had to stop borrowing `.act`, which also
  paints the blinking "generating" dot — the scene under review was the one
  scene whose own light you could never see.
- **The render lock is not protecting the render.** While a Final Assembly
  execution is alive, every step but Assembly is frozen in the stepper — but
  navigating could never have interrupted anything, the render runs in n8n and
  on Railway and does not care what is on screen. The real hazard is that
  `confirmFinalSettings` fires the assemble webhook ITSELF (see auto-assembly
  below), so walking back to Final touches and pressing render again starts a
  SECOND execution and both write `Link Video Final`. `stopAssembly()` kills
  the live executions and rewinds the status to `Setari Finale`, which is why
  stopping and going back are one button. The lock keys off `assembly.running`,
  never off the status, so the two states that are not a live render unlock by
  themselves: the gap where production is still upstream, and a render that
  failed (its panel then offers Restart plus a door back to Final touches,
  because a failed render is often a failed *setting*).
- **`?stage=` navigation is a full server round-trip**, and the page is
  `force-dynamic`: every click re-reads Airtable and asks n8n what is running
  before one pixel changes, so the previous step sat on screen for a second
  and the click read as ignored. Nothing about switching Images↔Video needs
  the server — same mounted board, same scene data — so `StageNav` records
  where the click is going and `SceneBoard` believes it immediately; the
  server render arrives and agrees. The guess is dropped when the committed
  stage changes, so a failed navigation cannot leave the UI lying.
- **Approval used to be one-way, and "Make changes" is the door back.** Every
  control in a step is gated on the scene NOT being approved, so signing off
  froze it — however wrong it turned out three steps later. `reopenStep()`
  expresses reopening as **un-approval of one scene**, which is the whole
  trick: the per-scene controls reappear by themselves and n8n's "is every
  scene approved" gates reopen with them, so the pipeline needed no change at
  all. Only the named scene is touched, so the batch gets exactly one piece
  of outstanding work and the rest of the film keeps its sign-off. What
  cascades is what was derived from the changed thing — the scene step owns
  BOTH the narration and the image prompt, so it invalidates image + voice +
  video; image → video, voice → video, clip → nothing. `saveSceneScript`
  applies the same rule without any button: a changed image prompt un-approves
  the picture, a changed line re-records the take. It deliberately does NOT
  start a regeneration: reopening means "this needs another look", and the
  producer then picks what to change. The initial script has no such button:
  it is written for the whole project, not per scene, and `restart-scripting`
  is its door.
- **…and the script is the one step where approval is FINAL.** Every per-scene
  step can be reopened; the script cannot, because the entire film is derived
  from it — chapters, scenes, narration, image prompts — so editing it
  afterwards would describe a film that no longer exists. `ScriptReview` takes
  a `locked` prop (Airtable `Status === 'approved'`) and renders a read-only
  record: no Save, no Approve, no Regenerate, and the text as a plain block
  rather than a textarea, because clicking the Script step is how you go back
  and READ it and a fixed-height scrollbox fights that. Two details that
  matter: **only `'approved'` locks** — an unknown or empty status must leave
  the gate usable, since freezing a script nobody signed off strands the
  pipeline with no door at all — and the sessionStorage draft is DROPPED when
  locked instead of restored, or an unsaved pre-approval edit reappears on top
  of the approved text and reads as what production is running on.
- **Drafts are filed automatically, and the de-duplication is what makes that
  bearable.** Every path that replaces an asset — image regen, video regen,
  `restartVideoRegen`, and restoring an older draft — calls `autoKeep` first,
  because the moment you need a draft is the moment you did not think to
  press the button. It swallows its errors on purpose: a safety net that can
  block the regeneration it protects is worse than none. Identity is the Flow
  media id for images and the Drive URL for clips, **never the URL of an
  Airtable attachment** — those are re-signed on every read, so comparing
  them would file a duplicate on every single regeneration. `MAX_VERSIONS_PER_KIND`
  (12) bounds the growth and the drop is reported, not silent.
- **One draft per kind is a place, not a date, and it needs a marker of its
  own.** Since every regeneration files one, the newest automatic keep is
  always "the thing that was on this scene before the current one" — which is
  the card reached for most, and a timestamp is a poor name for it. It is
  labelled **Last generation** instead. The obvious implementation ("newest
  entry with `auto: true`") is wrong the moment de-duplication bites: restore
  an older draft, then regenerate, and the asset just replaced is one that was
  already on file, so no new entry is written and the label stays on the wrong
  card. So the marker is an explicit `last` flag on exactly one entry per kind,
  moved by EVERY automatic keep including the de-duplicated one — which is why
  that branch now writes to Airtable where it used to return early. A manual
  "Save draft" never claims it: it files the asset that is still live, which is
  not a previous anything. `readVersions` falls back to the newest `auto` entry
  for drafts saved before the flag existed, and drops the guess as soon as a
  real marker is written.
- **Nothing in the pipeline keeps what it replaces.** There is one image and
  one clip per scene, and every regeneration overwrites in place — so a
  re-roll that came back worse was unrecoverable. "⤓ Save draft" copies the
  live asset aside first; the drafts appear in the inspector with Restore.
  Two Airtable fields hold them, both created 2026-08-14 and **written only
  by the site — n8n must never touch either**: `Versiuni Imagine`
  (attachment) and `Versiuni Media` (JSON metadata). The split is forced by
  how the two assets expire: **an image is copied INTO Airtable** because
  fal's link dies within hours, while **a clip only needs its URL** because
  Drive links are permanent. And restoring an image writes back its
  `Image Media ID` and prompt as well — without the Flow id the scene can no
  longer generate video at all (`Prep Video Regen` refuses it), which would
  look like the restore having silently broken the scene.
- **A scene has THREE inputs, and the site used to show two.** `Script Scenă`
  is the line, `Imagine First Frame` is the picture, and `Video Scenă URL` —
  despite the name — is the MOTION prompt handed to Veo. The finished clip
  lands in `Scene Final URL`, so the "URL" field stays prose for the life of
  the project. Scripting writes all three once; nothing downstream ever
  rewrites the motion prompt except the AI scene rewrite. So a producer who
  edited the narration and the image prompt still got a clip performing the
  ORIGINAL direction, with no field on screen explaining why — seen on
  "Working engine", where a mechanic the producer had written out kept
  appearing. **On a cinematic project this makes the script edit entirely
  inert**, because the narration is neither spoken nor captioned: the whole
  film is the image prompt plus the motion prompt. The video step now shows
  it as "Shot direction" (`saveVideoPrompt`), and saving it un-approves the
  clip. `Evaluate Video Approval` re-reads the field every polling cycle, so
  an edit lands on the next regeneration.
- **Refusal notes get translated to next steps** by `platform/lib/refusals.ts`
  (wired into ProductionActivity and SceneBoard). Match only literal pipeline
  codes, never bare words or bare numbers: `\bminor\b` hit ordinary reviewer
  feedback (and Romanian "minoră"), and `\b5\d\d\b` hit scene ORDERS — the
  chapters convention is `chapter*100+scene`, so "scene 503" is data, not an
  HTTP status. The deterministic-refusal branch must stay ahead of the
  transient branch.
- **Verifying mobile from a Claude Code web session:** headless Chromium
  refuses windows narrower than 500px — `--window-size=390,...` silently
  renders a 500px viewport and CROPS the screenshot to 390, which looks like
  catastrophic overflow that isn't there. Simulate a real 390px viewport with
  `--window-size=500,H --force-device-scale-factor=1.282` instead.
- **prefers-reduced-motion strips ALL animations globally** (the `*` rule in
  globals.css). Anything revealed by animation must set its resting state in
  the BASE rule (`.finflash` needs `opacity: 0` there, or reduced-motion users
  get the flash at full strength), and anything that starts a download for an
  animated payoff (hover video previews) must skip the download entirely when
  the media query matches.
- **Drive-hosted media must go through `platform/app/api/media`, never the
  Railway `/media`.** The render server's version buffers the whole file and
  answers a plain 200: no `Accept-Ranges` and the `Range` header ignored. A
  browser plays such a response progressively but **cannot seek**, which
  presented as "the player is broken — I can't scrub the final video". Final
  videos (`Link Video Final`) and voiceovers are Drive URLs, so all three
  players were affected; scene clips are on fal.media and were always fine
  because a CDN honours ranges. `mediaSrc()` in `platform/lib/media.ts` is the
  single place that decides, and it deliberately proxies **only**
  `drive.google.com` — pushing CDN-hosted clips through our own function would
  cost Vercel bandwidth for nothing. A 206 is returned `private, no-store`: a
  cache keyed on URL alone would serve one partial response for a different
  range, which looks like a corrupt file rather than a caching bug.
  **Scene clips are Drive URLs too** — `Set Scene Result` writes
  `uc?export=download&id=…`, so an older note here claiming they sit on
  fal.media is wrong for `Scene Final URL`. That is what makes the per-scene
  download work: `mediaSrc` routes them through `/api/media`, which is
  SAME-ORIGIN, and a browser only honours `<a download="name">` on a
  same-origin link. `?dl=<filename>` additionally asks the proxy for a
  `Content-Disposition`, so the file arrives named even when the link is
  opened rather than clicked — opt-in by query, because the same route feeds
  the players and an attachment header would make every clip download instead
  of play.
- **The narration exists only as one take per scene, so downloading it whole
  had to be built, not linked.** `Voiceover URL` is per scene and the takes are
  joined in exactly one place — inside the final video, muxed under the
  picture — so there was no way to get the narration on its own.
  `/api/audio-bundle?project=…&chapter=all|hook|N` concatenates them with
  ffmpeg and answers as an attachment. Four things are load-bearing:
  it is a **GET**, because `<a download>` cannot POST; the site's password
  middleware covers `/api`, so it is no more open than the page linking to it;
  every input is passed through `aformat` before `concat`, because a
  re-synthesized line can come back at a different sample rate and concat
  refuses inputs that disagree; and there is **no gap between takes** — the
  bundle is the narration as the cut plays it, and one that drifts from the
  video is worse than none. Chapter comes from `lib/chapters.ts`, which is now
  the single owner of `floor(Ordine Scenă / 100)` — the same rule `AB Pick
  Voice` uses in n8n. They must agree or "Chapter 2" downloads different lines
  from the ones labelled Ch. 2.
- **That put ffmpeg in the site's own image** (`apk add ffmpeg` in the
  Dockerfile runner stage). The alternative was the Railway render server,
  which already has ffmpeg — but the site holds neither its URL nor its key,
  so that route meant two new GitHub Secrets and a `remotion/**` push (which
  rebuilds Railway and can kill a live render). A 3-second mp3 join is not
  worth either.
- **…and a binary in the image is a dependency on WHICH COPY of the site you
  opened.** The first report of the feature was a 500 — from
  `n8n-chi-azure.vercel.app`, the pre-Hetzner deployment, which is still live
  and still auto-building this trunk. Everything else on it works, because
  everything else is Airtable and n8n over HTTP; only the one route that
  shells out to a binary cannot. `lib/mp3.ts` is the answer: no ffmpeg → join
  the frames in pure Node. **Two live copies of the site writing to one
  Airtable and one n8n is the real hazard here** — approvals from one,
  in-flight flags from the other, and `getAliveProduction()` answering for
  both. Turning the Vercel project off is the actual fix; the fallback only
  means the producer is not stranded when they land there.
- **The stale copy now says so itself** (`StaleCopyBanner`, any `*.vercel.app`
  host). Two things about how, both deliberate. It is a CLIENT check on
  `location.host`, not the Host header: `headers()` in the root layout is
  correct on the first paint and opts the **entire app** out of static
  rendering — `/login` and `/new` both stopped being prerendered, which the
  build output shows and nothing else warns about. A temporary banner must not
  change how every page is served. And it keys off the vercel.app suffix
  rather than a canonical-host env var, so it needs no configuration and
  cannot misfire on the real site.
- **The Vercel MCP connector cannot delete that project**, so this is still a
  manual step: the connector's grant covers the `FermaFabiz` team, which has
  ZERO projects, and the personal scope answers 403. The deployment lives in
  the personal account. Dashboard → the `n8n` project → Settings → Delete, or
  at minimum disconnect its Git integration so it stops rebuilding this trunk.
- **The pure-Node join is a fallback and not a replacement, and the reason is
  measured.** Every mp3 carries encoder delay/padding frames, trimmed by a
  decoder using the gapless info in the Xing header — the very header a frame
  concat has to strip. So each join gains ~36ms of silence: three takes came
  out 4.2006s through ffmpeg and 4.3106s through the Node path (parts decode
  to 4.2018s of real audio). Inaudible per join, but on a fifteen-scene film
  it is about half a second of drift against the cut. Verify this by decoding
  to WAV and counting samples — the container's own duration field will not
  show it, and the remotion-bundled ffmpeg has no `s16le` muxer, so decode to
  `-c:a pcm_s16le` in a `.wav` rather than to a pipe.
- **A per-scene download works only because `/api/media` is same-origin.** A
  browser ignores `download` on a cross-origin link, so a raw Drive href opens
  a tab instead of saving. `downloadSrc()` in `lib/media.ts` adds `?dl=<name>`
  for proxied assets and returns CDN URLs untouched, since the attribute is
  ignored there either way.
- Count **approvals**, not asset existence, for pipeline progress. Counting
  clips that merely exist made "Video" tick green before review.
- **…but scope that count to the scenes the pass staged, not to the film.**
  See "The batch cap" — asking the project-wide question is what froze every
  film longer than 8 scenes.
- **The Inspector's chips are derived from checkboxes and assets, never from
  the status TEXT** — the same rule the gates follow, for the same reason.
  `Video` read `statusKind === 'run'` and therefore announced "Rendering" on
  scenes that had nothing at all (their status text still says "Generare
  Script"), while `Image` said "Awaiting review" for a picture that did not
  exist. On a project past the batch cap that was the state most scenes sat
  in, which is precisely what made the producer suspect the statuses were
  what had jammed production.
- **A getter that answers `null` for every failure must answer `null` for a
  NETWORK failure too, or its callers are guarding a lie.** `getExecutionError`
  returned null when n8n was unconfigured, when the response was not OK, and
  when the payload held no error — but `api()` is a bare `fetch`, and a
  request that never completes throws instead of returning a response for
  `!res.ok` to catch. `OpsPanel` compounded it by putting the list calls
  inside `try/catch` and the per-execution lookup AFTER it, so a three-second
  DNS blip on wf7 between the two calls killed the server component and
  answered the whole site with a black "Application error" page (digest
  2857745208, 2026-08-13). The same outage an hour earlier, hitting the list
  call, had produced the "Can't reach the n8n API" card and a perfectly usable
  page — the strategy was right, one call was outside it. The path is not
  rare: it runs on every render whenever any execution failed in the last 24h,
  and four had. **When a display-path fetch can throw, the page must not.**
- Transient states need a grace period. The render-error panel fires on healthy
  gaps between executions; `AssemblyStatus` uses a 75s sessionStorage-backed
  grace before crying failure.
- `ProductionActivity` (project page) mirrors the batch rule from `Sort & Cap
  Scenes`: a scene is done for the batch once its clip exists, pending scenes
  sort first, and `MEDIA_BATCH_CAP` in `platform/lib/n8n.ts` is a display
  mirror of the CAP in that node — if Dan changes the cap in n8n, update the
  constant too or the "N more runs needed" hint goes stale. The panel's
  "likely on scene X" line is an estimate from landed assets and is labeled
  as such; the batch reports no per-scene progress.

## Conventions

- Standalone webhooks over long-lived executions — they don't depend on a
  parent surviving.
- Flags in Airtable drive UI states like "Regenerating".
- `story` in `platform/lib/categories.ts` is the reference category: it is
  exactly today's working pipeline. Everything else is built *around* it,
  never by changing it. Categories marked `ready: false` are selectable, saved,
  and inert on purpose — so colleagues can work while the rest is wired up.

## The database that replaces Airtable

Airtable costs 125 lei/month and is being retired. **It is still the source of
truth today** — the site and every n8n workflow still read and write it. What
exists so far is the substrate underneath: a populated Postgres database and a
media store, running in parallel and used by nothing yet. Do not point anything
at it without reading this section.

| Piece | Where |
|---|---|
| Database | `hov` database, role `hov`, in the postgres:16 container already on the box. n8n's own database is untouched. |
| Password | `/opt/n8n/secrets/hov_db_password` (root-only) |
| Connection from a container | `postgresql://hov:<pw>@postgres:5432/hov` on `n8n_n8n_net` |
| Schema | `db/001_schema.sql` in this repo, applied 2026-08-15 |
| Media store | `/opt/n8n/media` on the host, served by Caddy at `https://house-of-videos.com/media/*` |
| Import | `db/import-from-airtable.mjs`, idempotent, re-runnable |

### Why Postgres and not Supabase

Self-hosted Supabase is ~10 containers and wants 4 GB+ RAM. The box has 3.8 GB
total. It does not fit, and paying for a bigger box would move the cost rather
than remove it. Postgres was already running for n8n, so a second database
there costs nothing and no extra memory.

### Airtable is only a rendezvous, which is why this substitutes 1:1

Nothing in the approval loop is an Airtable *feature*. The whole handshake is:

```
site:  PATCH { "Aprobare Imagine": true }        → writeSceneApproval(), lib/data.ts
n8n:   GET every 15s → is it true? → proceed     → Evaluate Image/Voice/Video Approval
```

No automations, no triggers, no formulas on that path. `UPDATE` + `SELECT` do
the same thing, without the 5 req/s per-base ceiling, and locally instead of
through a third host in the cloud.

### What Airtable was silently doing that Postgres does not

**Hosting files.** fal and Flow return signed CDN links that die in hours;
re-uploading them into an Airtable attachment field made Airtable re-host the
bytes permanently. That is what has been keeping every image and clip alive.
Postgres stores no files, so `/opt/n8n/media` now does that job:

- Mounted `rw` into `n8n` and `web` at `/media`, `ro` into `caddy` at `/srv/media`.
- `web` gets `MEDIA_ROOT=/media` and `MEDIA_BASE_URL=https://house-of-videos.com/media`.
- **The two containers run as different non-root users** (n8n `1000:1000`, web
  `1001:65533`), so both are in a shared host group `hovmedia` (gid 2000) via
  `group_add:`, and the directory is `2775` so new files inherit the group. A
  plain `chown` of one uid locks the other out; that is the failure you get
  first if you rebuild this.
- Paths are content-addressed (`<scene>/<field>/<sha256-32>.<ext>`), so Caddy
  serves them `immutable` and a re-import overwrites nothing.
- **Deliberately not behind the site password**, exactly like the Airtable
  attachment URLs it replaces — n8n, Remotion and the browser all fetch these
  with no session. Unguessable paths are the protection.

**A grid for humans.** `Genre Profiles`, `Script Library` and `Librărie
Scripturi` are edited by hand in Airtable — Genre Profiles explicitly so
("edit a cell here and the next project picks it up"). Nothing replaces that
yet. Screens in the site are still owed before Airtable can be switched off.

### Record ids keep Airtable's shape

`gen_rec_id()` mints `rec` + 14 chars, indistinguishable from an Airtable id,
and the import copies existing ids verbatim. The site puts scene ids in webhook
payloads and n8n passes them between workflows as opaque strings — UUIDs would
have forced a rewrite of every stored reference and broken every project in
flight on cutover day.

### Three legacy field names survive, and they lie

Columns are named for what they HOLD, not what Airtable called them, and every
column carries its Airtable original in a `COMMENT`. Three are worth knowing by
heart before porting any node:

| Airtable field | Column | What it actually holds |
|---|---|---|
| `Imagine First Frame` | `scene.image_prompt` | prompt TEXT, not a frame |
| `Video Scenă URL` | `scene.motion_prompt` | the motion prompt, never a URL |
| `Scene Final URL` | `scene.scene_final_url` | the clip the site actually plays |

`Status Producție Scenă` → `scene.production_status` is still result-stamps
only. The displayed status stays DERIVED from checkboxes plus asset existence,
exactly as `toScene()` does today. Do not start trusting the stored text.

### The constraints are the point, not decoration

The zeroing bug — a numeric field left mapped with no value writing a literal
`0` — cannot be committed any more:

```sql
scene.scene_order      integer not null check (scene_order > 0)
project.length_seconds integer      check (length_seconds is null or > 0)
```

The import found **206 zeros already fossilised in the data**, including the
eight projects whose `Lenght` was wiped by `Update Status to Finished`. They
import as NULL and are listed in the run's report rather than laundered.

`evidence` gained a unique `(project_id, ref)` — a scene citing E3 now gets one
claim instead of a coin flip. `genre_profile` gained a unique `lower(tone)`,
because the lookup is case-insensitive and two rows differing only in case made
the winner depend on row order.

### Stranded regen flags are now a query

The site sets a regen flag, n8n clears it from inside the execution, and any
death in between strands it — with the UI showing the in-flight state *instead
of* the button row. Each flag needed a hand-built escape hatch and two still
have none. Every flag now has a `*_at` timestamp, so staleness is one rule for
all of them, including ones added later:

```sql
where regen_image and regen_image_at < now() - interval '10 minutes'
```

### What the import did, and what it left behind

Run it with `--dry-run` first; it reads Airtable and writes nothing.

```
docker run --rm --network n8n_n8n_net \
  -v /opt/n8n/media:/media -v /opt/n8n/import:/app -w /app \
  --env-file /opt/n8n/import/import.env \
  node:20-alpine sh -c 'npm i --no-save --silent pg && node import-from-airtable.mjs'
```

Landed 2026-08-15: 56 projects, 107 chapters, 382 scenes, 334 files (735 MB),
59 scripts, 134 evidence, 11 genre profiles, 71 script library, 48 examples.

**287 records were skipped and that is correct.** 131 scenes and 156 chapters
from May–June predate the `Project_ID` convention: they have no project, no
order, and the site cannot render them either (`getScenes` filters on
`Project_ID`). They are residue from an earlier pipeline, not data loss. The
report groups every skip by reason with a count — it never truncates to
"…and 279 more", because that reads as a harmless tail and is how a real
problem hides.

**Attachment URLs expire.** Airtable hands back signed
`v5.airtableusercontent.com` links good for a few hours. The script downloads
each one inside the per-record loop for that reason — collect every URL first
and fetch them later and you get a few hundred dead links with no way to tell
which. Do not "optimise" that into two passes.

### Two backends, one switch

`platform/lib/data.ts` now answers from either backend, chosen by
`DATA_BACKEND`:

| value | reads/writes | when |
|---|---|---|
| `airtable` (default) | the base n8n still uses | now |
| `postgres` | the `hov` database | once the workflows are ported |

Flip it in `/opt/n8n/.env`, then **`docker compose up -d web`** — env vars are
fixed when a container is created, so a restart does nothing. `DATABASE_URL`
lives in compose rather than `platform.env` on purpose: that file is rewritten
from GitHub Secrets on every deploy, and this connection string names a service
on the compose network and never leaves the box.

**Do not flip it while the workflows still write Airtable.** The site would
render a frozen picture — the last import — while n8n updated rows nobody was
reading.

**The derivation is shared, and that is the point.** A scene's displayed status
is not stored anywhere; it is reconstructed from checkboxes plus asset
existence (see the long comment in `buildScene`). That logic, the status
vocabulary, and the `Project`/`Scene` types all live in
`platform/lib/data/derive.ts`, and **both** backends call it. Each adapter's
only job is to turn its own rows into the neutral `RawProject`/`RawScene`
shapes. Duplicating the derivation per backend would let them drift silently
and would make comparing them meaningless — which is the whole method for
verifying this migration.

`app/actions.ts` still calls `writeSceneFields` and friends with **Airtable
field names** (`{ "Aprobare Voce": true }`) in fourteen places. The Postgres
adapter translates them (`SCENE_FIELDS` / `PROJECT_FIELDS` / `SCRIPT_FIELDS`),
rather than those fourteen call sites being rewritten while both backends are
supposed to behave identically. An unmapped name **throws** instead of being
dropped — a silently ignored write is exactly the divergence the parallel run
exists to catch. When Airtable is gone, the call sites can move to column names
and those maps can go with them.

Two things the Postgres side does better, both free:

- `updateEditingOptions` is `editing_options || $1::jsonb`, one statement.
  The Airtable version was a read-modify-write, i.e. a lost update waiting for
  two approvals to land together.
- `deleteProjectDeep` is one `delete` and the foreign keys cascade. Airtable
  needed three paginated calls in the right order, and a half-finished delete
  left orphans nothing could reach.

Verified against the real database on 2026-08-15: 56 projects, correct status
derivation and progress, editing options parsed out of jsonb, cast and
per-character voice assignments intact, covers and scene images resolving to
the media store, `scene_final_url` correctly winning over the stored
attachment, and scene orders 1/101/102/103 in the right sequence.

## Porting the workflows off Airtable

48 Airtable nodes across the five active workflows: 22 `update`, 13 `search`,
8 `get`, 5 `create`.

| Workflow | Airtable nodes | of total |
|---|---|---|
| 3. Media Generation (Batch) | 23 | 165 |
| Claude Scripting | 10 | 100 |
| 1. Master Orchestrator | 8 | 32 |
| 4. Final Assembly | 4 | 37 |
| Video Factory Notifications | 3 | 7 |

### Postgres speaks Airtable, so the expressions never find out

**Do not swap an Airtable node for a Postgres node that returns columns.**
`db/002_airtable_compat.sql` exists because of one number: **52 nodes read
`$json.fields['Nume Câmp']`** — Romanian, with diacritics. A Postgres node
returning flat snake_case breaks every one of them, and they are scattered
through 344 nodes. That is not a port, it is a rewrite of the pipeline's gates.

So the database emits Airtable's exact shape instead:

```sql
select id, "createdTime", fields from hov.at_scene where id = $1
select * from hov.at_write('scene', $1, '{"Aprobare Imagine": true}'::jsonb)
select * from hov.at_create('project', $1::jsonb)
```

`{ id, createdTime, fields: {…} }`, with linked records as id arrays and
attachments as `[{id,url,filename,size,type,width,height}]`. Views `at_project`
/ `at_scene` / `at_chapter` / `at_script`; writes through `at_write` /
`at_create`, which read the field map out of `hov.airtable_field` and cast
using each column's real type from `information_schema` — there is no second
copy of the schema to drift.

**Verified inside n8n**, not just in psql: a real Postgres node feeding a Set
node resolved `$json.fields["Ordine Scenă"]` → `102`,
`$json.fields["Imagine Scenă"][0].url` → the media store URL, `$json.id` →
the record id, and `typeof $json.fields` → `object`. That last one is the
assumption the whole design rests on and it holds: node-postgres parses jsonb
into a real object, so expressions index it exactly as they indexed Airtable's.

Credential: **`HOV Postgres`** (`eRjiNDQFuDSTJpGK`), type `postgres`, pointing
at `postgres:5432/hov` on the compose network.

`at_write` **refuses** rather than drops: an unmapped field name raises, and so
does any attempt to write an attachment. A silently ignored write is precisely
the divergence that would make a parallel run look successful while it was not.

**And the schema refuses too — a value Airtable swallowed for months can now
abort a run.** First one found in the wild, 2026-08-16 15:20: a
`restart-scripting` run (orchestrator 4225 → scripting child 4226) died at
`Create Chapter Records` with

    new row for relation "chapter" violates check constraint "chapter_ordinal_check"
    Failing row contains (…, HOOK, …, 0, Aprobat, …)

The **hook chapter is created with `Ordine: 0`**, and the CHECK rejects it.
Airtable had no constraints, so this shipped invisibly. Runs after 15:27
succeeded, so something changed — constraint, payload, or simply a project
without a hook — but which is unconfirmed, and a film whose hook cannot be
written loses its opening card. Treat this as the first of a class: **every
place the old code wrote a lazy `0` or `null` is now a candidate abort**, and
the two zeroing entries under Airtable are the map of where those are. The
failure is at least loud, which is the improvement.

### The four nodes that need more than a query — solved

`Write Scene Image`, `Write Regen Image`, `Write Regen Video` and
`Update Scene Record` wrote `"Imagine Scenă": [{url}]` / `"Video Scenă":
[{url}]`, and **Airtable went and fetched those bytes itself**. That download
is the only reason images survive fal and Flow's signed links expiring within
hours, and it is the one thing a database cannot do.

They are now a single POST each to **`/api/media/ingest`** on the site:

```json
{ "sceneId": "rec…", "field": "image", "url": "https://fal…/x.png",
  "fields": { "Aprobare Imagine": false, "Status Producție Scenă": "Așteaptă Aprobare Imagine" } }
```

The endpoint downloads, content-addresses the bytes exactly as the import does,
writes the file under `/media/<scene>/<field>/<sha>.<ext>`, and records the
attachment **and the node's other fields in one transaction**. That transaction
is the point: split apart, a failure between them leaves a scene holding a new
image while still claiming to await the old one — and the batch's gates read
exactly those columns.

It answers with the scene in **Airtable's own shape**, spread at the top level,
so it is a drop-in: `Wait Image Approval`, `Wait Between Images` and `Loop
Scenes` read `$json.id` and `$json.fields['…']` and never learn anything moved.

Doing it inside n8n instead would have been three nodes per site — HTTP
Request, write to disk, insert — twelve nodes expressing directory creation and
content hashing as node parameters, none of it testable.

Two things about the wiring:

- **It is exempt from the site password** (`middleware.ts`). n8n has no browser
  session, so the gate would have bounced it to `/login` and the image would
  vanish behind a 200 nobody reads. Auth is the `x-hov-key` header against
  `MEDIA_INGEST_KEY` (in `/opt/n8n/.env` and `/opt/n8n/secrets/media_ingest_key`).
- **n8n holds that key as a credential**, `HOV Media Ingest`
  (`8kpY42LmZaBYBzfY`, type `httpHeaderAuth`), not as `{{ $env.… }}` — env
  access inside nodes can be switched off, and the port should not depend on
  whether it currently is. Same pattern as the FAL header.

**`IR Write Image` was the one attachment write the port missed** — found
2026-08-17, three site-triggered image regens 500-ing in a row. It had been
rerouted to `/api/at` like an ordinary PATCH, but its body writes `Imagine
Scenă`, and the shim refuses attachments BY DESIGN. The failure shape is
nasty: the image is generated and uploaded to Flow, then the write dies, so
money is spent, the scene keeps its regen flag, and the site shows the
in-flight state — the producer sees a regeneration that "takes forever"
until the batch's own (working) regen loop happens to pick the scene up.
Fixed by moving it onto `/api/media/ingest` with the same body shape as
`Write Scene Image`. When auditing the port, grep the BODIES for attachment
fields, not just the URLs for `api.airtable.com`.

Writing an `image` or `video` replaces that scene's attachment ROW. The old
FILE stays on disk on purpose: saved drafts point at it by path, and deleting
it would empty the one feature that exists to recover a bad re-roll.

Verified end to end on 2026-08-15: a real image posted from inside the network
downloaded, stored, served over HTTPS at 200, returned the scene with
`Imagine Scenă` as `[{id,url,size,type,filename}]`, and a second write with
different bytes left exactly one row.

### The public API has no draft — a PUT goes straight to production

n8n 2.32.7 stores `versionId` and `activeVersionId`, and the UI's publish flow
uses them, so it is natural to assume the REST API stages edits as drafts.

**It does not.** `PUT /workflows/{id}` on an active workflow bumps
`versionCounter`, sets `versionId` **and** `activeVersionId` to the new
version, and that version is live from that moment. Verified the hard way on
2026-08-15: a converted `Video Factory Notifications` was pushed expecting a
draft, went live immediately (3 Postgres nodes, 0 Airtable), and was reverted
from the saved original about two minutes later. Its schedule fires every five
minutes and the last run had been at 22:10:47 against a PUT at 22:11:06, so
nothing executed on the wrong version — luck, not design.

This query is the check, and `draft_eq_live` staying `t` after an edit is the
tell that the edit is already serving traffic:

    select "versionId" = "activeVersionId" as draft_eq_live, "versionCounter"
    from workflow_entity where active;

**So the port cannot be staged.** Converting all five workflows ahead of time
and leaving them parked is not available through the API. The consequences:

- **Always save the original first.** `GET /workflows/{id}` to a file before
  any PUT. That file is the only rollback, and it took ninety seconds to use.
- The conversion is a *file* deliverable (`db/port/*.ported.json`), applied
  inside the cutover window, not a set of live drafts.
- `settings` is stricter on PUT than on GET: it rejects `binaryMode` and
  `availableInMCP`, which GET happily returns. Send `{"executionOrder": "v1"}`
  alone — the server merges rather than replaces, and the other two survive.

### …but the UI does stage drafts, and one is parked right now with its Drive uploads broken

The entry above is about `PUT /workflows/{id}`. **The editor is different: opening
a workflow in the n8n UI and saving stages a real draft**, and `versionId` then
stops matching `activeVersionId` until someone presses Publish. So "a draft
cannot exist" is true of the API and false of the instance.

Observed 2026-08-17: `3. Media Generation` has `versionId`
`d85a3f8c-5cda-4dc0-96d3-9e8fac91aa2a` against `activeVersionId`
`f7f59a08-05a5-4f73-81a4-742e46880544`, the draft saved at 12:37. Diffed
node-for-node against the live version, it is identical except for key-reorder
noise and one thing that matters: **all six Google Drive *upload* nodes have
lost `resource: file` + `operation: upload`** — `Upload Audio to Drive`,
`Upload Scene To Drive`, `Upload Regen Clip To Drive`, `Upload VR Audio`,
`Upload VR Clip`, `AB Upload Audio`. The `Share *` siblings kept
`operation: share`.

**The port is not the culprit** — `db/port/workflows/yHG4DBCDjR3RJzav.ported.json`
still has `op=upload res=file` on all six. This is the same stripping the
cloud→self-hosted import did, which means it is the **editor** dropping a Drive
node's action when it round-trips a node type it cannot fully resolve. Publishing
that draft would break every voice and clip upload in the pipeline, silently:
the nodes do not error, they just have no resolvable action.

So: **discard it, or re-set `resource`/`operation` on those six before
publishing.** And check for this after any UI visit to a workflow with Drive
nodes:

    jq -r '.nodes[]|select(.type|test("googleDrive"))|.name+" "+(.parameters.operation//"MISSING")'

Two reading traps come with the draft model, and together they cost an hour:

- **`get_workflow_details` returns the DRAFT.** To see what is actually running,
  `get_workflow_version` with `activeVersionId`.
- **`search_workflows`' `updatedAt` reports the PUBLISHED version.** A workflow
  edited three minutes ago can look untouched for a day. Combined with a copy
  fetched earlier in a long session, that is how Media Generation got read as
  "still 22 Airtable nodes" on 08-17 — a workflow fully on Postgres since the
  day before. Re-fetch before concluding anything about the current state, and
  compare `.workflow.updatedAt` against what the search tool claimed.

**The MCP connector stages a draft too — `update_workflow` does NOT publish.**
Third case, and it behaves like the editor rather than like the PUT: after an
`update_workflow` the workflow's `versionId` is the new version, `updatedAt`
moves, `get_workflow_details` returns the change — and `activeVersionId` still
points at the old one, so **production keeps running the previous version**.
Nothing in the tool's answer says so; it reports `appliedOperations: 1` and a
URL. Found on 2026-08-17 while wiring `speed` into `Build Remotion Props`: the
edit read back perfectly and would have changed nothing at all.

So an MCP edit is two steps, and the second one needs the version id:

    publish_workflow { workflowId, versionId: <the id from get_workflow_history> }

Pass `versionId` explicitly rather than letting it publish "the current draft" —
that is the exact hazard the Media Generation draft above is: whatever is parked
goes live with your change. Before publishing anything, diff the draft against
the version you meant to build on, node by node, and confirm the ONLY entry that
differs is yours:

    # nodes differing between the saved original and the draft
    [k for k in draft if original.get(k) != draft[k]]

For the speed edit that list was exactly `['Build Remotion Props']` and all
three Google Drive nodes still had their `resource`/`operation`, which is what
made the publish safe. `get_workflow_history` is also how you tell the two
apart at a glance: the newest entry carries the `versionName` you passed, and
if `activeVersionId` is not that id, your change is parked.

### The write mechanism: dollar-quoting, not parameters

Feeding n8n expressions into SQL looked like the awkward part and turned out
not to be. Postgres dollar-quoting sidesteps escaping entirely:

```sql
select * from hov.at_write($hov$scene$hov$, $hov${{ $json.sceneId }}$hov$,
  $hov${{ JSON.stringify({ "Observații Scenă": $json.note,
                           "Aprobare Imagine": false }) }}$hov$::jsonb)
```

The column mapping of an Airtable node becomes the object literal in the middle
— a mechanical rewrite. Verified through a real Postgres node with deliberately
hostile input (`it's "tricky" — 100% $5 cost`, a newline, and `ăîșțâ`), which
round-tripped byte for byte, booleans included, with the regen timestamp set.

Only a literal `$hov$` in the data could break it, which no prompt will contain.
`queryReplacement` was the obvious alternative and is worse: it splits on
commas, and these payloads are full of them.

### The four search shapes

Thirteen `search` nodes, four distinct filters between them:

| Airtable formula | SQL |
|---|---|
| `AND({Project_ID}='X', {Aprobare Scenă}=1)` | `fields->>'Project_ID' = 'X' and (fields->>'Aprobare Scenă')::boolean` |
| `OR(RECORD_ID()='a', RECORD_ID()='b', …)` | `id = any(...)` built from the same `.map()` |
| `{Status General}='Finalizat'` | `fields->>'Status General' = 'Finalizat'` |
| `OR({Status Producție Scenă}='A', …='B')` | `fields->>'Status Producție Scenă' in ('A','B')` |

### The second cutover held — 2026-08-16, ~15:20 UTC

A full film ran end to end on Postgres with nothing left of Airtable in the
path: Orchestrator → Scripting → Media Generation → Final Assembly, four
executions, all green, twenty minutes. *A race between a snail and a turtle*,
32s, 5 scenes, 2 chapters, `Finalizat`, final video written.

What that actually proves, beyond "it works":

- **`/api/media/ingest` carries real generated assets.** Five images and five
  clips landed in the media store at content-addressed paths and serve over
  HTTPS. That is the code replacing the one thing Airtable did that a database
  cannot, and until this film it had only ever been tested by hand.
- **The shim carries the twenty-one raw-HTTP nodes.** Scripting reads its
  genre profile and style card through it, and writes evidence through it.
- **Chapter zero survives.** `ordinal` 0 for HOOK, 1 for the real chapter, and
  `scene_order` 1/101/102/103/104 — the chapter*100 + scene encoding intact.

**Two bugs only a real film could find**, both mine, both now fixed: the
twenty-one HTTP nodes the type-filtered port never saw, and a CHECK constraint
that made chapter zero uncommittable while the import had already nulled 47
hook markers and reported them as repairs.

**Not yet exercised on Postgres** — these are where the next surprise lives:
regenerations of image, voice, video and scene text (which is where three of
the four ingest nodes are), saved drafts through the UI, Resume and
restart-scripting, multi-voice and cast, a reference image on creation, and any
film past the batch cap of 8 scenes.

### The cutover was rolled back — 2026-08-16, 14:40 UTC

**Counting Airtable nodes undercounted the dependency, and the first test film
found it in ninety seconds.**

The port converted every `n8n-nodes-base.airtable` node: 48 of them, all five
workflows, verified. What it never looked at was **21 `httpRequest` nodes that
call `api.airtable.com` by hand** — `Fetch Project Record`, `Fetch Genre
Profile`, `Save Evidence`, `Write Scene Rewrite`, `IR Write Image`, and
sixteen more, spread across Claude Scripting, Media Generation and the
Orchestrator. They exist because the Airtable node could not do what those
steps needed; the note on `Fetch Project Record` says as much.

So the very first new project 403'd on its second node: the record had been
created in Postgres, and that raw GET went looking for it in Airtable.

**The right query is not by node type:**

    select w.name, n->>'name', n->>'type'
    from workflow_entity w, json_array_elements(w.nodes::json) n
    where w.active and lower(n::text) like '%airtable%';

That answers 48 for Media Generation's type filter and **11 / 4 / 1 / 32**
across the four workflows for the honest one — including Code nodes
(`Parse Approved From Airtable`, `Choose Bible`, `Prep Evidence Rows`…) that
still need auditing to see which merely read `fields` from upstream, which the
compatibility layer already covers, and which build Airtable URLs themselves.

Rolled back in about four minutes: five PUTs from
`db/port/workflows/*.original.json`, then `DATA_BACKEND=airtable` and
`docker compose up -d web`. Nothing was lost but the test project itself, which
had been created in Postgres and therefore never existed in Airtable — which is
exactly why the rollback had to happen on the first film rather than the tenth.

**Done, 2026-08-16.** The 21 HTTP nodes were not rewritten — they were
**rerouted**. `/api/at` on the site answers in Airtable's own dialect over the
same `at_*` views, so converting one is a change of host and nothing else:

    https://api.airtable.com/v0/applPyJjvNzyxJkbv/tblkNIy…/rec…
    http://web:3000/api/at/tblkNIy…/rec…

Method, body and every downstream `$json.fields[…]` stay as they were, which
matters because several of those bodies are IIFEs that parse a model's reply
into a fields object. Auth swaps the Airtable PAT for the `HOV Media Ingest`
header credential.

The shim answers only the four request shapes these nodes make — GET a record,
GET a filtered list, PATCH, POST a batch — and the four `filterByFormula`
shapes they send. Anything else **throws**: unknown table, unrecognised
formula, unmapped field, all 422. Verified including hostile text
(`it's "fine" — 100% $5`, a newline, diacritics) round-tripping byte for byte.

**The Code nodes turned out to be a non-issue.** Zero of them build Airtable
URLs or name a table; three read `.fields` from upstream, which both the
compatibility layer and the shim provide, and the rest mention Airtable only in
comments.

**The scan that now answers zero** — note the substitution, without which the
shim's own URLs count as Airtable references:

```python
s = re.sub(r'http://web:3000/api/at[^"\ ]*', '', json.dumps(node))
flagged = ('api.airtable.com' in s or 'applPyJjvNzyxJkbv' in s
           or re.search(r'tbl[A-Za-z0-9]{14}', s) or 'airtable' in node['type'].lower())
```

44 Postgres nodes, 21 through the shim, 0 remaining — across all five.

### The first cutover attempt — 2026-08-15, 22:46 UTC

**Superseded by the rollback above.** What ran, and what it proved, is still
accurate; what it missed is the section above. What ran, in order:

1. `search_executions` returned zero running/waiting.
2. `pg_dump` of `hov` to `/opt/n8n/backups_hov_pre_cutover.sql.gz`.
3. Final `import-from-airtable.mjs` — 56 projects, 382 scenes, 334 files.
4. Five `PUT`s from `db/port/workflows/*.ported.json`. **22:46:38.**
5. `DATA_BACKEND=postgres` + `docker compose up -d web`.

First production execution on the new backend was `4019`, 22:50:47: same scene,
same Romanian field names, same values — with
`https://house-of-videos.com/media/…` where Airtable had signed links, and
**65 ms where Airtable took 787 ms**.

**A caution about verifying this.** Execution `4018` ran at 22:45:47, 51
seconds before the PUT landed, and reading it as proof of success was wrong —
its attachment URLs were still `airtableusercontent.com`, with `thumbnails`,
which `at_attachments()` never emits. Compare an execution's `startedAt`
against the workflow's `updatedAt` before believing it tested anything.

### Rolling back

Airtable is untouched and complete. To go back:

    # workflows
    for f in db/port/workflows/*.original.json; do … PUT … ; done
    # site
    sed -i 's/^DATA_BACKEND=.*/DATA_BACKEND=airtable/' /opt/n8n/.env
    cd /opt/n8n && docker compose up -d web

**The asymmetry that matters:** rolling back loses everything written since the
cutover, because those writes went to Postgres and the import only ever runs
one way. The longer it runs, the more expensive the rollback — so give it a
full film early rather than waiting.

**Do not cancel the Airtable plan yet.** It is the only rollback that exists.
A full film and a week first.

### Looking at the data — /db

Airtable's grid was also how the team *looked* at things, and losing it left the
data reachable only over SSH, which two people have. `https://house-of-videos.com/db`
gives it back: browse every table, filter, sort, edit a cell, export CSV, run
SQL.

**pgweb, not NocoDB.** NocoDB is the closer match to Airtable's feel and costs
~500 MB; pgweb costs **5.8 MB measured**, on a box with 3.8 GB total that could
not host Supabase for the same reason. If the grid ever genuinely matters more
than the memory, NocoDB points at the same database and nothing else changes.

**Its own password**, separate from the site's, in `/opt/n8n/secrets/db_ui_password`
with the bcrypt hash in `.env` as `DB_UI_HASH`. Caddy checks it — the container
publishes no port. This is deliberate: the door opens onto every table with
write access, which is not the same door as the approval buttons.

It reads `hov` directly, so **it shows real column names**, not the Airtable
ones. `hov.at_scene` and the other `at_*` views are there for anyone who wants
the old shape back. The tables live under the **`hov` schema**, not `public`.

**The `hov` role can only reach its own database, and that had to be arranged.**
Postgres grants CONNECT on every database to PUBLIC by default, so on the first
visit pgweb's own Connect button led straight into the `n8n` database — its
`project` table, its `oauth_access_tokens`, its migrations. Table reads were
denied, but the schema was fully visible, and the `/db` password is not the
password that should open n8n's internals. Closed with:

    revoke connect on database n8n      from public;
    revoke connect on database postgres from public;

Owners keep their access, so n8n was unaffected — verified immediately after
(9 workflows, healthz 200). Worth re-checking after any `createdb`: a new
database starts open to everyone again.

### Ticking things by hand, now that the grid is gone

Unblocking a stuck film by ticking a box in Airtable was a real part of how
this got operated, and it still works — through `/db`'s **Query** tab, as SQL.
The gates n8n polls are the same columns they always were; only the names
changed.

| What you used to tick | Now |
|---|---|
| `Aprobare Scenă` | `scene_approved` |
| `Aprobare Imagine` | `image_approved` |
| `Aprobare Voce` | `voice_approved` |
| `Aprobare Video` | `video_approved` |
| `Regenerează Imagine/Video/Voce` | `regen_image` / `regen_video` / `regen_voice` |
| `Status Producție Scenă` | `production_status` |
| `Status General` (project) | `status` |

Scenes of one film, in the order the site shows them:

```sql
select id, scene_order, left(narration,60) as text,
       scene_approved, image_approved, voice_approved, video_approved,
       production_status
from hov.scene
where project_id = (select id from hov.project where name ilike '%part of the title%')
order by scene_order;
```

Push one scene past a gate:

```sql
update hov.scene set image_approved = true where id = 'recXXXXXXXXXXXXXX';
```

Release a regeneration that got stranded — the flag is set, the execution that
was meant to clear it is gone, and the UI shows the in-flight state instead of
the buttons:

```sql
update hov.scene
set regen_image = false, regen_image_at = null
where regen_image and regen_image_at < now() - interval '10 minutes';
```

**Two things behave differently from Airtable, both on purpose.** The database
refuses values Airtable accepted — `scene_order = 0` raises rather than
silently destroying the ordering — and a regen flag carries a `*_at` timestamp,
so clear both together or the staleness sweep stops seeing it.

**SQL is worse than a checkbox, and that is a real cost.** NocoDB gives an
Airtable-shaped grid with actual checkboxes over this same database for ~500 MB
of RAM; pgweb costs 5.8 MB. Worth revisiting if hand-editing turns out to be
frequent rather than occasional — but most of what used to need a manual tick
now has a button on the site.

### Known gaps, live right now

- ~~Saved drafts throw on Postgres.~~ Implemented 2026-08-15. A draft is now a
  second `attachment` row over the **same file** the scene already holds —
  Airtable re-uploaded and kept two copies; here the bytes are already ours and
  copying them would buy nothing but disk. That needed `attachment.path`'s
  global unique replaced by `(scene_id, field, path)` (db/003), and restoring
  moves the row, not the bytes.

  The bookkeeping — de-duplicating against every prior draft, moving the
  "previous generation" marker, pruning past the cap — moved into
  `planVersionSave()` in `derive.ts` as a pure function. `lib/data.ts` still
  carries the Airtable original inline; the two must agree, and the shared one
  is what runs.

  Verified end to end: manual save files a draft over the live image, the same
  asset is refused as a duplicate, a new image auto-keeps the outgoing one with
  the `last` marker, and restoring puts back the file, the Flow media id and
  the prompt while resetting the approval.
- ~~`Scene Final URL` wins over the stored clip.~~ Inverted 2026-08-15: the
  stored copy is preferred when there is one, in `buildScene` where both
  backends share it.

  Checking it first corrected two assumptions. The old precedence existed
  because the attachment was assumed to be the raw clip and the URL the muxed
  one — but twelve of twelve stored clips carry an aac track, so the stored
  file IS the muxed clip. And the expiring links were never fal: all eleven fal
  URLs still answer months later, while both `flow-content.google` ones answer
  403. Those two scenes had a good copy on disk the whole time and the old rule
  refused to show it. Both play again.

### Still owed before Airtable can be cancelled

1. ~~A `PostgresAdapter` behind the existing signatures in
   `platform/lib/data.ts`.~~ Done. (The note that used to live here said 11
   direct `fetch` calls to `api.airtable.com` had to be pulled in first; on
   inspection all 11 were already *inside* `lib/data.ts`.)
2. ~~The 48 Airtable nodes.~~ All 48 convert — `db/port/workflows/*.ported.json`,
   regenerate with `db/port/port-airtable-nodes.mjs`. **Not applied**: a PUT is
   live immediately, so they go in during the window.
3. ~~Admin screens for the three hand-edited tables.~~ Done — `/admin`, on
   both backends.
4. Saved drafts on Postgres — see "Known gaps, live right now".
5. ~~Cutover.~~ Done 2026-08-15. A full film and a week before cancelling the
   Airtable plan; it is the only rollback there is.


## Environment

**There is no `main`. The trunk is `claude/hello-7o90qh`**, and it is what
deploys. Feature branches are `claude/*` and reach the trunk through a merge
commit; `9353445 "Merge … into deploy-merge"` is the pattern.

**The Hetzner box does not track a branch — do not go looking for a git
checkout on it.** GitHub Actions builds a Docker image from the trunk on
every push touching `platform/**`, pushes it to GHCR, and the server pulls
that image. So the question is never "which branch does the server track" but
"which branch triggers the workflow", and that is the trunk. The site's env
vars live in **GitHub Secrets**, and the workflow writes them to the server on
each deploy — nothing about shipping needs shell access. Only hot diagnosis
does: logs, a restart, checking what the container is actually running.

To confirm a change is live, read the deploy's commit and the container's
restart time (`c3e72b8` at 11:16:18 → container back at 11:17:35 is the shape
of a healthy one), rather than assuming a green push means a served build.

**A branch that is pushed is not a branch that is deployed**, and the gap is
invisible from here: a session told to develop on its own `claude/*` branch
will push, report success, and leave the producer reloading a build that never
contained the change — who then reasonably says the fix did not work. That
already happened once (the step-scoped scene controls). **Finish the job by
merging into the trunk**, or say in as many words that the change is not live
yet and what is needed to make it so. This is the same class of error as the
stale Remotion Studio above: the artifact on screen outlives the fix.

Verifying a deploy no longer depends on the producer reloading the page. A
session with the SSH key can check the real thing directly:
`docker ps` for health, `docker logs n8n-web-1`, and a `wget` inside the
container using `SITE_PASSWORD` from `platform.env` as the `vf_auth` cookie.
The Vercel MCP connector still lists zero projects, and the web-session proxy
still answers 403 — neither matters now.

**Caddy does not reload itself.** The deploy workflow restarts only `web`. Env
vars are fixed when a container is created, so a change to the Caddyfile or to
`SITE_HOST`/`PANEL_HOST` in `/opt/n8n/.env` needs
`docker compose up -d caddy` — a reload is not enough. Skipping this is what
took the site down for a few minutes during the Vercel cutover: DNS pointed at
the box while Caddy was still running an 11-day-old config that had no site
block for the bare domain.

**The site's env** lives in **GitHub repo Secrets and Variables**, not on
the server: `.github/workflows/deploy-platform.yml` writes `/opt/n8n/platform.env`
from them on every deploy. Editing that file over SSH does nothing lasting —
the next deploy overwrites it. This is deliberate: four people share the work
and only one has a key on the box, but everyone reaches GitHub.

`N8N_API_URL`, `N8N_API_KEY`, `N8N_NEW_PROJECT_WEBHOOK_URL` must point at the
current n8n host. The other six webhooks are DERIVED from the new-project URL
by swapping the trailing path, so getting that one wrong breaks every approval
button at once. The registered paths are in Postgres:
`select method, "webhookPath" from webhook_entity;`

**Google OAuth** (Drive credential): redirect URI is
`https://wf7.house-of-videos.com/rest/oauth2-credential/callback`, JavaScript
origins empty. The app is **Published**, not in Testing — Testing mode expires
refresh tokens after 7 days. The "Google hasn't verified this app" warning is
expected and harmless for an app touching only its own Drive.

### Reference image for the first scene

The creation form takes an optional photo; the first scene's image is then
generated FROM it. The chain, and where each piece lives:

- **Site**: `new/page.tsx` file input (JPG/PNG/WebP, ≤6 MB, validated in
  `createProject`) → base64 in the webhook payload as `reference_image`.
  `next.config.mjs` raises the server-action `bodySizeLimit` to 10 MB —
  the default 1 MB would reject the photo before the action even ran.
- **Orchestrator**: IN-LINE after `Respond With Project` (parallel branches
  flush too late — same lesson as Save Evidence): `Has Ref Image?` →
  decode base64 (`this.helpers.prepareBinaryData` works in Code nodes) →
  Drive upload + share → merge `refImage: <drive url>` into Editing
  Options via HTTP PATCH (no read needed — the record was created seconds
  earlier by this same execution).
- **Media Generation**: new `IMG Load Project` (one GET at batch start,
  in-line before `Find Audio Folder`) exposes Editing Options to the image
  loop. `Build Image Request`: scene with `Ordine Scenă === 1` + refImage
  → `nano-banana/edit` with the photo as GROUND TRUTH ("recreate the
  subject faithfully"), which is a deliberately different instruction from
  the n-1 chain's "identity only, different composition". User ref wins
  over chaining and skips the similarity guard.
- **Regen path** (`IR Build Request`/`IR Generate Image` in Scripting):
  same rule, keyed by `refIsUser`. Unlike the n-1 chain, the user ref
  survives a prior rejection — it is producer-approved content; the
  refusal came from the generated output.
- The RESTART-scripting path reuses the same project record, so refImage
  survives a script redo. The rest of the film chains off scene 1's
  generated image (n-1), so the reference propagates one hop at a time.
- `Has Ref Image?` must guard `$('Normalize Webhook Input').isExecuted`.
  The orchestrator has a LEGACY `Video Project Form` trigger that is still
  enabled and still first, and on that path Normalize never runs — an
  unguarded `$('Normalize Webhook Input')` killed the run one step after the
  record was created (execution 2701). Same class as the restart-tail
  lesson: any node referenced by name must be reachable on every path that
  reaches the reference. That form trigger is also what `execute_workflow`
  hits when you mean to fire a webhook, which silently creates empty
  projects — target webhooks by POSTing the URL, not via execute_workflow.

## Open work

- ~~Do not publish the Media Generation draft parked since 2026-08-17~~ — that
  draft is gone, superseded by later edits, and the six Google Drive upload
  nodes carry `resource: file` + `operation: upload` again in everything now
  parked. The *check* stays worth running after any UI visit; the specific
  draft it warned about does not exist.
- **The ElevenLabs TTS migration went live 2026-08-28**, on the producer's
  say-so, after sitting written-but-parked for a day. Commit `8ffcf57` had
  shipped the repo half — which deployed — while both n8n halves stayed
  unpublished drafts, so production kept synthesizing through ai33 with
  nothing on screen to say so. Textbook `update_workflow`-does-not-publish,
  and it was invisible from `get_workflow_details` (which returns the DRAFT);
  only `activeVersionId` told the truth.

  | Workflow | now active | was active |
  |---|---|---|
  | Media Generation `yHG4DBCDjR3RJzav` | `c1cd26d0` | `97321056` (08-26, the audio-first reorder) |
  | Claude Scripting `gkEtGMecv4TC3ZHp` | `4ce12fa6` | `8211a0e5` (08-17) |

  Both drafts were diffed node-for-node against their active version first.
  Media Generation's differed ONLY in the TTS nodes — no dangling
  `$('<deleted node>')` references, all twelve Drive nodes keeping their
  `resource`/`operation` — so the audio-first reorder was carried forward
  intact and is verified live. **Scripting's carried two unrelated features**,
  the voice-regen swap *and* the whole motif-card chain, so publishing it
  shipped both: that is "whatever is parked goes live with your change" in
  the concrete, and the motif chain is now in the scripting happy path
  without ever having run on a real film.

  **It does not change how the audio sounds, and that was true before the
  publish too.** The new nodes and `remotion/server/tts.mjs` both pin
  `eleven_multilingual_v2` on purpose — the model ai33 was already choosing —
  so the migration buys direct billing, one call instead of a 3s poll loop,
  and *access* to the `voice_settings` ai33 silently dropped. Not a better
  take. The node exposes `additionalOptions.voiceSettings` and
  `languageCode`; using them is the separate change that would actually move
  the sound, and the two copies of `MODEL` must move together or a
  regenerated line comes back in a different voice character from its
  neighbours.
- **Verified live end to end, 2026-08-28** — execution `7716`, a real
  `scene-voice-regen` on scene `recR8blM6RLZ07vB6` (order 104 of the
  disposable cutover test film "A race between a snail and a turtle"),
  success in 15s. What makes it proof rather than a green tick is the
  RESPONSE HEADERS on `VR Speak`, which are unmistakably ElevenLabs' own
  API and could not come from ai33: `server: uvicorn`, `history-item-id`,
  `character-cost: 51`, `tts-latency-ms: 1008`, `x-region: europe-west4`,
  `current-concurrent-requests: 1 / maximum: 5`. `character-cost` also
  proves the credential is bound and billing to our account.
  The rest of the chain checked out in the same run: `VR Pick Voice`
  stripped `elevenlabs_EXAVITQu4vr4xnSDxMaL` → `EXAVITQu4vr4xnSDxMaL`
  (Sarah), the node emitted binary `data` / `audio/mp3` / 91,159 bytes,
  Drive received a file of exactly 91,159 bytes, and `VR Write Voice` wrote
  the new URL back through the `/api/at` shim and returned the scene in
  Airtable's shape out of Postgres. Approval flags were restored afterwards
  (`voice_approved`, `production_status`); the NEW take was deliberately
  KEPT, so that scene is an A/B against its ai33 neighbours in the same
  film, same voice, same model.
- **A Claude Code web session has NO outbound HTTP at all** — every host
  answers `000`, not just the house-of-videos ones, so `curl` cannot reach
  the site, wf7, or `api.elevenlabs.io`. The MCP connectors are the only way
  out. To run a query or fire a webhook, create a throwaway workflow
  (manual trigger → Postgres, or → an HTTP node posting to
  `http://localhost:5678/webhook/<path>`), `execute_workflow` it, read the
  result, then `archive_workflow`. n8n can reach itself and the database
  when you cannot.
- **Manual executions DO persist their data** — `get_execution` with
  `includeData: true` returns full `runData` for a `mode: manual` run. An
  older note here said otherwise and prescribed writing probe results into
  a table to read them back; that workaround is unnecessary. (The thing
  that genuinely has no readable progress is a *running* execution — see
  the `runData` entry above, which is unchanged.)
- **`setNodeCredential` applies IN PLACE to the live version — it does not
  stage a draft**, which makes it the exception to the rule two bullets up.
  Verified on both workflows 2026-08-28: `versionId` and `activeVersionId`
  were unchanged afterwards, `versionCounter` did not move, no new entry
  appeared in `get_workflow_history`, and only `updatedAt` advanced. So a
  credential fix needs no `publish_workflow` — and, less comfortably, it
  cannot be staged or reviewed before it is live. Do not batch one into an
  `update_workflow` call alongside node edits you meant to park.
- **`credentials: None` is redaction, never evidence — prove it with a
  control.** The API blanks every node's credential binding, so the question
  "is this new node bound?" cannot be read. The cheap test is a differential
  one: dump a node that provably works (a Google Drive upload that has been
  uploading for months) alongside the node in doubt. Both read `None`, which
  settles that the field carries no signal. Then use the documented remedy —
  setting is idempotent, so just set it and the unknown becomes a known.
- **Confirm the hook chapter's ordinal survives Postgres.** `chapter_ordinal_check`
  rejected `Ordine: 0` on 2026-08-16 (execution 4225 → 4226). Later runs
  succeeded, but whether the constraint, the payload or the absence of a hook is
  what changed is unknown.
- ~~The OpenAI account is out of credits~~ — **resolved.** Full pipelines ran to
  a finished film on 08-13, 08-14 and 08-16, and both `recCoZWsZBOrIU69L` and
  `rec1GITgUCq4mEsUd` read `Finalizat` with a final video. The entry is kept for
  its map of which nodes share that account — still the fastest way to see the
  blast radius of a billing failure. **Check the DATE on a note like this
  before repeating it**: this one had been resolved for a fortnight and was
  still told to the producer as a live blocker on 08-27, which cost a round
  trip and some of their patience. Original note: execution 1783 (2026-08-08,
  project "Death cominig up to take someone into the underworld",
  `recCoZWsZBOrIU69L`) died at `Rebuild Story Bible` with *"You have no
  credits remaining"*, after the script had been written, edited and
  approved. Every writing path shares that account: the six langchain model
  nodes (`Story Bible / Outline / Narration / Segment / Hook / Research
  Model`) and the three raw HTTP calls (`Rewrite Script`, `Rewrite Scene
  Text`, `Rewrite Scene Standalone`). So whole-script writing AND per-scene
  rewriting are both dead until the account is topped up, and both fail in a
  way that reads like a broken button. Per-scene regen at least fails
  honestly — `Mark Scene Regen Failed` writes the reason into `Observații
  Scenă` and releases the "Regenerare Text" status, so nothing hangs.
  That project is mid-flight: Story Bible and approved script exist, no
  chapters and no scenes. `restart-scripting` is the door back in.
  (Both of those projects have since finished — see the strike-through above.)
- **Ask Dan for `hookTitle`.** Scripting should write a 3-6 word line meant
  for the screen and n8n should pass it in `Build Remotion Props`; the prop
  already exists and bypasses the isTitleLike gate. Until then, projects whose
  Tema reads as a sentence open with no title card at all.
- Test `characters` multi-voice end to end again after the first run's three
  findings were fixed: the hook prompt now receives `hookRules` (no-narrator
  films tag the hook too), rule (e) bans third-person narration inside a
  character tag, and captions strip `[...]` like both TTS paths do. Note the
  site deliberately sets the project `Voice ID` to `cast[0]` when no narrator
  is picked — any untagged line falls back to the first character's voice.
- The audio panel can pin a voice per scene: the regen webhook accepts
  `voice_id`, which beats every mode rule in `VR Pick Voice` for that one
  synthesis. The batch never overwrites an existing voiceover, so the pin
  sticks.
- **A line and its recording drift apart silently, and that same "never
  overwrite" rule is why.** The take is synthesized from `Script Scenă`;
  nothing downstream ever compares the two again. So any path that rewrote
  the text after the audio existed left the film saying one thing and showing
  another — visible only by watching the whole cut, which is exactly how it
  was found. Three writers now all invalidate the voice, and only when a take
  actually exists (a scene not yet voiced needs no flag; a cinematic project
  has no speech): `requestVoiceRegen` already did, `saveSceneScript` now
  reads the old line first and re-records when it changed, and n8n's `Write
  Scene Rewrite` sets `Regenerează Voce` when `Voiceover URL` is present.
  **Any fourth writer of `Script Scenă` must do the same** — grep for it
  before adding one.
- **Auto-assembly has NEVER fired on wf7** — every Final Assembly execution
  is `mode: webhook`. The batch's settings gate (15s Wait loop) dies rather
  than release, proven again on the first cinematic project. **Bypassed, not
  fixed**: `confirmFinalSettings` now fires the assemble webhook itself
  right after flipping the status, so the manual Restart click became the
  automatic path. The n8n gate still exists and still never fires — if it
  is ever repaired, add dedup or the same project renders twice.
  The site half is fixed: `getAssemblyState()` now returns an explicit
  `stopped` verdict (true only when n8n answered and nothing is alive
  anywhere), and `page.tsx` shows the "render stopped" panel only on that
  verdict — "no running render" alone (production upstream, n8n
  unconfigured) is no longer treated as a stop.
- Test `chapters` multi-voice on a project with 2+ chapters (over 120s), which
  is the branch the per-scene rotation does *not* cover.
- Codify the "no visible faces" rule into Documentary image prompts.
- Scene 104/105 of `recCoZWsZBOrIU69L` are the first scenes to go through the
  new fal auto-rewrite path — worth watching once to confirm the rewritten
  prompt clears fal and the regen loop picks the scene up.
- The ambience level in `assemble.mjs` (`nativeVolume`, 0.22) and its
  sidechain settings were never heard on a real montage — tune by ear once.
- Optional: `channelName: 'Video Factory'` → `'House of Videos'` in
  `remotion/src/types.ts` and the n8n "Build Remotion Props" node (affects
  rendered end screens).
- Rotate the ai33 / Railway / useapi keys. Discord webhook URLs are still empty.

## Working language

The producer writes in Romanian and English interchangeably; reply in whichever
they used. Code, comments and this file stay in English.
