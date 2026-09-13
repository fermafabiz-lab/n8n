// The motion judge for the GATE's regeneration, mirroring `Motion Prep` on
// the batch path — see that node for why a clip is judged at all.
//
// It matters MORE here, not less. A producer who rejected a clip because the
// car drove the wrong way clicks regenerate, waits a minute and a half, and
// is handed another one. Catching that before they see it is the whole point,
// and the brief this judges against is better too: `Evaluate Video Approval`
// appends their own "ADJUSTMENT REQUEST — the new video MUST follow this:
// …" to the motion prompt, so what the clip is measured against is what the
// human actually asked for.
const ev = $json; // Extract Regen Video URL: {Video_Signed_URL, Video_Media_Id}
const p = $('Prep Video Regen').first().json;
const sd = $getWorkflowStaticData('global');
sd.motionRerolls = sd.motionRerolls || {};

// Keyed 'regen:<id>' the way the cooldown counters already are, so a scene
// that used its batch re-roll still gets one here — these are different
// takes, judged against different briefs.
const key = 'regen:' + p.id;
const MAX_REROLLS = 1;
let opts = {};
try { opts = JSON.parse((($('IMG Load Project').first().json.fields || {})['Editing Options']) || '{}') || {}; } catch (e) { opts = {}; }

const motion = String(p.motionPrompt || '').trim();
const done = (sd.motionRerolls[key] || 0) >= MAX_REROLLS;
const skip = opts.motionJudge === false ? 'motionJudge: false'
  : (!ev.Video_Signed_URL ? 'no signed clip URL to inspect'
  : (!motion ? 'no motion prompt to judge against'
  : (done ? 'already re-rolled ' + MAX_REROLLS + ' time(s)' : '')));

const base = { sceneId: p.id, key: key, ord: p.id, videoUrl: ev.Video_Signed_URL || '', mediaId: ev.Video_Media_Id || '', passthrough: ev };
if (skip) {
  console.log('RG MOTION ' + p.id + ': not judged, ' + skip);
  return [{ json: Object.assign({}, base, { ok: false, reason: skip }) }];
}

// Word for word the batch path's question. The two must keep agreeing.
const system = 'You are a film editor checking whether a generated shot does what its brief said. You are shown a contact sheet: frames sampled about one second apart from a single 8-second clip, in time order, left to right and then top to bottom. Judge only what the brief claims. Do not judge taste, style, beauty, lighting or composition. Answer only the JSON object requested.';
const ask = [
  'The brief for this shot was:',
  '"' + motion.slice(0, 700) + '"',
  'Score 0 to 1.',
  '"direction": does the movement across the frames match what the brief says, including which way things travel and whether they approach or leave? 1 = it does what the brief says; 0 = it does the opposite (the brief says out and the subject goes in, or the brief says left to right and it goes right to left). If the brief names no direction, answer 1.',
  '"coherent": does the sequence hold together physically? Lower it when solid things pass through each other, a moving vehicle has no driver, or people or objects appear, vanish or duplicate between frames.',
  '"morph": true if the frames do not show real movement but a dissolve or warp between two different pictures — the subject changing shape, sliding without turning its wheels or legs, or the scene cross-fading. Otherwise false.',
  'Answer ONLY JSON: {"direction": number, "coherent": number, "morph": boolean, "problems": ["short concrete reason", ...]}',
].join(' ');

console.log('RG MOTION ' + p.id + ': judging');
return [{ json: Object.assign({}, base, { ok: true, system: system, ask: ask, motion: motion }) }];
