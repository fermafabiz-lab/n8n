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

// Strip the legacy "Negative:" tail before the judge sees it, the same way
// `Current Scene`, `Submit Video Regen` and `End Frame Prompt` now do. The
// stored prompt on every scene written before 2026-09-13 ends in ~355
// characters of prohibitions, and this node hands the whole thing to the
// vision model as THE BRIEF — so the judge was being asked whether the clip
// matches a list of things that must not happen. It scored the shot against
// "no oncoming vehicles" and "no reversed motion" as if those were the
// director's intent. New scenes store the action only and this line is a
// no-op for them; it exists for the 368 rows that do not.
const motion = String(f['Video Scenă URL'] || '').split(/\s*Negative:\s*/i)[0].trim();
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
// terms. SIX things are checked and they fail differently — the first three
// were here from the start, the last three were added on 2026-09-13 after a
// café clip failed in three ways this judge could not see:
//
//   direction — the originally reported bug. The scene said the car leaves
//     the yard and the clip had it reversing in. Note the wording asks only
//     about what the SENTENCE claims, not about whether the shot is good: a
//     judge given licence to have taste will re-roll half the film.
//   morph — the risk the end frame introduced. Given two frames Google
//     routes this tier to veo_3_1_interpolation_lite_low_priority, and an
//     interpolator handed two frames that differ too much dissolves between
//     them instead of moving anything. That failure is invisible to a
//     direction question: the car does end up outside the gate, by fading
//     there. It is also the one failure whose fix is NOT another roll of the
//     dice — see `Motion Resubmit`.
//   coherent — the catch-all the producer described as "lucruri fără
//     logică": things sliding through each other, a vehicle with no driver.
//     NARROWED when permanence arrived: things appearing and disappearing
//     used to be listed here too, and asking two questions about the same
//     failure only splits the signal.
//
//   permanence — "personajul ia ceva in mana apoi dispare". A held object
//     leaving the hands, a prep table vanishing and coming back in a
//     different place, an apron changing cut between frames, a subject
//     duplicating. A presence question, which a contact sheet reads more
//     reliably than anything else here.
//   untouched — "usa la frigider se deschide singura", "bate vantul peste
//     acele foi lipite". A door or drawer moving with no hand on it, paper
//     or cloth stirring indoors where there is no wind. This is the score
//     most exposed to false positives, because plenty of real motion has a
//     cause outside the frame — hence the lowest threshold in `Motion
//     Verdict`.
//   loop — "pleaca cu el apoi se intoarce nenatural". The signature of a
//     brief with more actions in it than fit in eight seconds: the model
//     performs the first one twice, or walks out and comes back, to fill the
//     time. Rule 6 now forbids writing such a brief, but the 368 scenes
//     already in Postgres still carry them.
//
// BOTH NEW QUESTIONS CARRY AN EXPLICIT CARVE-OUT, for the same reason
// `direction` has one ("if the brief names no direction, answer 1"). Rule 6
// MANDATES a named camera move on every shot, so things entering and leaving
// frame is the design rather than an edge case, and an absolute permanence
// question would dock well-made pans. And `untouched` is a rule about
// INTERIORS: outdoors, wind, water, foliage, traffic and crowds move with
// nobody touching them and that is correct. A question with no carve-out
// would re-roll street scenes for being streets.
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

console.log('MOTION ' + (f['Ordine Scenă'] ?? '?') + ': judging');
return [{ json: Object.assign({}, base, { ok: true, system: system, ask: ask, motion: motion }) }];