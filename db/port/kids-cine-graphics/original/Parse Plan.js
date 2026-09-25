// Check every graphic the model proposed against the film it is for, and
// keep only what survives. The model is asked for a quote per graphic; the
// quote is what makes a tag checkable — it must be words that scene actually
// says, so a name the narration never mentions, or a figure it never states,
// cannot reach the screen. Nothing here trusts the model's own counting
// either: the budgets are applied again.
//
// A failed or empty answer writes NOTHING: the film then renders with no
// graphics (classic), which is the safe side of wrong. Unless the producer
// picked a style — then the pick is saved with no items, so Final touches
// still shows it.
const asked = $('Build Plan Prompt').first().json;
const STYLES = ['classic', 'reportage', 'editorial', 'cinematic', 'handwritten'];
const TRANSITIONS = ['none', 'push', 'crossfade', 'blur', 'shutter', 'glitch'];

let answer = null;
try {
  const raw = String((($json.choices || [])[0] || {}).message?.content || '');
  answer = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, ''));
} catch (e) { answer = null; }
if (!answer || typeof answer !== 'object') {
  console.log('GRAPHIC PLAN EMPTY ' + asked.project_id + ': ' + JSON.stringify($json).slice(0, 300));
  if (!asked.picked) return [];
  answer = {};
}

// A film that gets no graphics (Kids, Cinematic, or Classic picked) is asked
// only for its transitions; its plan carries style 'classic', which draws
// nothing, so every reader of the plan keeps one shape.
const style = !asked.graphics ? 'classic' : (asked.picked || (STYLES.includes(answer.style) ? answer.style : null));
if (!style) {
  console.log('GRAPHIC PLAN NO STYLE ' + asked.project_id + ': ' + JSON.stringify(answer.style));
  return [];
}
// Only the AI's own choice is stored here; a producer's pick lives in
// Editing Options.transitionStyle and wins at render time anyway.
const transition = !asked.picked_transition && TRANSITIONS.includes(answer.transition) ? answer.transition : null;
if (!asked.graphics && !transition) {
  console.log('GRAPHIC PLAN NO TRANSITION ' + asked.project_id + ': ' + JSON.stringify(answer.transition));
  return [];
}

// Compare as a viewer reads: case, accents and punctuation do not matter.
const fold = (s) => String(s || '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const clip = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n).trim();

const byOrder = new Map();
for (const s of asked.scenes || []) byOrder.set(Number(s.order), s);

const items = [];
const usedScenes = new Set();
const usedTitles = new Set();
let tags = 0;
let stats = 0;
const rejected = [];
for (const it of asked.graphics && Array.isArray(answer.items) ? answer.items : []) {
  const why = (reason) => rejected.push((it && it.kind) + '@' + (it && it.scene) + ': ' + reason);
  if (!it || typeof it !== 'object') continue;
  const order = Number(it.scene);
  const scene = byOrder.get(order);
  if (!scene) { why('no such scene'); continue; }
  if (!(Number(scene.chapter) > 0)) { why('cold open'); continue; }
  if (usedScenes.has(order)) { why('scene already has one'); continue; }
  const quote = fold(it.quote);
  if (!quote || quote.split(' ').length > 12 || !fold(scene.text).includes(quote)) { why('quote not in the narration'); continue; }

  if (it.kind === 'person' || it.kind === 'place') {
    if (tags >= asked.max_tags) { why('over the tag budget'); continue; }
    const title = clip(it.title, 40);
    if (title.length < 2) { why('no title'); continue; }
    // The name itself must be in the scene too, not only the quote: a quote
    // of "the emperor" titled "Augustus" would be an inference, not a label.
    const words = fold(title).split(' ').filter((w) => w.length >= 3);
    if (!words.length || !words.some((w) => fold(scene.text).includes(w))) { why('title not spoken in the scene'); continue; }
    if (usedTitles.has(fold(title))) { why('already tagged'); continue; }
    const subtitle = clip(it.subtitle, 56);
    items.push(Object.assign({ kind: it.kind, sceneOrder: order, title }, subtitle ? { subtitle } : {}));
    usedTitles.add(fold(title));
    usedScenes.add(order);
    tags++;
  } else if (it.kind === 'stat') {
    if (stats >= asked.max_stats) { why('over the stat budget'); continue; }
    const value = Number(it.value);
    if (!Number.isFinite(value) || value <= 0 || value >= 1e7) { why('bad value'); continue; }
    const label = clip(it.label, 40);
    if (!label) { why('no label'); continue; }
    // Letters or % only: a suffix like "–40M" is a range squeezed into the
    // unit, and clipped to three characters it would print a wrong figure.
    const suffix = clip(it.suffix, 8);
    if (suffix && !/^(%|[\p{L}]{1,3})$/u.test(suffix)) { why('suffix is not a unit: ' + suffix); continue; }
    const caption = clip(it.caption, 64);
    items.push(Object.assign(
      { kind: 'stat', sceneOrder: order, value: Math.round(value * 10) / 10, label },
      suffix ? { suffix } : {},
      caption ? { caption } : {},
    ));
    usedScenes.add(order);
    stats++;
  }
}
items.sort((a, b) => a.sceneOrder - b.sceneOrder);

const plan = {
  style,
  ...(transition ? { transition } : {}),
  source: asked.picked ? 'producer' : 'ai',
  why: clip(answer.why, 240),
  items,
  at: new Date().toISOString(),
};
console.log('GRAPHIC PLAN ' + asked.project_id + ': ' + style + ' (' + plan.source + '), transition ' + (transition || asked.picked_transition + ' (producer)') + ', ' + tags + ' tags, ' + stats + ' stats' +
  (rejected.length ? ' — rejected ' + rejected.length + ': ' + rejected.slice(0, 12).join('; ') : ''));
return [{ json: {
  project_id: asked.project_id,
  plan,
  plan_b64: Buffer.from(JSON.stringify(plan), 'utf8').toString('base64'),
} }];
