// Rebuilds, from the database alone, everything the in-loop regeneration
// holds in execution memory: the prompt, the aspect ratio, and the SAME
// reference set the batch attaches — cast sheets, object sheets, the set
// plate, the previous scene's picture last — so a picture re-rolled from the
// site is anchored exactly like its neighbours. One model string, in three
// places that must agree.
const MODEL = 'nano-banana-2';
const scene = $('IR Load Scene').first().json;
const f = scene.fields || {};
const project = ($('IR Load Project').first().json || {}).fields || {};
const all = ($('IR Load Siblings').first().json.records || [])
  .slice()
  .sort((a, b) => (Number((a.fields || {})['Ordine Scenă']) || 0) - (Number((b.fields || {})['Ordine Scenă']) || 0));

let prompt = f['Imagine First Frame'] || f['Prompt Vizual'] || '';
if (!prompt) throw new Error('Scene ' + scene.id + ' has no image prompt.');
// Reviewer feedback steers the re-roll instead of repeating it blindly.
const note = String(f['Observații Scenă'] || '').trim();
if (note && !/REJECTED|FAILED|AUTO-REWRITE/i.test(note)) {
  prompt += '\n\nADJUSTMENT REQUEST — the new image MUST follow this: ' + note;
}
const rejectedBefore = /REJECTED|AUTO-REWRITE/i.test(note);

let opts = {};
try { opts = JSON.parse(project['Editing Options'] || '{}') || {}; } catch (e) {}
let bible = {};
try { bible = JSON.parse(project['Story Bible'] || '{}') || {}; } catch (e) {}
const isFirstScene = Number(f['Ordine Scenă']) === 1;
const userRefId = isFirstScene ? String(opts.refImageMediaId || '') : '';
if (isFirstScene && !userRefId && String(opts.refImage || '').startsWith('http')) {
  console.log('IR: scene 1 has a reference photo but no refImageMediaId yet (the next batch pass uploads it) — regenerating without it.');
}
// Previous scene's image = palette reference, last, by media id; dropped when
// consecutive prompts are largely the same words (the text alone keeps them
// consistent and the reference would collapse the composition).
const idx = all.findIndex((r) => r.id === scene.id);
let prevId = '';
if (idx > 0 && !rejectedBefore) {
  const prev = all[idx - 1].fields || {};
  prevId = String(prev['Image Media ID'] || '');
  const wordSet = (s) => new Set(String(s || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((w) => w.length > 3));
  const A = wordSet(prompt), B = wordSet(prev['Imagine First Frame']);
  if (A.size && B.size) {
    let hit = 0;
    for (const w of A) if (B.has(w)) hit++;
    if (hit / Math.max(A.size, B.size) > 0.55) prevId = '';
  }
}
const aspect = project['Format'] === '9:16' ? '9:16' : '16:9';
