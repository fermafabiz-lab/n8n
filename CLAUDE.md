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
- **Some executions never start at all.** n8n creates the execution, stores its
  input, and then runs nothing: `runData` stays `{}` while the status says
  `running`, forever. Seen twice (5639, and 1175 on the Vikings project). The
  parent sits in `waitForSubWorkflow`, the batch never moves, and the site used
  to hide Resume because it trusted `running` — leaving no way out of the UI.
  `isStalled()` in `platform/lib/n8n.ts` detects it by the empty `runData`
  after a 3-minute grace, never by age: a real media batch legitimately runs
  for the best part of an hour. Stalled executions are excluded from
  `getAliveProduction()`, listed in the ops panel with a Stop button, and
  stopped automatically before a Resume so they can't accumulate.
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
- **The import also strips `parameters.operation` from Google Drive nodes**,
  leaving them with no resolvable action rather than an error. Every upload
  node needed `resource: file` + `operation: upload` re-set by hand, and
  `VR Find Audio Folder` needed `operation: search`.

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
- **A numeric field left in an Airtable node's column mapping with no value
  writes a literal `0`.** It does not skip the field — it destroys it. Fifteen
  nodes across all three workflows were silently zeroing `Ordine Scenă`,
  `Durată Scenă (secunde)` and the project's `Lenght` on every single write.
  The damage always surfaces far from its cause: scenes shuffled on the site,
  the render built from zero-length scenes, and scripting computing chapter
  counts from a length of 0. If you add a mapped field, either give it a value
  or take it out of the mapping. Nothing warns you.

### The batch cap

`Sort & Cap Scenes` in Media Generation ends with `items.slice(0, CAP)`,
CAP = 8 — and the cap is applied **before** anything checks what is already
done. A project with more approved scenes than the cap used to be unfixable:
every run picked the same finished head, found nothing to do, and the tail
stayed invisible rather than pending. Regenerating did nothing, because the
scene was never in the batch to begin with.

Pending scenes now sort ahead of finished ones, so the cap always covers
outstanding work and repeated runs converge. The cap itself still stands: a
20-scene project needs several passes. The drop is logged — do not make it
silent again.

This interacted viciously with the zeroing bug above: processed scenes lost
their order to `0`, so the one *un*processed scene held the only non-zero
order, sorted last, and fell off the end forever.

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
- If SFX are enabled and the final video still has none, check whether the
  veo-3.1-lite clips actually carry an audio stream (`/inspect`).
- The ffmpeg bundled with Remotion in `node_modules` is a **stripped build**
  — no `sidechaincompress`, `alimiter`, `asplit`, `afade`, `anullsink`,
  `aloop`. The mix graph cannot be rehearsed locally with it; validate the
  graph by reading it, and test on Railway.

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
  past TTS entirely; `Evaluate Voice Approval` waives the Voiceover-URL
  requirement for cinematic. The audio stage therefore completes on its
  own and video starts immediately.
- **Final Assembly**: scenes have no `audioUrl`; `/assemble`'s `it.a ??
  it.v` fallback makes each clip's own track the scene's main audio (the
  Veo prompt guardrail keeps it speech/music-free), scene length = clip
  length (no elastic retime). `Build Remotion Props` forces
  `showCaptions: false` for cinematic — `Script Scenă` holds the beat
  sheet, and captioning it would print stage directions on screen.
- Untested end to end as of writing. Watch for: the site's Audio stage
  shows green immediately (correct); hook title still works (on-screen
  text only).

### The stage chain in Media Generation

The three stages are gated the same way — a loop, then a Wait/Fetch/Evaluate/If
cycle that holds until every scene is approved:

```
If All Images Approved →  Refetch Scenes For Audio → Loop Audio
Loop Audio        out[0] →  Wait Voice Approval  (out[1] is the loop body)
If All Voices Approved →  Refetch Scenes For Video → Loop Scenes
If All Videos Approved →  Prep Finalizat List
```

The voice gate used to be **unreachable in both directions**: nothing fed
`Wait Voice Approval` except its own cycle, and `If All Voices Approved`'s
true output went nowhere. `Loop Audio`'s done output was dangling too. On top
of that, `If All Images Approved` started audio *and* video at once — so
production looked like it skipped straight to clips, and every voice had to be
regenerated by hand afterwards. An orphaned gate does not error; the branch
just ends in mid-air.

When touching this chain, check each loop's **out[0] (done)** actually reaches
the next gate, and that each gate's **out[0] (approved)** actually reaches the
next stage. `Submit TTS` and the `Submit Mux*` nodes are leftovers from an
older inline audio path and are deliberately disconnected — n8n warns about
them on every publish. Ignore those four; do not wire them back.

### Remotion / the edit

- **Nothing that moves may be linear.** `remotion/src/easing.ts` holds the whole
  vocabulary — `outExpo` for entrances, `outQuart` for settles, `inOutCubic` for
  exits and sweeps — plus `eased()` (clamped + eased interpolate) and
  `curveAt()`. Constant-speed ramps are the clearest tell that a graphic was
  generated rather than designed. The one deliberate exception is the base Ken
  Burns push in `kenBurnsTransform`: a constant-velocity zoom is what a real
  rostrum move looks like, and easing it makes it visibly decelerate for no
  reason. Punch-ins are discrete events and do get shaped.
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

The films used to read as ONE shot. Measured against five reference
documentaries (`remotion/reference/editing-benchmarks.json`), at the same
detector threshold every reference registers 43-126 cuts per 4 minutes and
ours registered **one** — consecutive scenes shared subject, location and
framing, so the only "cut" was a luminance dip, and the scene boundaries
only appeared at all when the detector was made twice as sensitive, landing
on a visible 8-second grid.

- **No pipeline change was needed, and none should be made.** The planner
  never touches the media, never reorders and never drops time: shots tile
  the timeline contiguously and only ever **re-frame the same continuous
  footage**. A discontinuous jump in scale/position is what reads as a cut,
  exactly the way an editor punches into a single take. The audio timeline
  is fixed (narration is muxed per scene), so this is the only kind of
  cutting available to us — and it is enough.
- **Rhythm is planned across the whole timeline, not per scene.** A scene is
  one narration beat (~7-9s), far too short to hold both a burst and a hold.
  The planner walks the scene list in modes: HOLD swallows several scenes
  whole (the only way to reach the 10s+ shots every reference has), BURST
  chops one scene into 4-8 rapid inserts, NORMAL cuts lightly.
- **A cut the detector cannot see is not a cut**, and rhythm statistics
  cannot tell you the difference — a shot list with perfect variability still
  reads as one take if consecutive framings happen to match. Two ways that
  happened, both fixed, both invisible in the stats:
  - `pickKind` enforced the 0.14 minimum scale step against the previous
    shot's **base** framing, but `shotTransform` pushes in during the shot.
    A shot that drifted 0.03 upward left a smaller gap than its base
    suggested, so planned 14% cuts landed at 3%. `pushFor()`/`endScaleOf()`
    now own that number and both the planner and the renderer read it.
  - Every insert in a BURST was forced to `detail`, so all eight shared
    scale 1.5 — the fastest passage in the film was the one a detector read
    as a single shot. Modes now state a framing *preference list* and
    `clearing()` picks the first entry that actually clears the threshold.
- **`npm run check:montage`** reports rhythm AND `auditCuts()` — the real
  jump at every planned cut, measured from where the outgoing shot ended.
  It exits non-zero on any weak cut or missed acceptance target. Run it
  after touching the planner; the numbers above are exactly what it caught.
- `intensity` used to have `BURST_EVERY` as its only lever, and a burst fires
  at most once on a 40s film — so intensity 2 planned a shot-for-shot
  identical edit to intensity 1 on the length we make most often. It now also
  drives the NORMAL piece count.
- The remaining acceptance target, `cutsWithAudioAccentPct >= 40`, cannot be
  checked here: it needs a rendered file, and it is **Dan's side** — SFX
  accents have to land on these cut times. `auditCuts()` is where to get
  them from.
- Pixel-diffing a cut against the Studio fixture proves nothing:
  `PreviewBackdrop` is a near-featureless gradient, so adjacent frames differ
  by 0.07 vs 0.11 of 255 either way. That is a defect of the test, not the
  montage — verify numerically, or over real footage.

### The site

- The project page auto-refreshes every 10s, which remounts components. Drafts
  in progress must be backed by `sessionStorage` to survive it.
- **The app and the render share one type system.** Fraunces / Inter Tight /
  IBM Plex Mono are loaded in `platform/app/layout.tsx` via `next/font` and
  mirror `remotion/src/style.ts`, so the site looks like the films it makes.
  `latin-ext` is required here for the same reason as in the render — Romanian
  project names carry ș and ț. Direction is "editorial": hairlines and tracked
  mono labels instead of nested bordered boxes, one bloom behind the headline,
  no gradient-filled text. Review and approval surfaces deliberately kept their
  density — only the chrome changed.
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
- **The /new form's field names are a frozen contract.** `createProject()`
  posts `name, category, cat_*, cast_voices, language, length, tone, pace,
  style, voice_id, aspect, captions/hook_title/chapter_cards/end_screen/sfx
  (yes|no)` to the n8n webhook. Any redesign keeps those names and value
  vocabularies byte-identical — the 2026-08 editorial rebuild moved them into
  hidden inputs bound to React state, nothing more. Every non-submit button
  inside the form must carry `type="button"`.
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
- Count **approvals**, not asset existence, for pipeline progress. Counting
  clips that merely exist made "Video" tick green before review.
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
- `Generate Scene Image` has no `onError`, so one content refusal from fal
  kills the whole batch. The auto-rewrite chain already exists for Google Flow
  rejections (`Prep Flow Reject → Rewrite Prompt AI → Apply Rewritten Prompt`);
  wire fal's 422 into it.
- The ambience level in `assemble.mjs` (`nativeVolume`, 0.22) and its
  sidechain settings were never heard on a real montage — tune by ear once.
- Optional: `channelName: 'Video Factory'` → `'House of Videos'` in
  `remotion/src/types.ts` and the n8n "Build Remotion Props" node (affects
  rendered end screens).
- Rotate the ai33 / Railway / useapi keys. Discord webhook URLs are still empty.

## Working language

The producer writes in Romanian and English interchangeably; reply in whichever
they used. Code, comments and this file stay in English.
