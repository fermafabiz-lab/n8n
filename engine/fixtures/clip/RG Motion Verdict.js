// Keep the regenerated clip, or spend one more generation on it. Mirrors
// `Motion Verdict`; every way of not getting an answer KEEPS the take,
// because a judge that can strand the producer's regeneration by being
// unavailable is worse than no judge.
//
// 2026-09-13 — `RG Motion Prep` now asks three more questions, so this node
// reads three more answers. A score nobody acts on is worse than no score:
// the café-stockroom clip failed on exactly these and on nothing the old
// three questions covered.
//
//   "permanence" — a held object vanishing, a prop popping out and back,
//     clothing changing, the subject duplicating.
//   "untouched" — a fridge door and a room door opening by themselves, taped
//     up paper flapping in a wind that cannot exist indoors.
//   "loop" — the eight seconds filled by doing the same thing twice, or by
//     walking out of frame and coming back to where it started.
//
// The two rules the old checks follow are kept for the new ones. A MISSING
// score is NOT a failure: `num()` leaves it null, the comparison is skipped
// and the clip is kept, so a judge answering in the old shape (or a model
// that drops a field) can never start re-rolling the producer's takes. And
// the thresholds stay low on purpose — a re-roll costs a whole Veo
// generation and a place in the queue, so this fires only when the judge is
// confident, not when it is unenthusiastic:
//   permanence < 0.5, as strict as direction — an object disappearing out of
//     a hand is unpostable, and it is what was reported;
//   untouched < 0.45, the looser of the two, because it is the check most
//     easily tripped by legitimate motion the judge cannot attribute (a door
//     the subject really did push, a curtain outdoors in real wind).
//   loop is a boolean like morph, but unlike morph it is NOT a reason to drop
//     the end frame — it is a new roll of the dice. It is carried in the
//     re-roll payload anyway so `RG Motion Resubmit` can decide otherwise
//     later without this node changing.
const prep = $('RG Motion Prep').first().json;
const sd = $getWorkflowStaticData('global');
sd.motionRerolls = sd.motionRerolls || {};
sd.motionNotes = sd.motionNotes || {};
const MAX_REROLLS = 1;

// The ORIGINAL Extract Regen Video URL item flows on — Download Regen Clip
// and everything after it read Video_Signed_URL / Video_Media_Id.
const keep = (why) => [{ json: Object.assign({}, prep.passthrough || {}, { motionVerdict: why, motionReroll: false }) }];

if (!prep.ok) return keep(prep.reason || 'not judged');

let v = null;
try {
  const text = (($json.choices || [])[0] || {}).message ? String((($json.choices || [])[0] || {}).message.content || '') : '';
  const m = text.match(/\{[\s\S]*\}/);
  v = m ? JSON.parse(m[0]) : null;
} catch (e) { v = null; }
if (!v) {
  console.log('RG MOTION ' + prep.sceneId + ': unreadable judge answer, keeping — ' + JSON.stringify($json).slice(0, 200));
  return keep('unreadable');
}

const num = (x) => (typeof x === 'number' && isFinite(x)) ? x : null;
const direction = num(v.direction);
const permanence = num(v.permanence);
const untouched = num(v.untouched);
const coherent = num(v.coherent);
const morph = v.morph === true;
const loop = v.loop === true;
const problems = Array.isArray(v.problems) ? v.problems.map(String).slice(0, 4) : [];

const bad = [];
if (direction !== null && direction < 0.5) bad.push('direction ' + direction);
if (permanence !== null && permanence < 0.5) bad.push('permanence ' + permanence);
if (untouched !== null && untouched < 0.45) bad.push('untouched ' + untouched);
if (coherent !== null && coherent < 0.45) bad.push('coherence ' + coherent);
if (morph) bad.push('morph');
if (loop) bad.push('loop');

const summary = 'direction=' + direction + ' permanence=' + permanence + ' untouched=' + untouched + ' coherent=' + coherent + ' morph=' + morph + ' loop=' + loop + (problems.length ? ' — ' + problems.join('; ') : '');
const n = sd.motionRerolls[prep.key] || 0;
if (!bad.length) { console.log('RG MOTION ' + prep.sceneId + ': ok, ' + summary); return keep('ok'); }
if (n >= MAX_REROLLS) { console.log('RG MOTION ' + prep.sceneId + ': still wrong after ' + n + ' re-roll(s), keeping it (' + bad.join(', ') + '): ' + summary); return keep('wrong-accepted'); }

sd.motionRerolls[prep.key] = n + 1;
sd.motionNotes[prep.key] = (bad.join(', ') + (problems.length ? ': ' + problems.join('; ') : '')).slice(0, 400);
console.log('RG MOTION ' + prep.sceneId + ': re-roll ' + (n + 1) + '/' + MAX_REROLLS + ' (' + bad.join(', ') + '): ' + summary);
return [{ json: { sceneId: prep.sceneId, key: prep.key, motionReroll: true, morph: morph, loop: loop, attempt: n + 1, problems: bad, discardedMediaId: prep.mediaId } }];