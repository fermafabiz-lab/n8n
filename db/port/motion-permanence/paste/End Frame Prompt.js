// The LAST frame of the shot, so direction stops being a matter of prose.
//
// useapi supports I2V-FL on every Veo variant, ours included: startImage plus
// endImage, "video ends with this frame" (end-frame-ONLY is not supported,
// which is why this chain is useless without `Image Media ID`). Given both,
// direction stops being rhetoric and becomes geometry.
//
// The end frame is drawn by the same image model that drew the first one,
// with the START frame as its reference, so composition, wardrobe, light and
// style carry over and only what moves has moved. It is scaffolding, not a
// deliverable: nobody reviews it, it is never stored on the scene, and if it
// fails the scene falls back to exactly the single-frame behaviour it has
// today. Images are free on the Ultra plan, so this costs queue time only.
//
// NOTE the mode exclusivity on the VIDEO call: reference_* and character_*
// trigger R2V on Veo and "cannot be combined with startImage / endImage".
const cs = $('Current Scene').first().json;
const f = cs.fields || {};
const rb = $('Receive Batch Input').first().json;

// Two ways out: endFrame:false in Editing Options, and sd.endFrameOffAt — a
// timestamp stamped by `Submit Cooldown Guard` the first time Flow rejects a
// submission carrying an end frame for a reason that names one. A TIMESTAMP
// rather than a boolean, and deliberately NOT reset by `Sort & Cap Scenes`:
// static data outlives the execution, so a flag set once would disable end
// frames for every future film until somebody noticed.
const OFF_FOR_MS = 6 * 60 * 60 * 1000;
const sd = $getWorkflowStaticData('global');
const offUntil = Number(sd.endFrameOffAt || 0) + OFF_FOR_MS;
const off = Date.now() < offUntil;
let opts = {};
try { opts = JSON.parse((($('IMG Load Project').first().json.fields || {})['Editing Options']) || '{}') || {}; } catch (e) { opts = {}; }
const wanted = opts.endFrame !== false && !off;

const startImage = f['Image Media ID'] || '';
// Strip the legacy "Negative:" tail before the image model sees it. Without
// this, nano-banana-2 is handed "no subtitles", "no lip movement" and
// "ambient/atmospheric motion only" as instructions for drawing a single
// still — and, worse, it is handed the tail of a chained action. Scene 3 of
// the café film ended "...and pivots back toward the swinging door", so the
// after-frame was drawn with the subject turned back toward the door, and the
// interpolator then had to LAND there: that is the producer's "walks away
// with it and turns back unnaturally", manufactured by our own end frame.
const motion = String(f['Video Scenă URL'] || '').split(/\s*Negative:\s*/i)[0].trim();
const look = String(f['Imagine First Frame'] || f['Prompt Vizual'] || '').trim();

// Both halves are required. Without the start frame there is nothing holding
// the composition steady, and without the motion there is no "after" to draw.
// Never return zero items — everything downstream is the rest of the batch.
if (!wanted || !startImage || !motion) {
  const why = !wanted ? (off ? 'end frames paused until ' + new Date(offUntil).toISOString() + ' after a Flow rejection' : 'endFrame: false') : (!startImage ? 'no start frame' : 'no motion prompt');
  console.log('ENDFRAME ' + (f['Ordine Scenă'] ?? '?') + ': skipped, ' + why);
  return [{ json: { ok: false, sceneId: cs.id, reason: why } }];
}

const aspect = rb.Aspect_Ratio === '9:16' ? '9:16' : '16:9';

// This asks for the END of the motion, not for a new shot. The wording leans
// hard on the reference for everything that must NOT change, because the
// failure mode of an end frame is not a wrong position — it is a
// different-looking scene, which would make Veo morph between two strangers
// instead of moving one.
const prompt = [
  'This is the FINAL FRAME of a single continuous shot: the same camera, the same subject and the same place as the reference image, a few seconds later, after the following motion has fully completed:',
  motion,
  'Draw the world exactly as the reference image shows it — same characters, same faces, same wardrobe, same vehicles and objects, same setting, same lighting and time of day, same lens and framing style. The ONLY things that may differ are where the moving subjects have got to and whatever the camera move has brought into or out of view. Do not restage the shot, do not change the angle for effect, do not add or remove anyone, and do not put any text on the image.',
  look ? ('The shot was originally composed as: ' + look) : '',
].filter(Boolean).join(' ');

// count: 1 is mandatory — this endpoint DEFAULTS TO FOUR images. captchaRetry
// 1 because useapi's five captcha retries are pure spend while Google
// throttles.
const body = {
  email: rb.Flow_Email || 'fermafabiz@gmail.com',
  model: 'nano-banana-2',
  prompt: prompt,
  aspectRatio: aspect,
  count: 1,
  captchaRetry: 1,
  reference_1: startImage,
};

console.log('ENDFRAME ' + (f['Ordine Scenă'] ?? '?') + ': drawing the after-frame from ' + startImage);
return [{ json: { ok: true, sceneId: cs.id, requestBody: body } }];
