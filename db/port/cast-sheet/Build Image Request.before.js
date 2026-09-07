const f = $json.fields || {};
const prompt = f['Imagine First Frame'] || f['Prompt Vizual'] || '';
if (!prompt) throw new Error('Scene ' + $json.id + ' has no image prompt.');
const rb = $('Receive Batch Input').first().json;
const aspect = rb.Aspect_Ratio === '9:16' ? '9:16' : '16:9';

// Images are generated ON Google Flow (useapi POST /google-flow/images):
// the response carries the signed fifeUrl the ingest re-hosts AND the
// mediaGenerationId Submit Video needs as startImage, so the picture is
// born past Flow's upload filter with its id already in hand. No fal, no
// download, no upload. One model string, here and in the gate's regen and
// Claude Scripting's IR Build Request — the three must agree.
const MODEL = 'nano-banana-2';

// The producer's reference photo, uploaded to Flow ONCE per film by the
// user-ref chain at pass start (Download User Ref -> Upload Asset To Flow ->
// Extract Asset Id -> Save User Ref Id) and stored as Editing Options
// .refImageMediaId. GROUND TRUTH for scene 1 (the hook): wins over the n-1
// chain and skips the similarity guard. IMG Load Project read the record
// BEFORE the id was saved on the pass that uploads it, so the fresh id is
// taken from Save User Ref Id when that node ran.
let userRefId = '';
try {
  const opts = JSON.parse((($('IMG Load Project').first().json.fields || {})['Editing Options']) || '{}') || {};
  userRefId = String(opts.refImageMediaId || '');
} catch (e) {}
if (!userRefId) {
  try { if ($('Save User Ref Id').isExecuted) userRefId = String($('Save User Ref Id').first().json.media_id || ''); } catch (e) {}
}
const isFirstScene = Number(f['Ordine Scenă']) === 1;

// n-1 chain: the previous scene's generated image is the reference for
// this one, BY ITS FLOW MEDIA ID — no download, no upload. Read from the
// previous run of Decode Scene Image (run data survives Wait suspensions,
// unlike static data in test executions — proven in execution 661).
let prevId = '';
let prevPrompt = '';
try {
  if ($runIndex > 0) {
    const prev = $('Decode Scene Image').all(0, $runIndex - 1);
    if (prev && prev[0] && prev[0].json && prev[0].json.mediaId) prevId = prev[0].json.mediaId;
    const prevReq = $('Build Image Request').all(0, $runIndex - 1);
    if (prevReq && prevReq[0] && prevReq[0].json) prevPrompt = prevReq[0].json.rawPrompt || '';
  }
} catch (e) { prevId = ''; }

// Reference guard, unchanged: chaining exists for CHARACTER/wardrobe
// consistency. When consecutive prompts are largely the same words, text
// alone keeps the subject consistent — drop the reference so the composition
// can vary (the Porsche films collapsed into one repeated shot otherwise).
const wordSet = (s) => new Set(String(s || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(w => w.length > 3));
let promptSim = 0;
if (prevPrompt) {
  const A = wordSet(prompt), B = wordSet(prevPrompt);
  if (A.size && B.size) {
    let hit = 0;
    for (const w of A) if (B.has(w)) hit++;
    promptSim = hit / Math.max(A.size, B.size);
  }
}
if (promptSim > 0.55) prevId = '';
// An in-place retry after a content refusal (the AUTO-REWRITE note is
// written by Apply Rewritten Prompt just before the scene re-enters the
// loop) gets NO reference image: the previous picture may carry exactly
// the content that was refused.
if (/AUTO-REWRITE/.test(String(f['Observații Scenă'] || ''))) prevId = '';

// count: 1 is mandatory — the API DEFAULTS TO FOUR images. captchaRetry: 1
// because useapi's five captcha retries per request are pure spend while
// Google throttles the account; our own cooldown loop handles that.
const body = { email: rb.Flow_Email || 'fermafabiz@gmail.com', model: MODEL, prompt: prompt, aspectRatio: aspect, count: 1, captchaRetry: 1 };
let usedReference = null;
if (isFirstScene && userRefId) {
  body.prompt = 'The reference image is GROUND TRUTH for this film: recreate its subject faithfully — the same exact appearance, design details, materials, colors and overall look — while composing the shot described here: ' + prompt;
  body.reference_1 = userRefId;
  usedReference = userRefId;
} else if (prevId) {
  body.prompt = 'Use the reference image ONLY for character identity, wardrobe, color palette and film look — NOTHING else. The new shot must be a RADICALLY different composition: different camera angle, different distance, different part of the environment; the reference layout must NOT be recognizable in the result: ' + prompt;
  body.reference_1 = prevId;
  usedReference = prevId;
}
return [{ json: { sceneId: $json.id, requestBody: body, usedReference: usedReference, userRefApplied: !!(isFirstScene && userRefId), rawPrompt: prompt, promptSimilarityToPrev: Number(promptSim.toFixed(2)) } }];
