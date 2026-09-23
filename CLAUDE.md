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
be approved, edited, or retried. **Every one of the five now carries its own
way out**, a re-send and a keep-what-exists, and they are deliberately worded
the same so the pair is recognisable wherever it appears:

| Flag | Where the pair lives | Actions |
|---|---|---|
| scene text (`Regenerare Text`) | `SceneReview` | `restartSceneRewrite` / `cancelSceneRewrite` |
| `Regenerează Imagine` | `SceneBoard` (Images step) | `restartImageRegen` / `cancelImageRegen` |
| `Regenerează Voce` | `AudioReview` | `restartVoiceRegen` / `cancelVoiceRegen` |
| `Regenerează Video` | `SceneBoard` (Video step) | `restartVideoRegen` / `cancelVideoRegen` |
| `hookRegen` (Editing Options) | `HookPanel`, on whatever step is open | `regenerateHook` / `cancelHookRegen` |

The last two of those (image, voice) landed 2026-09-16; before that the two
states were dead ends. **Cancel never restores an approval** — it clears the
in-flight flag and hands the scene back to review, because whether the asset
that survived is good enough is the producer's call, not the button's.
**When you add a state whose exit is written by someone else, give it a
local exit too** — and see `docs/lessons-site.md` for the second half of the
rule, that the exit has to be on screen at the moment it is needed.

There is also an inactive legacy `2. Scripting Sub-Workflow`
(`5YWpycnnL6OaDWIx`) — superseded by Claude Scripting, referenced by nothing.
Leave it alone or archive it; do not repoint anything at it.

Webhooks the site calls: `new-project`, `resume-project`, `restart-scripting`
(all three on the Master Orchestrator), `scene-text-regen`,
`scene-image-regen`, `scene-voice-regen` (all three on Claude Scripting),
`scene-video-regen` (on **Media Generation** — the odd one out, because the
`RG *` tail it runs lives there; it is also the only webhook that answers
`onReceived` rather than at the end of the run, since a Veo generation
outlives the site's 15-second fetch), `assemble`, and the single-purpose ones — `expand-brief`, `yt-scene-titles`,
`upscale-film`, `list-music`/`share-music`, `archive-suggest`, `hook-regen`,
`series-recap` (its own workflow `4jVkQjpr7terqQhY`, fired by `approveScript`
for an episode of a series — `db/port/series-recap/`), `series-next`
(`f3iV6hx39rSr0Dbx`, the brief's "Suggest episode N" button —
`db/port/series-next/`), `deep-search-rerun`
(on **Claude Scripting**, the "⟳ Re-check this script" button above the script
gate — nine `DS *` nodes that re-check the FINISHED script including the hook;
answers `onReceived` because the run outlives the site's 15-second fetch —
`db/port/deep-search-rerun/`), `sheet-backfill`
(workflow `IGWjknKcffnGlOmV`, fired by the series page's "Bring the pictures
back" — `db/port/sheet-backfill/`; it is the one webhook the site WAITS on,
because the count it reports is taken from the database after n8n is done). The site derives all of them from `N8N_NEW_PROJECT_WEBHOOK_URL`
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
  **CLAUDE SCRIPTING BELONGS IN THAT LIST TOO** (measured 2026-09-19): it makes
  **15 HTTP calls into the site container**, and five of them are on the main
  writing path, not just the regen tails — `Fetch Genre Profile`, `Fetch
  Project Record`, `Load Project Bible`, `Load Scene`, `Save Evidence` (the
  other ten are the `IR *` / `VR *` / rewrite tails). A `platform/**` deploy
  restarts `web` for about a minute, so a film that is mid-script can lose a
  node to a connection refused and die with the script half written. The rule
  as written names only the two render workflows, which reads as permission to
  deploy over a scripting run. It is not. List them with:
  `jq -r '.workflow.nodes[] | select((.parameters|tostring) | test("house-of-videos|/api/at")) | .name'`
  over a saved `get_workflow_details` dump.
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
- **An n8n MCP `addConnection` accepts `sourceOutput: 1` and silently ignores
  it — the key is `sourceIndex`.** Every edge then lands on output 0, which on
  an If node fires BOTH branches on `true`, and nothing complains: the
  workflow validates clean. Caught on 2026-09-17 only by diffing the published
  draft against a simulated one edge for edge. Never trust a branch index you
  did not read back. (`from`/`to`/`fromOutput` is rejected outright, so that
  spelling is safe.) Related, and in the other direction:
  `updateNodeParameters` MERGES rather than replaces, which is what lets one
  key be edited without re-sending a node's unredacted API tokens. Full
  account: `db/port/video-regen-webhook/README.md`.
- **A scene preview is TWO media elements, and only one of them is local.**
  Clips and stills are kept on the box by `/api/media/ingest`; VOICEOVERS
  never were (`hov.attachment` has no audio field), so they come from Google
  Drive at 593-1383 ms a range against 25 ms for a local file. Anything that
  "corrects" audio/video drift on a timer will therefore seek a stalling
  source four times a second and block playback outright — which is what made
  scene review unusable on 2026-09-20. `MediaPlayer` nudges `playbackRate`
  instead of seeking, which is the whole of the fix that worked. A disk cache
  in `/api/media` was tried the same day, broke the final video twice, turned
  out never to have written a single byte, and was withdrawn — **and it left
  browsers poisoned with a year-long `immutable` header, which is why
  `mediaSrc` now carries `&v=2`. Never send `immutable` from a route that can
  answer with a partial or an error.** Full account:
  `db/port/scene-lag/README.md`; lesson in `docs/lessons-site.md`.
- **A pipeline fix does not reach a batch that is already running, and the
  regenerate buttons hide that.** Executions are version-pinned, so a producer
  clicking "regenerate" during a 12-hour-old batch is served 12-hour-old code
  and is given no sign of it — which looks exactly like "your fix did not
  work". Repaired STORED PROMPTS do reach it (read fresh per submit); node
  bodies do not. Check `search_executions` before claiming a fix is live.
  Full account: `db/port/motion-permanence/stale-execution/` and
  `docs/lessons-n8n.md`.
  **One clause of that entry has been out of date since 2026-09-17**: it said
  video regen "is the batch's own job, not a webhook". It has `scene-video-regen`
  now (`db/port/video-regen-webhook/`), so a video regeneration runs on its own
  execution and therefore on the CURRENTLY PUBLISHED version — it is the one
  regenerate button the stale-batch trap no longer applies to. The trap is
  entirely real for everything still inside the batch.
- **`runData` is EMPTY for the whole life of a healthy running execution.**
  You cannot watch progress through the API — wait for it to end.
  `docs/lessons-n8n.md`, "n8n" section.
- **Any MCP edit to a live node must be diffed against the version you built
  on, node by node, confirming the ONLY entry that differs is yours** — use
  `db/port/lib/diff-workflow.mjs` rather than ad hoc python/jq. See
  `db/port/lib/README.md`. **Feed it the workflow object, not the tool's
  output**: `get_workflow_details` wraps it as `{workflow: …}`, and handed the
  raw file the differ reads `before 0 nodes → after 0 nodes, changed 0` and
  still prints `RESULT: OK`, plus a cheerful "only the expected nodes differ".
  A pass over nothing looks exactly like a pass. Pipe both sides through
  `jq '.workflow'` first and check the node count is not zero before believing
  the verdict (2026-09-18, `db/port/watermark-open-once/`).
- **Never write a prompt instruction as a negation.** Google's Veo guidance is
  explicit that "no walls" / "don't show walls" makes the model render walls;
  what is unwanted belongs in a bare comma-separated NOUN LIST. This pipeline
  produced a clip where a held object vanished and a table duplicated because
  our own tail said "nobody and nothing appears, disappears or duplicates".
  Same for props: "the swinging door" is an instruction to animate the door.
  Full account: `docs/lessons-pipeline.md`, "A prompt that names a failure
  summons it".
- **A length in a prompt is obeyed or ignored according to how it is PHRASED,
  not according to the number.** "At most 80 words" produced 92 and 97; the same
  budget written as a rule — length named as a rule, the model asked to count
  its draft before answering, and the consequence stated — produced 73, 75, 80,
  71, 76, 72 across a 1.4 KB kids episode and the 11.4 KB Burj Al Arab
  documentary. All three parts are load-bearing; the version missing one went
  over. So when a length matters, measure the wording rather than lowering the
  number, and keep a net under it that cuts at a SENTENCE boundary (a half
  sentence still reads like a recap — the silent failure). `node
  db/port/series-recap/check.mjs`, in `npm run check`. Full account:
  `docs/lessons-pipeline.md`, "A word cap is obeyed or ignored according to how
  it is PHRASED".
- **A prompt fragment always lives in more copies than the one you found.** The
  motion-prompt tail lived in seven places across three workflows; a fix that
  touched two was reported as done and shipped half-broken. Before calling a
  prompt change complete, grep EVERY workflow JSON for a distinctive phrase from
  the text you replaced — **and grep `db/port/*/paste/` too**, which is how the
  FIFTH copy of the ambient-motion rule (`VP Rewrite AI`, Media Generation) was
  found on 2026-09-15 after a grep of the two obvious workflows missed it. The
  rule lives in `Segment Chapter Into Scenes`, `Rewrite Scene Text`, `Rewrite
  Scene Standalone` (Claude Scripting), `HR Shots Prompt` (Hook Regen) and
  `VP Rewrite AI` (Media Generation).
  **Deep Search's judge is the newest member of this family, since
  2026-09-19**: `FC Judge` and `DS Judge` carry the SAME 11 KB prompt, as do
  `FC Source` and `DS Source`, because the re-run chain emits its payload under
  `fc` precisely so the prompts can be shared byte for byte. One file,
  `db/port/fact-check/paste/FC Judge.txt`, two live nodes — **re-paste both or
  the button silently checks films by last week's rules.** Guardrails are cheapest composed at submit
  time, where one node owns them, rather than stored in the database where
  changing them means a backfill. The same rule now covers a TABLE: the
  eight kids style prefixes (`KIDS_STYLES`) live in `Voice Mode` (Claude
  Scripting), `Cast Sheet Prep` and `Set Plate Prep` (Media Generation) —
  change one, change all three, and run `node db/port/sheet-style/check.mjs`.
- **An `Execute Workflow Trigger` with typed inputs emits ONLY those fields,
  and one of them resolving is not evidence the rest are there.** Claude
  Scripting's `Receive Project Data` declares eight — `Project_ID`, `Tema`,
  `Tonalitate`, `Pace`, `Lenght`, `Language`, `Style`, `Lore` — so the project
  ROW is not on it, however plainly the parent's payload shows `fields` in the
  execution's stack (that is the INPUT; the node filters it). Deep Search read
  `$('Receive Project Data').first().json.fields['Editing Options']` for four
  hours on 2026-09-18 and got undefined on every film, while
  `FC Save Report`'s `$('Receive Project Data').first().json.Project_ID` kept
  working — because that one IS declared. **The node that carries the project
  row is `Fetch Project Record`**, which is what `Voice Mode` has always read.
  The general rule: **when a workflow already answers a question somewhere,
  copy THAT node's reference instead of inventing one**, and when a `$('…')`
  read comes back empty, check what the node DECLARES before assuming the data
  shape. Full account: `docs/lessons-n8n.md`, "A typed trigger is a filter".
- **A branch that skips work must still write its record, or silence means two
  things at once.** Deep Search's gate sent skipped films straight past the
  report writer, so "no row" meant both "this was a Story film" and "the chain
  is dead" — which are exactly the two the producer's red light exists to tell
  apart. Every film gets a row now. **Any status a human is meant to act on
  needs its negative case recorded, not merely not-recorded.**
- **`category` is a REQUEST, not a description of the film.** `story` is the
  site's DEFAULT, so genuine documentaries carry it — of eleven researched
  films only three say `documentary`, and the Burj Al Arab, Peking to Paris and
  Tupac films are all filed as `story`. So never use it to infer what a film
  IS. Deep Search nevertheless gates on it, because the producer's instruction
  was that it is a feature OF Documentary mode: reading it as "this producer
  asked for the documentary treatment" is sound, reading it as "this film is
  factual" is not. Full account: `docs/lessons-pipeline.md`, "The script is
  checked against its own research".
  **The source watermark is the SECOND gate to do this** (2026-09-19,
  Final Assembly `309157bd`): source labels are a Documentary feature now,
  on the same reading — the producer asked for a label that distinguishes
  sources, and every other category is wall-to-wall AI, so the badge drew
  one continuous `AI GENERATED` pill that distinguished nothing. They were
  shown this rule and the 3-of-11 count and chose it anyway, so it is a
  decision. What makes it survivable is that it is NOT silent: the row is
  dropped on the brief (where the category control is two rows up) and
  Final touches prints "No source labels on this film" with the category it
  was filed as, so a documentary filed as Story is caught before the render
  rather than after it. The licence credit is untouched — an obligation, and
  no category reaches it. Full account `db/port/watermark-open-once/README.md`,
  pinned by `node db/port/watermark-open-once/check.mjs`. **If a documentary
  ever does ship unlabelled because of this, the fix is not to widen the
  category list — it is to gate on whether the film MIXES kinds of source,
  which needs no category at all.**
- **A button has to GO somewhere, and nothing tells you when one stops.**
  Two of them had: the chime's toast and system notification did nothing at
  all on click, and the library hero's "Everything waiting on me" pointed at
  `/projects?filter=wait` while the grid kept its tab in `useState("all")`
  and read no param — a link to the page it was already on, with a query
  string nobody consumed. Destinations now have one owner each
  (`platform/lib/deep-link.ts` for the gate→step map and `?scene=`,
  `platform/lib/library-filters.ts` for `?filter=`, `platform/lib/nav.ts` for
  the sections in the bar), and `npm run check:deeplink` pins all of them:
  every link names a real key, and the reader is still there. **The third one
  was added 2026-09-21 for the same failure one level up**: the bar wrote its
  links out by hand while `NavMenu` kept a list, the two disagreed, and
  `/series` was unreachable on a laptop for five days — the producer's
  "very hard to find" was literally "there is no link". The same edit killed a
  `className="navlink on"` LITERAL that made Projects the current section on
  every page of the site. Full account: `docs/lessons-site.md`, "A
  notification that says what happened but does not GO there", "A link to
  the page you are already on" and "A section nobody can reach does not
  exist".
- **Editing Options fields are refuse-then-clamp, never silently coerced** —
  the `normalize*` family in `platform/lib/data/derive.ts`, fixture-tested by
  `npm run check:normalize`. A value stored by the site, read by n8n and
  interpreted by the render must have its normalize rule agree in every copy
  — several fields keep 3-4 copies in lockstep on purpose.
- **A numeric Airtable field left mapped with no value writes a literal `0`,
  not nothing.** Killed scene ordering and project length more than once.
  `docs/lessons-n8n.md`, "Airtable" section.
- **A Claude Code web session reaches GitHub and nothing else.** Anything
  that needs `wf7.house-of-videos.com`, the site, an external API or a real
  render must be done through the n8n MCP connector, a throwaway workflow, or
  Railway's own tools — never a direct `fetch()`/`curl` from this
  environment. `api.github.com` answers normally, and so does the npm
  registry (measured 2026-09-23, `registry.npmjs.org` 200) — which is what
  makes it possible to run the SITE against a real Postgres engine from a web
  session: `db/port/lib/local-pg.mjs` (PGlite with the repo's own migrations,
  served over the wire protocol). See `db/port/lib/README.md`.
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
- **Each category owns the tone its films are written in** (2026-09-19):
  `defaultTone` on every entry in `platform/lib/categories.ts` — Story →
  **Epic**, Documentary → **Documentary**, Cinematic → **Cinematic**, Kids
  story → **Childish**. The brief lights that chip the moment the category is
  chosen (the same contract `narratorVoice` has: a visible selection, never a
  hidden default), and one click on any chip makes the row the producer's for
  good — an explicit `toneTouched` flag, because "is it still the default?"
  cannot tell a deliberate *Epic* on a Story film from an untouched one. The
  field is REQUIRED and typed against `lib/tones.ts`, the one owner of the
  twelve names, so a new category cannot forget it and a misspelling is a
  build error. **That matters because a tone with no `hov.genre_profile` row
  is written with Scripting's DOCUMENTARY fallback silently** — no error, no
  log line — so adding a tone means inserting its profile first
  (`db/port/childish-tone/` is the worked example) and re-measuring the date
  recorded in `lib/tones.ts`. `npm run check:tones`; full account
  `docs/lessons-site.md`, "The tone is part of what kind of film it is".

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

**A GitHub Actions run status read from a web session can be served STALE for
a quarter of an hour, and it looks exactly like a slow build.** On 2026-09-23
run 179 finished at 12:18:25; `actions_get` and `actions_list` both kept
answering `status: "in_progress"` with "Build and push" still running until
about 12:35, and a session sat waiting on it and told the producer the deploy
was still going twenty minutes after it had succeeded. **The tell is
`updated_at`**: it stayed frozen at `12:16:13` across every poll, which a
genuinely advancing run's does not. So when a run looks stuck, check whether
its `updated_at` has moved at all before believing the status — an unchanged
timestamp means you are reading a cache, not a build. Poll less often and read
the STEP timestamps, which are authoritative the moment they appear.

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

- **Playlists exist on the projects page since 2026-09-23**
  (`db/port/playlists/README.md`; lessons in `docs/lessons-site.md` under
  "Playlists — the library, organised by the producer"). A playlist row above
  the library toolbar — one chip per playlist, "+ New playlist", Rename,
  Delete playlist — filled with the existing ☑ Select ("+ Add to playlist",
  "− Remove from …" with Undo); a film can be in any number of them, and
  everything below the row counts inside the chosen one (`?playlist=<id>`).
  **`db/013` is applied on the live database** (execution 16435: two tables,
  both keys cascading — deleting a playlist never deletes a film). **Not in
  `project.tags`**: that is n8n's Airtable-compat field. Verified end to end
  against a real Postgres engine in Chromium (`db/port/lib/local-pg.mjs` +
  `db/port/playlists/browser/`), pinned by `npm run check:playlists` (38).
  **What is owed**: the producer's first real playlist. **Noticed, not
  changed**: the library toolbar sticks at `top: 10px` UNDER a nav that ends
  at 72px, so once scrolled it is hidden except a wrapped second row —
  pre-existing; `top: 84px` is the likely fix and the producer's call.
- **Deep Search is live; what is owed is a film somebody keeps**
  (2026-09-18, Claude Scripting `b927a298`; full account
  `db/port/fact-check/README.md`, lessons in `docs/lessons-pipeline.md` under
  "The script is checked against its own research" and `docs/lessons-site.md`
  under "Deep Search — a warning with no button"). **Documentary mode only**,
  by the producer's instruction. Thirteen nodes between `If Narration Retry`[1]
  and `Combine Chapters` read the narration against the film's own research
  pack, look up what the pack does not cover, rewrite what nothing can back,
  and write `hov.fact_check` for the panel above the script gate and the
  Settings card. **The feature is called Deep Search; the nodes are `FC *` and
  the table is `hov.fact_check`** — the mapping is FC = Deep Search, and it
  stays that way because renaming thirteen live nodes means rewriting every
  `$('FC …')` reference between them. It was
  exercised end to end on the Burj Al Arab film's real narration and pack
  through a throwaway (execution 14764: 47 statements, 16 looked up, 8
  corrected, 0 left flagged, rewrite accepted, every chapter within a few words
  of its length), and `node scripts/check-fact-check.mjs` holds 60 assertions
  over the committed node bodies including every refusal branch. It has also
  run for real: execution 14771, a whole pipeline fired at `new-project` for
  the disposable film `rec4ZIQVVxXZcS5no`, wrote `{checked: 18, flagged: 1,
  searched: 5, rewritten: 1}` into `hov.fact_check` and then went on to write
  its script and park at the gate — which is the only proof available from a
  web session that the LIVE node bodies match the repo, since n8n's own tables
  are in a different database from `hov` and a session here has no API key, so
  `diff-workflow.mjs` cannot be run on a 123-node workflow. **What is owed is
  the same on a film somebody intends to keep, with the corrected sentences
  READ as prose rather than counted** — the length checks pass by
  construction, and nobody has yet judged whether a correction reads as well
  as the sentence it replaced. The escape hatch if a film goes wrong: publish
  `b9f95221`, the version this was built on; the chain is purely additive.

  **It shipped broken for four hours on its first evening and the producer
  found it, not a check.** The Documentary gate published at 15:18 read the
  category from `$('Receive Project Data')` — the typed sub-workflow trigger,
  which emits only its eight declared fields — so it was `undefined` on every
  film and every documentary skipped as `no-mode`. And the skip branch went
  straight past `FC Save Report`, so there was no row to say so: the
  producer's own Google Maps film reached its script gate showing red with no
  explanation, on a script whose hook said April and whose first chapter said
  October. Both are fixed in `b927a298` — the category comes off
  `Fetch Project Record` (what `Voice Mode` has always read), and
  `FC Run?`[false] now runs through `FC Apply`, so **every film writes a row
  and an absent row now means the chain genuinely did not run**. Verified on a
  real documentary: `{category: "documentary", checked: 15, searched: 9,
  flagged: 1, rewritten: 1}`.

  **The process lesson is the expensive one**: the only end-to-end run that
  ever verified Deep Search finished at 15:00, eighteen minutes BEFORE the gate
  was published. It was reported verified when what had been verified was the
  version before it. **A change published after the run that verified it is
  unverified**, and it is worth re-reading that sentence before writing "live
  and verified" about anything here.

  **The judge rules on one ASSERTION at a time since 2026-09-19 09:37**
  (`63d21d49`, `db/port/fact-check/README.md` §5, lesson in
  `docs/lessons-pipeline.md` under "A sentence is only as sound as its weakest
  clause"). The producer read a post-Deep-Search script against ChatGPT and
  found four things through it; all four were one fault — **the judge was
  asked for a verdict per SENTENCE, and a documentary sentence is almost never
  one assertion**, so a source for the half it was mostly about carried the
  half nothing backed. It now returns one finding per assertion, repeating the
  `quote`, with `claim` as what distinguishes them; on the producer's own
  narration that is 26 findings across 13 sentences where it was 15, and all
  four misses come back unsupported (execution 15034). Two consequences worth
  carrying past this feature. **A closed-book checker inherits its pack's
  errors**: the ZipDash chronology was not missed but checked, against a claim
  that itself said "after buying Where 2 and Keyhole" — so the judge now
  refuses to take ORDER from a claim's prose and takes it only from dates,
  which routes it to a live lookup. And **a ratio measured over units a prompt
  defines is not a threshold**: doubling the findings silently moved
  `FC Resolve`'s overwhelmed backstop, its fix list and `FC Apply`'s
  `rewritten`, all three of which now count distinct sentences.
  **What is owed**: `Extract Claims` still writes relative order ("after") as
  if it were sourced — claims should carry dates.

  **Two more holes are closed, LIVE as `3d1834f1` since 2026-09-19 11:14**
  (`db/port/fact-check/README.md` §6, verified in execution 15071 BEFORE the
  publish and on a real film after). The producer's next Google Maps documentary came back cleaner but
  with ZipDash still wrong, and the reason is new: the writer had ATTRIBUTED
  the ordering ("according to the same report"), so the assertion the judge
  extracted was a claim about what a report SAYS — which is true — and "dates
  settle order" never fired. **Attribution laundered the chronology**, and the
  source it launders through is a real one: the 2020 U.S. House Judiciary
  report itself carries the wrong order. The repo now has the judge ruling on
  both the attribution AND the underlying fact whenever that fact is one
  another source could check (narrowly: a party's claim about ITSELF stays one
  claim), and the rewrite forbidden from repairing an ordering by attributing
  it. The same film also said "early 2003" and "In 2004" for one founding,
  three sentences apart, and the second sentence produced no finding at all —
  so the judge is now asked to check **the narration against itself**, which
  nothing in the chain could do before and which is the same fault as the very
  first red-light film (hook said April, chapter one said October).
  **The 09-18 lesson was applied rather than described**: this sat committed
  and unpublished for an hour while the OpenAI account was empty, because a
  prompt change nobody has run is not one to publish; execution 15071 then ran
  it against the real narration, both rules fired, and it went live after
  that. The ZipDash sentence now returns three findings — the attribution
  still `supported` on E16, and the chronology as its own `unsupported` one.

  **THE HOOK HAS NEVER BEEN FACT-CHECKED, ON ANY FILM** (found 2026-09-19,
  `db/port/fact-check/README.md` §7 — read it before touching this chain).
  `Generate Hook` runs AFTER the whole Deep Search chain
  (`FC Done → Combine Chapters → Generate Hook`), so the hook does not exist
  when the judge reads the narration and `FC Prep` cannot include it. The
  producer's third Google Maps film opened on *"Lars Rasmussen faced a
  deadline in 2003"* — an invention with no support anywhere in the script or
  its pack — while all 9 checked sentences came from chapter 1. **This also
  re-explains the first red-lit film's "hook said April, chapter one said
  October"**, which was filed under the gate bug and was actually this.
  The judge is fine: fed the hook, it catches the line instantly (15089).
  What shipped is a CONSTRAINT, not a check — `Generate Hook` rule 3b forbids
  stating any date, number, name or event the narration does not — and a
  constraint is not a check. **§8 is the same shape**: nothing re-reads what
  the REWRITE produced, so it can introduce an unsourced claim, half-fix a
  contradiction, or create a new internal one, all of which happened on that
  film. **One re-run of `FC Judge` over the FINISHED narration, after the
  rewrite and after the hook, closes both** — that is the next piece of work
  here, and it was deliberately not rushed in as the fourth publish of a day
  the producer was making films through.

  **That next piece exists now: "⟳ Re-check this script"**, Claude Scripting
  `6d7e0079`, webhook `deep-search-rerun`, full account
  `db/port/deep-search-rerun/README.md`. Thirteen `DS *` nodes on their own
  canvas row read `hov.script.content` — the finished text, hook included,
  corrections applied — rebuild the pack from `hov.evidence`, re-run the judge
  and the live lookup over it, **and correct what nothing can back**. The
  report replaces the row and carries `rerun: true` / `scope: "final"`, which
  is what makes the panel say "Re-checked at HH:MM" and name the hook.
  **Two design notes that will bite**: `DS Prep` emits under `fc`
  so `DS Judge` / `DS Source` take the FC prompts BYTE FOR BYTE, which means
  **the judge prompt now lives in two live nodes and both must be re-pasted
  together**; and the webhook answers `onReceived`, so the button does not
  change the numbers on screen — the timestamp is how the producer tells the
  new report from the old one, and the site polls for it.

  **It shipped report-only and the producer overruled that the same evening**
  (*"cand da recheck ar trebui sa si schimbe ce e gresit/unsupported"*). The
  reasoning for abstaining was not wrong about the hazard — editing text under
  someone who is reading it — only about who prices it; what it identified is
  now enforced mechanically instead: `supported` is never touched, the
  overwhelmed backstop stands, `DS Apply` refuses six shapes of bad rewrite,
  and **past the script gate it reports and refuses to edit** (`DS Load` counts
  the scenes; a non-zero count sets `frozen`, because by then the scenes carry
  their own copy of every line and their own recordings).
  **The hook is written in BOTH places or neither** — `hov.script.content` and
  `editing_options.hookPlan.beats`, one statement, since the beats are what the
  render speaks.
  **Verified on the producer's own Google Maps film**, four presses in a row,
  each reading what the last one wrote: flagged **3 → 2 → 1 → 0**, and the
  fourth pass wrote `script_rows 0, hook_rows 0` — the reassembly round-trips
  to identical bytes, so a clean re-check costs one judge call and no writes.
  The first press corrected exactly the three things the producer's reader had
  rejected: the invented hook line (now *"In 2003, Google Labs launched 'Search
  by Location.'"*, in both copies), the over-universal scope claim and the
  counterfactual.
  **Two failures worth carrying**, both invisible in the diff and caught only
  by running it: `editing_options` is `jsonb` so the decode needs `::jsonb`,
  and the refusal took the corrected script down with it because they share one
  statement; and **inserting `DS Write` between `DS Apply` and `DS Save`
  replaced the payload** — a Postgres node mid-chain replaces `$json` exactly
  as an agent does, which this repo knew about agents and had not generalised.
  It died as *"invalid base64 end sequence"*, having written the correction and
  not the report that described it.

  **AND THEN IT WROTE THE SAME SENTENCE FOUR TIMES.** The producer's reader
  found it the same evening: every fact sourced, one of them stated four times
  over. **This chain made them** — the rewrite is told to keep each chapter's
  length and to use only the claims, and is never shown what the narration
  already says, so each press replaced an unsourced sentence with the
  best-sourced fact available, which was the one the sentence before it already
  carried. The convergence reported above as 3 → 2 → 1 → 0 was measuring the
  factual axis while the editorial one got worse every pass. Live as
  `dfc81d23`: the rewrite may not restate what the narration says, the judge
  has a fourth verdict `redundant`, `FC Resolve` orders such a sentence CUT,
  and `FC Apply` subtracts the cut words before its length guard measures.
  Verified on that film (15228, 15231) — two presses removed all four copies,
  including one where the judge correctly split an attributed sentence into its
  attribution (`supported`) and its underlying fact (`redundant`).
  ~~**THE BILL IS UNPAID: chapter 1 went from 185 words to 101, a 45% cut, and
  nothing measures that.**~~ **Paid, 2026-09-23.** The bill was real — the guard
  was per press and per chapter, so two presses at a quarter each passed
  individually and halved the chapter together, and that film also lost its
  closing bookend, cut as a repeat of the hook, which is what a bookend IS.
  Both are closed: `DS Load` fetches `length_seconds`, `DS Prep` re-derives
  `Narration Guard`'s own arithmetic from it, and `DS Resolve` spends a budget
  of `bodyWords − minWords` measured against the script AS IT NOW STANDS, so
  the button is idempotent in length across any number of presses; the closing
  line and the hook are spared in the prompt AND again in code. **No floor
  means no limit, not a limit of zero** — failing closed there would switch the
  whole feature off silently and look exactly like a judge that found nothing.

  **AND THE SAFETY VALVE WAS REFUSING THE CORRECT FIX** (2026-09-23,
  `7a865309`, `db/port/fact-check/README.md` §10). The producer's Google Maps
  film reached them with five unsourceable statements in it while the row said
  `refused: "chapter 1 went from 178 to 128 words"` — the judge found them, the
  rewrite cut them, and `FC Apply` threw the whole correction away for being
  28% shorter. **This project had already decided that question**:
  `Narration Guard` settled on 2026-09-13 that the length is a CEILING and a
  film shorter than ordered is correct. The valve was re-deriving a
  project-wide rule instead of reading it, and drifted from it invisibly until
  it refused something right — which looks like the checker being wrong.
  The band is one-sided now in both copies: **growth past a fifth refused,
  losing more than HALF a chapter refused as a re-telling, everything between
  accepted**, and a corrected narration that lands under the floor writes
  `short: {words, min}` into the report — never a refusal, a statement that the
  research does not cover the running time ordered. The general rule worth
  carrying: **a guard that re-derives a decision another node owns will drift
  from it, and the drift only shows when it rejects something correct.**

  **The judge rules on the RELATIONSHIP a sentence asserts, not only its nouns
  and dates** (same publish). *"Inside Google, the Sydney software gained the
  scale it had lacked"* passed `supported` while the judge's own `claim` field
  read "gained scale it had previously lacked" and its `reason` justified only
  the half after the comma — so the prompt now carries the general form of the
  transition rule (cause, intention, limitation, comparison, order,
  consequence, each its own assertion) and one self-check that does most of the
  work: **when your reason covers less than your claim says, the verdict is
  unsupported.** Verified on that film, execution 16421 after the publish: the
  sentence is two findings now, the rewrite was ACCEPTED where it had been
  refused, and all four sentences removed are from the named family.
  **What is owed is upstream**: `Write Full Narration` / `Edit Full Narration`
  produce the connective prose this judge then catches one sentence at a time.
  Constraining the writer is cheaper than checking the writing — but those two
  nodes are on the main path of EVERY film in every category, so it needs its
  own verification and its own day.
- **A Flow refusal that arrives as HTTP 200 no longer kills the film**
  (2026-09-17, Media Generation `6735a96a`, `db/port/regen-unstick/README.md`,
  lesson in `docs/lessons-pipeline.md` under "Flow refuses twice"). **What is
  the site half went live the same day**: the badge now says how long a
  regeneration has been waiting and whether a batch is alive, Pause counts
  what is in flight and admits it is thrown away rather than paused, and
  Resume stopped recommending Pause. It needed no schema change — the site
  reads `hov.scene` directly, so `regen_*_at` was already in the row.
  `npm run check:regen-wait`. **And then it was watched, which changed the
  answer**: a batch started 14:54:23 wrote to the flagged scene at 14:56:24
  and was stopped through the site at 14:58:47 — the fourth such cycle in
  four hours, each 4-7 minutes in, none long enough for a Veo generation.
  Nothing was broken; every attempt was working and every attempt was
  stopped. Pause now arms first ("⏸ Throw the regeneration away — sure?").
  **The structural fix shipped the same evening** — `scene-video-regen`,
  Media Generation `549d982d`, `db/port/video-regen-webhook/README.md`. Video
  regen was the only regeneration without a webhook of its own; it now has
  one, and **Pause no longer stops it** (`pauseProduction` spares a `webhook`
  run on Media Generation or Claude Scripting — one scene's work is not the
  film's production). **The measurement is done too**: execution 14316,
  16:38:28 → 16:41:25, click to new clip in **2 min 57 s** on its own run,
  with the refusal path and the "flag already clear" path verified beside it.
  What is still owed is one regeneration driven from the browser rather than
  from a webhook fired by hand. See `docs/lessons-site.md`, "Pause is the
  button that destroys a regeneration".
- **Story and Kids films end on a resolution since 2026-09-16 14:03 UTC**
  (`db/port/story-close/README.md`, lesson in `docs/lessons-pipeline.md`
  under "The story ends on a resolution, not on its climax"). Claude
  Scripting `31e37b3c` + Final Assembly `450fa910`: a fifth beat after the
  climax, its own last scene, a 1.5 s / 2 s hold before the end screen; for
  kids it is warm and overrides the tone's beat 5. Verified on two disposable
  scripts (`recZHr8go7vcYiQZp`, `rec78haMNefc8xaWs` — delete them).
  **Owed**: the hold has never been heard on a render, and the
  `Rewrite Script` path (producer rejects with feedback) still carries
  neither the spine nor these rules.
- **Drawn cards: one accepted motif card used to SILENCE every derived card,
  and the validator refused chapter-start cards on films with chapter cards
  OFF** (2026-09-23, `db/port/motif-more-cards/README.md`). The New York
  remote-work film shipped with ONE card in six minutes: Scripting's best
  proposal, a Brooklyn → Manhattan route, died as "a chapter card already
  owns this scene" because `Validate Motif Cards` never passed the film's
  `chapterCards` setting (default true, for every film ever); the one card
  that survived then bypassed the render's own figure-card derivation, which
  would have drawn the film's twenty spoken figures. Fixed on both sides:
  `buildTextCards` MERGES explicit and derived cards (one per scene, explicit
  wins; `npm run check:cards`), and Claude Scripting `8186ec33` reads
  `chapterCards` off `Fetch Project Record`, sizes the cap by length
  (`maxCardsFor`: one card per ~2 minutes, never under 3, in
  `remotion/motif/validate.mjs`), puts `LENGTH:` in the writer's brief and
  asks for that many. **Measure before believing the frame count**: the first
  inspection here pulled frames from the MONTAGE (`Check Render`'s
  `outputUrl`) and saw no captions either — the delivered film is the
  GRAPHICS job's output (`Check Graphics`), and `/inspect` needs the
  `x-api-key` header the live nodes carry. **Owed**: the next film's
  `motifReport` read against its delivered cut, and whether one card every
  two minutes reads as rhythm or interruption — the number was chosen, not
  measured.
- **Series exist since 2026-09-16** (`db/port/series/README.md`; lessons in
  `docs/lessons-site.md` under "Series — the same cast, film after film").
  `/series` lists the shows, a show is started from any film with a Story
  Bible, `/series/<id>` shows the cast with their sheets and the episodes,
  `/new?series=<id>` opens the brief as the next episode. The bible rides
  to Scripting as Lore, the sheets as Editing Options (orchestrator
  `1bde883f`, `Normalize Webhook Input`); no other node changed. **Sheet
  ingest is live since 2026-09-17 11:33 UTC** (Media Generation
  `71b42624`, `db/port/sheet-ingest/`): every new cast sheet and set plate
  is posted to `/api/media/ingest` (`field: "sheets"`) while Flow's signed
  URL is alive, so the series page shows faces for anything drawn from
  then on. **Sheets drawn BEFORE that are recoverable, and ten of them were
  recovered on 2026-09-18** — `GET
  api.useapi.net/v1/google-flow/assets/{mediaGenerationId}` mints a fresh
  signed URL for any asset at any time, which nothing in the repo knew and
  three files claimed was impossible (`db/port/sheet-backfill/README.md`
  has the query, the four nodes and how the endpoint was found). The general
  lesson: **a 4xx that rejects a value for its FORMAT is an endpoint that
  wants a different value in that position, not an endpoint that does not
  exist.** Re-run the backfill whenever a show's faces are initials — it is
  idempotent, and it needs a session with the n8n connector until the
  producer-facing button in that README exists. **What is owed**: one
  real episode — read its Story Bible against the series page (same
  names, same descriptions), check `SHEET PLAN` says the cast was skipped,
  not drawn again, and `SHEET KEEP` in the log of the first film that
  draws a sheet.
  **An episode now opens as an episode (2026-09-21)** — the producer's
  report was that `/new?series=` read as a brand-new film: "Start a video"
  at the top, a blank title, and every setting to pick again. Three
  changes, all in `platform/`: the page header IS the show (the series
  name as the title, `Episode N` in the pill, the cast and the last recap
  line under it); the WHOLE brief is pre-answered from the series row —
  length, look, overlays, levels, caption colour, hands-off, cast and
  multi-voice, on top of the category/tone/voice that already carried —
  frozen by `seriesSettingsFromProject` when the show is created; and the
  title field has **✨ Suggest episode N**, which asks the show itself
  (`series-next`). Every new settings field is NULLABLE and every reader
  falls back to the form's own default, so a series created before this
  opens exactly as it did. `npm run check:series` pins the mapping.
  **What the show does NOT learn**: changing a setting on one episode's
  brief changes that episode only — the series keeps what it was frozen
  with, so one short episode cannot silently shorten the show.
  **The bookkeeping after each episode is automatic since the same
  evening** (`db/port/series/README.md`, "What happens by itself"): when
  an episode's script is approved, the site re-keys the episode's sheets
  to the bible's spelling of each name, writes new characters / places /
  objects back to the show, and POSTs the project to the `series-recap`
  webhook (workflow `4jVkQjpr7terqQhY`, `db/port/series-recap/`), which
  has gpt-5.4 write the `Episode N — Title: …` line onto
  `series.previously` — replace-or-append, verified on a throwaway
  episode (execution 13951). The next episode reads the UNION of the
  show's sheets and every episode's. **Note for the next debugger**:
  `project.full_narrator_script` / `edited_narrator_script` are EMPTY on
  every film since the cutover — the approved narration is the newest
  `hov.script` row, which is what `Load Episode` reads.

- **The eight kids styles are live end to end since 2026-09-16 ~12:55 UTC**
  (`db/port/kids-styles/README.md` and
  `db/port/sheet-style/README.md`). Claude Scripting `6e21cddc` (`Voice
  Mode`: `KIDS_STYLES` with eight keys — illustrated, crayon, papercut, cel,
  cartoon3d, brick, clay, felt — and a stop-motion motion clause for
  clay/brick/felt) and Media Generation `0f418e8e` (cast sheets and set
  plates drawn in the film's style instead of hard-coded photorealistic)
  are both published, and the site half reached the trunk in merge
  `4c2c6c9` (pushed only after Media Generation `13887` and the render
  `13900` that followed it had finished — the deploy restarts the
  container four Media Generation nodes talk to). The list has four
  copies (Voice Mode, Cast Sheet Prep, Set Plate Prep, categories.ts) and
  `node db/port/sheet-style/check.mjs` asserts all four agree. **What is
  owed**: the first film in each new style — `clay` for whether the
  stop-motion clause reads as stop motion rather than smooth CGI over a
  clay-looking still, `brick` for content refusals — and one kids film's
  `castSheets` / `locationPlates` opened to confirm they are in the film's
  medium. Same branch: Kids story now visibly selects George as narrator
  and the "Storyteller" tone preset on the brief (`STORYTELLER_TONE`, one
  owner in `derive.ts`) — the tone had been a silent server-side default
  since 09-08, which the producer read as "no storyteller voice". And the
  brief has a **Childish** tone (`db/port/childish-tone/`): a
  `hov.genre_profile` row `recpa1ZmZmXFnGjDi` — the writing profile of a
  bedtime story — that Kids story selects by itself; the profile's five
  beats are what to read the first Childish outline against.

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
- **A MERGE TO THE TRUNK IS A RAILWAY DEPLOY, and nothing in the repo says so.**
  Railway's service config (project `ee89d76e`, service `651807a9`) watches
  branch **`claude/hello-7o90qh` — the trunk** — with
  `watchPatterns: ["/remotion/**"]` and `rootDirectory: /remotion`. So the rule
  "never push to `remotion/**` while a render is running" is really "never MERGE
  a branch touching `remotion/**` into the trunk while a render is running", and
  the second form is the one that catches you, because merging feels like
  bookkeeping. Check `search_executions` for running Media Generation / Final
  Assembly work before merging such a branch, exactly as you would before a push.
  (The site is the other half and behaves differently: `platform/**` deploys
  through GitHub Actions, also off the trunk.)
  **The hold this entry carried is released** (2026-09-17): the contact-sheet
  sampling ceiling in `remotion/server/inspect.mjs` waited on Media Generation
  `13033`, which ended on 09-14, and it merged with nothing running anywhere in
  n8n. Keep the rule; the example is history.


- **The upload address is a PATH segment, and sending it as a query parameter
  silently load-balances across accounts** (2026-09-17, fixed in Media Generation
  `8c4ef1bf`; full account `db/port/parallel-accounts/README.md`, "The real
  blocker"). useapi's endpoint is **`POST /v1/google-flow/assets/{email}`**, and
  its own spec says that OMITTING the email "triggers automatic load balancing
  […] to select the healthiest account". Both our callers sent
  `assets?email=…`, which that endpoint reads as no email at all. **With one
  account linked this was invisible for months**, because the balancer had
  nothing to choose from; the day a second and third account were linked, every
  asset upload started going wherever it liked — including
  `Upload Asset To Flow`, which carries the producer's own reference picture, so
  it was never only a parallel-generation problem. Measured both ways on the same
  file: query form 1 of 3 landed on the account asked for, path form 3 of 3.
  **The general lesson: a REST parameter in the wrong position does not error, it
  defaults** — and a default that is "pick something sensible" is the hardest
  kind to notice. `scripts/check-n8n.mjs` block 7 checks account health but
  cannot see this; only the returned `mediaGenerationId`'s hex-encoded owner can,
  which is why `Collect Replicated` files every copy by it.

- **A clip Google refuses for its AUDIO was being diagnosed as a picture
  problem, and the ladder that "fixed" it rewrote the wrong thing**
  (2026-09-22, Media Generation `78bff76f`, rollback `2d3f0f86`; full
  account `db/port/audio-filter/README.md`). Scene 7 of the producer's New
  York film would not generate: the rewrite ladder had spent four motion
  rewrites on it and left a note saying *"The START IMAGE is most likely
  what Google refuses: regenerate the image so no face or real person is in
  frame"* — on a start image that is an extreme close-up of a HAND, with no
  face anywhere in it. Submitting that same image with a deliberately blank
  prompt returns `PUBLIC_ERROR_AUDIO_FILTERED` / `AUDIO_GENERATION_FILTERED`.
  **Veo 3.1 generates a soundtrack alongside the picture and Google refuses
  that soundtrack on its own terms**; the string contains `FILTER`, so
  `Filter Failure?` routed it into the ladder that rewrites the MOTION
  prompt — the one thing that was not refused. `VP Prep` now has an audio
  arm and carries the advice that fits the refusal. **Three things close off
  the obvious escapes.** `generateAudio` is not a parameter useapi accepts
  (`400 Parameter generateAudio not supported`), so a silent clip cannot be
  asked for. The detection window was `slice(0, 2000)` while the marker sits
  past a kilobyte of echoed request, so **the `PROMINENT` and `MINOR` arms
  were unreliable too** — it is 20,000 now. And **retrying is not a second
  roll of the dice**: both submit paths derive the seed as
  `hash(sceneId + ':' + takes)`, a refused clip files no take, so `takes`
  stays 0 and every rewrite and every press of "Regenerate video" re-rolls
  the IDENTICAL seed. Four attempts were one attempt four times, and a scene
  that fails the filter before it ever produces a clip cannot escape by
  retrying. **The fix that worked was a different still** — the same desk in
  the same light with no person and no hand, so the audio model has nothing
  to speak; it passed on the first submit (execution 16104, 1m13) after five
  straight refusals. **What is owed**: vary the seed per attempt, and measure
  whether an audio refusal is deterministic at all. Also worth a
  measurement — every clip this pipeline submits ends
  `"Negative: speech, voices, dialogue, singing, narration, music, …"`, and
  this repo's own expensive lesson is that naming a thing in a Veo prompt
  summons it.

- **The first REAL film through the three-account pool is measured, and the
  bottleneck is neither the pool nor Google** (2026-09-22, `rec7U8PbMS8MUYQcW`,
  54 scenes, 10 minutes; full account `db/port/parallel-accounts/etapa3.md`,
  "The first REAL film through the pool"). **The split is exact — 18 / 18 / 18**,
  every clip on the account that minted its image, zero `Email mismatch`, so
  Etapa 1 and the path-form upload are confirmed on a real film. The phases:
  scripting 9.5 min, images + voices **55 min**, clips **105 min**, final
  render 32 min — which finally answers whether parallelising images is worth
  it (clips are two thirds of the machine time, so images could buy a third at
  most, for the 38-node tail duplication the plan prices). **Two findings
  matter more than the totals.** First, the pool delivers a clip every **86
  seconds** while all three accounts are busy — about 3x serial, better than
  the 9-scene A/B suggested — and then **collapses to one account at a time
  for the last 14 clips, 55 of the 105 minutes**. That is the TAIL: contiguous
  blocks mean an account that finishes early sits idle while the slowest block
  runs alone, so the film ends at serial speed. **The fix is work stealing, not
  more accounts or a bigger `videoPoolPerAccount`** — an idle account should
  take the next unstarted scene from ANY block. Second, **22 of 54 scenes (41%)
  were refused by the content filter at least once**, roughly 43 refused
  generations against 54 successful ones — an 80% overhead, most of an hour on
  this film. Fifteen of those refusals were filed as the generic "Google video
  content filter", which is exactly where `AUDIO_GENERATION_FILTERED` was
  hiding (see the audio entry above). **Cutting the refusal rate buys more than
  any amount of extra concurrency.** Note also that the film's 17-hour
  wall-clock is ~3 hours of work plus an overnight gap and two manual cancels;
  do not read it as a pipeline figure.

- **The parallel-accounts work is reachable from the site since 2026-09-20**
  (`db/port/flow-accounts-ui/README.md`; orchestrator `4f022248`, rollback
  `fec6369c`). The brief has a **Clip generation** control next to Video
  quality; one switch writes both `flowAccounts` and `videoPool`, because
  apart neither does what was asked — the first only stops useapi's 429s, the
  second is the half that makes a film finish sooner. **It defaults to OFF**:
  the pool has been measured on one disposable film, not on a real one. Flip
  the default after the first real film goes through it. `flowAccounts`
  refuses out-of-range values DOWN to 1 rather than clamping up, and
  `FLOW_ACCOUNTS_MAX` in `derive.ts` must agree with the `ACCOUNTS` list in
  `Assign Accounts`, order included. **The trap this change nearly fell into
  is worth more than the feature**: the committed copy of `Normalize Webhook
  Input` under `db/port/series/` was four days stale — another session had
  edited that node on 09-19 — so republishing it with one key appended would
  have silently reverted `watermarkScale` and `watermarkOpenOnce`. Four people
  work in this repo and n8n has no merge. **`get_workflow_history` before any
  node edit**: it names the version, the date and the file each body came from.

- **Three Google Flow accounts buy 1.3x, not 3x, and the reason is worth more
  than the number** (2026-09-18, measured A/B on `rec1rkfxvBeMCFDRj`, nine scenes
  split evenly three ways; full account `db/port/parallel-accounts/etapa3.md`,
  "The A/B"). Serial (`videoPool: false`) delivered a clip every **88 seconds**,
  dead steady. The pool (`videoPool: true`) delivered 9 of 9 on the right
  accounts in **10m05** against a serial extrapolation of **13m12**. The gap
  between that and the 3x the three accounts suggest has two causes. One is bad
  luck: one clip took 6m31 against a 2m10 norm **for reasons that are not known**
  (it was not a motion re-roll — no scene on the film has a second
  `media_versions.video` entry), and
  **with a pool the slowest account IS the film** — the serial loop spreads that
  exposure, the pool concentrates it. The other is structural and was NOT
  predicted: a pooled clip takes **2m10 per account where a serial one takes
  1m28**, so each account's own work got ~48% slower and three of them cannot
  give back 3x. **That penalty is NOT the pool's polling**, which this entry
  first claimed: the serial path waits 30 s (`Wait Video`) then 15 s
  (`Wait Retry`) between polls, COARSER than the pool's 20 s, so if detection
  latency were the story the pool would be ahead rather than 42 s behind. What
  the run does show is that the penalty scales with jobs in flight — the pool's
  last clip, running alone after the other accounts finished, took 1m26, i.e.
  serial speed — so the leading suspect is now Google itself being slower when
  three of our accounts generate at once. **Measure that before raising
  `videoPoolPerAccount`**, submit-to-land rather than land-to-land, and do not
  start by tuning `POLL_EVERY_MS`. **That measurement was attempted on
  2026-09-20 and stopped from outside** (`etapa3.md`, last section): the test
  film had been deleted, a fresh one was created through the live brief, its
  scripting stalled 24 minutes in the known shape, and it was cancelled at
  17:09:33 by a Pause or a manual stop — the fourth timing run in three days
  killed on the shared instance, and a cancelled execution keeps no data. Do
  not run it again unattended while anyone else is working; it needs a quiet
  window, or one real film left alone. `recGea91h5CGUvTeB` ("ZZ DELETE pool
  timing") is kept as the stall reproduction — "⟳ Restart writing" on it is
  the cheapest chance of the scripting timeout naming its node. **That restart
  was pressed the same evening and reproduced the stall exactly** (new bible
  at 20:05:01, then 45 minutes of nothing) — and was cancelled by hand at
  20:50:46, the fifth such kill in three days, every one before the guard
  could fire. The reason it never fires is arithmetic, not a missing
  timeout: the model timeouts are confirmed present in the live version, but
  four agents carried n8n's own `retryOnFail`/`maxTries: 3` on top, so a hang
  cost 3 × 3 × 5 = **45 minutes** before failing — above anyone's patience.
  **That retry is gone since 2026-09-20 ~20:55** (Claude Scripting
  `f86e6cc1`, rollback `c0b8e3d8`, `db/port/scripting-timeout/README.md`);
  the ceiling is 15 minutes per agent now. **Leave the next stalled run alone
  for 15 minutes** and the error names the node. Two traps met on the way:
  `diff-workflow.mjs` is blind to node SETTINGS (it reported `changed 0`
  over a real four-node change — compare `retryOnFail` by hand), and a
  `glob(...)[-1]` over the tool-results folder picks files lexically, not by
  time, which produced a confident diff of two unrelated workflows before
  the selection was redone by workflow id and mtime. Note also that the old planning figure "80 scenes =
  6.7 h serial" implies ~5 min per clip and does not reconcile with the 88 s
  measured here; treat the RATIO as transferable, not the absolute minutes.

- ~~**`houseofvideos01@gmail.com` is signed out at Google and must be reconnected**~~
  **Reconnected 2026-09-17 21:59** and all three accounts read `health: OK`. The
  lesson below is the durable part; the misrouting it was blamed for turned out to
  be the separate, larger fault in the bullet above
  (`db/port/parallel-accounts/README.md`, "The fixed chain, run on a film").
  Reconnecting is something only the producer can do, at
  `https://useapi.net/docs/start-here/setup-google-flow`.
  **The lesson that outlives it is that a dead Flow account is SILENT**: tier, credits
  and the model list all still read fine, useapi keeps answering 2xx, and an
  upload addressed to the dead account comes back with an id minted on a
  DIFFERENT account, which looks entirely ordinary. The only signal is `health`
  in `GET /v1/google-flow/accounts`. `scripts/check-n8n.mjs` block 7 now fails
  on it (needs `USEAPI_TOKEN`, and a machine that can reach useapi).

- **The Veo direction work needs a real film to measure it** (2026-09-13,
  Media Generation `6a79f422`; full account `db/port/veo-direction/`, lessons
  in `docs/lessons-pipeline.md` under "Direction: why Veo played the shot
  backwards"). Three changes went live in one afternoon against the
  producer's report that clips contradict their own scene — the contradictory
  continuity clause is gone, every clip was made from a start frame AND an
  end frame, and a gpt-4o judge scores each finished clip and re-rolls it
  once when it clearly disagrees with its brief. **The end frame half was
  REVERSED on 2026-09-14 and is now opt-in** (`endFrame: true`), because the
  one real film that ever carried it came back with two of its signature
  artefacts and a per-shot "draw it only when it helps" rule measured 0 of 16
  — see the entry below and `db/port/motion-permanence/endframe/`. Each was verified at the API
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
  for are `RG ENDFRAME <id>: got …` and `RG MOTION <id>: ok`. The escape
  hatch, if a film goes wrong at 2 a.m., is `motionJudge: false` in
  `Editing Options`. **`endFrame` reversed polarity on 2026-09-14**: it used
  to be `endFrame: false` to switch OFF, it is now `endFrame: true` to switch
  ON, and the strict boolean is deliberate — there is no UI for the key
  (`grep -rn endFrame platform/` is empty), so a hand-typed `"true"` stays OFF
  and the skip log echoes what it actually saw.

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
- **A Claude Code web session reaches GitHub and NOTHING else.** Measured
  2026-09-18: `api.github.com` answers 200, while `example.com`,
  `api.elevenlabs.io`, `house-of-videos.com` and `wf7.house-of-videos.com`
  all answer `000`. So `curl` cannot reach the site, wf7 or any external API —
  but the entry here used to say "every host answers 000", which is no longer
  true and would send a session looking for a workaround it does not need for
  GitHub. (The npm registry answers too — measured 2026-09-23 — so a session
  can install tools that are not the site's dependencies, like the WASM
  Postgres behind `db/port/lib/local-pg.mjs`.) For everything else the MCP connectors are the only way out. To run a query or fire a webhook, create a throwaway workflow
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
- ~~**THE OPENAI ACCOUNT IS OUT OF CREDITS AGAIN — 2026-09-19, ~10:00 UTC**~~
  — **topped up by the producer the same hour**, confirmed by execution 15071
  running an agent normally at 11:12. The entry stays for the blast radius and
  for the error-shape trap, both of which will be wanted the next time.
  Measured, not inferred: a probe at 10:57 came back
  *"You have no credits remaining. Add credits to continue using the API at
  https://platform.openai.com/settings/organization/billing/"*, and the film
  `reczMt4d9zqrYcceL` had written its whole script an hour earlier at 09:47.
  So it ran dry inside that hour. **Only the producer can fix it**, by topping
  up at that URL.

  **What is dead while it is empty**, per the node map below: every writing
  path. Story Bible, Outline, Narration, Segment, Hook and Research Model; the
  three raw HTTP rewrites; and — new since 09-18 — all of Deep Search, whose
  `FC Judge`, `FC Source` and `FC Rewrite` are agents on the same account. A
  new film dies partway through scripting; per-scene regeneration fails
  honestly (`Mark Scene Regen Failed` writes the reason and releases the flag);
  Media Generation and Final Assembly are UNAFFECTED, so a film that already
  has its scenes still renders.

  **n8n reports it as "OpenAI: Rate limit reached"**, which is not what it is.
  The credits sentence is in the error's `description`, not its `message`, so
  the surface reading sends you looking for throttling that is not there.
  Read the description before believing the message.

  ~~Resolved as of 08-16~~ — it was, for a month, and the entry below is that
  history. Full pipelines ran to a finished film on 08-13, 08-14 and 08-16, and
  both `recCoZWsZBOrIU69L` and `rec1GITgUCq4mEsUd` read `Finalizat` with a
  final video. **Check the DATE on a note like this before repeating it**: that
  resolution had been true for a fortnight and was still told to the producer as
  a live blocker on 08-27, which cost a round trip and some of their patience.
  The same caution now runs the other way — do not read the strike-through above
  and conclude this is history, because it recurred. Original note: execution 1783 (2026-08-08,
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
  **Superseded 2026-09-22 by `db/port/pool-tail-and-refusals/README.md`,
  step 1c**: gate it on STYLE (photorealistic), not on category — the film
  that measured a 41% refusal rate was `category: story` with Documentary
  tone and style, so a category-keyed rule would never have fired — and add
  the speech cue, since Veo invents a soundtrack from the still and refuses
  it. That file is the plan for both the refusal rate and the pool's tail;
  it names two decisions that were the producer's (D1: may the ladder replace
  an approved still; D2: faces off by default on photorealistic films) and
  both were taken the same day. **All four code steps are LIVE as of
  2026-09-22 evening**: Media Generation `3c65295d` (1b, seed fresh after a
  refusal) → `de198483` (1a, the ladder regenerates the STILL with a steer,
  twice, then gives up) → `c22878a1` (2a, work stealing: an idle account
  copies a still from the busiest queue and makes the clip there), and
  Claude Scripting `f379e56d` (1c, the faces-and-speech block appended to
  `segmentRules` in `Voice Mode` for every non-kids film; `Editing
  Options.facesOff === false` switches it off, strict boolean, no site
  control yet). Rollbacks `78bff76f` and `f86e6cc1`. **None of the four has
  run on a real film.** What proves them is in the README's order table:
  `AUTO-REWRITE-VIDEO (attempt N)` notes and `VP IMAGE … ready` lines for
  1a, `POOL steal` lines and zero `Email mismatch` for 2a, the refusal rate
  against 41% for 1c. Owed after that: 1d, 1e, 2b, the `facesOff` brief
  control, and rotating the useapi token hard-coded in the steal nodes.
- Scene 104/105 of `recCoZWsZBOrIU69L` are the first scenes to go through the
  new fal auto-rewrite path — worth watching once to confirm the rewritten
  prompt clears fal and the regen loop picks the scene up.
- The ambience level in `assemble.mjs` (`nativeVolume`, 0.22) and its
  sidechain settings were never heard on a real montage — tune by ear once.
- Optional: `channelName: 'Video Factory'` → `'House of Videos'` in
  `remotion/src/types.ts` and the n8n "Build Remotion Props" node (affects
  rendered end screens).
- **Give voiceovers a real attachment row** (`field: 'voice'` through
  `/api/media/ingest`, a `storedVoiceUrl` beside `storedVideoUrl`), so new
  films never reach Drive for playback at all, and backfill the existing
  ones. Since 2026-09-20 the proxy's disk cache makes this an optimisation
  rather than a fix — `db/port/scene-lag/README.md` explains why the cache
  was done first (it heals films that already exist; the attachment row
  would need three n8n nodes changed and a backfill before it helped
  anything). Also owed there: watch one scene play on the deployed site.
- Rotate the ai33 / Railway / useapi keys. Discord webhook URLs are still empty.

## Working language

The producer writes in Romanian and English interchangeably; reply in whichever
they used. Code, comments and this file stay in English.
