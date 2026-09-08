// Reference sheets, once per film — for the cast AND for the hero objects.
//
// Tiers, decided by how often a name appears across the film's scenes
// (Load Scene Cast): a LEAD gets a TURNAROUND sheet (front, both profiles,
// back — the back of a coat and the side of a face were never seen by the
// model before, so every shot from behind invented them); a RECURRING
// character (two or more scenes) gets the single portrait the cast sheet
// port shipped with; a one-scene extra gets no sheet — nothing to be
// consistent WITH, and a faceless extra is also what the people filter
// prefers. Hero objects (the bible's `objects`: a car, a machine, a ship)
// get a three-view product sheet, because on the race film the CAR was the
// character that drifted.
//
// The producer's own photo, when the film has one, is the base of the
// protagonist's sheet: the sheet is drawn FROM it, so the real face and
// outfit reach every scene instead of only the hook.
//
// Free on the Ultra plan, one Flow call per sheet, once per film: the ids
// are stored on the project, so a later pass generates nothing — except an
// upgrade, when a character that had a portrait now qualifies for a
// turnaround (films made before this existed).
const proj = $('IMG Load Project').first().json;
const f = proj.fields || {};
let opts = {};
try { opts = JSON.parse(f['Editing Options'] || '{}') || {}; } catch (e) { opts = {}; }
try { if ($('Save User Ref Id').isExecuted) { const m = $('Save User Ref Id').first().json.media_id; if (m) opts.refImageMediaId = String(m); } } catch (e) {}
const castRefs = (opts.castRefs && typeof opts.castRefs === 'object') ? opts.castRefs : {};
const castSheets = (opts.castSheets && typeof opts.castSheets === 'object') ? opts.castSheets : {};
const objectRefs = (opts.objectRefs && typeof opts.objectRefs === 'object') ? opts.objectRefs : {};
let bible = {};
try { bible = JSON.parse(f['Story Bible'] || '{}') || {}; } catch (e) { bible = {}; }
const chars = Array.isArray(bible.characters) ? bible.characters : [];
const objs = Array.isArray(bible.objects) ? bible.objects : [];
const rb = $('Receive Batch Input').first().json;
const aspect = rb.Aspect_Ratio === '9:16' ? '9:16' : '16:9';
const MODEL = 'nano-banana-2';

const norm = (s) => String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Appearances per name. Tags first (exact bible names chosen by the
// segmenter); a scene without tags is matched on Prompt Vizual by full
// name, or by the given name where it is unique among the cast.
let scenes = [];
try { scenes = $('Load Scene Cast').all().map((it) => it.json).filter((s) => s && s.id); } catch (e) { scenes = []; }
const givens = chars.map((c) => norm(String((c || {}).name || '').split(/\s+/)[0] || ''));
const count = (name, prefix, i) => {
  const full = norm(name), given = norm(name.split(/\s+/)[0] || '');
  const keys = givens.filter((g) => g && g === given).length > 1 || prefix !== 'char:' ? [full] : [full, given];
  let n = 0;
  for (const s of scenes) {
    const tags = (Array.isArray(s.tags) ? s.tags : []).map(String);
    const tagged = tags.filter((t) => t.startsWith(prefix));
    if (tagged.length) { if (tagged.some((t) => norm(t.slice(prefix.length)) === full)) n++; continue; }
    const text = ' ' + norm(s.visual_prompt || '') + ' ';
    if (keys.some((k) => k.length > 2 && new RegExp('\\b' + esc(k) + '\\b').test(text))) n++;
  }
  return n;
};
const total = scenes.length;
const leadMin = Math.max(3, Math.ceil(total * 0.1));
const protagonist = (() => {
  const byRole = chars.find((c) => /protagonist|lead|main|hero/i.test(String((c || {}).role || '')));
  return String(((byRole || chars[0]) || {}).name || '');
})();
const userRefId = String(opts.refImageMediaId || '');

const work = [];
const tiers = {};
chars.forEach((c, i) => {
  const name = String((c || {}).name || '').trim();
  const desc = String((c || {}).visual_description || '').trim();
  if (!name || !desc) return;
  const n = total ? count(name, 'char:', i) : 2; // no scene list at all: behave like the old port
  const kind = n >= leadMin || (norm(name) === norm(protagonist) && n >= 2) ? 'turnaround' : (n >= 2 ? 'portrait' : 'none');
  tiers[name] = { appearances: n, kind: kind };
  if (kind === 'none') return;
  const have = castRefs[name] ? String((castSheets[name] || {}).kind || 'portrait') : '';
  if (have === kind || (have === 'turnaround')) return; // already has this or better
  if (work.length >= 6) return;
  const isProt = norm(name) === norm(protagonist) && !!userRefId;
  const base = kind === 'turnaround'
    ? 'Character reference sheet of ONE person on a plain neutral grey studio backdrop: four full-body views standing side by side in one row — front view, left profile, back view, right profile — identical outfit, hair and build in all four, relaxed natural standing pose, even soft studio lighting, no text, no labels, no grid lines, no props, nothing else in frame: '
    : 'Character reference portrait of ONE person, centred, front three-quarter view, plain neutral studio backdrop, even soft lighting, no props, no text, no collage: ';
  const body = {
    email: rb.Flow_Email || 'fermafabiz@gmail.com',
    model: MODEL,
    prompt: (isProt ? 'The reference image is the producer\'s own photo of this person and is GROUND TRUTH: build the sheet FROM it — exactly that face, hair, body and outfit, in every view. ' : '') +
      base + desc + ' If the description offers alternatives for different eras or scenes, use the FIRST one only — one person, one outfit, one age. Photorealistic, natural skin texture, sharp focus.',
    aspectRatio: kind === 'turnaround' ? '16:9' : aspect,
    count: 1,
    captchaRetry: 1,
  };
  if (isProt) body.reference_1 = userRefId;
  work.push({ kind: 'cast', sheet: kind, name: name, requestBody: body });
});
objs.forEach((o) => {
  const name = String((o || {}).name || '').trim();
  const desc = String((o || {}).visual_description || '').trim();
  if (!name || !desc || objectRefs[name]) return;
  const n = total ? count(name, 'obj:') : 2;
  tiers[name] = { appearances: n, kind: n >= 2 ? 'object' : 'none' };
  if (n < 2 || work.filter((w) => w.kind === 'object').length >= 3) return;
  work.push({ kind: 'object', sheet: 'object', name: name, requestBody: {
    email: rb.Flow_Email || 'fermafabiz@gmail.com', model: MODEL,
    prompt: 'Product reference sheet of ONE object on a plain neutral grey studio backdrop: three views side by side in one row — front three-quarter view, side profile, rear three-quarter view — identical design, colours, markings, materials and proportions in all three, even soft studio lighting, no text, no labels, no people, nothing else in frame: ' + desc + ' Photorealistic, sharp focus.',
    aspectRatio: '16:9', count: 1, captchaRetry: 1,
  } });
});
console.log('SHEET PLAN (' + total + ' scenes, lead from ' + leadMin + '): ' + JSON.stringify(tiers) + ' -> making ' + work.map((w) => w.sheet + ':' + w.name).join(', ') || 'nothing');
// NEVER return zero items: everything downstream of this node is the rest of
// the batch, and an empty output would end the pass silently.
if (!work.length) return [{ json: { skip: true } }];
return work.map((w) => ({ json: w }));
