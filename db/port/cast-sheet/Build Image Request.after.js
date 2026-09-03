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

// ---------------------------------------------------------------------------
// THE CAST SHEET — identity that does not have to travel through the film.
//
// Before this, the only thing carrying a face from scene to scene was the n-1
// chain: the previous scene's picture, handed over as "use this ONLY for
// character identity". That works while a film has one person in it, and it
// was measured working — the same man survives 71 scenes of the Boyd film.
// It cannot work for a CAST. The reference is whoever was in the last frame,
// so on a two-hander every scene tells the model to take Bill's identity from
// a picture of Sam, and a character who appears every fifth scene has no
// anchor at all. Names never reach the image model either (the segmenter's
// output-hygiene rule strips them), so the prose cannot disambiguate.
//
// A sheet is one portrait per character, generated once per film by the Cast
// Sheet chain and stored on the project as `castRefs` {name: mediaGenerationId}.
// Flow takes up to ten references, and we were using one.
//
// Who is in THIS scene is answered by `Prompt Vizual` — the segmenter's own
// visual_scene_description, which DOES name people ("Sam stands at the desk")
// and is stored per scene and never sent to any model. Measured on the Boyd
// film: Bill named in 27 scenes, Sam in 26, Crowley in 3, out of 71.
let castRefs = {};
try {
  castRefs = JSON.parse((($('IMG Load Project').first().json.fields || {})['Editing Options']) || '{}').castRefs || {};
} catch (e) { castRefs = {}; }
try {
  if ($('Save Cast Refs').isExecuted) {
    const fresh = $('Save Cast Refs').first().json.cast_refs;
    if (fresh && typeof fresh === 'object') castRefs = fresh;
  }
} catch (e) {}

let bibleChars = [];
try {
  bibleChars = JSON.parse((($('IMG Load Project').first().json.fields || {})['Story Bible']) || '{}').characters || [];
} catch (e) { bibleChars = []; }
if (!Array.isArray(bibleChars)) bibleChars = [];

const norm = (s) => String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const sceneText = ' ' + norm(f['Prompt Vizual'] || '') + ' ';
// A shared surname is not an identifier: "Boyd" matches Sam, Bill and the
// company. Where the given name is unique it is enough, and it is what the
// description actually uses; where two characters share it, only the full
// name counts.
const givens = bibleChars.map((c) => norm(String((c || {}).name || '').split(/\s+/)[0] || ''));
const inScene = [];
for (const c of bibleChars) {
  const name = String((c || {}).name || '').trim();
  if (!name || !castRefs[name]) continue;
  const full = norm(name);
  const given = norm(name.split(/\s+/)[0] || '');
  const keys = givens.filter((g) => g && g === given).length > 1 ? [full] : [full, given];
  const hit = keys.some((k) => k.length > 2 && new RegExp('\\b' + esc(k) + '\\b').test(sceneText));
  if (hit) inScene.push({ name: name, id: castRefs[name] });
  // Two is the most a shot can be about. A third sheet crowds the references
  // and starts costing the composition.
  if (inScene.length >= 2) break;
}

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
// the content that was refused. Sheets go too — a face is the likeliest
// thing a people filter objected to.
const afterRefusal = /AUTO-REWRITE/.test(String(f['Observații Scenă'] || ''));
if (afterRefusal) prevId = '';

// count: 1 is mandatory — the API DEFAULTS TO FOUR images. captchaRetry: 1
// because useapi's five captcha retries per request are pure spend while
// Google throttles the account; our own cooldown loop handles that.
const body = { email: rb.Flow_Email || 'fermafabiz@gmail.com', model: MODEL, prompt: prompt, aspectRatio: aspect, count: 1, captchaRetry: 1 };
let usedReference = null;
let castUsed = [];
if (isFirstScene && userRefId) {
  body.prompt = 'The reference image is GROUND TRUTH for this film: recreate its subject faithfully — the same exact appearance, design details, materials, colors and overall look — while composing the shot described here: ' + prompt;
  body.reference_1 = userRefId;
  usedReference = userRefId;
} else if (!afterRefusal && inScene.length) {
  // Sheets first, the previous frame last: the order is what the sentence
  // below refers to, so it has to be built rather than assumed.
  const refs = inScene.map((p) => p.id);
  if (prevId && refs.length < 3) refs.push(prevId);
  const people = inScene.length === 1 ? 'reference image' : 'first ' + inScene.length + ' reference images';
  body.prompt =
    'The ' + people + ' define the EXACT appearance of the ' +
    (inScene.length === 1 ? 'person' : 'people') +
    ' in this shot — same face, same hair, same build, same wardrobe as shown. ' +
    (refs.length > inScene.length
      ? 'The LAST reference image is only for colour palette and film look, never for layout or for who anyone is. '
      : '') +
    'Compose the shot described here, which may place them at any distance, angle or part of the location: ' + prompt;
  refs.forEach((id, i) => { body['reference_' + (i + 1)] = id; });
  usedReference = refs[0];
  castUsed = inScene.map((p) => p.name);
} else if (prevId) {
  body.prompt = 'Use the reference image ONLY for character identity, wardrobe, color palette and film look — NOTHING else. The new shot must be a RADICALLY different composition: different camera angle, different distance, different part of the environment; the reference layout must NOT be recognizable in the result: ' + prompt;
  body.reference_1 = prevId;
  usedReference = prevId;
}
return [{ json: { sceneId: $json.id, requestBody: body, usedReference: usedReference, castUsed: castUsed, userRefApplied: !!(isFirstScene && userRefId), rawPrompt: prompt, promptSimilarityToPrev: Number(promptSim.toFixed(2)) } }];
