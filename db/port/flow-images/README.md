# Images on Google Flow instead of fal.ai — the port

Status: **APPLIED and LIVE since 2026-09-02 ~11:33 UTC.**

| Workflow | now active | was active (saved here as `*.original.json`) |
|---|---|---|
| 3. Media Generation `yHG4DBCDjR3RJzav` | `d88a638e` (two entries: `a53180c8` batch loop + user-ref upload, `d88a638e` gate regen + counters) | `95f1a1f0` |
| Claude Scripting `gkEtGMecv4TC3ZHp` | `bafbe64d` | `6ebf3e18` |

Applied exactly as every other MCP edit: `update_workflow` staged the drafts
(`applied/01..03-*.json` are the operation lists, verbatim), both drafts were
fetched back and diffed node-by-node against `activeVersionId` with
`applied/diff-against-active.js` — every differing node was in the intended
set, no `$('…')` reference to a removed node, no dangling edge, all twelve
Google Drive nodes still carrying `resource`/`operation`, every Code body
byte-identical to what was written — and only then `publish_workflow` with
each draft's own `versionId`. Rollback is `restore_workflow_version` to the
"was active" id, or a PUT of the saved original.

**The API contract was verified live before a single node changed**: a
throwaway workflow (execution 9241, archived) called `GET /accounts`
(`health: OK`, session refresh 01:24 UTC — not the 04:38 the design guessed)
and `POST /images` with `count: 1` — 23.6s for `nano-banana-2`, one item in
`media[]`, `media[0].image.generatedImage.{fifeUrl, mediaGenerationId}`
exactly as designed, the id of the form `…-image:<uuid>`, `modelNameType:
NARWHAL`, plus a `captcha` block showing useapi solved one reCAPTCHA in 3.5s
on the way. The `fifeUrl` is `flow-content.google/image/…?Expires=…`, which
`/api/media/ingest` downloads like it already downloads Flow's clips.

**First film on the new chain — 2026-09-02 17:02 UTC, execution 9361** (the
disposable test film *A race between a snail and a turtle*, restarted to test
the story layer, so its batch was the first one to make images on Flow).
Audio stage 17:02:16→17:02:44 for four takes; the first image landed at
17:03:22 — 38 s after the audio stage: 8 s `Flow Pace`, ~23 s generation,
ingest. `Image Media ID` = `user:2923-email:…-image:8c0f5914-…`, a GENERATED
id (not `-asset:`), the picture re-hosted at
`reczA9FG5FYtWsfFi/image/04f1fedad4c2e50cd61fe2eca2bddde4.jpg`, status
`Așteaptă Aprobare Imagine`. Portrait film (`Format: 9:16`), so `aspectRatio:
"9:16"` is exercised too. The takes and images were approved by SQL so the
video stage would run `Submit Video` with that generated id as `startImage`
— see the end of this file for what came back.

Four things differ from the design below, each on purpose:

- **`Save User Ref Id` is a Postgres jsonb merge**
  (`editing_options || '{"refImageMediaId": …}'`), not the HTTP PATCH of the
  whole Editing Options the design proposed. A read-modify-write of that JSON
  is the lost-update the site's own `updateEditingOptions` was rewritten to
  avoid; the merge cannot lose a concurrent write. `Build Image Request`
  reads the id from `IMG Load Project` and, on the pass that uploads it,
  from `Save User Ref Id`'s `returning` — `IMG Load Project` read the record
  before the id existed. Its credential (`HOV Postgres`) was passed on
  `addNode` and then re-set in place with `setNodeCredential` because the
  API redacts every binding and a control read on a working Postgres node
  answers the same `undefined`.
- **`IMG Error Router` treats a throttle as never a refusal** — `throttled`
  is tested first and `refusal` requires `!throttled`, so a captcha error
  whose text happens to contain "blocked" cannot enter the rewrite ladder
  and burn a rewrite on a prompt that was never judged.
- **The reference photo's own upload refusal goes to `Find Audio Folder`**,
  i.e. the pass continues without the reference (scene 1 then chains like
  any other), rather than into the rewrite ladder — the photo is not a
  prompt and cannot be rewritten. It retries on every pass because no id is
  stored; visible in the execution log, not on the site.
- **Claude Scripting's `IR Build Request` needs `refImageMediaId`, not the
  Drive URL**, and a project whose batch ran before this port has only the
  URL. It logs `IR: scene 1 has a reference photo but no refImageMediaId
  yet` and regenerates scene 1 without the reference; the next batch pass
  (Resume, a regen through the gate) uploads it and stores the id, after
  which the site's regen uses it. Kept simple on purpose: the case is one
  regen on scene 1 of an old project.

Also carried: `Upload Asset To Flow` and `Extract Asset Id` still exist,
moved to the user-ref chain; `Generate Scene Image` keeps its now-unused
FAL credential binding (redacted, harmless — `authentication` is gone from
its parameters); the useapi Bearer stays a literal header like every other
useapi node. `Regenerate Scene Image` keeps its 15s `batching` interval as
the gate regen's pacing. Retries are OFF on all three generate nodes.

The rest of this file is the design as written before the apply, kept
because it explains the shape.

## Why

Two reasons, and efficiency is the smaller one.

1. **The picture and the clip come from the same place, so one refusal
   instead of two.** Today an image is made on fal, downloaded, and uploaded
   to Flow (`Upload Asset To Flow`) so Veo can use it as a start frame — and
   Flow's upload filter (`PUBLIC_ERROR_MINOR_UPLOAD`, prominent-people) rejects
   pictures fal was happy to make. Every refusal caught at upload time was a
   fal image paid for and thrown away. Generated in Flow, the picture is born
   past that filter, with its `mediaGenerationId` already in hand.
2. **Three network hops become one.** `Generate → Decode → Download → Upload
   → Extract Asset Id → Write` becomes `Generate → Decode → Write`. The
   response carries the signed `fifeUrl` (which `/api/media/ingest` downloads
   and re-hosts, exactly as it does fal's URL today) **and** the
   `mediaGenerationId` that `Submit Video` needs as `startImage`.

What it costs: **nothing on this plan** — the producer confirmed on
2026-09-02 that Flow image generation on the Ultra account does not spend
Google AI credits (Veo lite low-priority is free the same way). Keep the
`402` handling anyway: the useapi API answers `402` when an account is out
of credits, and the chain below treats that as fatal, not retryable, so a
plan change fails loudly instead of looping.

## The API (from useapi's own examples — the docs host is blocked from here)

```
POST https://api.useapi.net/v1/google-flow/images        Authorization: Bearer user:…
{
  "email":       "fermafabiz@gmail.com",
  "model":       "nano-banana-2",       // nano-banana-2-lite (default) | nano-banana-2 | nano-banana-pro | imagen-4
  "prompt":      "…",
  "aspectRatio": "16:9",                // "9:16" for portrait; "auto" only with references
  "count":       1,                     // DEFAULT IS 4 — never omit this
  "reference_1": "<mediaGenerationId>", // optional, up to reference_10 on nano models; imagen-4 takes none
  "captchaRetry": 1                     // see "Not tripping the unusual-activity filter"
}
```

- **Synchronous.** `200` with `media[]`, each item
  `media[i].image.generatedImage.{fifeUrl, mediaGenerationId}` — the same
  shape `Extract Video URL` already reads for clips
  (`media[0].video.generatedVideo`). No job id, no polling.
- `429` / `503` → useapi's own scripts sleep 30s and resubmit. `402` → out of
  credits, stop. `4xx` with `captcha_quality: PUBLIC_ERROR_UNUSUAL_ACTIVITY…`
  → Google is throttling the ACCOUNT; retrying only spends captcha credits.
- A reference must be a Flow `mediaGenerationId`: either a generated image's
  own id (the n-1 chain needs no upload at all any more) or an upload via
  `POST /assets/{email}` with the raw bytes and an image `Content-Type`,
  answering `mediaGenerationId.mediaGenerationId` — which is what
  `Upload Asset To Flow` already does. That node survives for exactly one
  purpose: the producer's reference photo on scene 1.
- Timing (useapi's comparison script measures it per model): lite is the
  fastest, pro the slowest; expect ~10–20s a call for `nano-banana-2`.

Model: **`nano-banana-2`**. Lite is the default and faster, but the film's
whole look rides on these frames and Veo animates whatever detail is there;
`imagen-4` takes no references, which kills the n-1 chain and the user
photo. One string in `Build Image Request`, in one place.

## Not tripping the unusual-activity filter

What Google flags (from the useapi error docs and the Flow support threads):
bursts of requests in a short window, automation-shaped cadence, account
switching, VPN/proxy egress. What we control is cadence and retry behaviour:

- **One request in flight, always.** The image loop is already sequential.
  The video loop runs after it, never beside it. Two films in production at
  once double the load on the one account — worth knowing, not worth
  preventing in n8n.
- **Pace the submissions.** A new Wait, `Flow Pace` (8s), sits before every
  `Generate Scene Image`. With ~15s of generation that is ~25s a scene, ~30
  min for 71 scenes — about what fal + download + upload cost. Under 65s so
  the execution stays in memory and the static-data counters survive.
- **Back off, never hammer.** `Generate Scene Image` is `continueErrorOutput`
  with `retryOnFail` OFF (n8n's quick retries are exactly the burst we must
  not send). Its error output goes through `IMG Error Router`:
  - content refusal (`FILTER`, `SAFETY`, `PROMINENT`, `MINOR`, `content`) →
    `Prep Flow Reject`, the existing rewrite-in-place ladder, unchanged;
  - `402` → throw, the run dies with "out of Flow credits";
  - everything else (`429`, `503`, `captcha_quality:`, timeouts, `5xx`) →
    `IMG Cooldown Guard` → `Wait IMG Cooldown` (60s) → back to `Flow Pace`.
    The guard counts per scene in `sd.imgCooldowns` (reset by `Sort & Cap`),
    and for a `captcha_quality:` error it requires **five** cooldowns (5 min)
    before the next attempt instead of one — the throttle needs time, not
    attempts. Max 20 cooldowns per scene, then the run dies with the last
    reason, as `Submit Cooldown Guard` does for videos.
- **`captchaRetry: 1`.** useapi solves Flow's reCAPTCHA through a captcha
  provider and retries up to five times per request by default; on
  `UNUSUAL_ACTIVITY` those five are pure spend. One attempt, then our own
  cooldown. Set it on `Submit Video` / `Submit Video Regen` too while there.
- **The session refreshes daily at ~04:38 UTC** (`nextRefresh` on
  `GET /accounts`); a request landing in that minute fails and the cooldown
  covers it. `GET /accounts` with the same Bearer answers `health` — run it
  from a throwaway workflow before assuming a block has lifted.

## The nodes — Media Generation, batch path

Replace, in the image loop (`Loop Images` → `Needs Image?` → …):

```
Needs Image? → Build Image Request → Flow Pace → Generate Scene Image
  ok  → Decode Scene Image → Write Scene Image → Wait Between Images → Loop Images
  err → IMG Error Router
          refusal → Prep Flow Reject → IMG Give Up? → … (unchanged)
          other   → IMG Cooldown Guard → Wait IMG Cooldown → Flow Pace
```

Deleted from this path: `Download Scene Image`, `Extract Asset Id` (keep
`Upload Asset To Flow` for the user photo, see below). Connections to remove:
`Decode Scene Image → Download Scene Image`, `Download Scene Image → Upload
Asset To Flow`, `Upload Asset To Flow → Extract Asset Id`, `Upload Asset To
Flow(err) → Prep Flow Reject`, `Extract Asset Id → Write Scene Image`,
`Generate Scene Image(err) → Prep Flow Reject`.

### `Build Image Request` (Code) — replaces the fal body builder

```js
const f = $json.fields || {};
const prompt = f['Imagine First Frame'] || f['Prompt Vizual'] || '';
if (!prompt) throw new Error('Scene ' + $json.id + ' has no image prompt.');
const rb = $('Receive Batch Input').first().json;
const aspect = rb.Aspect_Ratio === '9:16' ? '9:16' : '16:9';

// The producer's reference photo, uploaded to Flow ONCE per film by
// 'Upload User Ref' at pass start and stored as Editing Options.refImageMediaId.
// It is GROUND TRUTH for scene 1 (the hook) and wins over the n-1 chain.
let userRefId = '';
try {
  const opts = JSON.parse((($('IMG Load Project').first().json.fields || {})['Editing Options']) || '{}') || {};
  userRefId = String(opts.refImageMediaId || '');
} catch (e) {}
const isFirstScene = Number(f['Ordine Scenă']) === 1;

// n-1 chain: the previous scene's generated image is the reference for
// this one, by its Flow media id — no download, no upload. Read from the
// previous run of Decode Scene Image (run data survives Wait suspensions).
let prevId = '', prevPrompt = '';
try {
  if ($runIndex > 0) {
    const prev = $('Decode Scene Image').all(0, $runIndex - 1);
    if (prev && prev[0] && prev[0].json && prev[0].json.mediaId) prevId = prev[0].json.mediaId;
    const prevReq = $('Build Image Request').all(0, $runIndex - 1);
    if (prevReq && prevReq[0] && prevReq[0].json) prevPrompt = prevReq[0].json.rawPrompt || '';
  }
} catch (e) { prevId = ''; }

// Similarity guard, unchanged: near-identical consecutive prompts keep the
// subject consistent by text alone, so drop the reference and let the
// composition vary (the Porsche films collapsed into one shot otherwise).
const wordSet = (s) => new Set(String(s || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(w => w.length > 3));
let promptSim = 0;
if (prevPrompt) {
  const A = wordSet(prompt), B = wordSet(prevPrompt);
  if (A.size && B.size) { let hit = 0; for (const w of A) if (B.has(w)) hit++; promptSim = hit / Math.max(A.size, B.size); }
}
if (promptSim > 0.55) prevId = '';
// An in-place retry after a refusal gets NO reference: the previous picture
// may hold exactly what was refused.
if (/AUTO-REWRITE/.test(String(f['Observații Scenă'] || ''))) prevId = '';

const body = { email: rb.Flow_Email || 'fermafabiz@gmail.com', model: 'nano-banana-2', prompt, aspectRatio: aspect, count: 1, captchaRetry: 1 };
let usedReference = null;
if (isFirstScene && userRefId) {
  body.prompt = 'The reference image is GROUND TRUTH for this film: recreate its subject faithfully — the same exact appearance, design details, materials, colors and overall look — while composing the shot described here: ' + prompt;
  body.reference_1 = userRefId; usedReference = userRefId;
} else if (prevId) {
  body.prompt = 'Use the reference image ONLY for character identity, wardrobe, color palette and film look — NOTHING else. The new shot must be a RADICALLY different composition: different camera angle, different distance, different part of the environment; the reference layout must NOT be recognizable in the result: ' + prompt;
  body.reference_1 = prevId; usedReference = prevId;
}
return [{ json: { sceneId: $json.id, requestBody: body, usedReference, userRefApplied: !!(isFirstScene && userRefId), rawPrompt: prompt, promptSimilarityToPrev: Number(promptSim.toFixed(2)) } }];
```

### `Flow Pace` (Wait, 8s) — new, between `Build Image Request` and `Generate Scene Image`.

### `Generate Scene Image` (HTTP Request) — retarget

`POST https://api.useapi.net/v1/google-flow/images`, headers `Authorization:
Bearer …` (the same literal `Submit Video` carries) and `Content-Type:
application/json`, body `={{ $('Build Image Request').first().json.requestBody }}`,
timeout 180000, `onError: continueErrorOutput`, **`retryOnFail: false`**.
(Reading the body from `Build Image Request` by name rather than `$json` is
what lets `Wait IMG Cooldown` feed this node with a cooldown item.)

### `Decode Scene Image` (Code)

```js
const resp = $json;
const gi = ((resp.media || [])[0] || {}).image && resp.media[0].image.generatedImage || {};
const url = gi.fifeUrl || '';
const mediaId = gi.mediaGenerationId || '';
if (!url || !mediaId) throw new Error('No image in Flow response. Head: ' + JSON.stringify(resp).slice(0, 400));
const sceneId = $('Build Image Request').first().json.sceneId;
return [{ json: { sceneId, url, mediaId } }];
```

### `Write Scene Image` (HTTP, ingest) — body

```
={{ JSON.stringify({ sceneId: $('Decode Scene Image').first().json.sceneId, field: "image",
  url: $('Decode Scene Image').first().json.url,
  fields: { "Image Media ID": $('Decode Scene Image').first().json.mediaId,
            "Aprobare Imagine": false, "Regenerează Imagine": false,
            "Status Producție Scenă": "Așteaptă Aprobare Imagine" } }) }}
```

`fifeUrl` is a signed Google URL and expires; the ingest downloads it on the
spot and re-hosts the bytes, which is the whole reason the ingest exists.

### `IMG Error Router` (Code, new) — on `Generate Scene Image`'s error output

```js
const j = $input.first().json || {};
const text = JSON.stringify(j).slice(0, 2000);
const status = Number((j.error && j.error.httpCode) || j.httpCode || j.statusCode || 0);
const refusal = /PROMINENT|MINOR|FILTER|SAFETY|content policy|content_policy|blocked/i.test(text);
if (status === 402 || /insufficient credits|402/.test(text)) throw new Error('Google Flow: out of credits — ' + text.slice(0, 300));
const throttled = /captcha_quality|UNUSUAL_ACTIVITY|TOO_MUCH_TRAFFIC/i.test(text);
return [{ json: Object.assign({}, j, { imgRefusal: refusal, imgThrottled: throttled, imgStatus: status }) }];
```

Then `IMG Refusal?` (If, `{{ $json.imgRefusal }}`): true → `Prep Flow Reject`
(its `service` detection defaults to Google Flow already; the `reason`
branches on `MINOR` / `FACE` — add `PROMINENT` → "a recognizable real
person"); false → `IMG Cooldown Guard`.

### `IMG Cooldown Guard` (Code, new)

```js
const sd = $getWorkflowStaticData('global');
sd.imgCooldowns = sd.imgCooldowns || {};
const sceneId = $('Build Image Request').first().json.sceneId;
const key = $execution.id + ':' + sceneId;
const n = (sd.imgCooldowns[key] || 0) + 1;
sd.imgCooldowns[key] = n;
const MAX = 20;
const j = $input.first().json || {};
const last = String((j.error && (j.error.message || j.error.description)) || j.message || JSON.stringify(j)).slice(0, 300);
if (n > MAX) throw new Error('Flow image generation kept failing after ' + MAX + ' cooldowns of 60s — last reason: ' + last);
// A throttle needs TIME, not attempts: hold five cooldowns (5 min) per try.
const holds = j.imgThrottled ? 5 : 1;
const retryNow = n % holds === 0;
console.log('Flow image ' + sceneId + ' failed (' + n + '/' + MAX + '), cooling down 60s' + (retryNow ? ', then retrying' : '') + ': ' + last);
return [{ json: { cooldown: n, retryNow, imgThrottled: !!j.imgThrottled, lastError: last } }];
```

`Wait IMG Cooldown` (Wait, 60s) → `IMG Retry Now?` (If, `{{ $json.retryNow }}`):
true → `Flow Pace`; false → `IMG Cooldown Guard` (another 60s). Add
`sd.imgCooldowns = {};` to the reset block in `Sort & Cap Scenes`.

### The producer's reference photo — once per pass, at the top

After `IMG Load Project`: `User Ref?` (If: Editing Options has `refImage`
and no `refImageMediaId`) → `Download User Ref` (HTTP, file, the Drive URL
via `/api/media`-style proxy or the direct `uc?export=download` link) →
`Upload Asset To Flow` (existing node, moved here) → `Extract Asset Id`
(existing, moved here) → `Save User Ref Id` (HTTP PATCH
`http://web:3000/api/at/tbl0zT7ilefOqE3xk/<project>` writing Editing Options
with `refImageMediaId` merged into the copy `IMG Load Project` just read —
the only writer of that JSON at that moment) → `Find Audio Folder`. False →
`Find Audio Folder`. Persisting the id means restarts and later passes never
upload the photo twice.

## The nodes — the gate's regen (`If Any Regen` branch)

`Regenerate Scene Image` → Flow body `{ email, model: 'nano-banana-2',
prompt: $json.prompt, aspectRatio, count: 1, captchaRetry: 1,
…($json.prevId ? { reference_1: $json.prevId } : {}) }`, sync,
`continueErrorOutput` → `Mark Image Regen Rejected` as today. `Decode Regen
Image` reads `fifeUrl` + `mediaGenerationId`; `Write Regen Image` takes both;
`Download Regen Image`, `Upload Regen Asset To Flow`, `Extract Regen Asset
Id` go. In `Evaluate Image Approval`, `prevUrl` (from the previous scene's
`Imagine Scenă` attachment) becomes `prevId` from its `Image Media ID` —
which every scene made by this port carries, and every older scene carries
from its upload.

## The third copy — Claude Scripting's site-triggered regen

`IR Build Request` / `IR Generate Image` / `IR Write Image` (webhook
`scene-image-regen`) is the same chain a third time and must move with it,
or a producer-triggered re-roll comes back from fal, gets uploaded to Flow,
and can be refused at upload — the exact failure this port removes. Same
body builder, same decode, `IR Write Image` keeps writing `Image Media ID`.

## What to verify on the first film

- `Image Media ID` on a new scene looks like `…-image:<uuid>` (a generated
  id), not `…-asset:` (an upload), and `Submit Video` accepts it as
  `startImage` — that is the whole efficiency claim.
- The ElevenLabs lesson applies here too: `GET /accounts` and the Flow UI's
  credit counter are the logs; check both after ten images.
- A deliberately refused prompt walks the rewrite ladder without a 30-second
  burst anywhere in n8n's execution timeline.
