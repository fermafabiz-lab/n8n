# Lessons — the pipeline's content decisions

Part of the split of the old monolithic `CLAUDE.md` (2026-09-13). Read the
root `CLAUDE.md` first. This file is what Claude Scripting and Media
Generation actually WRITE and CHOOSE: story structure, repetition and ending
guards, evidence retrieval, character/set consistency, the hook, genre/
category rules (cinematic, kids), which video model and how content refusals
are handled, the batch cap and multi-voice assignment, and the reference
image for scene 1.

These each cost hours. Do not rediscover them.

### The clip's Flow identity is stored now (2026-09-04)

`Extract Video URL` has always pulled `mediaGenerationId` out of the Flow
response as `Video_Media_Id`, and nothing ever stored it: the moment the clip
reached Drive, its identity at Google was gone. `POST /videos/upscale` takes a
mediaGenerationId, so **no film made before 2026-09-04 can ever be upscaled** —
the bytes are on Drive and Flow cannot say which generation they came from.

`db/006_video_media_id.sql` adds the nullable column plus its row in
`hov.airtable_field`. Note the ordering it forces: **the site's copy of the
field map (`SCENE_FIELDS` in platform/lib/data/postgres.ts) must deploy BEFORE
n8n starts sending the field**, because both clip writes go through
`/api/media/ingest` and an unmapped name throws there rather than being
dropped — sending it early would break every clip write in production.

### The credit strategy: free is the default, forever (2026-09-03)

Measured on the account itself (`GET /accounts/{email}` returns `credits` and a
per-model `creditCost`), not quoted from anywhere: the allowance is **25,050
credits a month**, and an 8-second clip costs **0** on
`veo-3.1-lite-low-priority`, **5** on `veo-3.1-lite`, **10** on
`veo-3.1-fast`, **100** on `veo-3.1-quality`. Credits refresh monthly and do
not roll over.

The target volume is three films a day of eighty scenes — **7,200 clips a
month**. That is 72,000 credits on Fast and 720,000 on Quality. **No paid tier
can be the default**, which is the whole reason the Ultra $199 plan exists: the
lower-priority tier is free at any volume. So quality comes from the INPUTS,
and credits buy only the exceptions that do not grow with scene count.

What that looks like in the pipeline:

- **The model is chosen per scene in `Current Scene`** — free by default,
  `Editing Options.videoModel` overrides, the HOOK gets Quality (one clip per
  film, the one that decides whether it is watched), and a shot refused twice
  is rescued on Quality. Chosen there because three edges reach `Submit Video`
  and all three read `$('Current Scene')`.
- **The rescue fires in `Prep Video Regen`, not on the main path**, because the
  main path only submits scenes with NO clip — a third attempt can only arrive
  through the regen. **The take counter is the scene's own draft list**
  (`Versiuni Media`): every regeneration files the outgoing clip there, so its
  length is the number of takes already tried. No new field.
- **Seeds are derived, not stored**: `hash(sceneId + ':' + takes)`. A re-roll
  is a different take by construction; a first take is reproducible.
- **Two takes per submission (`count: 2`) is free and deliberately OFF.** At
  this volume the scarce resource is QUEUE TIME, not credits — a second take of
  every scene halves the throughput ceiling to save a click on the tenth that
  needs it — and take B has nowhere to live until it goes through the same
  Drive re-host as the live clip (a Flow URL dies in ~6 h).
- **Throughput, not credits, is the wall at three films a day.** 240 clips a
  day at 60-180 s each on a lower-priority queue is most of a day of wall
  clock. useapi load-balances across MULTIPLE Google accounts when `email` is
  omitted, so the scaling lever is another Ultra account — which also brings
  another 25,050 credits — not a better model.
- **An upscale cannot be applied to a finished film.** `POST /videos/upscale`
  takes a Flow `mediaGenerationId`; our final film is ffmpeg-assembled from the
  clips and has no such id. Upscaling means upscaling every CLIP and
  re-assembling: 1080p is free per clip, 4K is 50 (an eighty-scene film =
  4,000).

Rollback and the full account: `db/port/free-tier-quality/`.

### Motion prompts must say WHICH WAY (2026-09-03)

A race film came back with one car driving the wrong way down the track —
unpostable, and nobody asked for it. The cause is in the prompt, not the model.

`video_motion_prompt` names a camera move and an action and stops. From a real
film in the database: *"Tracking shot as the BMW M8 lunges forward **from a low
front three-quarter angle** … heat haze ripples above the highway and **towers
streak past**."* The camera sees the car's front, the car moves forward, the
towers stream by — and nothing in that sentence settles whether the world comes
toward the lens or recedes from it. Veo starts from the still and invents
whatever the words leave open, differently in different scenes. Another scene
of the same film says "into **thicker boulevard traffic**" without saying which
way the traffic goes.

So rule 6 of the segmenter now makes direction mandatory and anchors it to the
STILL rather than to taste: say which way relative to frame and camera, and
agree with the composition the image prompt already fixed — **a car framed from
behind drives away, a car framed head-on comes toward the camera** — and
everything else that moves (traffic, competitors, crowds) travels the same way
unless the narration says otherwise. The negative clause gained the same rule
from the other side.

**The half that matters for films already made is the SUBMIT-time clause.** The
segmenter rule only reaches scripts written after it; `Submit Video` and
`Submit Video Regen` now append the continuity sentence beside the audio one,
so every existing film and every regeneration gets it. The two submit paths
must keep agreeing — a re-rolled clip obeying a different rule from its
neighbours is the same defect wearing a different hat.

Two honest limits: a negative is a preference and not a constraint, so this
reduces the failure rather than removing it (the producer's video gate is still
the backstop); and **the model string is the bigger dial** —
`veo-3.1-lite-low-priority` is the weakest on offer and is free on the Ultra
plan, so anything better is a credit decision, not a code one. It lives in
three places that must agree, exactly like the image model string.

Full account and rollback: `db/port/motion-direction/`.

### Video quality is a per-film choice now, and the prompts carry a physics clause (2026-09-04)

Two answers to the producer's "ghost cars driving through each other, a man
buried to his hips in mud, a car starting without a driver — we pay €300-400
a month for this":

- **The brief has a "Video quality" picker** (Free / Better 5cr / Fast 10cr /
  Cinema 100cr per 8s clip), priced with the film's own arithmetic before the
  choice is bought. It writes `Editing Options.videoModel` through
  `Normalize Webhook Input` — the key `Current Scene` has READ since 09-03
  with nothing ever writing it, so every film ran on the weakest (free)
  model. The id list is whitelisted in THREE places that must agree
  (`VIDEO_MODELS` in derive.ts, the form's `VIDEO_TIERS`, Normalize's
  whitelist): the string reaches the Flow API verbatim and an unknown id
  kills a batch slowly. Absence = free default, like captionColor's white.
- **Both submit paths append a Physics clause** beside the continuity one
  (`Current Scene`'s videoRequest and `Submit Video Regen`): solid objects
  never pass through each other or sink into the ground, moving vehicles
  have drivers, nothing floats/melts/morphs. Submit-time, so existing films
  and regenerations get it too. A negative is a preference, not a constraint
  — the model TIER is the bigger dial, which is what the picker is for.

### The producer's direction: brief + must-includes, verified (2026-09-06)

The cheapest quality lever left: the writer used to receive a five-word
title and guess the rest. Two optional fields on `/new` now carry the
producer's intent, and the mandatory half is CHECKED, not requested:

- **"What the film should really be about"** (`brief`, ≤2000 chars) — the
  angle in the producer's own words. Injected as PRODUCER'S DIRECTION into
  `Generate Story Bible` and `Generate Outline` ("where this differs from
  your own reading of the Tema, THIS wins").
- **"Must appear in the film"** (`must_haves`, ≤3 lines) — injected into the
  outline and `Write Full Narration` as MUST APPEAR, and **verified by
  `Narration Guard`**: a point counts as present when at least half of its
  meaningful terms (4+ letters, diacritics folded) appear in the narration;
  a miss goes back to the editor through the existing `editorFeedback` path
  (same MAX_RETRIES=2, same accept-anyway ending). An instruction in a
  prompt is not a constraint; this is.
- **"✨ Develop my idea"** — `/api/expand-brief` → n8n workflow `Expand
  Brief` (`NPES1DrI2d3lifQp`, webhook `expand-brief`, one OpenAI call, keys
  stay in n8n): 2-4 sentences developing the producer's OWN idea, in the
  film's language, filled into the editable textarea. Any failure leaves the
  typed text untouched.

Both are stored in Editing Options (`producerBrief`, `mustInclude`) —
**unlike Lore, which is never stored and dies on restart-scripting** — and
all four prompt/guard injections read them via
`$('Fetch Project Record')`, wrapped in try/catch IIFEs that return `''`
when absent, so classic projects render byte-identical prompts. The four
touched Scripting nodes were byte-diffed against the active version before
publish (only they differed; connections untouched).

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
- **An image refusal is retried in place, escalating, up to four times —
  and the pipeline's own notes are never fed back as feedback** (2026-09-01,
  active version `95f1a1f0`). The chain used to be one automatic rewrite,
  then `Loop Images` moved on with the scene flagged; the gate's regen then
  built its prompt from `Imagine First Frame` PLUS `Observații Scenă` as an
  "ADJUSTMENT REQUEST" — and that field held the pipeline's own
  `AUTO-REWRITE: fal.ai rejected the previous image…` note, so the second
  attempt carried the refusal into the prompt and was refused again, after
  which `Mark Image Regen Rejected` cleared the flag and the scene sat with
  no image. The image gate cannot open while any scene has no picture, so
  ten such scenes froze the whole 71-scene Vegas film at that gate.
  Now `Prep Flow Reject` counts attempts per scene (`sd.imgRewrites`),
  `IMG Give Up?` (was `Already Rewritten?`) tests `giveUp` after four,
  `Rewrite Prompt AI` escalates from attempt 2 (no violence, weapons,
  minors, real people, brands; faces out of frame) and from attempt 3
  (no people at all), and `Apply Rewritten Prompt → IMG Reload Scene →
  Needs Image?` re-enters the loop for the SAME scene — with no reference
  image, because the previous picture may hold exactly what was refused.
  `Prep Flow Reject` reads the prompt from `Build Image Request`'s latest
  run, not from the `Loop Images` item, which still holds the original text
  after a rewrite. `Evaluate Image Approval` drops any note that starts
  with `AUTO-REWRITE` / `REJECTED` before appending it. A scene that
  arrives with such a note from an earlier pass starts one rung up the
  ladder. The give-up note now says what to do and clears the regen flag,
  so the gate stops dispatching a regen that can only fail.
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

### Character consistency: the cast sheet (2026-09-03)

Three things carry a face across a film, and until now only two existed.

1. **Text.** The segmenter is told to paste each character's full
   `visual_description` from the Story Bible into every image prompt they
   appear in, and it does.
2. **The n-1 chain.** Each image is generated on Flow with the PREVIOUS
   scene's picture as `reference_1`, prompted "use this ONLY for character
   identity, wardrobe and film look". **Measured working**: the same man is
   recognisably the same man in scenes 102, 203, 307 and 417 of the 71-scene
   Boyd film, four chapters apart.
3. **The clip.** Veo starts from the scene's own approved image, so a clip
   cannot drift from its own frame.

**What the chain cannot do is carry a CAST**, and the failure is structural:
the reference is whoever was in the last frame, so a scene about Bill whose
predecessor was a close-up of Sam tells the model to take Bill's identity from
a picture of Sam. Names cannot rescue it either — the segmenter's
output-hygiene rule strips them, so all 71 prompts of that film say "White
American man" and not one says Bill or Sam.

**The bible was also licensing the drift itself.** Sam was "late 40s to early
60s *depending on scene era*", Bill "early 30s to early 50s depending on scene
era" — pasted verbatim into every prompt. That is an instruction to draw a
different man in every scene, and we wrote it. Rule 3 of BOTH bible prompts now
demands one age and one outfit (both, in lockstep: a rewrite goes through
`Rebuild Story Bible`).

So: **one reference portrait per character, generated once per film** on Flow
(free on the Ultra plan), stored on the project as `castRefs`
{name: mediaGenerationId} — `Cast Sheet Prep → Cast Sheet? → Generate Cast
Sheet → Collect Cast Refs → Save Cast Refs`, sitting between `IMG Load Project`
and `User Ref?`. Three details are load-bearing:

- **Who is in a scene comes from `Prompt Vizual`**, the segmenter's own
  `visual_scene_description` — stored per scene, never sent to a model, and it
  DOES name people ("Sam stands at the desk"). Bill in 27 scenes, Sam in 26,
  Crowley in 3, of 71. That is why no new scene field and no migration were
  needed, and why this works on films made before it existed. A shared surname
  is not an identifier: "Boyd" matches Sam, Bill and the company, so a
  character matches on its full name, or on the given name where that is unique
  among the cast.
- **`Cast Sheet Prep` never returns zero items.** Everything downstream of it
  is the rest of the batch; an empty output would end the pass in silence. It
  emits a `skip` flag instead and `Cast Sheet?` routes on it. Same trap as
  `Replay Scenes For Images`.
- **`User Ref?` now reads the project from `$('IMG Load Project')` by name**,
  because the cast chain sits between them and `$json` is no longer the project
  record. Anything else inserted there must do the same.

Sheets become `reference_1..2` and the n-1 frame moves to LAST, for palette
only; the prompt names those roles positionally, so the reference list is built
rather than assumed. Two sheets is the cap — a third crowds the composition,
and scene 116 ("the three men gather") is the case that loses one. With no
sheet and no name match, behaviour is byte-for-byte what it was. After a
content refusal nothing is attached at all: a face is the likeliest thing a
people filter objected to.

Rollback, measurements and the smoke test: `db/port/cast-sheet/`.

### Consistency, taken further: turnarounds, set plates, tags and a judge (2026-09-08)

The cast sheet above carried a FACE across a film and nothing else. The long
film still showed the same man with a different coat from behind, and the same
building rebuilt differently every time the story returned to it — because a
portrait has no back, and a location existed only as prose. Live since
2026-09-08 (Media Generation `3fd53a5f`, Claude Scripting `5ab94af7`; full
account, originals and rollback ids in `db/port/consistency/`). Six pieces,
in the order a film meets them:

1. **The bible describes GEOMETRY and lists OBJECTS.** Rule 3 of both bible
   prompts now demands each location's layout (what stands where, materials,
   colours), and a new rule 6 lists hero objects (`bible.objects`: a car, a
   machine, a boat). Both prompts moved in lockstep, as always.
2. **The segmenter names who and where, in CODE-readable fields.** Each scene
   carries `location`, `characters[]`, `objects[]`, `time_of_day` as EXACT
   bible names; `Validate Evidence Refs` canonicalises them against the bible
   (diacritic-insensitive) and drops anything not in it; `Save scenes To
   Airtable1` stores them as `Tag-uri Scenă` — `loc:`, `char:`, `obj:`,
   `tod:` — so no column was added. A film made before the tags falls back to
   name-matching on `Prompt Vizual`, exactly as the cast sheet did.
3. **Sheets by tier, once per film**, planned from the WHOLE film (`Load Scene
   Cast` reads every approved scene before `Cast Sheet Prep`): a lead (in
   ≥ max(3, 10%) of scenes, or the protagonist with ≥ 2) gets a four-view
   TURNAROUND — front, both profiles, back — a recurring character (≥ 2) the
   old single portrait, a one-scene extra nothing. A portrait is upgraded to a
   turnaround when a character qualifies later. The producer's photo, when
   there is one, is the protagonist's sheet (drawn FROM it, ground truth), so
   the real face reaches every scene rather than only the hook. Hero objects
   in ≥ 2 scenes get a three-view product sheet. Stored as `castRefs` /
   `castSheets {name:{id,url,kind}}` / `objectRefs`, jsonb-merged.
4. **Set plates**: one wide, EMPTY, neutral-overcast plate per bible location
   (`Set Plate Prep → … → Save Set Plates`, stored as `locationRefs` /
   `locationPlates`). The plate fixes what stands where; light and time follow
   the text. `Generate Set Plate` is `continueRegularOutput` + `alwaysOutputData`
   like `Generate Cast Sheet`: a failed plate logs `SET PLATE FAILED` and that
   location runs on text, never a dead batch.
5. **One reference assembler, inlined word for word in THREE places** —
   `Build Image Request` (batch), `Evaluate Image Approval` (the gate's regen)
   and `IR Build Request` (the site's regen). Order: producer photo (scene 1) →
   up to two cast sheets (turnarounds first; the protagonist's sheet is skipped
   when the photo is attached) → one object sheet → one set plate → the previous
   frame LAST, palette only, and only if a slot is left. The prompt names each
   reference BY POSITION. After a refusal nothing is attached. **Change one
   copy, change all three** (`db/port/consistency/code/assembler.js` is the
   source): a re-rolled picture anchored to different references than its
   neighbours is the drift this exists to stop.
6. **A judge, because a reference is still only an instruction.** Every new
   frame is shown to gpt-4o beside the very sheets and plate it was anchored to
   (`Judge Prep → Judge? → Consistency Judge → Judge Verdict → If Reroll?`);
   identity/wardrobe under 0.6, place under 0.55, or the sheet leaking into the
   frame, sends the SAME scene back through `CONS Reload Scene → Needs Image?`
   in STRICT MATCH mode, at most twice per scene per pass
   (`sd.consistencyRerolls`, reset by `Sort & Cap Scenes` like every other
   counter). The drifted frame is never written. The judge is 3 retries then
   `continueRegularOutput`, and an unreadable answer is a pass — the producer's
   image gate is the backstop, as it is for refusals.

**Verified on the disposable film the same day** (executions 11332/11339):
turnarounds for both characters and three set plates within 100 s of the
batch, exact `loc:`/`char:`/`tod:` tags on every new scene, `reference_1..4`
per scene exactly as planned, four images and four clips, and the judge
scoring identity 0.8–0.9 with place 1.0 on every frame, no re-roll needed.
It also showed the sheet, assembler and judge wording assumed a HUMAN ("ONE
person", "face, hair", "skin texture") — fixed the same evening to "ONE
character (a person, an animal or a creature)" in all three copies (Media
Generation `3fd53a5f`, Claude Scripting `5ab94af7`). Full record in
`db/port/consistency/README.md`.

Two limits worth knowing. **A sheet's `fifeUrl` dies in ~6 h**; the Flow id
lives on, so GENERATION is unaffected, but the judge needs a URL to show, so
a pass starting hours after the sheets were made runs unjudged (`JUDGE
skipped` in the log). Re-hosting sheets through the media store is the fix
when it matters. And **two sheets per shot is the cap**, the photo counting as
one; the previous frame is the first thing dropped when slots run out.

### The reference sheets were photorealistic on a drawn film (2026-09-16)

The consistency chain above makes every character, object and location a
reference picture and lets a judge re-roll any frame that disagrees with it
(`STRICT MATCH`, "the references win"). All three sheet prompts ended,
hard-coded, in **"Photorealistic, … sharp focus."** — and the kids category
puts ONE mandatory style prefix at the head of every scene's `image_prompt`.
So on a kids film the identity anchor of every character was a photograph
and every scene was asked to be watercolour: the sheet pulls the frame toward
photography, and a frame drawn correctly scores low against a photographic
sheet and is re-rolled toward it. **A reference is a stronger instruction
than any sentence in the prompt, so it must be in the film's medium.**
Fixed in Media Generation `0f418e8e` (`Cast Sheet Prep`, `Set Plate Prep`):
both resolve `Editing Options.category` / `categoryOptions.visual_style`
exactly as `Voice Mode` does, open every sheet and plate prompt with the same
prefix every scene opens with, and swap the photorealistic finish for "drawn
in exactly that style, the same medium as every frame of the film". Every
other category emits byte-identical requests, proved offline by
`db/port/sheet-style/check.mjs` against a stubbed film. Found by reading the
node, not by watching a film — whether a kids film had gone through the chain
is unknown, and one kids film through Media Generation is the measurement
owed. Full record: `db/port/sheet-style/README.md`.

**The `KIDS_STYLES` table now has three copies** — `Voice Mode` (Claude
Scripting), `Cast Sheet Prep`, `Set Plate Prep` — and `check.mjs` asserts
the two in Media Generation match the Voice Mode body kept beside them. The
strings were copied from Claude Scripting's then-parked draft `6e21cddc` —
the eight-style table (illustrated, crayon, papercut, cel, cartoon3d, brick,
clay, felt) plus a stop-motion motion clause — **published later the same
day**, with the site's choices added in `categories.ts` and a fourth
lockstep assertion in the same check; see `db/port/kids-styles/README.md`.

### The batch cap

**Since 2026-09-01 a pass is the WHOLE film: `CAP = 200`.** Every take, then
every image, one combined gate, every clip, one video gate — two rounds of
approvals for a film of any length, which is what the producer meant by "an
automation". The cap was 8 for months, and on the 71-scene Vegas film that
was nine rounds of approvals with a dead execution between most of them
("mereu dă stop după 8"). 200 is a sanity bound (a 12-minute film is ~90
scenes), not a chunk size; `MEDIA_BATCH_CAP` on the site mirrors it. Three
things made the change possible, all in the same publish (active version
`173ffffe` — history entry "One pass per film"): binary data is
`binaryMode: separate`, so 71 clips do not sit in the execution's memory;
every `$runIndex` guard inside the per-scene loops became a per-scene counter
in static data (below); and a video-filter refusal now retries the SAME scene
in place instead of moving on (below). Sequential cost is unchanged — clips
are still made one after another, ~3–8 min each on the low-priority queue, so
a 71-scene film is several hours of video generation with nobody to click.
The history that follows is kept because the pending-first sort, the
`More Batches?` loop and the counters all still exist and still matter for a
repeat pass (refused scenes, regen flags).

`Sort & Cap Scenes` in Media Generation ends with `items.slice(0, CAP)`,
and until 2026-09-01 CAP was 8 — applied **before** anything checks what is already
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

**"Pending" is judged on the CLIP and the regen flags, never on the status
text — and until 2026-09-01 it was the text, which is why some scenes of a
long film were never made at all.** `Sort & Cap` read `Status Producție
Scenă` and treated `Așteaptă Aprobare Video` / `Finalizat` as done. But `VP
Apply` — the node that rewrites a motion prompt after the video filter
refuses it — stamped exactly `Așteaptă Aprobare Video` on a scene that had
NO clip, plus `Regenerează Video`. So a refused scene sorted as finished,
fell behind the cap on any film longer than 8 scenes, and was never in a
batch again; `More Batches?` kept counting it as remaining, so the passes
spun until `MAX_PASSES` doing everything except that scene. On the 71-scene
Vegas film (`recnyQ92QsXehZ98S`) scenes 117, 118, 203 and 204 sat like that
for a day, each carrying an `AUTO-REWRITE-VIDEO` note promising "the clip
regenerates on the next cycle". Now `pending = !hasClip || any regen flag`
in `Sort & Cap Scenes`, `More Batches?` counts a `Regenerează Video` scene
as remaining with the same rule, and `VP Apply` stamps `Generare Video` —
the status the site's own video regen writes. Inside the batch the refused
scene then takes the ordinary `Needs Clip?` path with its rewritten prompt,
and `Update Scene Record` clears the flag. **Any new writer of the status
text is not a gate input; the checkboxes, the assets and the flags are.**

Three more things killed that film's batches, each found by reading the
error of a dead execution rather than by watching the site, and each fixed
in the same publish (active version `2dc53805`):

- **`Check Job Status`'s `$runIndex` cap counts every poll in the EXECUTION,
  across all 8 scenes — not per scene.** At 60 polls × 30s that was 30
  minutes for the whole batch, which `veo-3.1-lite-low-priority` (a real
  queue served after Quality and Fast) blew through: 8939 died with "Video
  polling exceeded global safety limit (61 runs)" after eight clips' worth
  of waiting. **Every such guard is now a PER-SCENE counter in workflow
  static data**, keyed by scene id and reset by `Sort & Cap Scenes` at the
  start of each pass: `sd.polls` / `sd.resubmits` (`Check Job Status`,
  `Resubmit Guard`), `sd.regenPolls` / `sd.regenResubmits` (the gate's
  regen pair), `sd.multiPolls` (`AB Multi Guard`), `sd.rewrites` (`VP
  Prep`), `sd.submitCooldowns` (the two cooldown guards). A clip gets 120
  polls of 30s (one hour), and overrunning that counts as a FAILED job —
  resubmitted through `Resubmit Guard` (5 per scene) — rather than killing
  the film. **The counters only work because none of the Waits inside those
  loops exceeds 65s**: under that n8n keeps the execution in memory and
  static data with it; a longer Wait suspends the run to the database and
  the in-memory counts are not what comes back. Any new Wait in a counted
  loop must stay under that line.
- **A Flow captcha used to kill the batch.** 8981 died at `Submit Video`
  with `captcha_quality: PUBLIC_ERROR_UNUSUAL_ACTIVITY after 5 attempts` —
  Google throttling the account, and useapi had already retried five times,
  so n8n's own three quick retries could not help; the cure is time.
  `Submit Video` and `Submit Video Regen` are now `continueErrorOutput`,
  their error output goes `Submit Cooldown Guard → Wait Submit Cooldown
  (60s) → Submit Video` (and the `Regen …` pair for the gate), at most 20
  cooldowns per scene per run, then the run dies with the last reason as it
  did before. 60s, not longer, for the static-data reason above: the count
  must survive the Wait. `Sort & Cap` resets the counters each pass. The account's
  health is readable: `GET api.useapi.net/v1/google-flow/accounts` with the
  same Bearer header answers `health: OK` and the session expiry — do that
  from a throwaway workflow before assuming the block has lifted.
- **A site deploy restarts `web`, and the six shim nodes had no retry.**
  8703 died at `AB Load Project` with "The service refused the connection"
  — the container was being replaced under it. `AB Load Project`, `IMG Load
  Project`, `Write Scene Image`, `Update Scene Record`, `Write Regen Image`
  and `Write Regen Video` now retry 5×5s. That is the API's ceiling and it
  covers a blip, not a full rebuild (a deploy gap measured ~77s), so **do not
  push to `platform/**` while a batch is mid-generation** if you can help it
  — the same rule Railway already imposes on `remotion/**`.

**A video-filter refusal rewrites the prompt and resubmits the SAME scene, in
place, up to four times — it no longer moves on.** The chain used to be
`Filter Failure? → VP Prep → VP Already? → VP Rewrite AI → VP Apply → Loop
Scenes`: one rewrite, the scene flagged for "the next cycle", and the loop
went to the next scene — which, combined with the sort bug above, is how a
scene was never made. Now `VP Apply → VP Reload Scene → Current Scene`: the
scene record is re-read with its rewritten prompt and re-enters the loop at
`Current Scene`, so `Needs Clip?` → `Submit Video` runs again for it with
the new text. That re-entry works because every node in the video loop reads
the scene as `$('Current Scene').first()`, and `.first()` is the node's
LATEST run — re-running `Current Scene` is enough to change what the whole
loop sees. `VP Prep` counts the attempt (`sd.rewrites`), `VP Give Up?`
(renamed from `VP Already?`) tests `giveUp`, and `VP Rewrite AI` escalates
from attempt 2: every face and identifiable person out of frame, no
violence, weapons, minors, real names or brands. After four refusals `Mark
Video Prompt Rejected` writes a note saying the START IMAGE is the likely
trigger and what to do, and only then does the loop move on. That scene then
has no clip, so the video gate cannot open until the producer regenerates
the image and presses Regenerate video — the same door as before, reached
four rewrites later.

What none of this changes: an execution that never starts (the
`runData: {}` zombie above) still needs the site's Restart door; nothing in
n8n can detect it. And the combined gate still asks for takes AND images
together — the site shows Audio before Images, so the producer reviews in
that order, but n8n does not wait for the takes to be approved before it
starts on the pictures. Deliberate: the two are independent, and gating them
separately only adds a wait.

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

### The story layer — why films repeated themselves, and the fix (2026-09-02)

The 71-scene Vegas film retold the same eight facts in every chapter ("1941,
dealer" ×4, "Joe Crowley" ×5), 73 of its 185 sentences were under four words
("Green felt. Brass ashtrays."), nothing happened in any scene, and the
producer's fictional Bill had become Bill Boyd of Boyd Gaming. The producer's
words: "fragmente aruncate random". Read `db/port/story-layer/README.md` for
the full account; what bites is this:

- **A chapter written by a call that cannot see the other chapters WILL
  restate them.** `Write Chapter Narration` ran once per chapter with the
  same bible and the same claims list; the only cross-chapter signal was
  ENDS WITH / LEADS INTO. Now `Write Full Narration` writes the whole film
  in ONE call, `Edit Full Narration` reads the whole draft once, and
  `Narration Guard` (code) checks the `[CHAPTER n: title]` markers and the
  length window and sends the draft back at most twice. A 12-minute film is
  ~1,650 words — one call, always.
- **"Word count is the most important rule" is an instruction to pad**, and
  the prompt even said where from ("add detail from the Story Bible"). The
  model recited the bible's visual inventories as narration. Length is a
  window enforced by code now; the writer's top rule is the story.
- **`Generate Outline` writes a STORY SPINE before the chapters** —
  protagonist, want, obstacle, stakes, turning points that are EVENTS,
  ending, throughline — and each chapter owns its turning points. The spine
  rides on `output.story_spine` through `Combine Chapters` to the hook.
- **The genre profile is a pipeline configuration, and Motivational's was an
  essay.** "Name the moment of resistance … return to the opening moment,
  changed" made four chapters return to the same moment. It is a narrative
  arc now (row edited in `hov.genre_profile`, old values saved in the port
  dir). When a film repeats itself, read the profile's `structure` before
  the prompts.
- **Research plus "use only real examples" replaced the Tema's protagonist.**
  The Story Bible and the outline now say in words: if the Tema names or
  describes its protagonist, that name and role are canonical; research
  builds the world around them.
- **How to judge a script without watching the film**: count facts per
  chapter and sentences under four words (`db/port/story-layer/README.md`
  shows the numbers). Both were measurable in the database in one query,
  and both are what the producer saw.

**The fold had no ceiling, and the bill arrived at the other end of the
pipeline.** Merging a runt into a neighbour can only make a chunk BIGGER, and
nothing checked how big — so on the 71-scene Boyd film one chunk came out at
34 words, which ElevenLabs read as **16.7 seconds of narration over an
8-second clip**. `/assemble` could cover that only by stretching the picture
to its 1.5× limit and then freezing the last frame for five seconds, under a
voice that keeps talking. `MAX_WORDS_PER_SCENE` (1.45 × the target) now splits
anything over it back down, at a sentence boundary where there is one; the
"cut this near its middle" rule the unit splitter already had is factored into
`cutNear` and shared, so the two cannot drift. Verified on the chapter it came
from: 18 scenes with a 34-word outlier become 19 with a maximum of 28, every
other chunk byte-identical, and the chunker is still lossless. **The lesson
generalises: a rule that only ever adds needs the rule that subtracts beside
it**, and the place a missing bound shows up is rarely the place it was
written. Rollback and the measurements: `db/port/scene-length-ceiling/`.

### Repetition is COUNTED now, not asked for

The writer's rule 2 is SAY EVERYTHING ONCE. The editor's rule 1 is REPETITION,
"the single biggest defect". Both were already written, in capitals, and the
71-scene Boyd film still shipped with 1941 told four times, and 1952, 1962,
1966, 1975, 1977 and the $6,667 / $3,000 split twice each.

The reason is the shape of the guard, not the wording of the prompts.
`Narration Guard` enforced structure, empty chapters and **length** — and
length is the one pressure that pushes the other way: a draft that runs out of
story reaches its word count the only way left to it, by telling the same dates
again a chapter later. So the one rule that was measured was the rule that
caused the defect, and the two that mattered were only requested.

The guard now counts what it was already asking for, in code, and feeds the
result back through the existing `editorFeedback` path:

- **facts** — years, sums, quantities, at **3+** occurrences, named with the
  chapters they fall in. A NAME recurring is a protagonist; a NUMBER recurring
  is the same fact stated twice, which is why the pattern is numeric only.
- **phrasing** — an identical six-word run appearing twice. Overlapping windows
  of one repeat are folded, so five offenders means five sentences rather than
  five views of one.

Same `MAX_RETRIES = 2`, same accept-anyway ending: a repetitive film still
ships, it just costs at most two more editor passes and those passes are told
exactly what to cut and to replace it with EVENTS from the spine. Thresholds
were checked against real narration before shipping — the 44-scene Ploiești
film raises nothing, a synthetic Boyd-style recycling raises `1941 (3 times,
chapters 1, 2, 3)` plus four verbatim phrasings — because a guard that fires on
a clean draft would cost two extra model passes on every film.
Rollback: `db/port/chapter-titles-and-repetition/`.

**The general shape is worth keeping: an instruction in a prompt is not a
constraint.** If it matters, something after the model has to be able to say
whether it happened — and if the only thing you measure is length, length is
what you will get.

### The film has to END, not just stop (2026-09-12)

The producer: *"se termina brusc parca fara sens sau concluzie, cred ca tine de
partea de scripting."* They were right about where it lives. Measured on the
last sentence of the last chapter of the six most recent finished films of 2+
minutes: **five of six stop on a trailing subordinate clause** — "…while Paris
gathers around him", "…while the shop stays open behind you", "…while hidden
light fills the water" — which is a camera direction wearing narration's
clothes. The sixth, Boyd, ends on a statement.

**The cause is a field whose spec contradicted a rule elsewhere.**
`Generate Outline` asked the spine for *"ending: the last thing the viewer sees
and understands"* — a camera position plus a feeling — while writer rule 10 (NO
META) forbids the narration from mentioning the camera, the film or the viewer.
So the planned ending was by construction a thing the writer was not allowed to
say, and the only way it could reach the film was as a final SHOT. The Burj Al
Arab spine says it outright (execution 11663): *"The last image is the completed
Burj Al Arab seen from its island … and the viewer understands that…"*, and the
film duly ends on the water. **Neither prompt was wrong on its own — a field
whose spec contradicts a rule elsewhere does not fail loudly, it degrades into
whatever the model can legally do with it.**

Four nodes, live as Claude Scripting `8b8d7b74` (was `5a32e43e`): the outline's
`ending` is now the CLOSING EVENT and what it leaves behind, *sayable aloud*;
writer rule 15 and editor rule 4b ask the last chapter to finish on a closing
beat of two or three sentences — the one place in the script where meaning may
be stated, still not a summary, a moral, a new fact or a camera position; and
`Narration Guard` CHECKS the last sentence for that trailing clause and feeds
the existing `editorFeedback` path, same `MAX_RETRIES = 2`, same accept-anyway
ending. The pattern carries both languages the pipeline writes in and needs
three words after the connector, so a short tail ("…as planned.") is not an
offender; it is skipped for a silent or a dialogue film by the same gate as the
fragment and commentary checks, because a beat sheet legitimately ends on an
image. Backtested on those six films plus three controls before shipping.

**It reaches films written from now on only** — a film whose script exists keeps
the ending it has. Full account and rollback: `db/port/story-ending/`.

### The story ends on a resolution, not on its climax (2026-09-16)

Four days after the entry above, the producer again: *"nu prea au concluzie,
mai ales povestile se termina brusc."* Measured on the four Story / Kids
films written after the 09-12 fix: two land, **two end ON the climax** — the
Lego chase on the arrest, the kids' clay-builders film with two of three
characters shut inside a house. Both pass the 09-12 guard, which tests the
SHAPE of the last sentence; nothing asked for what comes AFTER the last
turning point. **The classical structure has five parts and the pipeline
planned four**: every genre's `structure` maps onto exposition / inciting
incident / rising action / climax / resolution, but writer rule 15 let "the
last event and its consequence" be one clause glued to the climax, and the
last scene cut 0.35 s after the last word.

Two things made it worse for kids. The genre `structure` shapes the OUTLINE
while kids rule (e) ("a warm ending with a gentle lesson") only reaches the
WRITER — and both kids films so far ran under the Dark profile, whose beat 5
is *"Aftermath, not resolution. Something remains."* The structure won.
**A rule that only reaches a later node loses to a rule that shaped the plan.**

Live as Claude Scripting `31e37b3c` and Final Assembly `450fa910`
(`db/port/story-close/`): a Story or Kids story (category absent counts as
story; documentary and cinematic untouched) plans a RESOLUTION beat — the
final situation of the characters, set later in time than the climax — as a
third `RESOLVES WITH:` line on the last chapter; the writer puts it as the
LAST PARAGRAPH of the last chapter (rule 17, 2–3 sentences, 18–45 words,
naming the protagonist); the editor writes it if missing (4c); `Narration
Guard` checks the paragraph is there, separate, and names the protagonist
(feedback into the same retry, never a hard failure); `Plan Scene Splits`
cuts that paragraph off before chunking so it is its own last scene; the
segmenter stages it as a settled, wider shot; and `Build Timeline` holds the
last voiced scene 1.5 s (2 s kids) after the narration. For kids the
resolution *"REPLACES beat 5 of the dramatic structure above whatever it
says"* — the override lives where the structure lives. One owner for all of
it: `Voice Mode`, which every consumer reads. Verified on two disposable
60-second films, the kids one deliberately under Dark: *"A little later, the
cold has settled, but Marn, Pip, and Tilla are safe in the same shelter."*

Known trade-off: the guard allows 45 words, a scene carries 32, so a 33–45
word resolution is two settled shots (the story test film did that). Owed:
hear the hold on a real render, and the `Rewrite Script` path still carries
none of these rules.

### The same lesson, three more times — inventory, the excerpt, the hook (2026-09-04)

Asked what would make the SCRIPTS better, the answer came out of measuring five
real films rather than out of opinion, and every finding has the shape above:
the rule was already written and nothing counted it.

| film | tone | ≤3-word sentences | commentary phrases |
|---|---|---|---|
| Boyd | **Motivational** | **46 of 185 (24.9%)** | **7** |
| Stalin's son | Dramatic | 11 (11.6%) | 0 |
| Ploiești | Dark | 9 (8.6%) | 0 |
| Fall of Rome | Documentary | 1 (1.9%) | 0 |
| Ceaușescu in N. Korea | Documentary | 1 (1.4%) | 0 |

Four films write scenes; one writes an essay — "Low ceiling. Green felt. Brass
ashtrays. A wall clock." and "That is the correction." The segmenter's rule 3
is EVENTS NOT INVENTORY, its rule 5 bans abstract commentary, and the
Motivational genre profile asks for "plain, direct sentences of 8-20 words".
All three were obeyed by the four films that did not need them.

- **`Narration Guard` now counts both**, beside the repetition pair and through
  the same `editorFeedback` path: fragment DENSITY (fires at 18% and 10+, where
  the worst good film is 11.6%) and banned commentary phrases (fires above 2,
  where every good film scores 0). A RUN of three fragments is quoted as
  evidence but never triggers — two of the good films carry one deliberate
  triplet each ("Wheat bends. Earth trembles. Silence breaks."). **Neither check
  runs on a silent or a dialogue film**: a beat sheet is terse by design and
  speech is legitimately short, and the category is read from
  `Fetch Project Record` exactly the way `Voice Mode` reads it.
- **The style excerpt was the wrong 450 characters.** `Prepare Style Block`
  shows the writer a verbatim paragraph from a real transcript of the genre —
  the strongest lever on rhythm there is, because a model imitates a paragraph
  far better than a description. Cut at a fixed offset it averaged **3.2
  sentences and 323 characters** over the 63 active library rows, 36 of 57
  gave under four sentences, and four gave a passage more than twice as
  fragmentary as their own script — one of them a **Motivational** row quoting
  at 25% from a transcript that runs at 6%. An excerpt is now whole sentences,
  5+ of them and 300-900 characters, and is rejected unless it is
  REPRESENTATIVE of its own script; under 20 sentences a row declines entirely
  (one row is 3,407 words of unpunctuated auto-caption). After: 8.0 sentences,
  825 characters, 60 of 63 usable, none unrepresentative. The Motivational
  transcripts themselves measure 4.2 / 5.9 / 0.0 — the library was not the
  defect, the window into it was.
- **The hook never fit the shot it was written for.** Rule 1 says 18-22 words,
  "NEVER more than 22 (it fills exactly one 8-second scene)". The 16
  chapter-encoded films run 12,12,13,14,14,15,15,16,16,16,16,17,18,19,**32,52**
  — two inside the window, and two so far over that `Plan Scene Splits` cut the
  hook into TWO scenes. New `Hook Guard` + `If Hook Retry` loop back into
  `Generate Hook` with the reason, twice, then accept. **Only the ceiling
  really bites**: sixteen words is a shorter opening, not a worse one, and a
  guard that argued a sharp hook up to the word count would be padding it for
  arithmetic. The guard's own output carries the COMBINED NARRATION (that is
  what the retry hands back to the prompt), so `Prepend Hook To Chapters` reads
  the hook from `$('Generate Hook').first()` instead of `$json`.

Two things measured and deliberately left alone: the **library is stocked where
films are not made** — Cinematic 25 films / 2 active style rows, Emotional 4/1,
Inspirational 1/0, against Funny 0 films / 11 rows and Educativ 1/10, which is
a producer decision at `/admin` — and one project has its whole Tema pasted
into the **Tonalitate** field, so it matched no genre profile and no style row
and was written with the built-in fallback. A closed list on `/new` is the fix.

None of this is measured against retention. It counts what the prompts already
demand of the text.

Rollback, the check script and the full measurements: `db/port/script-quality/`.

### Sharper scripts, and pictures that change — the library was reachable and useless (2026-09-10)

The producer's report on the 86-scene Burj Al Arab film: "the scripting and
the AI visuals feel bland and repetitive … until BAM the finished building
appears from almost nothing … does the AI still have access to the library
I made?" The answer was yes, and that was the problem. Full account, measured
numbers and rollback: `db/port/script-voice/README.md`. What bites:

- **`Fetch Style Card` matched the library on the film's TONE STRING and took
  the first three rows by insertion order.** For `Educativ` that was a
  Moroccan McDonald's vlog in broken English and a YouTube Shorts tutorial,
  while the producer's own Burj Al Arab transcript sat in the library as tone
  "Corporate" / category "Educational" and never matched. Now the rows come
  from **`GET /api/style-refs?project=…`** (site, keyed for n8n): the
  producer's PINNED references first (`Editing Options.styleRefs`, chosen on
  `/new` under Tone by `StyleRefPicker`, up to three), then tone-family
  matches (`toneFamily()` in `lib/style-refs.ts`: Educativ = Educational,
  Funny = Fun …), then category/Look matches; newer and excerptable first.
  `pickStyleRefs` is pure — `npm run check:style-refs`. The scripting log now
  prints `STYLE REFS: "…" [tone/category; pinned by producer]`, which is the
  line that answers the producer's question in one second.
- **All 63 active transcripts are SRT files and nothing ever stripped the
  cues**, so for seven weeks the "REAL EXCERPT" the writer imitated read
  «67 00:02:39,360 --> 00:02:41,670 Marrakesh…». `cleanTranscript` (site) and
  an identical copy in `Prepare Style Block` remove cue numbers, timecodes,
  `[music]`, `>>` and `\h`. **Two copies; change both.** The excerpt
  measurements in the entry above ("8.0 sentences, 825 characters") were
  taken with the timecodes inside them.
- **The Educativ genre profile ASKED for the glossary** ("Define a term before
  using it. One new idea per beat."), and the writer prompt says GENRE VOICE
  beats the style reference — so "A pile is a long structural element…" was
  the pipeline obeying its configuration. All 11 profiles are rewritten
  (`db/port/script-voice/genre_profiles.sql`, rollback beside it): no
  definitions, no meta, no signposting, every `visual` demands the light
  change between chapters. **The profile is a pipeline configuration**; read
  it before the prompts when a film sounds wrong, the same lesson as the
  Motivational essay.
- **Three more things are COUNTED now, in `Narration Guard`**, thresholds
  measured over the 14 most recent films first: glossary sentences (fires
  above 1; Burj had 4, every other film 0–1), meta lines ("the camera enters
  the atrium", "this is turning point four", "this chapter unveils" — fires
  at 1, because every one found in 14 films was a defect), and steering
  openers ("Now the work shifts", "So the question is" — fires at ≥10% of
  sentences and ≥8; Burj 11.9%, the good films 0–6.8%). Same feedback path,
  same `MAX_RETRIES = 2`. The writer has rules 9–14 to match and the editor
  5b/5c.
- **A place that changes over the story is one bible entry PER STATE** —
  `"<Place> — <stage>"` in chronological order, up to 4 states, 8 entries in
  all — and the segmenter picks the state the chapter has reached, never a
  later one. The Burj bible had one tower, "at Completion", so the frame-
  rising chapter anchored to the finished plate and scene 108 spoiled the
  ending; a construction film has to be ABLE to show half-built.
  `Set Plate Prep` makes up to 10 plates (was 6) to cover it. The assembler,
  tags and judge needed no change: a state is just another location name.
- **Lighting is a PROGRESSION in the bible now, and the segmenter moves it**:
  3–5 named conditions with the chapters they belong to, at least two per
  chapter, never more than five consecutive scenes in one `time_of_day`, no
  two chapters opening in the same light; `time_of_day` gains `overcast` and
  `storm`. `Validate Evidence Refs` logs `TOD MONOTONY` / `LOCATION
  MONOTONY` per chapter — it cannot send a chapter back, but 75 of 86 scenes
  reading "day" must never pass unlogged again.
- **The first run after publishing died on OpenAI credits, not on the
  change** (2026-09-10 19:04 UTC, scripting 12022: "You have no credits
  remaining"). Everything before the model call was verified — `styleRefs`
  stored and read back, the new profile fetched, the route's absence degraded
  cleanly — and nothing after it has run yet. The prompts are published and
  byte-verified, unproven on a film; the disposable test project
  `recTdqIxXei94goJF` (Educativ, 32 s, pinned Burj reference) is the one to
  `restart-scripting` after the top-up. **Check the date on this note before
  repeating it as a live blocker.**
- **Wiring order that matters**: `Fetch Style Card` is `continueRegularOutput`
  + `alwaysOutputData`, so until the site carrying `/api/style-refs` is
  deployed the node answers a 404 and Scripting falls back to the genre voice
  alone — degraded, never dead. Publish the site before expecting pinned
  references to reach a film.

### The voice says what the picture cannot (2026-09-13)

The producer: "AI-ul bagă mult din descrierea vizuală a scenei și în scriptul
audio … noi nu scriem o carte." Measured, not argued: in the fiction films a
THIRD of the narration's content words are the same words as that scene's own
shot description (Lego chase, Peking, Senate: 33% median; documentaries
6–14%), and the Lego chase carried 1.6 texture words per hundred against
**0.0 in nine real scripts from the producer's own library**. Full account,
numbers and rollback: `db/port/narration-voice/README.md`. What bites:

- **Four causes, and the fourth is this file's oldest lesson again.** The
  writer and the outline were handed the WHOLE Story Bible (1,530 words of
  wardrobe and geometry for a 404-word script); the outline's chapter plan
  was itself a shot list; the 09-10 profiles ASKED for it ("The sentence is a
  SHOT", "hands, objects, weather") — the Lego film, the only one written
  under them, has the worst numbers; and `Narration Guard`'s length FLOOR
  (90%) sent thin drafts back to be lengthened once repetition, inventories,
  glossary and meta were all counted, so the padding went to the one outlet
  still unmeasured. **A guard that measures length gets length, through
  whatever it does not measure.**
- **The two writing prompts see a STRIPPED bible** — WHO AND WHERE: names,
  roles, place names, object names, logline, era. Nothing visual. The full
  bible still reaches the segmenter and every image path untouched; only
  `Generate Outline` and `Write Full Narration` lost it.
- **Writer rule 16 / editor rule 2b / the SHARED clause in all 11 profiles**
  say the same thing: the voice carries intent, stake, cost, cause,
  consequence, number; a place or time may be NAMED, never described. The
  segmenter's rule 5 now DECIDES the shot from the event a line is about,
  because the line no longer tells it what to draw. A silent film is the
  exception, said in words inside `Voice Mode`'s cinematic block.
- **Length is a CEILING now.** Writer "AT MOST 1.1×", editor "at most 1.12×
  … otherwise LEAVE IT SHORT", guard floor 0.9 → **0.55** (only a broken
  draft goes back for length). A film shorter than ordered is the right
  outcome — the producer's decision, 2026-09-13.
- **Description is COUNTED** in `Narration Guard`: texture words ≥ 0.4/100
  and ≥ 4, or camera words ≥ 2, or ≥ 12% of sentences opening on scenery.
  Verified on the seven films before publishing: fires on the Lego chase and
  on Burj (all three of its hits are real — "silhouette against sea and sky",
  "the camera enters"), silent on the documentaries and Peking.
- **Check `guardcheck.mjs` after touching the regexes** — it reads them out
  of the guard body, so the test and the node cannot drift. The first test
  film found `mist\w*` matching "mistimes" (hence "mistake", "mister"); a
  `\w*` suffix on a texture word is a false positive waiting for a story.
- **Measured on the first film after publishing** (Claude Scripting active
  `d5972f17`; disposable `recDNqlXH2h1A19TY`, same tone and settings as the
  Lego chase): narration/shot overlap 33% → 21% (what remains is the
  characters' and objects' NAMES, which are in the frame by construction),
  texture words 1.5/100 → 0.0, scenery openers 25% → 0%, and the script came
  in at 263 words against a 308 target — shorter than ordered, as decided.

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

### Flow refuses twice, and only one refusal was handled (2026-09-17)

Google Flow says no to an image in two different ways, and the pipeline only
ever knew about one. The LOUD refusal is an HTTP error, and
`Generate Scene Image` routes it down its error output into a real ladder —
`IMG Error Router` sorts it, `Prep Flow Reject` builds a brief, `Rewrite
Prompt AI` rewrites the prompt, four attempts, then a human. The QUIET one is
**HTTP 200 with a `generatedImage` that carries the prompt and the seed and
nothing else**: no `fifeUrl`, no `mediaGenerationId`. The job ran, the filter
ate the picture, and the only evidence is an absence.

The HTTP node calls that success, so the ladder never saw it, and
`Decode Scene Image`'s `throw` was uncaught — **and an uncaught throw in
Media Generation ends the entire execution**: the image loop, the audio loop,
the video loop and both gates, for every scene in the film. Measured
2026-09-17 on a 48-scene film: executions 14202 and 14208 died there, both on
the same scene, whose prompt opened "Reference image 1 is a character sheet of
Lazarus shown from several angles" — the cast sheet was what the filter
objected to.

Live as `6735a96a`: the throw carries the marker `FLOW_NO_IMAGE`, the node
carries an error output into the ladder, and `IMG Error Router` matches the
marker FIRST and calls it a refusal. **Never a throttle** — the throttle
branch holds a minute and re-asks the byte-identical prompt, twenty times, and
a content filter's verdict does not change on a re-ask. `Decode Regen Image`
got the same treatment into `Mark Image Regen Rejected`. Full account and the
37-check harness: `db/port/regen-unstick/`.

**The generalisation worth keeping: a success status is not a success.** Any
node that reads a field out of a 200 and throws when it is missing is a node
that can end the film, and the ladder built for the loud failure is exactly
where the quiet one belongs.

### Images are made on Google Flow, not fal (2026-09-02)

`Generate Scene Image` (batch loop), `Regenerate Scene Image` (the gate's
regen) and `IR Generate Image` (Claude Scripting's `scene-image-regen`
webhook) all POST to useapi `/v1/google-flow/images` with `model:
nano-banana-2`, `count: 1`, `captchaRetry: 1`. The design and the apply record
are `db/port/flow-images/README.md`; what belongs here is what bites.

- **The picture and the clip come from one place, so one filter instead of
  two.** fal made a picture, we downloaded it, uploaded it to Flow, and Flow's
  UPLOAD filter refused what fal had happily made. Generated on Flow it is
  born past that filter, and the response carries BOTH the signed `fifeUrl`
  (which `/api/media/ingest` re-hosts, as it already did for Flow's clips)
  and the `mediaGenerationId` that `Submit Video` needs as `startImage`.
  `Download Scene Image`, `Extract Asset Id`-in-the-loop and the whole regen
  download/upload trio are gone; `Decode → Write` is the chain now. The n-1
  reference is the previous scene's media id, no bytes moved.
- **`count` DEFAULTS TO FOUR.** Omit it and every scene costs four images and
  returns four; `Decode Scene Image` reads `media[0]` and would silently keep
  the first. Proven on the probe (execution 9241): `count: 1` → one item,
  23.6s, `modelNameType: NARWHAL`, id of the form `…-image:<uuid>`.
- **Retries are OFF on all three generate nodes, on purpose**, and every
  failure that is not a content refusal goes through time, not attempts:
  `IMG Error Router → IMG Refusal? → IMG Cooldown Guard → Wait IMG Cooldown
  (60s) → IMG Retry Now? → Flow Pace (8s) → Generate Scene Image`. A
  `captcha_quality` / `UNUSUAL_ACTIVITY` error holds FIVE cooldowns before
  the next try; max 20 per scene per pass (`sd.imgCooldowns`, reset by `Sort
  & Cap`); `402` throws at once. n8n's own quick retries are exactly the
  burst that trips Google's unusual-activity filter, which is why `retryOnFail`
  must stay false here even though every other HTTP node in the batch has
  it. `Generate Scene Image` reads its body from `$('Build Image Request')`
  BY NAME so the cooldown loop can re-enter it with a cooldown item.
- **A refusal enters the SAME rewrite ladder** (`Prep Flow Reject → IMG Give
  Up? → Rewrite Prompt AI → Apply Rewritten Prompt → IMG Reload Scene`),
  which is why the router exists: the ladder rewrites a PROMPT, so it must
  only ever see a judgement on one. A throttle is tested first and can never
  be classed as a refusal.
- **The producer's reference photo is uploaded to Flow ONCE per film**, at
  pass start (`IMG Load Project → User Ref? → Download User Ref → Upload
  Asset To Flow → Extract Asset Id → Save User Ref Id → Find Audio Folder`),
  because a Flow reference must be a Flow media id and the photo is a Drive
  URL. The id lands in `Editing Options.refImageMediaId` through a jsonb
  MERGE, never a rewrite of the JSON — the lost-update the site's
  `updateEditingOptions` exists to avoid. `Build Image Request` reads it from
  `IMG Load Project` or, on the pass that uploads it, from `Save User Ref
  Id`'s `returning` (the project was read before the id existed).
  `IR Build Request` reads only the id: a project whose batch predates the
  port regenerates scene 1 WITHOUT its reference until a batch pass stores
  it, and says so in the log.
- **`captchaRetry: 1` is now on `Submit Video` / `Submit Video Regen` too.**
  useapi solves Flow's reCAPTCHA through a paid provider and retried five
  times per request; under a throttle those five were pure spend, and the
  cooldown loops on both sides already supply the waiting.
- **The account's session refreshes at ~01:24 UTC**, read off
  `GET /accounts` (`nextRefresh`), not the 04:38 the design guessed; a
  request in that minute fails and the cooldown covers it. Same call answers
  `health: OK` — run it from a throwaway workflow before assuming a block has
  lifted, exactly as the video section says.
- **How it was applied is the method to reuse**: probe the endpoint from a
  throwaway workflow first (a manual execution keeps its `runData`), stage
  with `update_workflow`, fetch the draft, diff it node-by-node against
  `activeVersionId` (`db/port/flow-images/applied/diff-against-active.js`
  prints added/removed/changed nodes, edge deltas, dangling `$('…')`
  references, the Drive `resource`/`operation` check, and a byte comparison of
  every Code body against the file it was written from), then
  `publish_workflow` with that draft's `versionId`. The first draft went up
  with one running execution (9067) still alive; that is fine — executions
  are version-pinned — and the running one simply finished on fal.

### Which Veo model the pipeline asks for

`Submit Video` and `Submit Video Regen` (Media Generation) are the only two
nodes that generate clips — no other workflow calls
`api.useapi.net/v1/google-flow/videos`. The model is a plain string in each
node's `jsonBody`, and the two must always agree, or a regenerated scene comes
back from a different model than the batch gave it.

**`veo-3.1-lite-low-priority` is the one that costs no credits**, and it is a
distinct model id rather than a flag on `veo-3.1-lite` — there is no separate
`priority` parameter to set. Set on both nodes and **published 2026-08-31**
(active version `60fb17df`), when the account moved to Google AI Ultra. The
draft was diffed against the active version first and differed in exactly
those two `jsonBody` strings, nothing else. Two things come with it:

- **It is Ultra-only.** useapi's docs put it on the $199 Ultra tier; the
  cheaper Ultra plan does not include it. If the plan lapses or is the wrong
  one, the API rejects the model — and a rejection still ends the batch
  loudly rather than falling back to a model that spends credits: since
  2026-09-01 `Submit Video` is `continueErrorOutput` into a bounded 120s
  cooldown loop (see "The batch cap"), so a wrong model id burns three quick
  retries, then ten cooldowns (~20 min), then kills the run with the API's
  reason. Slower to fail than the old `stopWorkflow`, never silent.
- **Lower priority is a real queue, not a label.** Flow serves Quality, then
  Fast, then Lite from the same account, so a Lite job only starts when
  capacity is left over. Fine for a 6-scene film; it is the pacing risk on the
  10- and 12-minute lengths, where a batch is 90 scenes across 12 passes.
  It already overran the video poll cap once (8939, see "The batch cap") —
  the cap is now 480 polls of 30s per batch.

### Switching the drawn cards off

`Editing Options.drawnCards` (default true) is the producer's PERMISSION for
motif cards. It is deliberately not the same key as `motifCards`, which is the
LIST Scripting chose: an empty list means the model found nothing worth
drawing, and that is a different fact from the producer saying no. Collapsing
the two would have made "none were found" indistinguishable from "none are
wanted", and the switch would flicker on by itself the moment a later film
found one.

The switch is offered twice, and both are needed for different reasons:

- **The brief** (`drawn_cards`, in Finishes) is the one that saves money —
  it reaches Scripting before any model call.
- **Final touches** is the one that can change its mind. The card list sits
  under that switch and is hidden when it is off; hidden rather than greyed,
  because a finishing screen listing things that will not be drawn is not a
  decision anyone still has to read. Nothing is destroyed by the switch —
  only by dropping an individual card — so switching back on restores the
  list exactly.

Three gates, in the order a film meets them:

| Where | What it does |
|---|---|
| Scripting → `Draw Cards?` | skips `Choose Motif Cards` entirely, routing `Prep Motif Input` straight to `Motif Done` |
| Final Assembly → `Attach Motif Cards` | draws none even when cards are stored |
| the site | shows the switch and the list it governs |

**The render gate is the one that must exist**, and the reason is the order of
events: Scripting stores its cards long before Final touches is reached, so a
film switched off at the gate already HAS them. Skipping only in Scripting
would have left those cards drawing themselves.

`Draw Cards?` routes its false branch to `Motif Done`, which returns
`$('Save scenes To Airtable1').all()` and reads nothing from the motif chain —
that is what makes the bypass safe. This chain is IN-LINE (same reason as Save
Evidence), so a branch that simply ended would strand `Wait For Scene
Approval` and hang the whole scripting run.

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

### Kids story is a real category now (2026-09-07)

`category: 'kids'` — `ready: true`, built as variant B of the plan agreed with
the producer: picture-book pacing + writing + look, with read-along extras
(big karaoke captions, kids music folder, book-style chapter cards) deferred
until a first test film is judged. How each piece works:

- **Both category options are live** (`categories.ts`): `narration_pace`
  (relaxed / very_slow) and `visual_style` (illustrated default / `cartoon3d`
  — the producer asked for a "more realistic" Paw-Patrol-ish choice, which is
  3D-animation realism, never photorealism; the option deliberately never
  names brands). They ride `category_options` → Normalize stores them in
  `categoryOptions` untouched — no orchestrator change was needed.
- **Pace = the retime that already works.** `createProject` maps relaxed→0.9,
  very_slow→0.8 into the existing `speed` payload (+ `Pace: "Slow"` for the
  two prompts that read the word) — but ONLY when the brief's own speed
  control was left at 1, so an explicit choice there still wins. Two controls
  that silently fight is how PACE was inert for months.
- **Longer breaths between scenes**: `/assemble` takes `sceneGap` (clamp
  0.2–2, default 0.35 — the constant that was hard-coded in `eff = voiceDur +
  0.35`). `Build Timeline` (Final Assembly, active `270dc41c`) derives it:
  kids relaxed 0.8s, very_slow 1.2s, everyone else 0.35s. Film-time — the
  retime stretches the gaps too, which is the point.
- **Writing + look are ONE Voice Mode edit** (Claude Scripting, active
  `0a162e0d`). The kids block is ADDITIVE — it appends to narrationRules /
  segmentRules / hookRules instead of replacing them, so kids composes with
  cinematic (silent kids film keeps silence) and dialogue (keeps tags), and
  non-kids projects append `''` and render byte-identical prompts. The image
  style is a mandatory PREFIX on every image_prompt, so it lives in the
  STORED prompt and every regen path (IR Build Request, Build Image Request,
  the refusal rewrites) inherits it for free. Storybook bonus, deliberate:
  "no photorealistic humans anywhere" also starves the Veo people-filter.
- **Storyteller voice default**: kids + untouched tone control → `voice_tone
  {stability 0.35, similarity 0.75, style 0.4, speakerBoost}` in the payload.
  Visible and changeable at the audio step like any chosen tone — unlike the
  usual "absent = each voice's own settings", which stays the rule everywhere
  else.
- **No length cap** — the producer refused one explicitly.
- **Eight styles since 2026-09-16, one flat list** (`db/port/kids-styles/`):
  the two originals plus crayon, papercut, cel (2D) and brick, clay, felt
  (3D), each a POSITIVE noun phrase, never a brand. Not medium × technique —
  "2D claymation" and "3D watercolour" are not things, so each label carries
  its own dimension. Stop motion is a CADENCE, not a texture: Veo renders
  smooth 24 fps whatever the still looks like, so for clay/brick/felt the
  segmenter gets a fourth rule asking for small deliberate steps and a
  pose-to-pose snap in every motion prompt. Unverified on a real clip. The
  prefix also heads every cast sheet and set plate (see the sheet entry
  under consistency), which is why the list lives in four places.
- **The storyteller was a silent server-side default, and the producer
  could not see it (2026-09-16).** "When I click Kids story it used to pick a
  voice" — it never did. Since 09-08 `createProject` added a storyteller
  `voice_tone` only when the form posted none, so nothing on the brief
  changed when the category did, and the numbers matched no preset, so the
  audio step showed "custom". Now one owner, `STORYTELLER_TONE` in
  `derive.ts`, read by three places: the brief SELECTS it in the Voice
  character control the moment Kids story is chosen (and clears it on the
  way out — only an untouched control moves), the picker offers it as the
  "Storyteller" preset so the audio step names it, and `createProject` keeps
  it as the backstop for a form that never rendered the control. The
  NARRATOR moves too: `Category.narratorVoice` (kids: George,
  `elevenlabs_JBFqnCBsd6RMkjVDRZzb`, ElevenLabs' own "Warm, Captivating
  Storyteller" and the one English voice labelled `narrative_story` in the
  account's library of 22) is followed by the form's single picker until the
  producer clicks a voice. A Romanian kids film still gets the language's
  own list — the picker's existing "selection must be in the list" rule
  swaps George for the first Romanian voice, which today is Mihai, also
  `narrative_story`. A default the producer cannot see is a default they
  will report as missing.
- **"Childish" is a TONE, i.e. a genre profile (2026-09-16,
  `db/port/childish-tone/`).** Tone selects the row of `hov.genre_profile`
  that shapes the outline and the narration, and a chip with no row is
  silently written as a DOCUMENTARY (the built-in fallback's fallback). So
  the tone the producer asked for is one row — no research, invention
  required, hero → small problem → tries with friends → the brave-small
  thing works → home and a goodnight; storyteller voice at 110 wpm,
  montage intensity 0 — plus one chip. Kids story selects it while the
  tone is untouched, the same way it selects George and the Storyteller
  preset; it composes with Voice Mode's KIDS STORY MODE rather than
  repeating it. Both title-typeface maps (`tone-type.ts`, `presetForTone`)
  fall to their default for it, in lockstep; a picture-book card look is a
  render change not yet made.

### The hook is a teaser — six styles, one shot per beat, a plan the site can rewrite (2026-09-11)

The film used to open on ONE 8-second scene of 18-22 narrated words with the
project's TITLE typed over it — "Opening title" on the brief, `HookTitle` in
the render. The producer's ask: every film opens on something dramatic and
FAST, a trailer of the most dramatic stretch that never spoils the end; and
when the producer wants to, a chosen kind — a slate with place and date, the
robber grabbing the money, a riser into the moment before the fall. Live
since 2026-09-11 on all four pieces (Scripting `5a32e43e`, Media Generation
`b9779578`, Final Assembly draft `ebf193c5` — see the note at the end —,
orchestrator `40ae627e`; Hook Regen `MDYR0J93RJDU8ftf`; render commit
`b932eaf`, site `7b553cb`). What is load-bearing:

- **Six styles, three of them SILENT.** `teaser` (3-5 spoken beats of 2-10
  words, one shot each), `question` (1-2 beats + the question on screen),
  `figure` (1-2 beats + a number the film STATES, set huge, with its source
  when the research pack has one), `slate` (one silent establishing shot,
  PLACE and DATE over it), `action` (2-3 silent shots of the climax in
  motion), `cliffhanger` (2-3 silent shots of the moment before the turn, a
  riser building, a boom on the cut). `Editing Options.hookStyle` is `auto`
  (the default everywhere — absent reads as auto) or a style; the brief's
  "Cold open" control writes it, `Voice Mode` reads it. A silent film may only
  open silently, a kids film may not use action/cliffhanger. **The style list
  is whitelisted in THREE places that must agree**: `HOOK_STYLES` in
  derive.ts, `Normalize Webhook Input`, `Voice Mode` (plus the copy inside
  `Hook Regen`'s `HR Prep`).
- **One beat = one scene, and the split is on LINE BREAKS.** `Prepend Hook To
  Chapters` writes the hook chapter's `narrator_script` as one line per beat;
  `Plan Scene Splits` cuts chapter 0 on `\n` instead of the 22-word chunker
  — otherwise "One student." would be folded into its neighbour and the
  teaser would come back as one 8-second scene again. The segmenter gets
  `hookSegmentRules` for chapter 0 only: 3-second shots (6 for a slate),
  one strong subject, one decisive camera move. Verified on the first film
  (execution 12303, `recN8pR5qKPQhSmMB`): four shots, orders 1-4, `Durată` 3,
  "Fast push-in", "Hard tracking shot", "crash-zoom", "Handheld follow".
- **A silent beat is stored with EMPTY narration and `Aprobare Voce` already
  true.** The beat text travels as `[SILENT] …` so the segmenter copies it
  verbatim, `Save scenes To Airtable1` strips it into `Script Scenă: ''`, and
  three Media Generation nodes know what an empty line means: `AB No Speech?`
  skips TTS for it, `Evaluate Image Approval` waives the Voiceover URL for it
  (`silentScene`), and `Current Scene` gives every chapter-0 shot
  **`veo-3.1-fast`** (`hookVideoModel` overrides; the free tier stays the
  body's default — 4-5 hook shots on Quality would have been 400-500 credits
  a film, more than the whole month's allowance at three films a day).
- **`Hook Guard` measures the style rules** (beat counts, words per beat, the
  card fields a style needs, a figure or a date the film actually states, no
  number that appears only in the last chapter — that is the ending), two
  retries with the reason, then accept. Same shape as `Narration Guard`, same
  reason: an instruction in a prompt is not a constraint.
- **The plan is STORED**: `Save Hook Plan` merges `Editing Options.hookPlan`
  `{style, silent, beats, card{line1,line2,source}, chosenBy, writtenAt}`
  in-line before `Save Script To Airtable` (`Hook Plan Done` hands the item
  stream back, the `Evidence Done` pattern). `chosenBy` is `producer` only
  when a style was asked for, `default` when the category left one,
  `ai` otherwise.
- **The render knows two things and derives one of them.** `hookEndSeconds`
  (remotion/src/hook.ts) is the first chapter-≥1 scene's start, from the
  SCENES, never from the plan — the scenes carry what was actually made.
  `hookCardWindow` places the one card a style draws (`HookCard`: question /
  figure / slate) and ends it before the chapter card's flare peaks on the
  first story frame; captions run over a spoken teaser and step aside only
  for that card; text cards never land on a hook shot. `HookTitle` is gone.
  `npm run check:hook`.
- **`/assemble` cuts the teaser the way the plan says.** Per-scene
  `holdSeconds` / `minSeconds` / `gapSeconds` (Build Timeline sends them for
  chapter-0 scenes of a film WITH a hookPlan, so every older film times
  exactly as before): a silent shot is held for its planned length, a spoken
  beat gets **0.45s** of breath after its last word with a 1.6s floor.
  `hookRiser` (sent for cliffhanger and action) places a 3.2s riser ending ON
  the cut to the story plus a boom on it, independent of the music switch — it
  is what the shots are doing, not an accent. `verify.hookEndSeconds` reports
  the boundary. `check:mix` covers it in all 48 combinations.

  **That gap was 0.12s until 2026-09-12, and the producer's report was "vocea
  este data prea rapid si nu se intelege nimic".** It was not a playback rate:
  an ordinary scene gets 0.35s, and the breath trim has ALREADY cut the take's
  own lead-in and tail silence off, so 0.12 was all the air a teaser beat had —
  **less than the same narrator leaves between two clauses of one sentence**,
  with three to five whole statements arriving back to back. The number was
  chosen so the PICTURE cuts hard on the last word, which is right; the mistake
  was giving the picture and the voice one number. 0.45 is deliberately MORE
  than an ordinary scene's 0.35, because a teaser line has to land on its own —
  that is the whole reason it is a separate shot. Silent shots are untouched.
  Costs about 1.3s on a four-beat hook. **Generalises: a constant shared by a
  visual cut and a spoken line is two decisions wearing one name.**
- **`hook-regen` rewrites the hook ALONE** (workflow `Hook Regen`, POST
  `{project_id, hook_style}`): loads project + chapters + evidence + genre
  profile from Postgres, writes the beats under the same rules and the same
  guard (a second copy of both — `HR Prep`, `HR Guard`), writes one shot per
  beat (`HR Shots Prompt`, a second copy of the segmenter's hook rules),
  then in ONE transaction deletes the chapter-0 scenes, creates the new ones
  through `hov.at_create` with exactly the fields `Save scenes To Airtable1`
  writes, rewrites the hook chapter's script and merges `hookPlan` while
  clearing `hookRegen`. The new scenes arrive UNAPPROVED (`Aprobare Scenă`
  false) — a rewritten line is reviewed like any other — and with no
  picture, so the next production pass makes them (Resume / nudge when no
  batch is alive). `create_workflow_from_code` skipped the credentials on
  both HTTP nodes again, fourth occurrence.
  **`HR Commit`'s transaction is also why every literal in `HR Apply` is
  base64** — read the transaction-batching trap under "The write mechanism"
  before touching that node; it is the bug that killed the first rewrite a
  producer ever fired (2026-09-12), and dollar-quoting is what caused it.
- **The site sets `Editing Options.hookRegen` before firing and the run
  clears it — the stranded-flag shape, so `HookPanel` carries its own exits**
  ("Send the rewrite again" / "Cancel — keep this hook"), exactly as the
  scene rewrite does. The panel shows the plan the moment the script exists
  (scene step, where a rewrite costs one model call) and again beside Final
  touches (where it also costs new shots, and says so). `confirmFinalSettings`
  deliberately does not send `hookStyle`: a rewrite is new shots, not an
  overlay.
- **Every hook shot is fresh footage the batch has to make**: 3-5 more images
  and clips per film, on Fast. On the cost panel that is ~40 credits a film.
- **Final Assembly `ebf193c5` was published only AFTER the Railway build of
  the render commit went green** (deployment `ee1430d3`, 21:53 UTC): the
  draft sends keys an older `/assemble` ignores harmlessly and `hookPlan`
  reaching an older Remotion bundle is equally harmless, but the teaser is
  only cut fast once both halves agree. The site's first deploy of the same
  push FAILED (run 125): `HookPanel`, a client component, imported the
  style list as a VALUE from `lib/data`, which drags the Postgres adapter
  (`pg`, `net`, `tls`) into the browser bundle. Every other client component
  imports only TYPES from `lib/data`; values come from `lib/data/derive`.
  Fixed in `583b08c` (run 126).

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
  → the photo as GROUND TRUTH ("recreate the subject faithfully"), which is
  a deliberately different instruction from the n-1 chain's "identity only,
  different composition". User ref wins over chaining and skips the
  similarity guard. **Since 2026-09-02 the reference is a Flow media id**
  (`refImageMediaId`, uploaded once per film by the user-ref chain after
  `IMG Load Project`), not the Drive URL — see "Images are made on Google
  Flow".
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


### Direction: why Veo played the shot backwards — 2026-09-13, LIVE

The producer: *"scena spunea cum mașina iese din curte, iar mașina mergea cu
spatele către curte"* — and *"rateuri cu lucruri fără logică"* generally, on
`veo-3.1-lite-low-priority`, which is the tier every film runs on and is
staying on by their explicit choice. Full account, node bodies and the
verification runs: `db/port/veo-direction/`.

**The motion prompt was never the problem.** A query against live scenes
shows the segmenter's rule 6 works — *"surges right to left out of the
substation"*, *"advances away from the camera"*. Direction is stated. What
was APPENDED underneath it was the problem:

> everything that moves travels the same way as the subject — no oncoming
> vehicles, nobody walking or driving against the flow

That is not a general truth. It is a rule that **forbids shots this pipeline
legitimately writes**: scene 101 of the LEGO chase film asks for the cruiser
right-to-left with the Ferrari left-to-right ahead of it, and the clause bans
it outright. So does a crossing, and so does a car pulling into traffic.
Handed a prompt and a rule that contradict each other, the weakest model on
the tier resolves the contradiction whichever way it likes — a coin flip on
every clip, which is exactly the symptom. `no reversed motion` went with it:
it reads two ways (reverse PLAYBACK, or a vehicle driving backwards) and it
is a negation, which is a poor way to not get a thing. **When a clip does the
opposite of its prompt, read what else is in the prompt before blaming the
model.**

**Free Veo will take a last frame, and that changes direction from rhetoric
into geometry.** useapi supports I2V-FL — `startImage` + `endImage` — on
every Veo variant. Given two frames Google silently routes this tier to
`veo_3_1_interpolation_lite_low_priority` with
`VIDEO_MODEL_CAPABILITY_START_AND_END_IMAGE`, still at zero credits
(verified: `remainingCredits` unmoved, 8s/720p in 55s). A car that must END
outside the gate cannot get there by driving in. The end frame is drawn by
the same image model with the approved still as `reference_1`, so only what
moves has moved; it is scaffolding, never stored or shown. **Its cost is
queue time** — ~25-30s per scene, two image generations each paying a ~5.5s
captcha — which is why a switch exists at all. **Read this paragraph as
history: the end frame became opt-in on 2026-09-14 and the switch reversed to
`endFrame: true`.** The "geometry not rhetoric" argument above did not survive
contact — it was built on a cause the SAME afternoon's earlier fix had already
removed, and it is answered in full under "When an end frame helps" below.

**`reference_*` / `character_*` cannot be combined with `startImage` /
`endImage`** — both trigger R2V (Ingredients) on Veo. So Flow Characters and
a start frame are mutually exclusive, and the approved still wins.

**Interpolation's failure mode is a MORPH, and it is invisible to a
direction check.** Two frames too far apart make the model dissolve between
them rather than move anything — and the car does end up outside the gate, by
fading there. Hence the motion judge scores `morph` separately, and morph is
the one verdict a different seed cannot fix: the same two frames dissolve
again at any seed, so that verdict drops the end frame instead.

**Then: an instruction in a prompt is not a constraint.** Both fixes above
only ask Veo more nicely. So the clip now gets what the still already gets
from `Judge Prep` — a contact sheet, gpt-4o, and a score. `direction`,
`coherent`, `morph`; thresholds deliberately low (0.5 / 0.45) because a
re-roll costs a whole generation, and every way of not getting an answer
KEEPS the clip. One re-roll per scene per pass; `motionJudge: false` turns it
off. ~1,410 prompt tokens a clip, about 30 cents an eighty-scene film.

**A resubmit that reuses the seed returns the same clip.** `Current Scene`
derives the seed from the scene id and the takes already FILED, and a take
rejected by the judge is never filed — so a plain resubmit would send the same
seed, prompt and frames. `Motion Resubmit` overrides the seed and resets
`sd.polls[sceneId]` so the new job is not declared timed out on arrival. (The
older `Resubmit Guard` has the same blind spot harmlessly: it retries jobs
that FAILED, where an identical request is the right thing.)

### A prompt that names a failure summons it — 2026-09-13 (evening), LIVE

Hours after the direction fix above, the producer came back with an 8-second
clip from the café film `recXibIyVuLvMIqy3` and a list: *"personajul ia ceva in
mana apoi dispare, usa la frigider se deschide singura, bate vantul peste acele
foi lipite ce nu are sens ca nu bate vantul in cafenea, usa de la camera se
inchide singura, personajul ia acel teanc de foi pleaca cu el apoi se intoarce
nenatural"*. Pulled apart at 4 fps, all 34 frames confirm every complaint, plus
two they did not mention: the prep table vanishes and returns in a different
place, and the apron flickers between a bib cut and a waist cut.

**Almost none of it was the model inventing. The prompt asked for it.** The
stored `motion_prompt` for that scene, verbatim in the parts that matter:

> …**reaches to the shelf, strips off the last sleeve stack, and pivots back
> toward the swinging door**. Fluorescent prep-room light stays cold and static
> while **loose paper edges quiver from her movement** … Negative: … **no
> subject appears, disappears, duplicates or changes identity.**

Four separate lessons, each of which has now changed a node:

**1. Never mandate ambient motion.** Rule 6(c) required every shot to carry
*"the ambient/atmospheric motion of the environment (drifting steam, rippling
water, flickering light, moving crowd, blowing dust)"*. In a still indoor room
there is nothing to move, so the model invents something — and what it reaches
for is paper. Nine of that film's sixteen scenes asked for motion nothing in
frame could cause. The rule now reads: ambient motion **only where something in
frame causes it** (steam off a machine, dust in a sunbeam, a clock's second
hand), **indoors there is no weather**, and **write nothing at all if nothing
causes motion**.

**2. An adjective on a prop is an instruction to animate it.** *"the swinging
door"* is how the door came to swing with nobody near it; three of sixteen
scenes labelled a prop with a motion word. The rule is now literal: write *"the
door"*, never *"the swinging door"*.

**3. One action per shot.** *"reaches … strips off … pivots back toward the
door"* is three actions in eight seconds. The model, with more to do than fits,
performed the first one twice, lost the object between the two, and walked out
of frame and back — which is precisely the producer's *"pleaca cu el apoi se
intoarce nenatural"*. Rule 6 now caps a shot at one action and carries that exact
sentence as its worked counter-example.

**4. Naming what you do not want is how you get it.** Google's own Veo guidance
is explicit: **do not use instructive negative language** (*"no walls"*,
*"don't show walls"*) — put what is unwanted in a bare comma-separated **noun
list** instead, because naming a thing in a negative makes the model more likely
to render it. Our tails were almost entirely that anti-pattern — **and so was
the clause added that same afternoon** by the fix above, which read *"nothing
floats, melts or morphs; nobody and nothing appears, disappears or duplicates"*.
We wrote "disappears" and "duplicates" into the positive prompt and then got
exactly those. Both tails are now a positive world-state followed by one noun
list: `Negative: speech, voices, dialogue, …, duplicated subject, morphing,
warping, reversed playback.`

**The stored prompt is now the ACTION ONLY; guardrails are composed at submit
time.** That is the architectural half of the fix and it is what makes it cheap:
`Current Scene`, `Submit Video Regen` and `End Frame Prompt` each strip any
legacy tail with `String(x).split(/\s*Negative:\s*/i)[0].trim()` before use, so
**all 368 legacy scenes across 18 projects are repaired with no backfill**. A
guardrail that lives in the database is a guardrail you have to migrate; one
composed at submit time is a guardrail you can change in a single node.

**The same text lived in more places than the obvious one.** The afternoon fix
touched two nodes and was reported as done; it was one of **three** copies, and
a full fan-out found **seven** places that compose or preserve the tail — the
segmenter's rule 6, `HR Shots Prompt` in Hook Regen (a second full copy, and the
broken clip was a hook scene, so this was the copy that actually wrote it),
`VP Rewrite AI` (explicitly instructed to keep the trailing clause, which
launders it back into the database on every content-policy rewrite),
`Rewrite Scene Text` / `Rewrite Scene Standalone` (a third, shorter literal),
and the site (which writes no tail — the correct shape). **Before declaring a
prompt change done, grep every workflow for a distinctive phrase from the text
you just replaced.**

**The end frame is implicated in the round trip, and that is worth remembering
about any scaffolding.** `End Frame Prompt` embedded the WHOLE stored prompt,
so an after-frame for scene 3 was drawn with the subject *"pivoted back toward
the swinging door"* — and `veo_3_1_interpolation_lite_low_priority` must LAND on
the frame it is given. A chained action in the text therefore became a mandatory
round trip in the picture. Scaffolding built from a bad brief does not dilute the
brief, it enforces it.

**Two further findings from the same fan-out, both live the same evening.**

**The producer's regeneration note was being DELETED, and the submit-time strip
is what deleted it.** `Evaluate Video Approval` built the regeneration brief as
`<stored prompt> + ' ADJUSTMENT REQUEST — the new video MUST follow this: …'`,
appended. `Submit Video Regen` then stripped the legacy tail with
`split(/\s*Negative:\s*/i)[0]` and kept the half BEFORE it — so on any scene
still carrying that tail, which is 368 of 504, the producer's own words went
over the cliff with the tail. Reject a clip, write what is wrong with it, wait
ninety seconds, receive a re-roll of the identical brief. That is the shape of
"regenerate does nothing", and it was introduced by the strip itself a few hours
earlier the same day. The fix is ordering: strip FIRST, then append the
correction, so the human's sentence becomes part of the action. **A strip and an
append on the same string are a pair — whichever runs second decides whether the
other one mattered.**

**Both new judge questions needed an escape clause, and finding that out took
running the node rather than reading it.** `direction` has always ended "if the
brief names no direction, answer 1". `permanence` and `untouched` shipped without
an equivalent and would have fired constantly: rule 6 MANDATES a named camera
move on every shot, so things entering and leaving frame is the design, and an
absolute permanence question docks every well-made pan; and `untouched` is a rule
about INTERIORS, while outdoors wind, water, foliage, traffic and crowds move
with nobody touching them, so the same question re-rolls street scenes for being
streets. Both questions now carve those out by name. **The threshold is the
second line of defence and the wording is the first** — if a gate fires on
ordinary films, fix the question before touching the number.

**The apron flicker has one owner reached by two doors.** A character's look is
authored exactly once, as `bible.characters[].visual_description` by rule 3 of
`Generate Story Bible` — and `Rebuild Story Bible` carries that rule byte for
byte, as the same author reached after a script rewrite. Everything else only
RELAYS it. That is the right shape, and it is exactly why an ambiguity is
expensive: every consumer resolves it independently, so the cast sheet picks one
reading, the scene picks another, the end frame a third, and Veo interpolates
between a bib apron and a waist apron for eight seconds. The bible had said only
"forest-green short-sleeve coffee shop apron". Rule 3 now requires every garment
down to its CUT and its FASTENING, with the test being that two illustrators
given only that sentence would draw the same clothes. **Publish the two bible
nodes together or neither** — they were byte-identical before (1,235 chars) and
after (2,319), and updating only one means a producer who rewrites their script
silently gets the under-specified wardrobe back.

**The adversarial pass earned its keep twice, and both catches were about a fix
making something else worse.** Worth recording because the pattern will repeat.

**REJECT on `Evaluate Video Approval`: a fix that unmasked an older leak.**
Strip-then-append was right for the producer, and it turned a second, hidden
problem into a live one. `Observații Scenă` is NOT a producer-only field —
five nodes in Media Generation write machine text into it (`VP Apply`,
`Apply Rewritten Prompt`, `Mark Flow Upload Rejected`, `Mark Video Prompt
Rejected`, `Mark Regen Filtered`), all prefixed `AUTO-REWRITE*` or `REJECTED*`,
and **nothing in that workflow ever clears it** (the only three clears live in
Claude Scripting). `VP Apply` writes the note AND sets `Regenerează Video: true`
in the same statement, so the very next poll finds a machine sentence sitting in
the producer's feedback slot. While the note was being deleted by the strip that
did not matter; the moment it stopped being deleted, Veo would have been handed
*"the new video MUST follow this: AUTO-REWRITE-VIDEO (attempt 2): the video
filter refused this scene …"* as a mandatory instruction — and again on every
later regeneration of that scene, forever, because nothing clears the field.
`Evaluate Image Approval` one gate upstream already had the answer
(`/^(AUTO-REWRITE|REJECTED)/i` → treat as not-feedback); the video gate now
carries the same test. **When you stop discarding something, check what else was
riding on it being discarded.** The same review caught that a tail-only stored
prompt would strip to `''`, and `Prep Video Regen` throws on that with no
`onError` set — which aborts the whole batch, not one scene, and strands the
in-flight flag. It now falls back to the raw string.

**Two more, in prompts that are written by one model and read by another.**
`VP Rewrite AI` forbade a trailing `Negative:` clause but not inline negation —
and its output is stored in `Video Scenă URL` and handed verbatim to the image
model, which strips only a tail and never an inline "no X". It now has to write
positively, with the content filter's own required phrase (*no resemblance to
any real person*) as the single carved-out exception, because a blanket ban
would have contradicted a rule three lines above it. And both scene rewriters
told the model to *"keep the style and mood words the current motion prompt ENDS
WITH"* — on 368 of 504 rows the prompt ends with the old prohibition list, so
"the style" it was pointed at was a list of things not to do.

### A shaft of light is not a cause — 2026-09-15, LIVE

The producer, over a frame of a black-and-white conference room with white specks
hanging in the air: *"I dont understand why it generates this particles. It
happens really often and it makes no sense."*

Not the render — `FilmLayer.tsx` only adds grain, which is a flat noise field over
the whole frame, not discrete specks that sit in a beam and drift. We asked for
them, in words. That frame is scene 102 of the NASA film `recC5uy63NuUgeHD7`,
whose stored `motion_prompt` reads *"…while **dust motes drift in window light**
and the rest of the room remains still"*. Scene 1 of the same film manages the
self-contradiction *"dust motes drifting in **still air**"*.

**Measured before touching anything: 73 of 725 scenes across the last 40 films
ask for airborne particulate — 10.1%, and 29-33% on the worst.** "Really often"
was exact. Documentaries are worse than average because rooms, archives and
hearing chambers are where a window and a shaft of light are.

**The 09-13 ambient-motion rule above already catches most of this** — 10.4%
before it, 3.2% after — **and the case that walked past it is the instructive
one.** Café film `recXibIyVuLvMIqy3`, scene 110, written after the fix:

> Slow dolly-in on a figure standing near frame left… **She stays where she is.**
> Late afternoon sun through the window lies still across the empty tables, **with
> dust motes turning slowly in the shaft of light. The chairs and tables hold
> still.**

Read as a report card that is a pass on every rule it was given: one action,
nothing untouched moves, stated twice. It still put motes in the beam — not by
ignoring the rule but because **it did not think the rule was about this.** The
rule says INDOORS THERE IS NO WEATHER and lists paper, cloth, curtains, hanging
signs and loose sheets. A sunbeam is not weather; it is lighting. And dust in a
sunbeam is a photography cliché strong enough to survive a rule it does not
obviously break.

One sentence now closes it, in rule (c) between the weather sentence and *"If
nothing in the shot is causing motion"*:

> A SHAFT OF LIGHT IS NOT A CAUSE EITHER: "dust motes turning in the window
> light" is the one piece of invented air movement that survives the sentence
> above, because it reads as lighting rather than as weather — but motes only
> move if the air moves, and indoors the air is still. Light falls, lies across a
> surface and picks out an edge; it carries nothing.

Three deliberate choices in how it is written, all reusable:

- **It quotes the exact phrase the model keeps producing.** That is the only way
  to close a gap the model does not believe is a gap — a general restatement of
  the rule it already passed would change nothing. **This is the one place the
  "never write a negation" rule does not apply**, and the distinction is worth
  holding on to: that rule is about text reaching **Veo**. This text reaches
  **gpt-5.4**, which is being asked what to write, not what to draw, and the
  sentence never leaves the scripting model. Do not "fix" it into a noun list.
- **It gives the mechanism, not the ban** ("motes only move if the air moves"),
  so it generalises to smoke, pollen, embers, indoor snow and floating seeds
  without listing them.
- **It says what light DOES do**, positively — falls, lies across a surface,
  picks out an edge — so the writer keeps a way to use the beam. A rule that only
  takes something away gets routed around.

**There are FIVE live copies of the ambient-motion rule, not four.** The entry
above found `Segment Chapter Into Scenes`, `HR Shots Prompt`, `Rewrite Scene
Text` and `Rewrite Scene Standalone`. The fifth is `VP Rewrite AI` in **Media
Generation** — the content-filter repair — and it matters out of proportion to
its traffic because it is the only node on that side that WRITES a motion prompt
back to the database, so without the sentence it launders motes onto scenes the
segmenter wrote clean. It was found from this repo's `paste/` copies after a grep
of the two workflows I had open missed it, which is the CLAUDE.md warning landing
again: **grep the repo's own port directory as well as the live workflows.**

Full apply record, the per-film measurement, the four surviving prompts in full
and the published version ids: `db/port/still-air/README.md`. Note the byte check
there — four files grew by exactly 359 bytes and one by 361, because `Rewrite
Scene Text` escapes its quotes as `\"` where `Rewrite Scene Standalone` writes a
bare `"`, and the sentence contains one quoted phrase. **Detect each node's
escaping style programmatically; do not assume the pair matches.**

**Prompt-only, so existing films keep their motes.** The producer's NASA film
holds its three until those scenes' text is regenerated (which goes through
copies #2/#3, both fixed). And this is a fix with a mechanism and no outcome
until a film written after 2026-09-15 is measured — re-run the query in that
README and the post-fix bucket should read zero, not 3.2%.

### The script is checked against its own research before it is cut up — 2026-09-18, LIVE

The producer pasted a Google Maps script this pipeline had written, alongside
ChatGPT's reading of it, which listed four things in it that were not true —
a product described as still being a desktop one after it had shipped, a
launch attributed to the wrong platform, a motive attributed to a named
engineer, and two people credited with leading a team. The ask: *"a system to
check whether the information from the scripting part is accurate and rewrite
it if not."*

**It is tractable only because the retrieval half already existed.** `Research
Tema` → `Extract Claims` already produces a numbered pack of sourced claims
(E1…E20), each with a real URL, and the narration is written FROM that pack.
So the question the checker asks is not the open-ended, hallucination-prone
*"is this true?"* but the closed-book *"does any claim in this numbered list
say this?"* — answerable from the text in front of the model, with no
knowledge of the world required. Design anything of this kind the same way:
**find the closed-book version of the question before reaching for a model
that knows things.**

Full account, the chain, the version ids and every verification run:
`db/port/fact-check/README.md`. Three lessons belong here.

**A story is not a film with errors in it.** Run the judge on "The Roman slave
who conquered Egypt" and it flags 55 of its 56 statements. Every verdict is
correct — nothing in a pack about Ptolemaic Egypt backs what an invented
Lazarus did on a Tuesday — and the result is worthless; the rewrite would have
been handed the whole film. The gate that was supposed to prevent this,
"researched, with a pack", does not, because that film IS researched: fiction
here is researched for its background. **Nor does the project's category**:
`story` is the site's default, so the Burj Al Arab, Peking to Paris and Tupac
documentaries all carry it too — of eleven researched films in the database
only three say `documentary`. The only signal that separates a documentary
from a dramatisation is the narration itself, so the judge is asked FIRST what
it is reading and returns nothing for a story. **When a gate has to tell two
kinds of content apart, check whether the metadata you were about to trust
actually varies — a field whose default is one of the two answers is not a
signal.**

**Never let a corrector rewrite most of its input.** Past some share, a
rewrite stops correcting the producer's script and starts replacing it, and no
per-sentence safety check notices, because each sentence individually looks
like a fair fix. `FC Resolve` therefore stops offering to rewrite at all when
more than 60% of at least 8 checkable statements fail, and reports instead.
The findings still reach the producer in full — that is the producer's own
"warn loudly, never block" — but the film is returned untouched.

**A correction has to be visible or it is a silent edit.** The rewrite lands
BEFORE segmentation, deliberately: at that moment no scene and no voice take
exists, so a changed line costs nothing and desynchronises nothing (the whole
of "A line and its recording drift apart silently" is about the other case).
But it also means the producer opens the script gate looking at text a model
changed without being asked. The panel above the box says so in bold and shows
each sentence AS IT WAS, because the new wording is already in the box: the
only way to see what changed is to be shown what it used to say.

**Where the error rate actually lands.** On the Burj Al Arab film — a real
documentary, 6 chapters, an 18-claim pack — the judge found 47 checkable
statements, the pack backed 31, a targeted search sourced 16 more from
Jumeirah's own pages, CTBUH and a Washington Post archive piece, and 8 were
rewritten. Two of the eight are worth knowing by name, because they are the
shape of the problem: *"including documented use of 24-carat gold leaf"* (the
word "documented" was doing work no source supported — though the search then
found Jumeirah's own page saying 1,790 m² of it, so the sentence survived with
a citation), and *"9,000 tonnes of WHITE steel"*, where the pack gives the
tonnage and nothing gives the colour. Neither is a hallucination in the usual
sense. Both are a writer adding a true-sounding adjective to a sourced fact,
which is what this check is really for.

### A sentence is only as sound as its weakest clause — 2026-09-19, LIVE

The producer ran the first post-Deep-Search Google Maps script past ChatGPT
and brought back four things it had let through, with the verdict that *"the
chronology-checking component needs improvement — especially when several
acquisitions/events happen close together."* All four were one fault, and
it is worth stating precisely because **the check was doing exactly what it
was told and what it was told was wrong.**

The judge returned **one finding per sentence**, and a documentary sentence is
almost never one assertion. *"Search and mapping were already moving together,
while Where 2 still sat outside the browser"* has two: the pack backed the
first and was silent on the second, and the sentence as a whole came back
`supported`. The same shape produced the other three — *"reached … about 200
million places"* ruled against a claim that Maps held "information, ratings
and reviews FOR about 200 million places" (a quieter verb), and *"Lars
Eilstrup Rasmussen worked in Noel Gordon's Sydney spare room"* against a claim
that FOUR people founded the company there.

**Ask a judge for a verdict on a unit bigger than the claim and it will rule
on what the unit is mostly about.** The prompt now asks for one finding per
ASSERTION, the same `quote` repeated as often as the sentence needs, with
`claim` as what tells them apart. On the producer's own narration that went
from 15 findings to 26 across 13 sentences, and all four misses came back
`unsupported`.

**A closed-book checker inherits its pack's errors, and that is not a bug it
can be prompted out of.** The ZipDash one — *"Google acquired Where 2 and
Keyhole that month, then bought ZipDash"*, when ZipDash came first, in
September — was not missed. It was checked, against claim E5: *"Google
acquired ZipDash in 2004 AFTER buying Where 2 Technologies and Keyhole."* The
research asserted the order, the judge cited it, and both were wrong. Nothing
about reading the narration more carefully finds that.

What CAN be fixed is the judge treating an ordering as sourced because a claim
phrased it confidently. **A claim's PROSE is not evidence; only its facts
are.** E3 and E4 are dated October 2004, E5 says only "2004" — so the ORDER is
unsupported however the claim words it, and an unsupported ordering goes to
the live source lookup instead of being inherited. *Dates settle order.
Sequence words do not.* The other half of the repair belongs upstream and is
still owed: `Extract Claims` should be writing dates rather than "after".

**And the arithmetic underneath moved with the prompt.** Twice as many
findings for the same script meant `FC Resolve`'s "don't rewrite more than 60%
of it" backstop was suddenly measuring a different thing, its fix list was
asking for one sentence to be rewritten three times, and `FC Apply` would have
reported one corrected sentence as three corrections. All three now count
DISTINCT SENTENCES. The general form is worth carrying: **a ratio measured
over units that a prompt defines is not a threshold, it is a coincidence** —
change how finely the model is asked to slice and every number underneath
moves with it, silently, in the direction that looks like nothing happened.

**Then attribution walked straight around the order rule, and that is the
sharper lesson** (same day, `3d1834f1`). The next film's writer had
*attributed* the chronology — "Google acquired Where 2 in October 2004 and,
**according to the same report**, added Keyhole and ZipDash" — so the
assertion the judge extracted was a claim about what a report SAYS. The pack's
E16 really does say it, the finding was correctly `supported`, and "dates
settle order" never fired because no ordering claim was ever extracted at all.
**Naming a source does not make a date right, and a viewer does not hear
"this ordering is contested" — they hear the ordering.**

The judge now rules on an attributed statement TWICE when the underlying fact
is one somebody else could check — a date, an order, a count, a measurement —
once on the attribution and once on the fact. The limit is as important as the
rule and is written into the prompt: a party's claim about ITSELF ("Google said
Maps had a billion monthly users") stays ONE claim, because what they said IS
the fact and no outside source can settle their internal number. And the
rewrite may no longer repair an ordering by attributing it: that leaves the
same chronology in the viewer's ears with a citation in front of it, so an
ordering goes to the ladder's second rung instead — name the period everything
is agreed to have happened in, drop the sequence.

**A rule that refuses is only useful if it still accepts.** The obvious
failure mode here was a filter on the word "after", which would paint every
acquisition documentary red. It did not happen: on the film that verified this
live, *"Facebook completed the Instagram acquisition after the FTC closed its
investigation"* came back `supported`, citing E5's August 22 2012 closure and
E2's August 2012 completion — **the judge named the two dates as its
justification.** Undated order refused, dated order accepted with its working
shown. When you add a rule that says no, find the case where it should say yes
and check that it still does.

**The narration is also now checked against ITSELF**, which nothing in the
chain could do before. The same film said "In early 2003, Lars and Jens started
Where 2 Technologies in Sydney" and, three sentences later, "In 2004, two
Australians and two Danes came together in Sydney" — one founding, two years,
two counts — and the second sentence produced no finding at all, because "came
together to develop" reads like scene-setting. It is not: it carries a date and
a count. **A sentence that re-tells an event already narrated is always
checkable**, and the judge is the only step that ever holds the whole script,
so it is the only place this can be caught. It is the same fault that opened
this entire story, when the first red-lit film's hook said April and its first
chapter said October.

### A source must back the RELATIONSHIP, not only the nouns — 2026-09-23, LIVE

`7a865309`, `db/port/fact-check/README.md` §10. The entry above taught the
judge that `A BECAME B` is not sourced by a source for B. That was the right
rule in one special case, and the general one took another four days and a
second reader to find:

> **A source must support not only the nouns, dates and events in a sentence,
> but the relationship the sentence asserts between them — causation,
> intention, limitation, comparison, chronology and consequence.**

The sentence that exposed it was *"Inside Google, the Sydney software gained
the scale it had lacked"*, and what makes it worth reading twice is that **the
judge's own output convicted it.** It returned `supported` with
`claim: "gained scale it had previously lacked"` and
`reason: "gained scale inside Google"` — a justification narrower than the
claim it was justifying, written down, in the same object. So the cheapest fix
was not a new rule at all but a self-check: **when your reason covers less than
your claim says, the verdict is unsupported.**

**A before-and-after is the sharpest case because half of it is invisible.**
"gained the scale it had lacked" asserts something about the period BEFORE, and
a source about the after settles none of it. The same shape hides in *no
longer*, *still*, *for the first time*, *finally*, *kept*, *lost* — every one
of them a claim about two moments wearing the clothes of a claim about one.

Measured on the producer's film (execution 16421): the sentence now returns two
findings, one `supported` and one `unsupported`, and **all four sentences the
rewrite removed are from the family the rule names** — an intention (*"the aim
was practical"*), an inability (*"the startup could not deliver it worldwide on
its own"*), a comparison (*"gained the scale it had lacked"*) and a change of
state (*"was no longer only a startup tool"*). Four for four is the evidence
that the rule is finding its category rather than flagging more or less at
random.

**The diagnosis that came with it points upstream, and is the real work.** The
reader's summary was *"the problem is mostly the script generator adding
cinematic connective language that outruns the evidence, not the checker being
too strict"* — and that is right. `Write Full Narration` and `Edit Full
Narration` produce the connective prose; the judge then catches it one sentence
at a time, after the fact, on documentaries only. Constraining the writer is
cheaper than checking the writing. It has not been done, because those two
nodes are on the main path of every film in every category and a change there
needs its own verification.

### A guard that re-derives a decision drifts from the node that owns it — 2026-09-23

Same publish, and the more expensive of the two. `FC Apply` is the safety valve
between the fact-checker and the film: nothing the chain writes reaches the
script unless it passes there. It measured a rewritten chapter against a
**symmetric** band — a fifth either way — and on the producer's Google Maps
documentary it therefore threw away a correction that cut five unsourceable
statements, because cutting five sentences out of eleven made chapter 1 28%
shorter. **Every other part of the chain worked.** The judge found them, the
rewrite fixed them, the row said `refused: "chapter 1 went from 178 to 128
words"`, and the producer kept all five.

**This project had already settled the question a fortnight earlier.**
`Narration Guard`, 2026-09-13: *the length is a CEILING — a film shorter than
ordered is correct, and only a draft under 55% of its target, a broken one
rather than a short one, goes back for length.* The valve had a second, private
answer to the same question and nobody noticed, because a guard that refuses
things only announces itself when it refuses something correct — and then it
reads as the checker being wrong, not the guard.

The band is one-sided now: grow past a fifth and it is refused (padding is how
a narration used to reach a word count), lose more than HALF a chapter and it
is refused (that is a re-telling), everything between is accepted. And
**shorter is allowed, silently shorter is not** — both copies compare the
result against `Narration Guard`'s own `min` and write `short: {words, min}`
into the report, which is never a refusal. It says the film has not got enough
SOURCED material for the running time ordered, and the answer is more research
or a shorter film. Neither is a choice this chain gets to make.

**The rule: when a decision has an owner, READ it, do not re-derive it.** A
second copy of "how short is too short" cannot be kept in step by intention,
and the failure is silent in the one direction that matters.

### Deep Search is Documentary mode's feature, not the narration's — 2026-09-18

The entry above says the project's `category` cannot tell a documentary from a
dramatisation, and gives the evidence: `story` is the site's default, and of
eleven researched films only three say `documentary` while the Burj Al Arab,
Peking to Paris and Tupac films — all documentaries — say `story`.

All of that is still true, and the producer gated on `category` anyway, the
same afternoon: **"The new fact checking system has to be active only in
documentary mode."** That is not a contradiction, it is a different question.
The category is a REQUEST, not a description. Reading it as *"this film is
factual"* is unsound. Reading it as *"this producer asked for the documentary
treatment"* is exactly what it is for — it is the field that already decides
archive footage, the source watermark and the end-screen credits, and Deep
Search now joins that list.

**What it costs, stated plainly because it is invisible from the screen**: a
factual film created in Story mode gets nothing. Asking for Deep Search means
choosing Documentary when the film is created.

**The judge's own factual/story verdict is KEPT as an inner gate.** Two gates,
one per failure mode: the category answers *was it asked for*, the judge
answers *can it be done*. A documentary whose narration turns out to be a
dramatisation is a real case and no category can catch it.

**Every skip now carries a CODE as well as a sentence**, and that split is the
point. `not-documentary` and `story` are normal; `no-mode`, `not-researched`,
`no-pack`, `no-chapters` and anything unrecognised mean a film that asked for
Deep Search and did not get it. The prose beside each one will be reworded; the
code is what the site's red light is wired to, and `lib/deep-search.ts` is the
only thing allowed to interpret it. **A code the site has never heard of fails
CLOSED — red, not green** — because the alternative is a future workflow
turning the alarm off by inventing a reason.

### A word cap is obeyed or ignored according to how it is PHRASED — 2026-09-19

The series recap (`db/port/series-recap/`) asked gpt-5.4 for *"two sentences, at
most 60 words"* and got about a hundred, every time. Raised to 100 on the
producer's call, it wrote 128. Two points, a clean third over on both, and the
conclusion looked obvious: **a model overshoots any cap by about a third, so a
number in a prompt is a dial, not a fence.** That is what this section said for
an hour, and it was wrong — or rather, it was a law derived from one phrasing.

The producer's answer to it is what found the fault: *"I don't want this limit
to affect future episodes — leave it at 60-80 if you like, but make the workflow
actually generate that much, because I'm not going to rephrase it by hand."*
Which turns the question from *how much does it overshoot* into *what makes it
not overshoot*. Four phrasings, same budget of 80 words, same two narrations —
a 1.4 KB kids episode and the 11.4 KB Burj Al Arab documentary, the longest
script in the database — three runs each (probe executions 15110, 15111):

| phrasing | words written |
|---|---|
| `at most 80 words` (what it had) | 92, 97 |
| `write between 55 and 80 words` | 79, 86 |
| `a budget of 80 words you cannot spend` | 78, 77, 73, 81, 77, 77 |
| **hard rule + count your draft + what happens if it is over** | **73, 75, 80, 71, 76, 72** |

Eight of eight inside the budget, on the shortest and the longest material in
the project. The number never mattered; the framing did. What does the work in
the winning version is three things together: **length is named as a rule**
rather than a preference, **the model is asked to count its draft before
answering**, and **the consequence is stated** ("an answer longer than N words
is rejected and useless"). Drop any one of them and it drifts — the range
version has two of the three and went over once in two runs.

So the rule for this pipeline is: **when a length matters, do not merely state
it — make it a rule, ask for the count, and say what happens if it is broken.**
And measure the phrasing, because *"at most N"* reads to a human like a hard
limit and reads to a model like an aspiration.

**A net still belongs under it, and it belongs at a sentence boundary.**
`Parse Recap` trims to 25% over the budget by dropping whole sentences, never
cutting inside one — a half sentence still reads like a recap, which is the
silent failure. It logs `RECAP LONG` when it fires, and with the measured
wording it never has: it exists so that a future model, or a future rewording,
shows up in a log instead of in the producer's field. `node
db/port/series-recap/check.mjs` (in `npm run check`) pins both halves — that the
prompt still states the rule, asks for the count and names the consequence, and
that the net still trims where it should.

Live on the producer's own show the same afternoon: 71 words, 405 characters,
where the 100-word cap had produced 717. At ~450 characters a line,
`composeSeriesLore`'s 8,000-character Lore cap now starts dropping the oldest
recap lines at about episode 17 rather than about 11.
