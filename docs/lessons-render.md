# Lessons — the render

Part of the split of the old monolithic `CLAUDE.md` (2026-09-13). Read the
root `CLAUDE.md` first. This file is everything downstream of "the clip
exists": TTS/voice synthesis and its generation settings, breath trimming,
playback speed, the montage and its framing, text cards, captions, the sound
mix (SFX/music/ducking), caption colour, upscaling, and the Remotion render
pipeline itself (`remotion/src/`, `remotion/server/`).

These each cost hours. Do not rediscover them.

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

### Upscaling a finished film (2026-09-04)

`6. Upscale Film` (`QBb1a3UpTyJi8ybk`) — one webhook, `upscale-film`, taking
`{Project_ID, resolution, reassemble}`. It upscales every clip that has a Flow
id, re-hosts each through `/api/media/ingest`, points `Scene Final URL` at the
stored copy, and fires assemble unless `reassemble` is false. **The upscaled
clip is a new generation with its own id and replaces the old one on the
scene** — otherwise a second upscale re-does the first generation instead of
the current picture. Three buttons on the project page, because there are three
different answers with different costs: rebuild at 1080p (free, ~2x render),
clips only (free and quick, film untouched), 4K (50 credits per clip, prints
this film's own total and asks twice).

Two traps worth keeping:

- **A new webhook answers on the PLAIN path only.** n8n's trigger info prints
  `…/webhook/<uuid>/upscale-film`, which **404s**; `…/webhook/upscale-film`
  answers 200. The site derives its URLs by swapping the last segment, so the
  plain form is the one that matters.
- **`create_workflow_from_code` skips credential assignment on HTTP nodes.**
  Both calls into the site came out with no credential and needed
  `setNodeCredential` afterwards. Check credentials after any SDK create.

**And 1080p really means 1080p since the same day**: `Editing Options.resolution`
reaches `/assemble` (canvas 1920x1080) and `/render` (a Remotion **scale of
1.5**, composition untouched at 1280x720 — so type stays vector and footage is
read at its own resolution rather than upscaled from a 720p raster).
`Submit Graphics` and `Graphics Guard` both read the value off `Build Timeline`
instead of deriving it again, because the montage and the graphics over it must
agree on the canvas. **The guard's ceiling doubles for 1080p** (2160 → 4320
polls): at 2.09x an eight-minute film is ~3.3 h and would fail AT the
three-hour cap, which reads as a hang. 4K CLIPS still render to a 1080p film —
a 4K canvas is scale 3, nine times the pixels.

Full account: `db/port/upscale/`.

### 1080p is a TIME problem, not a memory one — measured (2026-09-04)

Four renders of the same 15-scene fixture over real footage, concurrency 1 and
`gl: swangle` to match Railway, two frame counts per resolution so the fixed
Chrome start-up falls out of the arithmetic:

| | 72 frames | 216 frames | per frame | start-up |
|---|---|---|---|---|
| 720p | 10.7 s | 26.1 s | **0.107 s** | 3.0 s |
| 1080p | 18.7 s | 50.9 s | **0.224 s** | 2.6 s |

**2.09×**, which is the pixel ratio (2.25) almost exactly — so it is real
rendering work, not overhead. Peak RSS across node + Chrome went **2.19 GB →
2.31 GB, +5%**, because `offthreadVideoCacheSizeInBytes` is capped in BYTES:
at 1080p the cache simply holds fewer frames.

**So the reason 720p is documented above — "the box has 8GB" — stopped being
the binding constraint when that cap was added.** What binds now is the clock:
the Boyd film's ~50-minute render becomes ~105 minutes, and an eight-minute
film's ~95 minutes becomes ~3.3 h, which is **past the 3-hour graphics poll
ceiling raised on 2 September**. Anything that renders at 1080p has to raise
that ceiling in the same change.

Worth separating: **upscaling the CLIPS helps even at a 720p output** — a
sharper source means less scale-and-crop damage on the canvas — and that half
is free in both credits and time. Only the 1080p OUTPUT costs 2.1×.

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
  container replacement. (2026-09-03, for calibration: three consecutive
  non-`remotion/` commits all showed `SKIPPED` in the deployment list and both
  `remotion/` commits built, so the filter USUALLY holds — it is the exception
  that costs a render, which is why the rule stays as stated. Builds took about
  two minutes, not the forty the queue can make them look like.) A Railway deploy replaces the container, which kills
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
  **Measured again 2026-09-03, over 48 h that contained the 71-scene film:**
  CPU peaked at **8.07 against a limit of 8** and memory at **6.63 GB of 8**.
  So the box is genuinely saturated at the peak, not idle-waiting — more tabs
  cannot help, and the memory headroom is thinner than the 2.48 GB recorded
  after the cache cap. Beyond matching the composition to 24 fps (25% fewer
  frames, see the montage lessons), the only remaining lever is more vCPU,
  which is a Railway plan decision and therefore the producer's.
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

### Voice character — the ElevenLabs generation settings (2026-08-31)

`Editing Options.voice` = `{stability, similarity, style, speakerBoost}`, chosen
on the brief (section 03) and again at the audio step, and sent as
`voice_settings` on every synthesis.

- **`voiceSettings` on the ElevenLabs node must be a JSON STRING. Given an
  OBJECT it is silently dropped** — the call succeeds, audio comes back, and
  the settings never leave n8n. This shipped that way and the producer's
  report was simply "I can't hear a difference"; they were right, and the
  storage, the read and the resolved expression were all verifiably correct,
  which is exactly what made it invisible.
  **How to prove transmission when the effect is not measurable**: send a value
  the API must reject. `stability: 99` answers 422 ("Input should be less than
  or equal to 1") on a direct HTTP call, and answered **200 with audio**
  through the node — so the field was not being sent. As a JSON string the same
  value 422s through the node too, which is the proof it now travels. Do this
  before believing any pass-through parameter works; a 200 proves the request
  was accepted, never that your field was in it.
  Corollary: `remotion/server/tts.mjs` builds its own JSON body and was always
  correct, so the multi-voice path was the only one really applying the tone.
- **A "Re-record all" is a fan-out, not a queue.** `regenerateVoice` awaits the
  WEBHOOK, which returns once n8n has *started* an execution — the synthesis
  then runs in parallel with every other one. Six scenes therefore hit the
  account's five-concurrent limit and the sixth came back 429; `VR Write Voice`
  never ran, so that scene's `Regenerează Voce` stayed set and the UI showed a
  re-synthesis with nothing left alive to finish it (the stranded-flag shape
  again; since 2026-09-16 the take carries its own way out, `restartVoiceRegen`
  / `cancelVoiceRegen` on the badge in `AudioReview`). Fixed with `retryOnFail`
  (5 tries, 5s apart) on `AB Speak`, `Speak VR` and `VR Speak`, which covers
  every source of concurrency; the site's stagger past the fourth scene is
  only a second line of defence.
- **There are FOUR synthesis paths and they must all agree**, or a re-recorded
  line comes back reading differently from the neighbours it sits between:
  `AB Speak` (batch) and `Speak VR` (regen at the video gate) in Media
  Generation, `VR Speak` (the `scene-voice-regen` webhook) in Claude Scripting,
  and `/tts-multi` on Railway for characters mode. The n8n three carry the same
  one-line expression; `remotion/server/tts.mjs` carries `normalizeVoiceTone`;
  `platform/lib/data/derive.ts` carries the write-side twin. Verified to agree
  on 20 inputs and again end to end on 13.
- **ABSENT means send nothing, and that is the feature.** Every voice has its
  own settings stored at ElevenLabs — Bella's are 0.5 / 0.75 / 0, read off the
  API — so an object we invent overrides each voice's own tuning on every line.
  `null` is therefore a real, storable choice ("Voice default"), and it is the
  default. Same shape as `confirmFinalSettings` omitting `speed`.
- **`speed` is accepted and IGNORED on `eleven_multilingual_v2`**, which is the
  model all four paths pin. Measured: the same sentence at 0.7, 1.0 and 1.2 all
  came back ~4.2s, where 0.7 should be ~6s. It is deliberately not exposed —
  the film's pace is `Editing Options.speed`, applied by `speed.mjs` to the
  finished render, and a second speed control would be the false one.
- **ElevenLabs TTS is NON-DETERMINISTIC, so you cannot prove a setting works by
  comparing outputs.** The control in that experiment — the same request twice —
  produced different bytes AND different fingerprints (67,335 vs 67,753). Which
  means the method could not answer the question it was built for, and the only
  judge of stability/style is the ear. It also means a regenerated take never
  reproduces the one before it, whatever the settings.
- **…which is why the audio panel offers "↻ Re-record all N".** The pace can be
  auditioned for free because it retimes audio already on the page; a
  generation setting only appears in a fresh synthesis. Without a way to spend
  one, the control would be a promise the producer has to take on trust. The
  button is offered only when the tone is SAVED — re-recording against an
  unsaved draft would synthesize with the old tone and read as doing nothing.
- **`VRB Load Project` exists because `AB Load Project` is not upstream of the
  video gate's regen branch.** Checked on the connection graph rather than
  assumed: `Speak VR` descends from `Evaluate Video Approval`, which never sees
  the project record, so a by-name reference there would throw, be caught, and
  silently synthesize with no settings — exactly the divergence this section
  exists to prevent. The node is `continueRegularOutput` + `alwaysOutputData`,
  so a failure degrades to the voice's own settings instead of breaking a
  re-record.
- The expression **refuses rather than clamps**: all three numbers present and
  inside 0..1, or nothing is sent. A 422 from ElevenLabs would kill the whole
  audio loop, and an out-of-range value can only come from a hand-edited row.
  The site and `Normalize Webhook Input` clamp instead, because they are the
  WRITE side and must not let a bad value reach the readers at all.
- Round-tripped on the real stack (execution 8647/8648): written to
  `hov.project.editing_options`, read back through `/api/at` as a STRING, and
  the live expression produced `{stability: 0.15, similarity_boost: 0.8,
  style: 0.7, use_speaker_boost: true}` — then removing the key produced
  "nothing" again.

### The breath at the ends of a take (2026-08-29)

ElevenLabs pads what it generates: every take opens with a beat of
near-silence and closes with another. Inside one line that is natural.
Concatenated down a film it is not — the scene lasts `voiceDur + 0.35`, so a
padded tail is added to a gap that already exists, and the narration comes out
slower and more recited than the take sounds on its own. `assemble.mjs` now
cuts that padding off both ends before anything measures the take.

- **Trimmed BEFORE `voiceDur` is read, which is why nothing else changed.**
  The scene length, the elastic stretch factor, the reported scene starts and
  every graphic placed off them all derive from that one number, so cutting
  first makes the whole pipeline follow on its own. Trimming later would have
  meant rescaling captions, chapter cards and the end screen in lockstep —
  exactly the reason the speed re-time has to happen after Remotion draws.
- **A scene that OPENS A CHAPTER keeps its lead-in**, and that exception is
  the point of the feature rather than a detail of it: with every take
  tightened the film runs on without a seam, and a chapter needs one. The
  pause is the silence ElevenLabs already generated, left alone. The test is
  `sceneChapters[i] !== sceneChapters[i-1]`, the same one `chapterBoundaries`
  already used — `Build Timeline` has always sent that array, so **no n8n
  change was needed**. Verified against the ACTIVE version, not the parked
  draft, which is the trap that entry two sections up describes.
- **Only silence that TOUCHES an end is padding.** A pause in the middle of a
  sentence is the performance, and cutting it would be rewriting the read.
- **`silencedetect` never closes a run that reaches the end of the file** —
  the file just stops, so no `silence_end` is printed. An unclosed run has to
  be closed by hand or a padded tail reads as no tail at all. That is the one
  edge case worth knowing, and `parseSpeechBounds` is exported and pure so it
  can be tested without ffmpeg: this box has none, so the parser is covered by
  fixtures (9 cases) and the filter itself is only provable on Railway.
- **Failure is survivable by construction.** A take that cannot be analysed or
  re-encoded keeps its original file and its original length, which is exactly
  the old behaviour; the guard also refuses to trim when less than 0.3s would
  survive, so a very quiet take is never cut down to nothing.
- Output is **WAV, not mp3**. Re-encoding to mp3 would hand back the encoder
  delay and padding this exists to remove — the same gapless-header problem
  that makes a pure-frame mp3 concat gain ~36ms per join.
- `verify.breathTrimmedSeconds` in the job result is the one number that says
  whether it did anything on a given film; each scene also logs what it cut.
- **Proven on real takes**, not just on fixtures — job `d24c3e9e`, the
  disposable cutover film, called straight at `/assemble` so nothing on the
  project moved. `breathTrimmedSeconds: 1.6` over 36.75s, and the per-scene
  log is the mechanism in the open: the two chapter openers cut **0.30s and
  0.31s** (tail only, "kept the chapter lead-in") while the mid-chapter takes
  cut **0.51s and 0.48s** (both ends). That ~0.2s difference IS the preserved
  lead-in. The fifth take cut 0.00 — the only one in that film regenerated
  through the new ElevenLabs-direct path, which is suggestive but one sample,
  not a finding.

**The audio panel previews the same cut**, so the producer hears the film's
rhythm before a clip exists. `speechBoundsOf` in `AudioReview.tsx` decodes each
take through Web Audio and scans inward from each end against the SERVER'S three
constants — copied deliberately, because a preview trimmed to different
thresholds would be a different cut confidently presented as the real one.

**It shipped cutting the last three words off every take, and the two causes are
each worth knowing.** Reported the day after it landed, and neither cause was
the one that looked obvious.

- **The dominant one was the STOP TIMER, not the detection.** The cut is a
  moment in MEDIA time; a timer counts WALL CLOCK; the two part company the
  instant the stream stalls to buffer — and every take here is a fresh fetch of
  a Drive file through `/api/media`, which answers `no-store`, so stalling is
  routine rather than rare. Armed once at `playing` and left alone, the timer
  fired however early the take had stalled, on every line. **Measured in a real
  Chromium rather than argued**: an 0.8s stall mid-take cost 0.87s of speech,
  which is exactly those three words. The timer now only ever *asks* — it
  re-reads `currentTime` and waits out whatever is genuinely left, so it can be
  late but never early — and `playing`/`waiting` re-arm it on the stall and the
  recovery. It is bounded (the take's own length again plus 10s) or a stream
  that stalls for good would leave "Play all" stopped on a line with no error
  to explain it. **The generalisation: any deadline computed once from a rate
  that can change is a bug waiting for the rate to change.** The `[rate]`
  re-arm two bullets down is the same lesson, caught earlier and only half
  learned — buffering is a rate change to zero.
- **Better still, the take no longer streams.** The panel already downloads
  every take to measure it, so it keeps the bytes as a blob and plays those:
  one `Blob` per take, and the stall the cut cannot survive is simply gone.
  Note the blob must be built BEFORE `decodeAudioData`, which detaches the
  buffer it is handed, and the URLs are revoked only on unmount — freeing them
  in the measuring effect's cleanup would pull the source out of a take that is
  playing, because that effect re-runs as the batch grows.
- **That cache must be keyed on the TAKE, not on the scene — and keying it
  wrong made every re-record inaudible.** A re-recorded take is a new Drive
  file (`VR Upload Audio` names it `<scene>-v<timestamp>.mp3`), so `Voiceover
  URL` changes every time; but the effect skipped on "does this scene have a
  duration yet" and its dependency was `withAudio.length`, which a replacement
  never moves. So the blob, the displayed length and the trim bounds all stayed
  with the recording that had just been thrown away, and the panel played it
  for the rest of the visit. **The symptom names the cause if you listen to
  it**: the producer reported that the download sounded completely different
  from the player, and the download link goes straight to the real URL without
  touching this cache — a difference between two surfaces reading the same
  record is a caching bug, not a generation one. The HTTP layer was never
  involved (`/api/media` sends `public, max-age=3600` on a full response, but
  the URL changes, so the browser cache is keyed past it).
- **The detection was wrong too, just far less wrong than it looked.** It
  measured RMS over 20ms windows while `silencedetect` measures sample
  MAGNITUDE, so `-45dB` meant something stricter here than on the server.
  **Two constants named the same thing are not the same threshold until they
  are measured the same way.** Worth modelling before believing: the gap is
  only about 3dB on a sustained vowel (an RMS window of a sine reads -3dB of
  its peak), i.e. ~0.12s on a take that lands softly — real, and not three
  words. Chasing it as the whole answer would have shipped a fix that changed
  almost nothing. Now sample-by-sample inward from each end, which matches the
  server and is *cheaper*: it reads the padding and never the speech.

- **The lengths on screen are the film's, not the file's.** `flagFor` judges
  speech against word count, `fitProblem` against the shot, and the render's
  scene length is `voiceDur + 0.35` off exactly this number — reporting the
  raw container length would leave all three measuring silence.
- **The take is stopped by a TIMER, not by `ended`**, because it now ends
  before the file does. `timeupdate` fires about four times a second, which
  would overshoot the cut by up to a quarter of the very pause being removed.
  The timer decides nothing on its own — see the stall entry above.
- **That timer is re-armed when the pace changes mid-take.** It was measured
  in real seconds against the old rate, so leaving it would cut early when
  slowed and late when sped up — and late means playing the padding the
  feature exists to remove. Verified in a browser: switching to 0.8× mid-take
  still cut at media position 2.65s, the tail bound, where an un-rearmed timer
  would have cut at ~2.2s and eaten half a second of speech.
- **Chapter openers are derived from the WHOLE film**, never from the takes on
  screen: judged on a partial pass, a scene in the middle of chapter 2 would
  look like an opener merely by being first in the batch, and the preview
  would put a pause where the film has none.
- Verified against fixtures with known padding (0.6s lead + 2.0s tone + 0.5s
  tail): lengths read 2.1s not 3.1s, an opener plays from 0, a mid-chapter
  take seeks to 0.55, and "Play all" advances at 2.70 / 2.68 / 2.13s against
  3.10s untrimmed.

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
stretch is clamped to `[0.65, 1.5]` and spills into a **bounced tail** past the
top (a frozen one until 2026-09-03, see below), so "slow" would mean slower in some scenes and stuttering in others; it
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

### Caption colour — per film, white by default

**Every video used to come out amber**, and that was never a choice anyone
made: the accent defaulted to `palette.primary`, which nothing upstream ever
set, so every film got `#E8B84B`. Two things made it louder than a highlight
should be — it painted the karaoke word AND every word the keyword rule
matched, and that rule counted any capitalised word. Romanian capitalises the
first word of every sentence, so on a dialogue script roughly half the words
on screen were yellow.

That default is gone (2026-08-27, `remotion/src/captionColor.ts`). **White,
with the spoken word marked by BRIGHTNESS rather than hue, is now the
default**, and it is the only choice that is right on every kind of footage —
an accent that sits well on a night dock is wrong on snow.

A colour is something a film opts INTO, chosen per project and stored as
`Editing Options.captionColor`:

| Where | What |
|---|---|
| the brief and Final touches | `CaptionColorPicker` — six swatches plus a native colour input, shown only while Captions are on |
| Orchestrator → `Normalize Webhook Input` | stores it, and ONLY when it is a real hex |
| Final Assembly → `Caption Colour` | copies it onto the render props |
| `remotion/src/captionColor.ts` | `resolveCaptionAccent()` has the final say |

Three things worth knowing:

- **Absence is the meaningful value.** The key is written only when a real hex
  was chosen, so a missing `captionColor` keeps meaning white — which is what
  every film made before this control existed should stay.
- **The render lifts a dark accent toward white** until it clears a luminance
  floor (0.32), because captions carry a heavy drop shadow and a deep colour
  disappears into its own shadow. So the picker cannot produce an illegible
  caption, and the swatch a producer picked may render slightly lighter.
- **`captionColor` is deliberately NOT `palette.primary`.** That field is also
  the outro's button and border colour, so tuning captions through it silently
  restyled the end screen — the original bug, and the reason for the separate
  prop.

**`POST /caption-color` on the render server derives an accent from the
montage itself, and nothing calls it yet.** `resolveCaptionAccent` already
anticipates it: a literal `auto` that nobody resolved to a hex falls back to
white rather than throwing. Wiring it would mean one HTTP node in Final
Assembly between the assemble and the graphics pass, and an "Auto from
footage" swatch.

### The SFX volume slider

`Editing Options.sfxLevel` (0–1) is how loud the scenes' own ambience sits
under the narration. It is chosen on the brief, in the SFX row, and the slider
only appears while the switch is on — a level for something switched off is a
decision with no subject.

The value travels as the GAIN, never as the percentage the slider shows: the
form converts once, at the edge, so the orchestrator, the project record and
`nativeAudio` in the assemble request all speak the same unit.

**0.35 is the default, and that is deliberate continuity** — it is the number
`Build Timeline` used to hard-code (raised from 0.25 in 2026-08-10 after a real
SFX-only render came back audible only in headphones). An untouched slider
therefore reproduces every film made before the control existed.

**The floor is 0.05, not 0.** Silence is what the SFX switch is for; a slider
that could reach zero would be a second, hidden off switch able to disagree
with the visible one.

The clamp is a refusal, not a correction — out of range or unparseable falls
back to 0.35 rather than guessing — and it exists in **three copies, one per
place the value passes through**:

| Where | What |
|---|---|
| `platform/lib/data/derive.ts` | `normalizeSfxLevel()`, also used by `createProject` |
| Orchestrator → `Normalize Webhook Input` | writes `sfxLevel` into Editing Options |
| Final Assembly → `Build Timeline` | reads it back, falls back to `SFX_LEVEL` |

Change one, change all three — the same rule `speed` already lives under.

**Final touches carries it too**, initialised from the stored value so the
slider shows what the film is actually set to. Two details there: the level is
a row's SETTING rather than a row of its own, so `changedKeys` cannot see it —
`sfxLevelMoved` is counted by hand, or moving only the slider would leave the
button reading "Keep initial settings" and silently discard the change. And
unlike `speed`, `sfxLevel` IS sent by `confirmFinalSettings`: the rule that
panel's `speed` note states is about controls it does not DISPLAY, where a
defaulted value would overwrite a choice made elsewhere.

**`SoundSettings` (under the finished video) still has only the switch.** It
writes `{sfx, music, speed}` and `updateEditingOptions` merges, so a stored
level survives a post-render sound change untouched — it just cannot be
changed from there.

### The music sits UNDER the voice now, and one slider position is one level (2026-09-10)

The producer's report was "muzica este proasta, se aude prea tare … in Premiere
am un efect, simple parametric eq, care face ca muzica sa se auda sub voce".
Two different defects wearing one complaint, and both are in the mix graph
(`buildMixGraph` in `assemble.mjs`, extracted as a pure function so the wiring
can be checked without an encoder — `npm run check:mix`).

- **The bed was never loudness-normalized, so `musicVolume` meant a different
  thing on every film.** The `Muzica` folder holds everything from a quiet
  ambient pad to a commercially mastered cue, and those differ by more than
  10 dB. At a fixed gain of 0.22 the first is inaudible and the second is
  blaring — the slider was not the problem, the missing measurement was. Every
  track is now measured (`loudnorm=print_format=json`, analysis only) and
  corrected with ONE constant `volume` to `MUSIC_TARGET_LUFS`.
  **Analysis, never loudnorm's own normalizing mode**: that rides the gain as
  it plays, which would fight the sidechain underneath it and pump the bed —
  the exact thing this section exists to stop.
  **-20 LUFS is below typical library music (-14 to -16), so the bed is also
  QUIETER than it used to be on an average track.** That is deliberate, it is
  the answer to "prea tare", and it is one constant to tune — not a default in
  four places. Note it changes the bed level on every film re-rendered from
  now on, which is the point.
- **The Premiere effect is a parametric EQ cut, and the honest version of it is
  DYNAMIC.** A static carve makes the music sound hollow even in the pauses.
  The bed is split at 300 Hz and 3800 Hz (two chained `acrossover`s — one split
  point each, so there is no list syntax to get wrong, and Linkwitz-Riley bands
  sum back flat), and only the SPEECH band ducks hard (ratio 20); body and air
  lean back (ratio 4). The music keeps sounding like music while the words stay
  clear, instead of the whole track pumping.
- **Release is 900ms on the speech band, up from 450.** A scene gap is 0.35s,
  so at 450 the bed surged back between every single sentence — that pumping is
  most of what "deranjant" was. At 900 it stays down through a scene gap and
  recovers over a chapter gap, where a breath belongs.
- **`acrossover` is asked for, not assumed** (`hasFilter`, cached per process).
  Bookworm ships ffmpeg 5.1 and has it, but a filtergraph naming a filter that
  is not there fails the WHOLE render minutes in, so the flat fallback (a
  static `equalizer` carve plus one broadband duck) keeps films rendering on a
  build without it. Which path ran is in the deploy log and in
  `verify.musicDuck`.
- **`verify` now carries `musicLufs`, `musicGainDb`, `musicVolume`,
  `musicDuck`** — the first place to look when someone says the music is wrong
  on one particular film.
- **The voice split is derived, not fixed at three.** It used to be
  `asplit=3` with two `anullsink`s for the branches nobody wanted; the band
  duck needs three keys. An unconsumed pad does not error, it STALLS the
  graph, which is exactly what `check:mix` audits across all 24 combinations
  of the switches — verified by mutation: restoring the old `asplit=3`, or
  miscounting an `amix`, makes it fail.

**Verified on the real ffmpeg the same day**, which is the half `check:mix`
cannot do: a throwaway workflow called `/assemble` directly (two scenes from
the database, the second take doubling as the bed — the graph does not care
what the music IS, only that it is audio), job `efdea227`, `status: done`,
and the answer that mattered — **`musicDuck: "bands"`**. So `acrossover` is
present on the container and the band-split path is what production runs; the
static fallback is insurance, not the shipped behaviour. `musicLufs: -24.3`
with `musicGainDb: +4.25` proves the measurement and the correction are live
too. Note what that particular number is NOT: the "music" there was a
voiceover take, so it says the mechanism works, not that the balance on a real
bed is right. **That judgement needs an ear on a real film** — the numbers to
read are in `verify`.

What none of this fixes is WHICH track plays. "Muzica este proasta" is partly
that: a tone with no folder of its own falls back to `Default` and the pick
inside a pool is random. Add a folder named after the tone, or pin a track in
the picker.

### The background track is choosable now (2026-09-06)

The producer asked whether the Drive music is used at all; the honest answer
was "yes, but you find out WHICH track by watching the finished film". Now:

- **`Editing Options.musicTrack` = `{id, name}` or null (auto).** The pin says
  WHICH track; `music` still says WHETHER there is one — same split as
  sfx/sfxLevel. `normalizeMusicTrack` in derive.ts refuses anything without a
  usable Drive id, because a malformed pin that still looked pinned would make
  the render build a proxy URL for a file that does not exist.
- **`Pick Music Track` (Final Assembly, active `7d92a519`) checks the pin
  FIRST** and returns it with `matched: 'pinned'`; absent, the old order runs
  untouched (tone subfolder → tone-in-name → default* → any, random in pool).
- **Workflow `Music Library` (`xBRdtrArbbi89yvX`)**: `list-music` walks the
  Drive `Muzica` folder + subfolders → `{tracks:[{id,name,group}]}` (47 tracks
  in 8 tone folders at build time); `share-music {id}` makes one file
  anyone-with-link (idempotent) and answers its `uc?export=download` URL.
  `create_workflow_from_code` skipped the credential on all three raw Drive
  HTTP nodes again — third occurrence of that trap — fixed with
  `setNodeCredential` before publish.
- **The preview must SHARE before it plays.** `/api/media` fetches Drive with
  no session, so an unshared file answers HTML and the `<audio>` refuses it.
  `MusicPicker` POSTs `/api/music {id}` once per track, then plays
  `/api/media?id=…`. `/api/music` GET caches the list 10 min per instance.
- **`MusicPicker` is a standalone self-saving card BESIDE `FinalSettings`,
  not a row inside it**: that panel batches its choices into one confirm that
  also STARTS the render, and a music audition must be free to happen without
  arming that button. Saves via `saveMusicTrack` (merge-write of the one key).
  Own `MusicPicker.module.css` per the CSS-modules rule. The assembly panel
  prints which track the running render mixes ("aleasă automat după ton" when
  no pin), because that used to be invisible until the film arrived.

**The music bed has a volume now, like the effects (2026-09-09).**
`Editing Options.musicLevel` (0.05–1) is how loud the background TRACK sits
under the narration, before the sidechain duck. Chosen on the brief's Music
row (slider shown only while Music is on) and again in Final touches;
`SoundSettings` keeps only the switch, exactly like `sfxLevel`.

- **0.22 is the default, and that is continuity**: it is the `volume=0.22`
  the mix graph in `assemble.mjs` has carried since the music bed existed, so
  an untouched slider reproduces every film made before the control. Steps of
  1 on the slider (not 5) so that default sits on the scale.
- **The accents are NOT scaled by it.** The boom/whoosh/riser at the cuts keep
  their fixed levels (0.45 / 0.4 / 0.35): they are moments, not a bed, and a
  slider that made the hook boom twice as loud would be a surprise nobody
  asked for. The label says "Music volume"; it means the track.
- The refusal rule has **three copies plus the server's own clamp**:
  `normalizeMusicLevel` in derive.ts, the orchestrator's `Normalize Webhook
  Input` (writes it at creation from `music_level`), Final Assembly's
  `Build Timeline` (sends it as `musicVolume`, only while music is on), and
  `/assemble` (reads `musicVolume`, falls back to 0.22). Change one, change
  all. An older server build simply ignores the key.
- Verified on the disposable film — see the checked-in record below.

**The library connection, checked end to end (2026-09-09)**, because the
producer asked whether it really works:

- `list-music` answers 47 tracks in 8 tone folders in ~1.2 s (execution
  11646); `share-music` answers in ~0.35 s; the Railway `/media?id=` proxy the
  render fetches through serves the file (`200 audio/mpeg`, 3.84 MB). A
  render with music on (11530, "Peking to Paris") carried a real `musicUrl`
  and succeeded.
- **The `Muzica` folder is shared "anyone with the link → EDITOR"**, and every
  track inherits it: the share nodes ask for `reader`, Drive answers
  `role: writer` because the inherited grant is the wider one. Nothing in the
  pipeline needs more than reader, so this is a Drive setting worth turning
  down to Viewer — it is the producer's folder, not a code change.
- **A tone with no folder falls back to `Default`, not to the nearest tone.**
  `Match Tone Folder` matches the folder name against `Tonalitate`; a
  Dramatic film found no `Dramatic` folder and got a track from `Default`
  ("Curious Story"). Adding a folder named after the tone is the whole fix;
  the auto pick is random inside the pool, so pin a track when it matters.
- **`/media` on Railway answers 401 to HEAD** — the auth exemption tests
  `method === 'GET'`. Harmless (ffmpeg GETs), but a HEAD-based health probe
  would read as broken.

### Remotion / the edit

- **The karaoke highlight is ANCHORED to the take and estimated inside it —
  and it used to be a straight division** (2026-09-10, `src/captionTiming.ts`).
  Reported as captions that are not on the voice, sometimes with a big lag.
  Everything about the scene-level timing was already right and is worth
  knowing before suspecting it again: `startSeconds` comes from
  `verify.sceneStartsSeconds` (frame-snapped), `durationSeconds` is the gap to
  the next start, `speechSeconds` is the ffprobe'd take, the voice is placed at
  offset 0 of its scene by the ffmpeg graph, and the speed re-time scales
  picture and sound together. So **the highlight is exact at every scene start
  and drifts within the scene** — which is why it looked intermittent.
  The cause was `perWord = speech / words.length`: "și" and
  "responsabilitatea" got identical slots. Measured on real scenes, 0.3–0.65s
  of drift mid-scene, one to two words. Each word now costs a small onset plus
  its syllables plus the pause that follows a clause or a full stop, normalized
  to the take — **anchored at both ends**, so the first word starts with the
  take, the last ends with it, and an error cannot accumulate past one scene.
  Scored against the six ffprobe'd takes of the fixture it predicts a take's
  real length to 0.42s against 0.95s for the best possible uniform rate.
  Three things to keep:
  - **It is an estimate of a performance and cannot be made exact.**
    ElevenLabs is non-deterministic — the same line comes back at different
    lengths — so no model of the text can close the gap. The exact answer is
    `/v1/text-to-speech/{id}/with-timestamps`, which returns per-character
    times with the synthesis; that makes the module a lookup, needs the TTS
    nodes changed and a field on the scene, and cannot reach a film already
    made. That last part is why the model exists.
  - **The chapter opener is still early, by design elsewhere.** The breath
    trim deliberately KEEPS the lead-in silence on a scene that opens a
    chapter, so its `voiceDur` starts with 0.2–0.6s of nothing while the
    captions start at word one. The render cannot know that number — closing
    it means `assemble.mjs` reporting a `speechStartsSeconds` array and
    `Build Remotion Props` passing it. Until then it is the one systematic
    offset left.
  - **`captionAt` lives in `captionTiming.ts`, not in the component**, so the
    whole decision can be walked frame by frame without React —
    `npm run check:captions` does exactly that over a fixture and asserts the
    highlight never runs backwards, always sits inside the chunk on screen,
    starts each scene on its first word and ends on its last. An off-by-one
    between the chunk list and the timing list would show a caption on time
    with the wrong word lit, and no still can catch that.
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
  exactly on the comparison. (The composition is 24 since 2026-09-03, so that
  mismatch is gone; the lead and the epsilon remain, because they are what puts
  a boundary on the nearest frame rather than the next one.) There the decoder's arithmetic and this
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
- **A scene that outruns its clip BOUNCES now; it used to freeze.** Elastic
  timing gives every scene the length of its own narration and stretches the
  clip to fill it, clamped at 1.5×. Past that the remainder was
  `tpad=stop_mode=clone` — the last frame held still — which on the Boyd film
  meant five seconds of a frozen picture under a voice still talking. The tail
  is now the END OF THE CLIP PLAYED BACKWARDS: nothing jumps, because the seam
  is the same frame twice, and on ambient footage a bounce reads as continuous
  motion rather than as a loop. Bounded at six seconds because `reverse`
  buffers every frame it receives (~200 MB at 1280x720, and this box has lost
  renders to memory before); anything past that still clones. Measured with
  `freezedetect` on the exact worst case — 8s clip, 17.04s scene — the frozen
  time went from 5.08s to zero, with the frame count unchanged at 409.
- **The composition renders at 24, because the film underneath is 24.** It was
  30 over a montage `/assemble` encodes at `OUT_FPS = 24`, which cost two
  things. The frames: 25% more of them than the film contains, at roughly two
  a second on a box with no GPU. And the ties: every scene cut then sat at
  .0/.25/.5/.75 of a composition frame, and the .5 ones land exactly on the
  comparison that decides which shot a frame belongs to — which is the whole
  one-frame-pop saga below. The half-frame lead and the epsilon STAY (they are
  general, and they are what makes a boundary land on the nearest frame), but
  at 24 the tie cannot arise: every boundary the montage can produce is
  already a whole frame here.
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
- **No film had a chapter title for three weeks, and nothing failed.**
  `Build Remotion Props` parses the `[CHAPTER n: title]` markers out of the
  linked script, and `Fetch Script Titles` fed it by taking the script id from
  the project's `scripts` field — an Airtable REVERSE LINK that `hov.at_project`
  never emitted (look at the view in `db/002_airtable_compat.sql`: the link is
  stored the other way round, on the script, as `Associated Project`). So the
  expression fell through to its own fallback and queried the literal id
  `'missing'`, every query since the 15 Aug cutover returned no row, and
  `chapterTitles` reached the render as `{}`.
  Nothing errored, because `ImpactCard` has a fallback for exactly this: the
  first eight words of the scene's own narration. That is the failure mode
  worth remembering — **the card printed the opening words of the line the
  voice says one beat later**, over a graphic whose whole job is to show what
  is NOT being said. Four cards did it on the 71-scene Boyd film while the real
  titles ("The Floor, the Clock, and the Decision", …) sat in the script the
  whole time. The lookup now asks the script instead, filtering `at_script`'s
  own `Associated Project`, newest first — **through the view, not the base
  table**, because everything else in that workflow reads a `hov.at_*` view and
  the render path should not be the first thing to discover a missing
  base-table grant. Verified on a throwaway read-only workflow before
  publishing. Rollback and the full account: `db/port/chapter-titles-and-repetition/`.
  **Generalises to the whole migration: a link field that existed only in
  Airtable does not raise, it resolves to nothing** — and a lookup with a
  string fallback (`|| 'missing'`) turns that into a query that succeeds and
  returns zero rows. Grep the ported workflows for reverse links before
  trusting one.
- **A card that holds a variable-length line cannot have a fixed type size.**
  `ImpactCard`'s title was a flat `px(52)`, picked for the long case — the
  eight-word narration excerpt it falls back to when no chapter title arrives
  (which, until 2026-09-03, was every project — see the entry above). A real chapter title is three words, so
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
  nothing about the two pictures either side matches.
- **A card is a CUTAWAY, so the footage RESUMES across it — this entry used to
  say the opposite, and the opposite was reported as a bug.** The planner
  crossed the framing over a card on the reasoning that "the two footage shots
  never touch on screen, so there is no zoom jump to see". They are the same
  clip two or three seconds apart, and the eye holds a picture that long: the
  producer saw the zoom jump at the card and said so (2026-09-03), which is the
  same defect the whole "a cut is a change of picture" rule exists to prevent,
  arriving through the one door left open to it. A real cutaway returns to the
  shot it left. The tail now picks up the head's framing INCLUDING where its
  push and drift had carried it — re-entering on the head's base framing would
  step back by that much — and `check:montage` asserts it with a synthetic card
  on every fixture ("cutaway resume"). Intensity 0 carries the same
  continuation for its 1% pan, for the same reason.
- **Both of a card's cuts are flared** (`CutFlash` in `Transitions.tsx`,
  rendered after the card sequences so the light burns over the card too). A
  card replaces the picture when it arrives and again when it leaves; the
  chapter card has owned its own light leak since the slide was removed, and
  the motif cards were left with a 0.22s opacity fade — which is a dissolve
  between two unrelated pictures, the one thing a cut must not look like. Same
  envelope and the same peak-on-the-cut placement as everything else here, at a
  shorter `half` (0.3) because a card only runs two and a half to four seconds.
  The exit sweeps the other way, exactly as `ImpactCard`'s does.
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
- The card is ink with the accent, revealed by a fast settle. **Its own body
  still uses no light leak** — that would make two full-frame light cards
  confusable — but since 2026-09-03 the CUTS either side of it are flared by
  `CutFlash`, which is a different job: the leak there hides a change of
  picture, it does not decorate the card.
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
  between them; `timeline` (`TimelineCard`, 2026-09-03) measures a dimension
  line out across a span of years and marks each date at its REAL distance from
  the others, so what it shows is the shape of the span; `compare`
  (`CompareCard`, 2026-09-09) grows two bars from one baseline with the figures
  riding their ends, so what it shows is the RATIO; `steps` (`StepsCard`,
  2026-09-09) rules a spine down the frame and lands three to five beats on it
  one at a time, so what it shows is the SHAPE of a stretch of story. The planner needed no
  change at all to gain any of them — it places TIME and is written never to see
  what a card holds — so the only wiring is the variant dispatch in
  `FinalVideo`'s `renderCard`. Four rules came out of building them:
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
  - **The motif a film needs is the one you have not built, and the model will
    try to fake it with what exists.** The first real film to reach the chain
    was a life told in dates. `route` wants a journey, `schedule` wants clock
    times, so the model rendered the years 1893 and 1896 as `18:93` and
    `18:96` — the validator rejected them and the film shipped with nothing.
    That is not a prompt failure to be scolded out; it is a missing motif, and
    the empty answer's `none_because` line exists precisely to name it.
    `timeline` is the answer to that specific report, and its proportional
    spacing is the reason it is a motif rather than a list: a list of years
    typeset down the frame would be the script again.
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

  **Updated 2026-09-09 — the producer reported that no project had any
  animation, and they were right about the symptom and the cause both.** Two
  separate things were true at once, and neither was a broken node:

  - Films were getting `drawnCards: false`. On the Rome film (exec 11398) the
    project record carried it beside `chapterCards: false` and
    `hookTitle: false`, so `Draw Cards?` sent 0 items to the model and the
    chain never ran. That is the producer having switched three finishes off on
    the brief, working exactly as designed — **check the project's Editing
    Options before debugging the chain.**
  - Where it DID run, the model correctly returned nothing. The fable film
    (exec 11332) reached `Validate Motif Cards` with `motifCards: []` and an
    empty `motifReport`, which is the signature of a model that proposed
    nothing rather than a validator that refused something. Three motifs all
    want a documentary; that film is a snail racing a turtle.

  So the answer was the one this file already prescribes — MORE MOTIFS — and
  the two built from it are `compare` and `steps`, live in Scripting as
  version `fd27296a`. `steps` is the one that changes the coverage: its beats
  are quoted from three to five DIFFERENT scenes, which makes it a compression
  of a stretch of film rather than one scene typeset, and almost any story that
  goes somewhere can answer it.

  **A live defect in the validator came out of building them, and it had been
  silently refusing truthful cards for as long as the chain has existed:** its
  number-word map held only Romanian, while the films are mostly written in
  English. `quoteStatesTime` could not read "the ferry at five twenty" and a
  compare note reading "six times fewer" proved nothing — both answering "the
  film does not state that" about a film that states it in as many words. Found
  by running a real card through `check-motif.mjs`, not by reading the code.

  **And the apply produced a textbook instance of this section's own warning.**
  The validator's number-separator class holds a no-break space and a narrow
  no-break space, and the first apply sent them as `\u00A0` / `\u202F` escapes
  — which were decoded back into the invisible characters themselves in
  transit. Byte-identical to nothing, working perfectly, and caught ONLY by the
  mandatory diff. It is now `\p{Zs}`, ASCII all the way down, exactly as `norm`
  already uses `\p{M}`. **Prefer a property escape to any list of characters
  you cannot see.**

  **What the derived figure card looks like changed in the same pass**, because
  it is the card almost every film actually gets and it was the one the
  producer was really looking at: a year, set large, fading in with a 3% scale
  settle. Its digits now roll into place one after another on a deterministic
  counter — a different mechanism from the schedule board's flap, which pinches
  through the horizontal — with a rule drawing under them and the kicker rising
  in last. And the ground every drawn card prints on is `preset.cardGround`,
  per tone, where four components used to hold the same hardcoded `#0B0A08`:
  that single constant is most of why every project's graphics looked like
  every other project's.

  **Updated 2026-09-03, after the first film that actually reached it.** Two
  truthful cards were proposed and none shipped. Provenance is no longer a map
  keyed by path (`stops[2]`, `rows[1].value`): every stop, row and mark carries
  its own `source` and a note carries `noteSource`, because the route card's
  only source arrived filed under `rows[0].value` — a key belonging to a
  different motif — and a card whose strings were all true was dropped for
  having none. The old map is still read as a fallback. The parser's example
  now shows one card per VARIANT instead of one card wearing two motifs'
  fields, which is what invited the mis-keying. Three nodes changed
  (`Choose Motif Cards`, `Motif Parser`, `Validate Motif Cards`), all three
  diffed byte-for-byte against `db/port/motif-cards/paste/` after publishing.

  **And `Attach Motif Cards` was saved into Final Assembly on 08-27 but never
  published** — the render path ran without it until 09-02, while this file and
  that README both said it was live. The 08-27 diff had been run against the
  DRAFT. `versionId` is what you edited; `activeVersionId` is what production
  executes, and only the second one is evidence.
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
  but it may not force one: a card that repeats the narration ships while an
  empty array only asks a question. **The backlog worked as designed once:**
  the 71-scene Boyd film offered dates and sums, `route` and `schedule` could
  take neither, and `timeline` was built from that (2026-09-03). Expect the
  next one to arrive the same way — from a film that got nothing, not from a
  brainstorm. So an empty answer must carry
  `none_because` — one line naming what the film DID offer that no motif could
  draw — and `Validate Motif Cards` logs it as `MOTIF NONE: …`. That log is the
  backlog: it is how the third motif gets chosen, and it is also what stops "no
  cards" and "the node is broken" from looking identical.

**Updated 2026-09-12 — "pe absolut fiecare videoclip este aceeasi animatie de
cacat", and the count says so: of the 18 most recent films, exactly ONE carried
a motif card.** With `motifCards` empty, `Attach Motif Cards` leaves
`body.textCards` unset and the render falls back to DERIVING figure cards from
the narration — a year, set large — which is identical on every film. Three
causes, each found in a real execution:

- **The validator refused truthful cards over bookkeeping.** Peking to Paris
  (execution 9952) proposed a four-stop route and it was dropped for
  `stops[0] cites undefined`: the model filed its research ref as
  `{"kind":"evidence","from":"E3"}` while the validator read `src.ref`. The
  prompt's PROSE says `ref` — but its structured EXAMPLE showed only `quote`
  sources, whose text lives in `from`, and **a model copies the example it can
  see; prose that contradicts the example loses**. This is the third time a
  card has died of mis-keyed provenance. The validator now reads
  `src.ref ?? src.from`, and the example carries an evidence stop.
- **A route could never satisfy the no-spoiler rule.** With that fixed the same
  card died on "quotes scene 8, which the film has not reached at scene 7". A
  route is a map of the WHOLE journey, so anchored before its destination it
  cites forward and anchored after it is a summary — the rule made the motif
  unsatisfiable. Lifted for `route` only; provenance is untouched, every stop
  must still be verbatim in a real scene.
- **`drawnCards: false` silenced only half of what it names.** It gates
  Scripting's `Draw Cards?` and `Attach Motif Cards` — not the render's own
  derivation, which nothing gated — so six of those eighteen films had the
  switch OFF and still drew the year card. `Build Remotion Props` now sends
  `showTextCards: opts.drawnCards !== false`. **This is the one fix that
  reaches films already made**: switch it off and re-render, no re-scripting.
  Related trap: the Burj film had it off at scripting time and reads `true`
  today because Final touches turned it on later — which cannot work, since
  Scripting stored no cards. "Switching back on restores the list exactly" is
  true only if the brief left it ON.

Deliberately NOT changed: the timeline's strictly-increasing-years rule (the
same film's timeline had three marks all at `1907`, which would stack on one
another — the route was the right motif for it), and the Aston Martin failures,
whose payload turned out to predate the 09-03 provenance fix. **Read the
model's actual payload before fixing a rule its report line accuses.** Live as
Scripting `05bf7412` and Final Assembly `559cde3c`; full account, the refused
card as a runnable fixture, and what is still owed: `db/port/motif-rescue/`.


### `/inspect?save=1` — a contact sheet as a URL, for the judges

`GET /inspect?url=<media>&mode=sheet&interval=1&save=1` writes the sheet
under `/output` and answers `{file, url}` instead of streaming the JPEG.
Added 2026-09-13 for Media Generation's motion judge.

The reason is n8n's execution data, not convenience. A vision model has to be
given the picture somehow, and base64 in the request body means every sheet
travels through the execution on a node that runs once per clip of an
eighty-scene film — hundreds of kB each. A URL costs nothing, and it is
already how `Consistency Judge` feeds gpt-4o the frame it judges. `/output`
is deliberately key-free with unguessable names (the comment in `index.mjs`
says why), which is what makes this possible without opening anything up.

Two details worth keeping:

- **Sheets are swept after two hours** on the way past, best-effort, so a
  long pass cannot fill the container's disk with pictures nobody will open.
- **The URL respects `x-forwarded-proto`.** Behind Railway's proxy
  `req.protocol` is `http`, and the URL is handed to OpenAI to fetch. Plain
  http worked on the day, but it is the kind of thing a third-party fetcher
  tightens up on later. (`/render/:id/status`'s `outputUrl` still has the
  unguarded form; it is only ever read by n8n and the site, so it was left
  alone rather than touched for tidiness.)

Measured end to end on an 8s, 7 MB Flow clip: download + ffmpeg + the gpt-4o
read, **3.2 seconds total**, 1,410 prompt tokens at `detail: 'high'`.
`detail: 'low'` is cheaper and is what the still judge uses, but it
downscales the whole grid to 512 px — which is exactly where the movement
lives.

### The first film to mix sources died at the join — SAR (2026-09-15)

The producer confirmed Final touches on the NASA film and got a panel reading
*"Getting ready to assemble · Not started yet — Media Generation is still
running on this film, for 1040m 18s now. Nothing is stuck."* Nothing was
rendering, and nothing had been for hours.

**Two independent faults, and the second is why the first went unnoticed.**

**1. The render was firing and dying, forty seconds in, every time.** Three
Final Assembly executions that day (12:31, 12:52, 13:36), all `error`, all at
`Render Guard` after six polls. n8n's own error text is useless here — it
prints the tail of the ffmpeg command line and nothing else, exactly as this
file's ffmpeg-thread entry warns. The reason is in `Check Render`'s output
(`error`, ~65 kB), at the very END of it:

```
[Parsed_concat_167] Input link in0:v0 parameters (size 1280x720, SAR 0:1)
  do not match the corresponding output link in0:v0 parameters
  (1280x720, SAR 12735:12736)
[Parsed_concat_167] Failed to configure output pad
Error reinitializing filters! ... Conversion failed!
```

**SAR is the sample (pixel) aspect ratio, and `concat` compares it as exact
integers.** `12735:12736` is one part in twelve thousand off square — invisible
to a human, fatal to the filter. `0:1` means "undeclared", which displays
identically to `1:1` and compares unequal to it. And `scale` does not square
the SAR: it PRESERVES the source's display aspect by writing whatever output
SAR makes the arithmetic work, so the cover-fit
`scale=W:H:force_original_aspect_ratio=increase,crop=W:H` hands a clip's
oddity straight through to the join.

**It stayed invisible for months because every clip in a film came from the
same place.** Veo clips, via Drive, all identical. The NASA film was the first
to MIX — three of its nine clips came from the media store as archive footage,
six from Drive — and documentary mode is what made that possible. So this is a
latent fault of the footage engine that only a finished documentary could
find, which is exactly the "click through it once on a real project" that was
still owed.

The fix is one filter and it is a visual no-op: after the crop the frame IS
exactly W×H of square pixels, so `setsar=1` only says so. It lives in an
exported `coverFit(W, H)` in `remotion/server/assemble.mjs` — a function, not
an inline string, so `npm run check:sar` can assert on the code that actually
runs and can also assert the file spells the cover-fit exactly ONCE. Same
addition in `platform/lib/archive/kenburns.ts`, which writes archive stills:
that one does not unblock an existing film (the render normalises again at
assemble time regardless of what is stored), it stops a clip being WRITTEN
with a pixel aspect no other clip has.

**There is no ffmpeg in a Claude Code web session, so the check pins the graph
and the film pins the check.** `check-sar.mjs` was verified by removing
`setsar` and watching it drop to 3/6 — a check never run against the bug it
describes is a comment with a test runner attached.

**Verified by the film, the same afternoon.** Railway deploy `b5e04c5e`, then
the assemble webhook re-fired for `recC5uy63NuUgeHD7`: execution `13615`,
13:53:28 → 13:59:00, **success in 5m 32s**, where the three before it died at
37s, 43s and 35s. The project reads `Finalizat` with a `final_video_url`, and
the render server's own log shows all nine scenes trimmed and the music
ducked before the join it used to fail at. That is the proof the check
cannot give.

**2. A wedged upstream execution made the panel lie for hours.**
`getAssemblyState` returned `upstream` BEFORE it looked for a recent failure,
so while any worker execution was alive the failure branch was unreachable. A
Media Generation execution had been stuck in `running` since the previous
evening — the zombie this file's own `isStalled` entry describes — so the
panel printed "Nothing is stuck: the render begins once that pass hands over"
over three dead renders, and counted the zombie's age up past seventeen hours
while it did. **A verdict computed in the wrong order is worse than no
verdict**: the producer waited on a promise the system could not keep.

Now a recent Final Assembly failure outranks any upstream execution, and an
upstream that is `isStalled` is reported as `upstreamStalled` so the panel
says *"Media Generation has been running for 17h 22m — far longer than a real
pass takes, so it is almost certainly wedged"* and points at Restart
production. **The verdict itself is unchanged on purpose**: dropping a stalled
execution would make the panel offer a render restart, and firing assemble
while media generation is genuinely still working renders the film SHORT, with
only the scenes approved so far. The panel changes what it says, never what it
does.

**The general rule, which this is the second instance of.** When a status
panel has several possible answers, the order it tries them in is a design
decision with teeth: put the reassuring answer first and it will one day be
printed over the alarming one. Failures rank above "still working", always.
