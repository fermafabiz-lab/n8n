// Read the judge's answer and decide: accept the frame, or send the scene
// back for ONE more attempt with the references in charge. Bounded per scene
// per pass (`sd.consistencyRerolls`, reset by Sort & Cap): a frame that
// still drifts after MAX_REROLLS ships with its scores in the log — the
// producer's image gate is the backstop, exactly as it is for refusals.
const dec = $('Decode Scene Image').first().json; // {sceneId, url, mediaId}
const prep = $('Judge Prep').first().json;
const sd = $getWorkflowStaticData('global');
sd.consistencyRerolls = sd.consistencyRerolls || {};
sd.consistencyNotes = sd.consistencyNotes || {};
const MAX_REROLLS = 2;
const pass = (why) => [{ json: { sceneId: dec.sceneId, url: dec.url, mediaId: dec.mediaId, reroll: false, judged: why !== 'skipped', verdict: why } }];
if (prep.skip) return pass('skipped');
let v = null;
try {
  const j = $json;
  const text = j && j.choices && j.choices[0] && j.choices[0].message ? String(j.choices[0].message.content || '') : '';
  const m = text.match(/\{[\s\S]*\}/);
  v = m ? JSON.parse(m[0]) : null;
} catch (e) { v = null; }
if (!v) { console.log('JUDGE unreadable for ' + dec.sceneId + ': ' + JSON.stringify($json).slice(0, 200)); return pass('unreadable'); }
const num = (x) => (typeof x === 'number' && isFinite(x)) ? x : null;
const identity = num(v.identity), wardrobe = num(v.wardrobe), place = num(v.place);
const problems = Array.isArray(v.problems) ? v.problems.map(String).slice(0, 4) : [];
const bad = [];
if (identity !== null && identity < 0.6) bad.push('identity ' + identity);
if (wardrobe !== null && wardrobe < 0.6) bad.push('wardrobe ' + wardrobe);
if (place !== null && place < 0.55) bad.push('place ' + place);
if (v.sheet_leak === true) bad.push('the reference sheet leaked into the frame');
const n = sd.consistencyRerolls[dec.sceneId] || 0;
const summary = 'identity=' + identity + ' wardrobe=' + wardrobe + ' place=' + place + (problems.length ? ' — ' + problems.join('; ') : '');
if (!bad.length) { console.log('JUDGE ok ' + dec.sceneId + ': ' + summary); return pass('ok'); }
if (n >= MAX_REROLLS) { console.log('JUDGE accepting ' + dec.sceneId + ' after ' + n + ' re-rolls with drift (' + bad.join(', ') + '): ' + summary); return pass('drift-accepted'); }
sd.consistencyRerolls[dec.sceneId] = n + 1;
sd.consistencyNotes[dec.sceneId] = (bad.join(', ') + (problems.length ? ': ' + problems.join('; ') : '')).slice(0, 400);
console.log('JUDGE re-roll ' + (n + 1) + '/' + MAX_REROLLS + ' for ' + dec.sceneId + ' (' + bad.join(', ') + '): ' + summary);
return [{ json: { sceneId: dec.sceneId, reroll: true, attempt: n + 1, problems: bad, discardedMediaId: dec.mediaId } }];
