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
//
// 2026-09-13 — mirrored onto this node the two changes made to `Motion Prep`
// after the café-stockroom clip the producer rejected: a held object
// vanishing, the same reach performed twice, papers taped to a fridge
// flapping indoors, a fridge door opening by itself, the subject walking away
// and turning back. The old three-question judge would have scored that clip
// a clean pass, because nothing it asked about was wrong.
//
//   1. The question now also asks for "permanence", "untouched" and "loop",
//      and `RG Motion Verdict` reads all three. The wording is spliced from
//      the batch node word for word, as it always was — INCLUDING the two
//      carve-outs: a thing that leaves frame because the camera moved has not
//      vanished (every shot has a camera move, so an absolute question would
//      dock good pans), and outdoors wind, water, foliage, traffic and crowds
//      move untouched and that is correct (or the gate re-rolls street scenes
//      for being streets).
//   2. The brief handed to the judge is the ACTION ONLY. Scenes written
//      before today carry roughly 355 characters of "Negative: …"
//      prohibitions at the end of `Video Scenă URL`; asking "does the clip do
//      what the brief says" while calling that list the brief measured the
//      clip against things that were never meant to happen, and with the
//      `motion.slice(0, 700)` below it could crowd the real action out of the
//      question altogether. The strip is the one already live in
//      `Current Scene`, `End Frame Prompt` and `Submit Video Regen`.
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

// Strip the legacy tail, but NOT the producer's request — this is the one
// copy of the strip that cannot be a single split. `Evaluate Video Approval`
// builds motionPrompt as `Video Scenă URL` + ' ADJUSTMENT REQUEST — the new
// video MUST follow this: …', APPENDED, so on a scene written before today
// the producer's own words sit on the far side of the "Negative:" tail.
// Splitting the whole string there would throw away the one sentence this
// regeneration exists to satisfy. Cut the request off first, apply the
// canonical strip to the stored half, then put the request back.
const rawMotion = String(p.motionPrompt || '');
const adjAt = rawMotion.search(/\s*ADJUSTMENT REQUEST\b/i);
const storedMotion = adjAt >= 0 ? rawMotion.slice(0, adjAt) : rawMotion;
const adjustment = adjAt >= 0 ? rawMotion.slice(adjAt).trim() : '';
const motion = (String(storedMotion).split(/\s*Negative:\s*/i)[0].trim() + (adjustment ? ' ' + adjustment : '')).trim();

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
const system = 'You are a film editor checking whether a generated shot does what its brief said. You are shown a contact sheet: frames sampled at a fixed interval across a single 8-second clip, in time order, left to right and then top to bottom. The frames are samples, not the whole clip: a fault shorter than the gap between two of them is invisible here, so judge what you can actually see and do not infer what happened in between. Judge only what the brief claims and whether the world holds together. Do not judge taste, style, beauty, lighting or composition. Answer only the JSON object requested.';
const ask = [
  'The brief for this shot was:',
  '"' + motion.slice(0, 700) + '"',
  'Score each 0 to 1.',
  '"direction": does the movement across the frames match what the brief says, including which way things travel and whether they approach or leave? 1 = it does what the brief says; 0 = it does the opposite (the brief says out and the subject goes in, or the brief says left to right and it goes right to left). If the brief names no direction, answer 1.',
  '"permanence": does everything keep its identity and stay present from the first frame to the last? Lower it when something a character is holding disappears from their hands, when a prop or a piece of furniture vanishes and later comes back, when clothing changes between frames, or when a person or object duplicates. Judge only what the frames can actually show: a thing that leaves the frame because the CAMERA moved, or passes behind something else, has not vanished, and every shot here has a camera move. If you simply cannot follow an object, answer 1 rather than guess. 1 = nothing that should still be visible appears or disappears.',
  '"untouched": does everything that cannot move by itself hold still? Lower it when a door, a drawer, a lid or a window opens or closes with no hand on it, when paper, cloth, curtains or hanging signs move INDOORS where there is no wind, or when an object slides with nothing pushing it. This question is about interiors and about objects with no motive power of their own: outdoors, wind, weather, water, foliage, traffic, animals and crowds move on their own and that is correct, so answer 1 for an exterior unless a door, a lid, a drawer or a piece of furniture moves with nobody near it. 1 = nothing moved that had no cause.',
  '"coherent": does the sequence hold together physically? Lower it when solid things pass through each other, when something floats or sinks into the ground, or when a moving vehicle has no driver.',
  '"morph": true if the frames do not show real movement but a dissolve or warp between two different pictures — the subject changing shape, sliding without turning its wheels or legs, or the scene cross-fading. Otherwise false.',
  '"loop": true if the clip fills its eight seconds by repeating or doubling back — the subject performs the same action twice, or walks out of frame and returns to where it started, or the camera travels somewhere and comes back. Otherwise false.',
  'Answer ONLY JSON: {"direction": number, "permanence": number, "untouched": number, "coherent": number, "morph": boolean, "loop": boolean, "problems": ["short concrete reason", ...]}',
].join(' ');

console.log('RG MOTION ' + p.id + ': judging');
return [{ json: Object.assign({}, base, { ok: true, system: system, ask: ask, motion: motion }) }];
