# Lessons — n8n

Part of the split of the old monolithic `CLAUDE.md` (2026-09-13). Read the
root `CLAUDE.md` first — it has the index, the workflow ids, and a short
cross-cutting digest. This file is everything about **n8n as a platform**:
its own execution/draft/publish mechanics, the Airtable field-writing traps,
the audio/image gate wiring in Media Generation, and the full Airtable →
Postgres cutover (still the largest single piece of this file).

These each cost hours. Do not rediscover them.

### n8n

- **Executions are version-pinned.** A running execution keeps the workflow
  snapshot from when it started. Publishing a fix does *not* affect work
  already in flight — only new executions. When a fix "didn't work", check
  whether the execution predates it before assuming the fix is wrong.
  **This collides with the regenerate buttons, and the collision is silent.**
  Video regeneration has no webhook of its own: it is the batch's own job
  (`If Video Regen Pending` → … → `Submit Video Regen`), so while a batch is
  alive every regenerate click the producer makes is executed by whatever code
  that batch loaded, however old. On 2026-09-14 a night of prompt fixes was
  published against a batch that had started 57 minutes before the first of
  them; the producer regenerated, got a clip with the very artefacts the fixes
  removed, and reasonably reported that nothing had changed. Nothing in the
  site or in n8n says which version answered. **Before telling anyone a
  pipeline fix is live, check `search_executions` for a batch that predates it
  — and say so in the same breath.** The database half of a fix (a repaired
  stored prompt) DOES reach such a batch, because prompts are read fresh per
  submit; only node bodies are frozen. Full account:
  `db/port/motion-permanence/stale-execution/`.
- **`waiting` means alive, not idle.** Work paused in a Wait node reports as
  `waiting`. Polling loops spend most of their life there. Treating it as
  "nothing is running" produces duplicate concurrent executions.
- **But the instance accumulates zombies:** orchestrator parents stuck
  `waiting` with `waitTill` in the year 3000, for sub-workflows long dead.
  Counting those as alive breaks Pause/Resume permanently. `getAliveProduction()`
  in `platform/lib/n8n.ts` threads this needle: `running` always counts;
  `waiting` counts only for worker workflows with a genuinely near wake-up.
- **`execute_workflow` targets the first enabled webhook** in a workflow.
- **Two branches out of one node do NOT run at the same time.** n8n's v1
  execution order runs one branch to completion, then the other — measured,
  not assumed: two branches each holding a 5-second Wait took **10.0s** in
  total, the first finishing at +5.0s and the second at +10.0s. So "run the
  audio loop and the image loop in parallel" cannot be done by forking the
  canvas; inside one execution every arrangement is a different ORDER, never
  an overlap. Real concurrency needs separate executions — an `Execute
  Workflow` node with *wait for completion* switched off, or a webhook fired
  at another workflow. Worth knowing what that buys before paying for it: the
  audio stage is the cheap one (~1.2s of TTS per take plus its Drive upload),
  so overlapping it with images saves roughly the audio stage and nothing
  else, while the producer's first listenable take arrives at the same moment
  either way.
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
  `Upload*To Flow`, `Submit Video*`, `AB Submit Multi`, `VR Submit Multi`,
  `Generate Scene Image`, `Generate Cast Sheet`, `Generate Set Plate` and
  friends carry a literal `x-api-key` / `Authorization`. They work, but they
  live in the workflow JSON, so a rotation means editing nodes and any export
  leaks them.
- **The import also strips `parameters.operation` from Google Drive nodes**,
  leaving them with no resolvable action rather than an error. Every upload
  node needed `resource: file` + `operation: upload` re-set by hand, and
  `VR Find Audio Folder` needed `operation: search`.

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

**Every take was synthesized N times, N = the number of scenes in the pass,
and it was billed every time** (found 2026-09-01, active version `7f2c8353`).
`Refetch Scenes For Audio` is a Postgres node whose query reads the batch
from `$('Sort & Cap Scenes').all()` — but its INPUT is that same batch, N
items, and a Postgres node runs its query once per input item. N queries,
each returning all N scenes, gave `Sort Scenes For Audio` N copies of every
scene; `Loop Audio` walked every copy; `AB Speak` synthesized each line N
times in a row (a new Drive upload and a new `Voiceover URL` each time, the
last one winning). Since the audio-first reorder that was 8× on every film —
invisible, because the loop eventually moved on and the takes were right —
and with the cap at 200 it became 71× on the Vegas film: one line took eight
minutes, the producer read it as "blocked at voice on scene 32", and it
would have burned ~460k ElevenLabs characters against a 131k quota.
**How it was found**: `GET /v1/history` on ElevenLabs lists every request
with its text and timestamp — 71 identical rows seven seconds apart — and
execution 8981's `runData` showed `Loop Audio` emitting the same id eight
times. `Sort Scenes For Video` had always deduped by id, which is why the
video stage never showed it. Now `Refetch Scenes For Audio` is
`executeOnce` and `Sort Scenes For Audio` dedupes as well. **Any Postgres
node whose query ignores its input must be `executeOnce`**, or it runs once
per item — the n8n rule that `Fetch Scenes After Batch` already obeys.
When a stage is slow, check the provider's history before the workflow: a
bill is the one log nobody can forget to write.

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

## The database that replaces Airtable

Airtable cost 125 lei/month and has been retired. **This database is the source
of truth** — since 2026-08-15, 22:46 UTC the site and all five workflows read
and write it and nothing touches Airtable (see "The cutover happened" below).
Airtable itself is intact and frozen at that moment, and is the only rollback
there is; do not cancel the plan yet.

The sections that follow are written in the order the migration happened, so
several of them describe the parallel-run period rather than today. Where one
says "still", read it as history.

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
of* the button row. Each flag needed a hand-built escape hatch, and since
2026-09-16 all five have one (the table is in `CLAUDE.md`). The query stays
worth having: an exit only helps the producer who is looking at that scene,
and this finds the ones nobody opened. Every flag has a `*_at` timestamp, so
staleness is one rule for all of them, including ones added later:

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

It is set to `postgres` on the box today. The rule that governed the flip —
**never point the site at a backend the workflows are not writing**, or it
renders a frozen picture while n8n updates rows nobody reads — still governs
the way back: rolling the site to `airtable` means rolling the five workflows
with it, in the same window.

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

### A cleared text field is an empty string, not NULL (2026-09-03)

**Every cinematic film died at creation, and the site said "no record exists
in Airtable" over a database that has no Airtable in it.** The producer
tried twice in the morning and once in the evening (orchestrator executions
9558, 9559, 9690), each dead in under 100 ms at `Create Project in Airtable`:

    null value in column "voice_id" of relation "project" violates not-null constraint

The chain: `createProject` clears `voice_id` to `''` for a silent film
(nothing speaks — deliberate, see the Cinematic section); the orchestrator
sends `"Voice ID": ""`; `at_assign` turned every scalar into
`nullif($1 ->> k, '')::type` — a rule that exists so `''` never reaches
`''::integer` — and `project.voice_id` is `text not null default ''`. The
webhook then answered 200 with an EMPTY body (the Respond node never ran), so
the site's honest fallback fired. Airtable had swallowed the same `''` for
months; this is the constraint class the cutover section predicted, found on
the one category the cutover film never exercised.

`db/008_text_fields_keep_empty_string.sql` (first landed as `006` on 09-03,
then **overwritten on 09-04 by the trunk's `007_dedupe_at_assign.sql`**, which
redefined the same function from the pre-fix body — the producer hit the
identical error again on 09-06; `008` carries BOTH changes, and the lesson is
that two branches editing one function each re-apply the whole body, so the
later apply wins): for a TEXT column the value is
written as-is (`''` stays `''`, a JSON null still becomes NULL); the numeric,
boolean and date branch keeps the nullif. No reader can tell: the `at_*` views
already `nullif(…, '')` on the way OUT, and 37 projects already stored `''`
there. Applied live through a throwaway workflow (the n8n Postgres node
passes a literal `$1` through untouched — probed before sending a function
body full of them) and verified with a real `at_create` carrying
`"Voice ID": ""`, then deleted. Note for that kind of probe: a data-modifying
CTE cannot delete a row the same statement's function just inserted — same
snapshot — so create and delete are two executions.

The site's wording is fixed in `actions.ts` ("no record exists in the
database") on this branch; it is not deployed until the branch reaches the
trunk.

That refusal is also what makes the compat layer testable without the box, and
it is worth re-running after any change to either side. On a throwaway
Postgres 16, applying `001` + `002` + `003` and exercising the layer confirms
the behaviour the old Airtable traps make necessary: a numeric field sent as
`""` lands as **NULL, not 0** (the sixteen-node zeroing bug cannot reproduce
here), an attachment write raises, an unknown field raises, a link sent as
`[id]` becomes a real foreign key rather than JSON text in the column, and
`Editing Options` reads back as JSON *text* so the workflows' `JSON.parse()`
keeps working. Verified 2026-08-16.

The cheap static half of that is worth more than it looks: extract every field
name the ported nodes write and check it against `hov.airtable_field`. Because
an unmapped name RAISES, one missing row would kill a workflow mid-run at
cutover rather than degrade quietly. Measured across the five ported
workflows — 23 `at_write`/`at_create` nodes, 49 distinct (entity, field) pairs,
all mapped.

**One asymmetry to know about:** a linked record reads back as an array where
the column is a list (`"Capitol": ["rec…"]`) but as a bare string where it is a
single id (`"Project_ID": "rec…"`). Airtable always sent an array. No
expression indexes one today — checked — but `fields["Project_ID"][0]` would
silently yield `"r"` rather than an id.

The same throwaway-Postgres run is where a constraint like the one above gets
caught before a film does: applying the schema and replaying a node's real
payload is the only check that exercises the CHECKs, and it costs a minute.

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

**That last paragraph is true ONLY under the default query batching, and the
exception ate a feature on its first real use.** Set `options.queryBatching` to
`transaction` (or `independently`) and the node stops handing the SQL straight
to the driver: it goes through pg-promise WITH an empty values array, so every
`$` followed by a digit anywhere in the query text is read as a positional
parameter and the whole statement is refused —

    Variable $321 out of range. Parameters array length: 0

Dollar-quoting does not merely fail to help, it **manufactures** the hazard:
the closing `$` of `$hov$` in front of a value starting with a digit IS `$321`.
That is how the first producer-fired `hook-regen` died (execution 12490) on a
hook beat reading *"321 metres, standing in the Gulf"*. A leading digit is not
the only way in — `$1B` mid-sentence fails identically, and this pipeline
writes films about $1B hotels.

Measured both ways rather than reasoned about (execution 12511, four queries):
under default batching `$321`, `$1B` and `$5 million` all round-trip; under
`transaction` the first two are refused and only base64 survives. **So the 44
existing Postgres nodes are safe** — every one of them uses the default — and
the rule for a new one is:

- default batching → dollar-quote as above, unchanged;
- transaction batching → **no `$` may reach the query at all**. Encode each
  literal and let Postgres decode it:
  `convert_from(decode('<base64>','base64'),'UTF8')`, `::jsonb` on the end
  where a jsonb argument is wanted. Base64's alphabet has no `$` in it, so no
  data can form a placeholder. `HR Apply` in Hook Regen is the worked example.

Do not "fix" this by dropping the transaction. In `HR Commit` the transaction
is what deletes the old hook scenes and writes the new ones atomically, and on
the day it failed that is precisely what saved the film: every statement rolled
back and the stored hook was untouched.

**And a write that only the failing run can undo needs an error branch.** The
site sets `Editing Options.hookRegen` before firing and the run clears it, so
a dead run strands the spinner — the shape this file already names once per
regeneration. `HR Commit` is `continueErrorOutput` into `HR Release Flag`,
which clears the flag on its own (default batching, `executeOnce`), so a
refused rewrite now ends with the producer looking at buttons rather than at a
spinner with nothing behind it.

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

### Backups — and the part of them that lives outside this repo

`infra/hov-backup.sh` dumps the three things that cannot be rebuilt from git:
`hov` (the pipeline's state), the `n8n` database (workflows AND credentials —
credentials are encrypted per-instance and cannot be exported any other way),
and `/opt/n8n/media` (735 MB of images and clips that exist nowhere else — the
fal and Flow links they came from are long dead). Execution history is excluded
on purpose: 880 of that database's 894 MB, and it prunes itself after 14 days.
The media mirror is hard-linked against the previous night, so keeping three
days costs one copy.

**The cutover made this load-bearing.** Before it, a lost `hov` was an
inconvenience — Airtable held the truth and the import could be re-run. Now
Airtable is frozen at 2026-08-15, so everything written since exists in exactly
one place, and rolling back loses it (see "Rolling back"). The backup is the
only thing between a mistake and that loss.

**What is NOT in this repo is the schedule.** There is no cron entry, systemd
timer or compose service here that runs the script — whatever runs it lives on
the box. Two consequences: rebuilding the box from this repo silently produces
a machine with no backups, and nobody can tell from the repo whether it is
running at all. Before trusting it, check on the box:

    crontab -l | grep hov-backup ; ls -la /opt/n8n/backups

The script also protects against mistakes, not against the disk dying —
everything it writes is on the same disk. Off-box is Hetzner's own backup,
enabled in their console. Both, or neither is worth much.

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
   regenerate with `db/port/port-airtable-nodes.mjs`. Applied in the cutover
   window on 2026-08-15; a PUT is live immediately, which is why they went in
   all at once rather than being parked as drafts.
3. ~~Admin screens for the three hand-edited tables.~~ Done — `/admin`, on
   both backends.
4. Saved drafts on Postgres — see "Known gaps, live right now".
5. ~~Cutover.~~ Done 2026-08-15. A full film and a week before cancelling the
   Airtable plan; it is the only rollback there is.



### `addNode` through MCP does NOT carry a credential — 2026-09-13

`update_workflow`'s `addNode` accepts a `credentials` field, but a node
created from SDK code or from a plain `addNode` operation comes out with
none. For an httpRequest node using `authentication: predefinedCredentialType`
that is not a visible error: the node is valid, the workflow publishes, and
every call answers **401**.

That is worse than it sounds when the node is a judge. `Motion Judge` was
built so that any failure to get an answer KEEPS the clip — so an unbound
credential would have meant the motion judge silently passing every clip in
every film, looking exactly like a judge that never finds anything wrong.
**The failure mode of a well-designed fail-open component is silence**, so
bind the credential in the same breath as adding the node:

```
{type: 'setNodeCredential', nodeName: 'Motion Judge',
 credentialKey: 'openAiApi', credentialId: '…', credentialName: 'OpenAI account'}
```

Remember `setNodeCredential` applies **in place to the live version** — it is
the one edit that does not stage a draft (see the entry above) — so it takes
effect the moment it is sent, before any `publish_workflow`.

The tool result names this itself, in the line that is easy to skim past:
*"HTTP Request nodes (Motion Judge) were skipped during credential
auto-assignment. Their credentials must be configured manually."* Read it.

### The diff rule DOES work in a web session — via the overflow file

An earlier entry here (written the same day, now replaced) claimed
`db/port/lib/diff-workflow.mjs` was unusable on a large workflow from a Claude
Code web session, because `get_workflow_details` returns ~500 kB and writing it
back to disk would mean retyping all of it.

That was wrong, and the way out is a property of the harness rather than of
n8n: **a tool result too large for the context is written to a file, and the
error names the path.** So the sequence is

1. call `get_workflow_details` and let it overflow;
2. `python3` the named file into `db/port/<feature>/<Workflow>.original.json`;
3. make the edit through `update_workflow`;
4. call `get_workflow_details` again, save that as `…draft.json`;
5. `node db/port/lib/diff-workflow.mjs original.json draft.json --expect "A,B"`.

Done exactly this way on Claude Scripting (110 nodes, 489 kB) on 2026-09-13:
`✓ only the expected nodes differ`, `✓ connections identical`, `✓ no dangling
$('Node Name') references` — the full guard the convention asks for, with no
node body ever passing through the conversation.

The same trick reads an execution's node data without spending context on it,
which is how the motif diagnosis in `db/port/motif-rescue/` was made.

**What still cannot be done from a web session is WRITING a large node body.**
`update_workflow` needs the literal string in the call, so a node whose body is
18 kB of generated code can only be changed by transcribing it — which is a
real risk, not a nuisance, when that body is a validator every film depends on.
Read-and-diff is free; write is not.

### A strict output-parser schema turns one bad card into no cards

`Motif Parser` used `schemaType: fromJson` with an example holding five
differently-shaped cards. **`jsonSchemaExample` infers an array's item shape
from the FIRST element only**, so only the first card's keys were ever
allowed; `stops`, `rows`, `sides` and `steps` were absent from the generated
schema even though the example's own later cards used them. Every answer
carrying a route, compare or steps card was rejected **whole** — 14 films
wanted drawn cards in 30 days and exactly one got any.

Two lessons, both general:

- **`fromJson` cannot express a union.** If the thing you are parsing is one
  of several shapes, write the schema by hand (`schemaType: manual`,
  `inputSchema`) and keep it permissive. `$ref` is not supported there; inline
  the shared definitions.
- **Do not validate at the parser when you already validate downstream.** The
  strict schema was duplicating `Validate Motif Cards`, which refuses cards
  one at a time and says why. All the strictness bought was turning a reasoned
  refusal into silence.

And the fingerprint worth remembering: when the parser rejects the answer, the
agent (onError:continueRegularOutput) hands the next node `{error: …}`, so
`cards` reads as `[]` and the film is indistinguishable from one the model had
nothing to say about. **An empty result with an empty report means the answer
never arrived; a real refusal always leaves a reason.**

### `Submit Video Regen` reads `$json` — the regen path's shape

A trap worth knowing before inserting anything into the video gate's
regeneration chain. `Submit Video` reads `$('Current Scene')`; **`Submit
Video Regen` reads the item in front of it**, which is why both guards that
loop back into it (`Regen Cooldown Guard`, `Regen Resubmit Guard`) end with
`return [{ json: payload }]` — they exist partly to re-feed it.

So every node inserted between `Prep Video Regen` and that submit must pass
the whole payload through (`Object.assign({}, p, …)`, never a fresh object).
Getting it wrong is not subtle: the submit goes out with no model, no prompt
and no start image.

The corollary bit us in the design of the end frame there: anything a new
node *adds* to the payload is **lost on any loop back through a guard**,
because the guards re-feed `Prep Video Regen`'s original output. So a value
that must survive a cooldown or a resubmit has to be read back by node
reference with a scene-id guard (`$('RG Attach End Frame').first()`), exactly
as the batch path does — not off `$json`.

## Two entry points into one tail, without copying the tail (2026-09-17)

CLAUDE.md's restart-scripting rule — *"any third entry point needs its own
tail"* — is about a real mechanic: `$('Some Node')` throws when that node did
not execute on this path, so a tail whose nodes reach back to the first entry
point's head cannot be reached from a second one.

The rule names the symptom. `db/port/video-regen-webhook/` is the case where
treating the CAUSE was cheaper and safer than obeying the rule literally.
Adding `scene-video-regen` meant reaching a thirty-node `RG *` tail whose
nodes between them named three outside nodes. Copying thirty nodes would have
created a third copy of the motion judge's 700-word question and a sixth copy
of the world-consistency guardrail — precisely the "a prompt fragment lives in
more copies than the one you found" trap. Instead:

* ONE node in the tail (`Prep Video Regen`, its single entry) was made
  door-aware, with `try { $('X').isExecuted } catch` — an idiom Media
  Generation already used sixteen times — and it now carries the context it
  resolves (`opts`, `aspectRatio`, `viaWebhook`) in its output.
* The other three readers take that context off `Prep Video Regen`, which is
  inside the tail and therefore always executed.

Net: nine nodes added, four bodies edited, zero prompt duplication, and the
tail left with exactly one guarded outside reference instead of three
unguarded ones. **The rule still holds** — a fourth entry point must feed
`Prep Video Regen` — it is just cheaper to obey now. Where a tail's terminals
loop back into the first path (here `Wait Video Approval`, which reads
`$('Sort & Cap Scenes')`), each terminal needs a path switch, not a copy.

Two API traps found doing it, both documented in that README and the first in
CLAUDE.md's cross-cutting list:

* **`addConnection` accepts `sourceOutput: 1` and silently ignores it** — the
  key is `sourceIndex`, and with the wrong one every edge lands on output 0,
  putting BOTH branches of an If on `true`. It validates clean. The only thing
  that caught it was diffing the published draft against an offline simulation
  of the same operations, edge for edge.
* **`updateNodeParameters` merges rather than replaces.** Useful: a node whose
  other parameters hold an unredacted API token can be edited by sending only
  the key that changed. `addNode`, by contrast, drops node-level settings like
  `alwaysOutputData` — set those with `setNodeSettings` and read them back.

### A typed trigger is a filter — 2026-09-18

`Receive Project Data`, the `executeWorkflowTrigger` at the top of Claude
Scripting, declares eight workflow inputs:

```
Project_ID, Tema, Tonalitate, Pace, Lenght, Language, Style, Lore
```

**That declaration is a filter, not documentation.** The parent orchestrator
sends the whole Airtable-shaped project record — `{id, createdTime, fields:{…,
"Editing Options": "…"}, Project_ID, Tema, …}` — and you can SEE all of it in
the execution's `nodeExecutionStack`, because that is what arrived. What the
node emits is the eight declared keys and nothing else.

Deep Search's Documentary gate read the category out of
`$('Receive Project Data').first().json.fields['Editing Options']`. There is no
`fields` on that node's output. Every documentary skipped as `no-mode` for four
hours, including the producer's own film, which reached its script gate with a
red light and a script that contradicted itself about the date it was built on.

**Three things made the wrong node look right, and each is the transferable
part:**

1. **The execution data showed the object.** Reading `get_execution` for the
   trigger returns the stack entry — the INPUT waiting to be processed. It is
   not the output. `runData` is what would have proved it, and `runData` is
   empty for a running execution and, as it turns out, for a cancelled one too.
2. **A sibling reference worked.** `FC Save Report` reads
   `$('Receive Project Data').first().json.Project_ID` and has always worked,
   because `Project_ID` is one of the declared eight. **One field resolving is
   not evidence that the object is there** — it is evidence that one field is.
3. **Nothing complained.** The read was inside a `try` whose `catch` recorded
   "mode could not be read", which was the honest outcome and also completely
   invisible, because the skip branch bypassed the node that writes the report.

**The node that actually carries the project row is `Fetch Project Record`**,
and `Voice Mode` has read `(($('Fetch Project Record').first().json||{}).fields
||{})['Editing Options']` since the kids styles landed. The rule that would
have saved the day: **when a workflow already answers a question somewhere,
copy that node's reference rather than inventing one.** A grep of
`db/port/*/paste/` for `category` finds Voice Mode in one second.

**And the reason it took a producer to notice**: the only end-to-end run that
ever verified Deep Search (execution 14771, 15:00) ran on the version BEFORE
the gate was published at 15:18. The gate's own first real film was the
producer's. **A change published after the run that verified it is unverified**,
however small it looks — and "I verified this feature" is not the same claim as
"I verified this version of it".
