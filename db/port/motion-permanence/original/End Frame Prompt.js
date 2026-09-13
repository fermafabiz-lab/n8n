// The LAST frame of the shot, so direction stops being a matter of prose.
//
// Veo on the free tier gets a start frame and a sentence, and invents the
// rest. When the sentence says the car pulls out of the yard and the still
// shows it parked nose-in, the model has to choose how — and it chooses
// differently every time. That is how a car came to reverse INTO the yard on
// a film nobody asked that of.
//
// useapi supports I2V-FL on every Veo variant, ours included: startImage plus
// endImage, "video ends with this frame" (end-frame-ONLY is not supported,
// which is why this chain is useless without `Image Media ID`). Given both,
// direction stops being rhetoric and becomes geometry — a car that must END
// outside the gate cannot get there by driving in.
//
// The end frame is drawn by the same image model that drew the first one,
// with the START frame as its reference, so composition, wardrobe, light and
// style carry over and only what moves has moved. It is scaffolding, not a
// deliverable: nobody reviews it, it is never stored on the scene, and if it
// fails the scene falls back to exactly the single-frame behaviour it has
// today. Images are free on the Ultra plan, so this costs queue time only.
//
// NOTE the mode exclusivity on the VIDEO call, which is why this feature and
// Flow Characters cannot both be had: reference_* and character_* trigger R2V
// on Veo and "cannot be combined with startImage / endImage". The approved
// still is worth more than either, so start+end is the shape we take.
const cs = $('Current Scene').first().json;
const f = cs.fields || {};
const rb = $('Receive Batch Input').first().json;

// Two ways out:
//   endFrame: false in Editing Options — the producer's switch;
//   sd.endFrameOffAt — a timestamp stamped by `Submit Cooldown Guard` the
//     first time Flow rejects a submission carrying an end frame for a reason
//     that names one. Without it, a tier that turned out not to accept I2V-FL
//     would cost every scene of an eighty-scene film twenty cooldowns of 60s
//     and then kill the batch. One scene pays that, once.
//
// A TIMESTAMP rather than the boolean the other switches in this workflow
// use, and deliberately NOT reset by `Sort & Cap Scenes` where every other
// per-pass counter is. Static data is global and outlives the execution, so a
// plain boolean set once would disable end frames for every future film until
// somebody noticed — and the alternative, adding a reset line, means editing
// the node that owns scene ordering and the batch cap for a feature that has
// nothing to do with either. Six hours is long enough to cover the batch that
// found the problem and short enough that the next film tries again.
const OFF_FOR_MS = 6 * 60 * 60 * 1000;
const sd = $getWorkflowStaticData('global');
const offUntil = Number(sd.endFrameOffAt || 0) + OFF_FOR_MS;
const off = Date.now() < offUntil;
let opts = {};
try { opts = JSON.parse((($('IMG Load Project').first().json.fields || {})['Editing Options']) || '{}') || {}; } catch (e) { opts = {}; }
const wanted = opts.endFrame !== false && !off;

const startImage = f['Image Media ID'] || '';
const motion = String(f['Video Scenă URL'] || '').trim();
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
// 1 for the reason Build Image Request gives: useapi's five captcha retries
// are pure spend while Google is throttling.
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
