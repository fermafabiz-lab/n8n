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
| **Website** | `platform/` — Next.js on Vercel | The producer's whole interface: create projects, approve each stage, watch progress |
| **n8n** | self-hosted at `wf7.house-of-videos.com` | All orchestration. 4 workflows, see below |
| **Airtable** | base "Database Video" | The single source of truth for project + scene state |
| **Render server** | `remotion/server/` on Railway | ffmpeg + Remotion: `/assemble`, `/tts-multi`, `/media`, `/transcript`, `/inspect` |

External services: **ai33** (TTS), **fal.ai** (images), **Google Flow via
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

There is also an inactive legacy `2. Scripting Sub-Workflow`
(`5YWpycnnL6OaDWIx`) — superseded by Claude Scripting, referenced by nothing.
Leave it alone or archive it; do not repoint anything at it.

Webhooks the site calls: `new-project`, `resume-project`, `scene-text-regen`,
`scene-image-regen`, `scene-voice-regen`, `assemble`. The site derives all of
them from `N8N_NEW_PROJECT_WEBHOOK_URL`, so they must live on the same host.

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
- **`WEBHOOK_URL=https://wf7.house-of-videos.com`** must be set as an env var
  on the instance. Without it n8n hands out `localhost` webhook URLs and
  Vercel can't start anything — which presents as "the site is broken".
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

### Airtable

- **The status TEXT field is display-only and lags.** The site must trust the
  **checkboxes** (`Aprobare Imagine`, `Aprobare Voce`, `Aprobare Video`),
  never the status string. Stale-status overrides live in `platform/lib/data.ts`.
- Use `typecast: true` on writes. Airtable re-hosts uploaded attachment URLs,
  which is what keeps assets alive after Flow's signed CDN URLs expire (~hours).

### The site

- The project page auto-refreshes every 10s, which remounts components. Drafts
  in progress must be backed by `sessionStorage` to survive it.
- Count **approvals**, not asset existence, for pipeline progress. Counting
  clips that merely exist made "Video" tick green before review.
- Transient states need a grace period. The render-error panel fires on healthy
  gaps between executions; `AssemblyStatus` uses a 75s sessionStorage-backed
  grace before crying failure.

## Conventions

- Standalone webhooks over long-lived executions — they don't depend on a
  parent surviving.
- Flags in Airtable drive UI states like "Regenerating".
- `story` in `platform/lib/categories.ts` is the reference category: it is
  exactly today's working pipeline. Everything else is built *around* it,
  never by changing it. Categories marked `ready: false` are selectable, saved,
  and inert on purpose — so colleagues can work while the rest is wired up.

## Environment

**Vercel** (the site): `N8N_API_URL`, `N8N_API_KEY`,
`N8N_NEW_PROJECT_WEBHOOK_URL` — all three must point at the current n8n host.
See `platform/README.md`.

**Google OAuth** (Drive credential): redirect URI is
`https://wf7.house-of-videos.com/rest/oauth2-credential/callback`, JavaScript
origins empty. The app is **Published**, not in Testing — Testing mode expires
refresh tokens after 7 days. The "Google hasn't verified this app" warning is
expected and harmless for an app touching only its own Drive.

## Open work

- Merge `claude/hello-7o90qh` to the production branch so the House of Videos
  rename and all fixes actually deploy.
- Redeploy Railway so `/tts-multi` exists — Characters multi-voice synthesis is
  dead without it.
- Codify the "no visible faces" rule into Documentary image prompts.
- Optional: `channelName: 'Video Factory'` → `'House of Videos'` in
  `remotion/src/types.ts` and the n8n "Build Remotion Props" node (affects
  rendered end screens).
- Rotate the ai33 / Railway / useapi keys. Discord webhook URLs are still empty.

## Working language

The producer writes in Romanian and English interchangeably; reply in whichever
they used. Code, comments and this file stay in English.
