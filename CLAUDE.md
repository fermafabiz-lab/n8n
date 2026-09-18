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
| **Postgres** | `hov` database on the Hetzner box, plus `/opt/n8n/media` for the files | The source of truth for project + scene state since the cutover on 2026-08-15 |
| **Airtable** | base "Database Video" | **Read and written by nothing.** Frozen at the cutover and kept only as the rollback — do not cancel the plan yet |
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
`scene-image-regen`, `scene-voice-regen` (all three on Claude Scripting),
`assemble`, and the single-purpose ones — `expand-brief`, `yt-scene-titles`,
`upscale-film`, `list-music`/`share-music`, `archive-suggest`, `hook-regen`. The site derives all of them from `N8N_NEW_PROJECT_WEBHOOK_URL`
by string-replacing the last path segment, so they must live on the same host
— and each new one must be a plain `path` with no path parameters, or the
derived URL will not resolve.

Run `node scripts/check-n8n.mjs` (needs `N8N_API_URL` + `N8N_API_KEY`) to
verify all of the above in one shot — ids, active state, webhooks, every
`Execute Workflow` target, credentials, Railway health.

**It has to be run from a machine that can reach `wf7.house-of-videos.com`.**
Claude Code web sessions egress through a proxy that answers 403 to that host,
so the script cannot run there. `node scripts/check-fact-check.mjs` is the
opposite kind of check and runs anywhere: it executes the fact-check chain's
committed Code-node bodies against fixtures with no n8n and no network, which
is how the `RESULT:` parser was caught matching nothing before it ever ran.
The n8n MCP connector still works, and is the
way to check things from inside such a session.

## Where the lessons live

`CLAUDE.md` used to be one 5982-line file. As of 2026-09-13 it is this file
plus four companions, split by area so a session working on one part of the
pipeline is not forced to hold all of it in context:

| File | Covers |
|---|---|
| `docs/lessons-n8n.md` | n8n as a platform — execution/draft/publish mechanics, Airtable field-writing traps, gate wiring, the whole Airtable → Postgres cutover |
| `docs/lessons-render.md` | Everything downstream of "the clip exists" — TTS, breath trim, speed, the montage, text cards, captions, the sound mix, the Remotion render pipeline |
| `docs/lessons-site.md` | `platform/` (Next.js) — review UI, pickers, hands-off mode, documentary mode, the footage engine, the source watermark |
| `docs/lessons-pipeline.md` | What Claude Scripting and Media Generation WRITE and CHOOSE — story structure, evidence, consistency, the hook, genre rules, model choice, the batch cap, the fact check |

**Read this file always.** Then read the file (or files) for the area the
task actually touches. If a task crosses areas — and most non-trivial ones
do, since a single feature usually touches n8n, the render and the site
together — read all the files it touches. Do not assume a lesson is local to
one file just because the task looks like it belongs to one area: the
"Cross-cutting gotchas" section right below names the traps that bite
regardless, and the four files cross-reference each other by name where a
lesson genuinely spans two areas (e.g. `Editing Options` fields are written by
the site, read by n8n, and interpreted by the render — the pipeline file
holds the field's meaning, the other three hold what each side does with it).

These each cost hours. Do not rediscover them.

## Cross-cutting gotchas

The dozen or so traps that bite no matter which area a task is in, each with
the full entry in the file named:

- **Never push to `platform/**` or `remotion/**` while a Final Assembly (or
  Media Generation) execution is running.** A deploy restarts the container
  mid-render. Check `search_executions` first. Full account:
  `docs/lessons-n8n.md` under "Never push while a final render is running".
- **A PUT to the n8n public REST API has no draft — it is live immediately.**
  The MCP connector's `update_workflow` DOES stage a real draft;
  `get_workflow_details` always returns the DRAFT, never the live version —
  use `get_workflow_version` with `activeVersionId` to see what is actually
  running, and `publish_workflow` with an explicit `versionId` to make a
  draft live. Full account: `docs/lessons-n8n.md`, "The public API has no
  draft" and "…but the UI does stage drafts".
- **A Postgres node under `queryBatching: transaction` treats any `$` followed
  by a digit in the query text as a positional parameter** — `$321` in a
  quoted hook beat crashed `HR Apply` this way. Default batching is
  unaffected; a transaction-batched node must base64-encode every literal
  instead of dollar-quoting it. Full account: `docs/lessons-n8n.md`, "The
  write mechanism: dollar-quoting, not parameters".
- **`runData` is EMPTY for the whole life of a healthy running execution.**
  You cannot watch progress through the API — wait for it to end.
  `docs/lessons-n8n.md`, "n8n" section.
- **Any MCP edit to a live node must be diffed against the version you built
  on, node by node, confirming the ONLY entry that differs is yours** — use
  `db/port/lib/diff-workflow.mjs` rather than ad hoc python/jq. See
  `db/port/lib/README.md`.
- **Never write a prompt instruction as a negation.** Google's Veo guidance is
  explicit that "no walls" / "don't show walls" makes the model render walls;
  what is unwanted belongs in a bare comma-separated NOUN LIST. This pipeline
  produced a clip where a held object vanished and a table duplicated because
  our own tail said "nobody and nothing appears, disappears or duplicates".
  Same for props: "the swinging door" is an instruction to animate the door.
  Full account: `docs/lessons-pipeline.md`, "A prompt that names a failure
  summons it".
- **A prompt fragment always lives in more copies than the one you found.** The
  motion-prompt tail lived in seven places across three workflows; a fix that
  touched two was reported as done and shipped half-broken. Before calling a
  prompt change complete, grep EVERY workflow JSON for a distinctive phrase from
  the text you replaced — **and grep `db/port/*/paste/` too**, which is how the
  FIFTH copy of the ambient-motion rule (`VP Rewrite AI`, Media Generation) was
  found on 2026-09-15 after a grep of the two obvious workflows missed it. The
  rule lives in `Segment Chapter Into Scenes`, `Rewrite Scene Text`, `Rewrite
  Scene Standalone` (Claude Scripting), `HR Shots Prompt` (Hook Regen) and
  `VP Rewrite AI` (Media Generation). Guardrails are cheapest composed at submit
  time, where one node owns them, rather than stored in the database where
  changing them means a backfill.
- **A gate that tells two kinds of film apart must not trust `category`.**
  `story` is the site's DEFAULT, so genuine documentaries carry it — of eleven
  researched films in the database only three say `documentary`, and the Burj
  Al Arab, Peking to Paris and Tupac films are all filed as `story`. The
  fact-check chain asks the narration itself instead. Full account:
  `docs/lessons-pipeline.md`, "The script is checked against its own research".
- **Editing Options fields are refuse-then-clamp, never silently coerced** —
  the `normalize*` family in `platform/lib/data/derive.ts`, fixture-tested by
  `npm run check:normalize`. A value stored by the site, read by n8n and
  interpreted by the render must have its normalize rule agree in every copy
  — several fields keep 3-4 copies in lockstep on purpose.
- **A numeric Airtable field left mapped with no value writes a literal `0`,
  not nothing.** Killed scene ordering and project length more than once.
  `docs/lessons-n8n.md`, "Airtable" section.
- **A Claude Code web session has no outbound HTTP at all.** Anything that
  needs to reach `wf7.house-of-videos.com` or run a real render must be done
  through the n8n MCP connector, a throwaway workflow, or Railway's own
  tools — never a direct `fetch()`/`curl` from this environment. See
  `db/port/lib/README.md`.
- **Any Code-node body or prompt edited through MCP must come from a real,
  committed file first** (`db/port/<feature>/paste/<Node Name>.js`), never
  composed inline in the tool call. `db/port/lib/README.md`.

## Conventions

- **Every colour in `platform/app/globals.css` is one `light-dark()` token**
  (since 2026-09-15 the site has a dark mode, chosen at `/admin/customize`
  and carried as the `hov-theme` cookie; **the default is Light**, the
  device is followed only when chosen). **The night is an inversion**: what
  is near-black on the light ground — the "where you are" step card, the
  pills, the panels — is white on the dark one, and everything written on a
  panel reads a `--panel-*` token so it flips with it. A literal colour is
  allowed only on a surface that is the same in both themes — a video
  overlay, a film preview — and says so in a comment. Never add a second
  `[data-theme]` block of overrides: the token carries both values, which is
  the whole point. `docs/lessons-site.md`, "Settings is a hub, and the site
  has a night".
- **The genre profiles, script library and script examples have NO screen
  since 2026-09-15** (removed at the producer's call; Settings is a hub of
  Account / Billing / Notifications / Customize now). Claude Scripting still
  reads `hov.genre_profile` etc. — edit them in Postgres. The screens are in
  git at `b5150fe` if wanted back.
- Standalone webhooks over long-lived executions — they don't depend on a
  parent surviving.
- Flags in Airtable drive UI states like "Regenerating".
- `story` in `platform/lib/categories.ts` is the reference category: it is
  exactly today's working pipeline. Everything else is built *around* it,
  never by changing it. Categories marked `ready: false` are selectable, saved,
  and inert on purpose — so colleagues can work while the rest is wired up.

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

## Open work

- **The fact check is live and has never run inside a real scripting run**
  (2026-09-18, Claude Scripting `ea076103`; full account
  `db/port/fact-check/README.md`, lessons in `docs/lessons-pipeline.md` under
  "The script is checked against its own research" and `docs/lessons-site.md`
  under "The fact-check panel"). Thirteen nodes between `If Narration Retry`[1]
  and `Combine Chapters` read the narration against the film's own research
  pack, look up what the pack does not cover, rewrite what nothing can back,
  and write `hov.fact_check` for the panel above the script gate. It was
  exercised end to end on the Burj Al Arab film's real narration and pack
  through a throwaway (execution 14764: 47 statements, 16 looked up, 8
  corrected, 0 left flagged, rewrite accepted, every chapter within a few words
  of its length), and `node scripts/check-fact-check.mjs` holds 60 assertions
  over the committed node bodies including every refusal branch. **What is
  owed is one real researched documentary**: read its `hov.fact_check` row and
  READ THE PROSE — the length checks all pass by construction, and nobody has
  yet judged whether a corrected sentence reads as well as the one it replaced.
  The escape hatch if a film goes wrong: publish `b9f95221`, the version this
  was built on; the chain is purely additive.

- **The sunbeam-dust fix has a mechanism and no outcome yet** (2026-09-15,
  `db/port/still-air/README.md`, lessons in `docs/lessons-pipeline.md` under
  "A shaft of light is not a cause"). The producer's "why does it generate these
  particles" was real and measurable: 73 of 725 scenes across the last 40 films
  asked for airborne dust, 29-33% on the worst. One sentence is now live in all
  five copies of the ambient-motion rule. **What is owed is one measurement** —
  re-run the query in that README on a film written after 2026-09-15; the
  post-fix bucket should read 0, where it read 3.2% before. It is a prompt
  change, so existing films keep their motes until those scenes' text is
  regenerated.

- **The Veo direction work needs a real film to measure it** (2026-09-13,
  Media Generation `6a79f422`; full account `db/port/veo-direction/`, lessons
  in `docs/lessons-pipeline.md` under "Direction: why Veo played the shot
  backwards"). Three changes went live in one afternoon against the
  producer's report that clips contradict their own scene — the contradictory
  continuity clause is gone, every clip is now made from a start frame AND an
  end frame, and a gpt-4o judge scores each finished clip and re-rolls it
  once when it clearly disagrees with its brief. Each was verified at the API
  level on a throwaway (executions 12930, 12933, 12947) and the one clip that
  exists scored `direction: 1, coherent: 1, morph: false` on exactly the
  reported failure. **None of that is a measurement.** What is owed:
  watch one real film and count how many clips the judge re-rolls — too many
  means the thresholds (0.5 / 0.45 in `Motion Verdict`) are wrong, near zero
  on a film the producer still dislikes means the judge is too kind;
  watch for MORPHING, which is what interpolation does when the two frames
  are too far apart and is invisible to a direction check;
  and click "regenerate" on one real clip — the gate's regeneration got the
  same two changes mirrored onto it (`69c992f9`, seven `RG *` nodes) but has
  only had its pieces exercised, never the whole chain; the log lines to look
  for are `RG ENDFRAME <id>: got …` and `RG MOTION <id>: ok`. The two escape
  hatches, if a film goes wrong at 2 a.m.: `endFrame: false` and
  `motionJudge: false` in `Editing Options`.

- **Documentary mode, what is still owed** (see `docs/lessons-site.md`,
  "Documentary mode — archive footage" and "The Universal Footage Engine"):
  the picker itself has only been exercised through its HTTP twin, so click
  through it once on a real documentary project; print archive credits on
  the end screen (Remotion, i.e. a Railway push — the DESCRIPTION half
  shipped 2026-09-10, see `docs/lessons-site.md`); put the optional source
  keys into GitHub Secrets — `DVIDS_API_KEY`, ~~`EUROPEANA_API_KEY`~~
  (**set 2026-09-10** and verified live: the key answers HTTP 200 with
  `success: true` and echoes itself back in `apikey`, and the deploy log
  masks it as `***` where every other footage key is still blank — which
  is the only proof a secret exists, since its value can never be read
  back. Note what the key does NOT buy: `api2demo` answered the same
  query with the same 1,844 results in the same minute, so the gain is
  QUOTA, not reach — the demo key is shared and throttled, and a
  ninety-scene film asking three hundred times is what would have hit
  it), `FLICKR_API_KEY`, `PEXELS_API_KEY`,
  `PIXABAY_API_KEY`, `UNSPLASH_ACCESS_KEY`, `OPENVERSE_CLIENT_ID` +
  `OPENVERSE_CLIENT_SECRET` — because a keyed provider is OFF until its key
  exists, Openverse excepted (it runs anonymously at five requests an hour
  meanwhile) (`docs/footage-sources.md` has the sign-up page for each); and
  verify the four adapters written from documentation alone (Flickr,
  Pexels, Pixabay, Unsplash) against one real response each once a key is
  in. The EU Audiovisual Service is opt-in and off — it has no public API
  (see the footage engine section). (The "scripting proposes archive shots"
  half exists since the same day as the `Archive Suggestions` run, above.)
  Scenes 102 and 103 of the disposable film `recaW2aLFFD06FpoN` carry
  archive assets from the verification run and can stay as the
  demonstration.
- ~~Images on Google Flow instead of fal — designed, not applied.~~ **Applied
  and live 2026-09-02** (Media Generation `d88a638e`, Claude Scripting
  `bafbe64d`); see "Images are made on Google Flow" under the hard-won
  lessons and `db/port/flow-images/README.md` for the apply record, the
  four deliberate deviations from the design and the rollback ids.
  **Verified end to end the same day** on the disposable test film
  (execution 9361): four generated `…-image:<uuid>` ids, four clips made
  from them as `startImage`, and one refusal walking the rewrite ladder to
  a picture in 65 s. Details and timings at the end of that README.

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
  `docs/lessons-n8n.md`, "n8n" section, `runData` is empty while running —
  which is unchanged.)
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
- ~~Ask Dan for `hookTitle`.~~ Moot since 2026-09-11: the opening title card
  is retired and every film opens on the teaser (see "The hook is a teaser").
  `hookTitle` / `showHookTitle` are still accepted by the render props and
  ignored.
- **`speechStartsSeconds` — the last systematic caption offset.** The breath
  trim keeps the lead-in silence on a scene that opens a chapter (deliberately
  — that pause IS the chapter break), so its take begins with 0.2–0.6s of
  nothing while the captions begin at word one. Two lines fix it and both are
  outside the render: `assemble.mjs` already computes the kept `head` in
  `tightenTake`, so it can report it beside `voiceDurationsSeconds`, and
  `Build Remotion Props` can pass it into each scene. `captionAt` would then
  offset `elapsed` by it. Nothing can be guessed from inside Remotion.
- Test `characters` multi-voice end to end again after the first run's three
  findings were fixed: the hook prompt now receives `hookRules` (no-narrator
  films tag the hook too), rule (e) bans third-person narration inside a
  character tag, and captions strip `[...]` like both TTS paths do. **That
  last clause was written about an intention and stayed here as fact for
  weeks** — `Captions.tsx` did not strip anything until 2026-09-10, so every
  multi-voice film printed `[CHARACTER: Maria]` on screen AND spent that word's
  worth of time on it. `stripTags` in `src/captionTiming.ts` is the one owner
  now. Note the site deliberately sets the project `Voice ID` to `cast[0]` when
  no narrator is picked — any untagged line falls back to the first character's
  voice.
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
- **The site is the ONLY thing that starts a render** (2026-09-02, orchestrator
  version published that day). `confirmFinalSettings` writes `Asamblare` and
  fires the assemble webhook; the orchestrator's three `Execute Final
  Assembly*` nodes are disconnected and `Final Assembly`'s own `Update Project
  Status` marks the project `Finalizat`. History, because it explains the
  canvas: for months the batch's settings gate died rather than release, so
  the webhook was added as a bypass with the note "if the gate is ever
  repaired, add dedup or the same project renders twice". The one-pass
  batch repaired the gate as a side effect, and the very next film rendered
  twice — the webhook execution and, seven seconds later, the orchestrator's
  `integrated` one, on the same confirmation. Two 71-scene assembles on one
  box exhausted ffmpeg's decoder threads (below) and Drive answered 503 to
  the second set of 142 downloads; both died, the site rewound to Final
  touches, the producer confirmed again, and the pair ran again — four
  times. **Recognise it by the pairs**: a `webhook` and an `integrated`
  Final Assembly execution starting seconds apart.
- **The poll ceilings were sized for 60-second films, and the site's
  "taking much longer than usual" was too — together they turned the first
  8-minute render into a restart loop** (2026-09-02, Final Assembly version
  `4fcb507d`). At ~2 fps an 8-minute film is ~95 minutes of Remotion, so
  `Graphics Guard`'s 360 polls × 5s (30 min) would have killed it as "timed
  out", and `AssemblyStatus` called 15 minutes "much longer than usual" and
  offered Restart — which `retryAssembly` honoured by firing a SECOND webhook
  without stopping the first: two Remotion passes, CPU past 8 of 8, memory
  6.6 of 8 GB. Now `Render Guard` is 720 polls (1 h), `Graphics Guard` 2160
  (3 h — the 12-minute brief at 2 fps), `retryAssembly` stops what is alive
  before it fires, and the panel takes `lengthSeconds` and judges "slow"
  against `120 + 12 × length` seconds, saying the estimate out loud. Note a
  restart stops only n8n: the Railway job it abandons keeps rendering to the
  end and competes with the new one — there is no cancel endpoint, and
  `restart-service` is the only way to clear it.

  **Every per-second figure in this entry is ~20% pessimistic since
  2026-09-03**, when the composition dropped from 30 fps to the 24 the
  montage is encoded at: the same film is a quarter fewer frames to draw.
  Nothing needs changing — the poll ceilings and the site's
  `120 + 12 × length` estimate are both conservative in the safe
  direction — but do not re-derive a budget from these numbers without
  measuring first.
- **Every clip reaching ffmpeg's `concat` must declare square pixels
  (`setsar=1`), or the render dies at the join.** `concat` compares sample
  aspect ratio as exact integers, and `scale` preserves a source's oddity
  rather than squaring it — so a clip at SAR `12735:12736` or an undeclared
  `0:1` kills a render that is otherwise finished. Invisible until the NASA
  film (2026-09-15) became the first to MIX archive footage with Veo clips;
  before that every clip in a film shared one source and one SAR. One owner
  now, `coverFit()` in `remotion/server/assemble.mjs`, pinned by
  `npm run check:sar`. Full account: `docs/lessons-render.md`, "The first
  film to mix sources died at the join".
- **A status panel's ANSWER ORDER is load-bearing: a failure must outrank
  "still working".** `getAssemblyState` checked `upstream` before `failed`,
  so a Media Generation execution wedged since the previous evening made
  three dead renders read as "Nothing is stuck" for hours. Same file, same
  entry.
- **`Resource temporarily unavailable` from ffmpeg is a THREAD limit, not
  memory.** "Error while opening decoder for input stream #118:0" — the 60th
  h264 decoder of a 142-input assemble. Every decoder opens at start with
  the default thread count (one per core), so 71 clips × 8 threads, twice,
  ran into the container's `pthread_create` ceiling. `assemble.mjs` now
  passes `-threads 1` as an INPUT option before every `-i`; libx264 keeps its
  own pool, and eight-second clips do not need parallel decoding. Its
  `download()` also retries 503/429/5xx with a short back-off. n8n's error
  text shows only the command — the reason is in the `Check Render` output
  (`error`, ~100 kB) or in the job's status on Railway, never in the deploy
  log, which prints only the per-scene trim lines.
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
