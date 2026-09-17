// Builds paste/ from original/ — every edit is an insertion or a single
// replacement made here, so the diff is exactly what this file says.
// Re-running is idempotent (it always starts from original/).
//
//   node db/port/regen-unstick/build-paste.mjs
import fs from 'node:fs';
import path from 'node:path';

const dir = path.dirname(new URL(import.meta.url).pathname);
const orig = (f) => fs.readFileSync(path.join(dir, 'original', f), 'utf8');
const out = (f, s) => fs.writeFileSync(path.join(dir, 'paste', f), s);

function replaceOnce(src, from, to, label) {
  const n = src.split(from).length - 1;
  if (n !== 1) throw new Error(`${label}: expected exactly one occurrence of ${JSON.stringify(from.slice(0, 70))}, found ${n}`);
  return src.replace(from, to);
}

// The marker the throw carries and the router matches on. One owner: it is
// written in Decode Scene Image, read in IMG Error Router and named in
// Prep Flow Reject's reason, and a rename that misses one of the three puts
// a silent refusal back on the cooldown branch, where the identical prompt
// is retried twenty times and then kills the film.
const MARKER = 'FLOW_NO_IMAGE';

// ---------------------------------------------------------------------------
// Decode Scene Image — the node that killed four batches today.
//
// Flow answers a refused image with HTTP 200 and a generatedImage record that
// carries the prompt and the seed but NO fifeUrl and NO mediaGenerationId.
// The HTTP node sees success, so `Generate Scene Image`'s error output — the
// whole refusal ladder — is never taken, and this node's throw was uncaught:
// it killed the entire Media Generation execution, image gate, video gate and
// all. Now it routes into the same ladder as a loud refusal.
// ---------------------------------------------------------------------------
{
  let s = orig('mg-Decode_Scene_Image.js');
  s = replaceOnce(s,
    "if (!url || !mediaId) throw new Error('No image in Flow response. Head: ' + JSON.stringify(resp).slice(0, 400));",
    `// A SILENT REFUSAL, and the reason this node has an error output (2026-09-17).
//
// Flow refuses a prompt in two different ways. The loud one is an HTTP error,
// which 'Generate Scene Image' routes down its error output into IMG Error
// Router -> the rewrite ladder. The quiet one is an HTTP 200 whose
// generatedImage carries the prompt and the seed and nothing else: the job
// ran, the filter ate the picture, and the response says so only by the
// absence of a URL. The HTTP node calls that success, so the ladder never
// saw it and this throw was uncaught — it killed the WHOLE execution, taking
// the image gate and the video gate of every other scene with it. Measured
// 2026-09-17: executions 14202, 14208 and two more died here on one scene's
// character-sheet reference, and the two clips the producer had asked to
// regenerate were never reached, so their Regenerează Video flag could never
// be cleared by anyone. That is what "regenerate does nothing, forever" was.
//
// Still a throw, because it IS a failure — but the node now carries
// onError: continueErrorOutput and its second output goes to IMG Error
// Router, so a silent refusal walks the same rewrite ladder as a loud one.
// The marker is what makes the classification deterministic: without it the
// router would fall through to its "everything else" branch and retry the
// byte-identical prompt twenty times, which is the one thing that cannot
// work — the filter's verdict does not change on a re-ask.
if (!url || !mediaId) throw new Error('${MARKER} — Google Flow completed the job and returned no image, which is how its content filter refuses quietly. Head: ' + JSON.stringify(resp).slice(0, 400));`,
    'Decode Scene Image: silent refusal');
  out('mg-Decode_Scene_Image.js', s);
}

// ---------------------------------------------------------------------------
// IMG Error Router — classify the marker, deterministically and first.
// ---------------------------------------------------------------------------
{
  let s = orig('mg-IMG_Error_Router.js');
  s = replaceOnce(s,
    "const throttled = /captcha_quality|UNUSUAL_ACTIVITY|TOO_MUCH_TRAFFIC/i.test(text);\nconst refusal = !throttled && /PROMINENT|MINOR|FILTER|SAFETY|content policy|content_policy|blocked/i.test(text);",
    `// Decode Scene Image's silent refusal (2026-09-17): a completed Flow job
// that returned no image at all. It is a content refusal with none of the
// words below in it, so it is matched FIRST and by an exact marker rather
// than left to the prose regexes — and it must never be read as a throttle,
// because time does not change a filter's verdict and the cooldown branch
// would re-ask the identical prompt twenty times before killing the film.
const noImage = text.includes('${MARKER}');
const throttled = !noImage && /captcha_quality|UNUSUAL_ACTIVITY|TOO_MUCH_TRAFFIC/i.test(text);
const refusal = noImage || (!throttled && /PROMINENT|MINOR|FILTER|SAFETY|content policy|content_policy|blocked/i.test(text));`,
    'IMG Error Router: marker');
  s = replaceOnce(s,
    "return [{ json: Object.assign({}, j, { imgRefusal: refusal, imgThrottled: throttled, imgStatus: status }) }];",
    "return [{ json: Object.assign({}, j, { imgRefusal: refusal, imgThrottled: throttled, imgNoImage: noImage, imgStatus: status }) }];",
    'IMG Error Router: emit noImage');
  out('mg-IMG_Error_Router.js', s);
}

// ---------------------------------------------------------------------------
// Prep Flow Reject — tell the rewriter what actually happened.
//
// The reason string is pasted into Rewrite Prompt AI's user message, so a
// wrong one sends the rewrite in the wrong direction. A silent refusal names
// no cause at all, and saying so is more useful than guessing "content
// policy": the rewriter is told the filter gave no reason, which is exactly
// when its escalation ladder (attempt >= 2, >= 3) is the right tool.
// ---------------------------------------------------------------------------
{
  let s = orig('mg-Prep_Flow_Reject.js');
  s = replaceOnce(s,
    "if (errText.includes('MINOR')) reason = 'the image appears to contain a child (Flow refuses images with minors)';",
    `if (errText.includes('${MARKER}')) reason = service + ' ran the job and returned no image at all — its silent refusal, which names no cause. Assume the strictest reading: something in the prompt or its reference sheets reads as a real person, a minor, or unsafe content';
else if (errText.includes('MINOR')) reason = 'the image appears to contain a child (Flow refuses images with minors)';`,
    'Prep Flow Reject: reason');
  out('mg-Prep_Flow_Reject.js', s);
}

// ---------------------------------------------------------------------------
// Decode Regen Image — the same hole on the image-regeneration path.
//
// Left as a throw with an error output rather than rewritten to skip the bad
// item: this node maps N responses to N writes and its pairing is what
// Write Regen Image and Mark Image Regen Rejected both key off. Routing the
// throw to the rejection writer (where its HTTP sibling's failures already
// go) cannot be worse than today, where the same throw kills the film.
// ---------------------------------------------------------------------------
{
  let s = orig('mg-Decode_Regen_Image.js');
  s = replaceOnce(s,
    "  if (!gi.fifeUrl || !gi.mediaGenerationId) throw new Error('No image on regen (Google Flow) for scene ' + inputs[i].json.id + '. Payload head: ' + JSON.stringify(r.json).slice(0, 300));",
    `  // Same silent refusal as Decode Scene Image (2026-09-17): a completed job
  // with no image in it. Unguarded, this throw killed the whole execution —
  // including the video gate, which is the only thing that can clear another
  // scene's Regenerează Video. The node now carries onError:
  // continueErrorOutput into Mark Image Regen Rejected, the same place this
  // branch's HTTP failures already go, so the film survives one refused
  // regeneration and the scene is handed back to the producer with a reason.
  if (!gi.fifeUrl || !gi.mediaGenerationId) throw new Error('${MARKER} — Google Flow returned no image on regen for scene ' + inputs[i].json.id + '. Payload head: ' + JSON.stringify(r.json).slice(0, 300));`,
    'Decode Regen Image: silent refusal');
  out('mg-Decode_Regen_Image.js', s);
}

console.log('paste/ rebuilt from original/');
