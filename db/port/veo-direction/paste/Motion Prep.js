// Decide whether this clip's MOTION is worth measuring, and write the
// question if it is.
//
// The pipeline's hardest-won rule, already written into `Judge Prep` one
// stage upstream: an instruction in a prompt is not a constraint. Every
// change in this feature — the direction clause, the end frame — asks Veo
// more nicely. Nothing yet LOOKS at what came back. So the clip gets the
// same treatment the still already gets: a contact sheet, a vision model,
// and a score rather than a hope.
//
// This is the node that says no. Judging every clip of an eighty-scene film
// costs a Railway download plus a gpt-4o call each, and a re-roll costs a
// whole Veo generation, so the gates are deliberate:
//   - motionJudge: false in Editing Options turns it off entirely;
//   - a scene already re-rolled MAX_REROLLS times is not judged again —
//     there is nothing left to do with the answer;
//   - a clip with no signed URL cannot be inspected (Extract Video URL
//     sometimes recovers only a media id);
//   - a scene with no motion prompt has no claim to check the clip against.
// Never return zero items: the rest of the batch is downstream.
const ev = $json; // Extract Video URL: {Video_Signed_URL, Video_Media_Id}
const cs = $('Current Scene').first().json;
const f = cs.fields || {};
const sd = $getWorkflowStaticData('global');
sd.motionRerolls = sd.motionRerolls || {};

const MAX_REROLLS = 1;
let opts = {};
try { opts = JSON.parse((($('IMG Load Project').first().json.fields || {})['Editing Options']) || '{}') || {}; } catch (e) { opts = {}; }

const motion = String(f['Video Scenă URL'] || '').trim();
const done = (sd.motionRerolls[cs.id] || 0) >= MAX_REROLLS;
const skip = opts.motionJudge === false ? 'motionJudge: false'
  : (!ev.Video_Signed_URL ? 'no signed clip URL to inspect'
  : (!motion ? 'no motion prompt to judge against'
  : (done ? 'already re-rolled ' + MAX_REROLLS + ' time(s)' : '')));

const base = { sceneId: cs.id, ord: f['Ordine Scenă'], videoUrl: ev.Video_Signed_URL || '', mediaId: ev.Video_Media_Id || '', passthrough: ev };
if (skip) {
  console.log('MOTION ' + (f['Ordine Scenă'] ?? '?') + ': not judged, ' + skip);
  return [{ json: Object.assign({}, base, { ok: false, reason: skip }) }];
}

// The sheet is frames in time order, so the question is asked in those
// terms. Three things are checked and they fail differently:
//
//   direction — the reported bug. The scene said the car leaves the yard and
//     the clip had it reversing in. Note the wording asks only about what
//     the SENTENCE claims, not about whether the shot is good: a judge given
//     licence to have taste will re-roll half the film.
//   morph — the risk the end frame introduced. Given two frames Google
//     routes this tier to veo_3_1_interpolation_lite_low_priority, and an
//     interpolator handed two frames that differ too much dissolves between
//     them instead of moving anything. That failure is invisible to a
//     direction question: the car does end up outside the gate, by fading
//     there. It is also the one failure whose fix is NOT another roll of the
//     dice — see `Motion Resubmit`.
//   coherent — the catch-all the producer described as "lucruri fără
//     logică": things sliding through each other, a vehicle with no driver,
//     people or objects popping in and out between frames.
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

console.log('MOTION ' + (f['Ordine Scenă'] ?? '?') + ': judging');
return [{ json: Object.assign({}, base, { ok: true, system: system, ask: ask, motion: motion }) }];
