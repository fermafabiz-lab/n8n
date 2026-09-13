// Keep the regenerated clip, or spend one more generation on it. Mirrors
// `Motion Verdict`; every way of not getting an answer KEEPS the take,
// because a judge that can strand the producer's regeneration by being
// unavailable is worse than no judge.
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
const coherent = num(v.coherent);
const morph = v.morph === true;
const problems = Array.isArray(v.problems) ? v.problems.map(String).slice(0, 4) : [];

const bad = [];
if (direction !== null && direction < 0.5) bad.push('direction ' + direction);
if (coherent !== null && coherent < 0.45) bad.push('coherence ' + coherent);
if (morph) bad.push('morph');

const summary = 'direction=' + direction + ' coherent=' + coherent + ' morph=' + morph + (problems.length ? ' — ' + problems.join('; ') : '');
const n = sd.motionRerolls[prep.key] || 0;
if (!bad.length) { console.log('RG MOTION ' + prep.sceneId + ': ok, ' + summary); return keep('ok'); }
if (n >= MAX_REROLLS) { console.log('RG MOTION ' + prep.sceneId + ': still wrong after ' + n + ' re-roll(s), keeping it (' + bad.join(', ') + '): ' + summary); return keep('wrong-accepted'); }

sd.motionRerolls[prep.key] = n + 1;
sd.motionNotes[prep.key] = (bad.join(', ') + (problems.length ? ': ' + problems.join('; ') : '')).slice(0, 400);
console.log('RG MOTION ' + prep.sceneId + ': re-roll ' + (n + 1) + '/' + MAX_REROLLS + ' (' + bad.join(', ') + '): ' + summary);
return [{ json: { sceneId: prep.sceneId, key: prep.key, motionReroll: true, morph: morph, attempt: n + 1, problems: bad, discardedMediaId: prep.mediaId } }];
