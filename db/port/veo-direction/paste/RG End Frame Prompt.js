// The end frame for the GATE's regeneration, mirroring `End Frame Prompt` on
// the batch path — see that node for why an end frame exists at all.
//
// Two things make this copy different rather than a duplicate.
//
// First, THE PAYLOAD HAS TO SURVIVE. `Submit Video Regen` reads `$json`, not
// a node reference (which is why both guards around it re-feed the payload),
// so every node between `Prep Video Regen` and the submit must pass the whole
// payload through untouched. Hence Object.assign rather than a fresh object.
//
// Second, and better: `motionPrompt` here may already carry the producer's
// own correction. `Evaluate Video Approval` appends "ADJUSTMENT REQUEST — the
// new video MUST follow this: <Observații Scenă>" when they typed one. So on
// exactly the failure that started this — "mașina iese din curte" — the note
// they wrote is what the end frame is drawn from. That is the strongest
// version of this feature there is: the after-picture is composed from the
// human's description of what went wrong.
const p = $json; // Prep Video Regen: {id, motionPrompt, imageId, voiceUrl, model, seed, takes}
const rb = $('Receive Batch Input').first().json;

const OFF_FOR_MS = 6 * 60 * 60 * 1000;
const sd = $getWorkflowStaticData('global');
const offUntil = Number(sd.endFrameOffAt || 0) + OFF_FOR_MS;
const off = Date.now() < offUntil;
let opts = {};
try { opts = JSON.parse((($('IMG Load Project').first().json.fields || {})['Editing Options']) || '{}') || {}; } catch (e) { opts = {}; }
const wanted = opts.endFrame !== false && !off;

const startImage = p.imageId || '';
const motion = String(p.motionPrompt || '').trim();

// The composition note is not in the regen payload — it only carries what the
// gate needed — so it is read off the scene row the gate already fetched,
// the same way `Prep Video Regen` reads `Versiuni Media`.
let look = '';
try {
  const row = $('Fetch Scene Videos').all().find((x) => x.json && x.json.id === p.id);
  const f = row ? (row.json.fields || {}) : {};
  look = String(f['Imagine First Frame'] || f['Prompt Vizual'] || '').trim();
} catch (e) { look = ''; }

if (!wanted || !startImage || !motion) {
  const why = !wanted ? (off ? 'end frames paused until ' + new Date(offUntil).toISOString() + ' after a Flow rejection' : 'endFrame: false') : (!startImage ? 'no start frame' : 'no motion prompt');
  console.log('RG ENDFRAME ' + p.id + ': skipped, ' + why);
  return [{ json: Object.assign({}, p, { efOk: false, efReason: why }) }];
}

const aspect = rb.Aspect_Ratio === '9:16' ? '9:16' : '16:9';

// Word for word the batch path's prompt. The two must keep agreeing: a
// regenerated clip whose end frame was composed under different rules from
// its neighbours' is a new inconsistency, which is the trap `Prep Video
// Regen` already warns about for the model choice.
const prompt = [
  'This is the FINAL FRAME of a single continuous shot: the same camera, the same subject and the same place as the reference image, a few seconds later, after the following motion has fully completed:',
  motion,
  'Draw the world exactly as the reference image shows it — same characters, same faces, same wardrobe, same vehicles and objects, same setting, same lighting and time of day, same lens and framing style. The ONLY things that may differ are where the moving subjects have got to and whatever the camera move has brought into or out of view. Do not restage the shot, do not change the angle for effect, do not add or remove anyone, and do not put any text on the image.',
  look ? ('The shot was originally composed as: ' + look) : '',
].filter(Boolean).join(' ');

const efRequest = {
  email: rb.Flow_Email || 'fermafabiz@gmail.com',
  model: 'nano-banana-2',
  prompt: prompt,
  aspectRatio: aspect,
  count: 1,
  captchaRetry: 1,
  reference_1: startImage,
};

console.log('RG ENDFRAME ' + p.id + ': drawing the after-frame from ' + startImage);
return [{ json: Object.assign({}, p, { efOk: true, efRequest: efRequest }) }];
