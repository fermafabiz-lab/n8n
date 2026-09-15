// Read the judge's answer and decide: keep the clip, or spend one more
// generation on it.
//
// Shaped exactly like `Judge Verdict` one stage upstream, and for the same
// reason: bounded per scene per pass, and every way of not getting an answer
// (skipped, unreadable, the HTTP call failed) means KEEP. A judge that can
// take a film down by being unavailable is worse than no judge.
const prep = $('Motion Prep').first().json;
const sd = $getWorkflowStaticData('global');
sd.motionRerolls = sd.motionRerolls || {};
sd.motionNotes = sd.motionNotes || {};
const MAX_REROLLS = 1;

// What flows on is the ORIGINAL Extract Video URL item, untouched — this
// node sits in the middle of the download/upload chain and everything after
// it reads Video_Signed_URL / Video_Media_Id.
const keep = (why) => [{ json: Object.assign({}, prep.passthrough || {}, { motionVerdict: why, motionReroll: false }) }];

if (!prep.ok) return keep(prep.reason || 'not judged');

let v = null;
try {
  const text = (($json.choices || [])[0] || {}).message ? String((($json.choices || [])[0] || {}).message.content || '') : '';
  const m = text.match(/\{[\s\S]*\}/);
  v = m ? JSON.parse(m[0]) : null;
} catch (e) { v = null; }
if (!v) {
  console.log('MOTION ' + prep.ord + ': unreadable judge answer, keeping — ' + JSON.stringify($json).slice(0, 200));
  return keep('unreadable');
}

const num = (x) => (typeof x === 'number' && isFinite(x)) ? x : null;
const direction = num(v.direction);
const coherent = num(v.coherent);
const morph = v.morph === true;
const problems = Array.isArray(v.problems) ? v.problems.map(String).slice(0, 4) : [];

// The thresholds are low ON PURPOSE. A re-roll costs a whole Veo generation
// and a place in the queue, so this only fires when the judge is confident
// the shot contradicts its brief — not when it is merely unenthusiastic.
const bad = [];
if (direction !== null && direction < 0.5) bad.push('direction ' + direction);
if (coherent !== null && coherent < 0.45) bad.push('coherence ' + coherent);
if (morph) bad.push('morph');

const summary = 'direction=' + direction + ' coherent=' + coherent + ' morph=' + morph + (problems.length ? ' — ' + problems.join('; ') : '');
const n = sd.motionRerolls[prep.sceneId] || 0;
if (!bad.length) { console.log('MOTION ' + prep.ord + ': ok, ' + summary); return keep('ok'); }
if (n >= MAX_REROLLS) { console.log('MOTION ' + prep.ord + ': still wrong after ' + n + ' re-roll(s), keeping it (' + bad.join(', ') + '): ' + summary); return keep('wrong-accepted'); }

sd.motionRerolls[prep.sceneId] = n + 1;
sd.motionNotes[prep.sceneId] = (bad.join(', ') + (problems.length ? ': ' + problems.join('; ') : '')).slice(0, 400);
console.log('MOTION ' + prep.ord + ': re-roll ' + (n + 1) + '/' + MAX_REROLLS + ' (' + bad.join(', ') + '): ' + summary);
return [{ json: { sceneId: prep.sceneId, ord: prep.ord, motionReroll: true, morph: morph, attempt: n + 1, problems: bad, discardedMediaId: prep.mediaId } }];
