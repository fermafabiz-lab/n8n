// Check every graphic the model proposed against the film it is for, and
// keep only what survives. The model is asked for a quote per graphic; the
// quote is what makes a graphic checkable — it must be words that scene
// actually says, so a name the narration never mentions, a line nobody says,
// or a figure it never states cannot reach the screen. Nothing here trusts
// the model's own counting either: the budgets are applied again.
//
// A failed or empty answer writes NOTHING: the film then renders with no
// graphics (classic), which is the safe side of wrong. Unless the producer
// picked a style — then the pick is saved with no items, so Final touches
// still shows it.
const asked = $('Build Plan Prompt').first().json;
const STYLES = Array.isArray(asked.styles) ? asked.styles : ['classic', 'reportage', 'editorial', 'cinematic', 'handwritten'];
const TRANSITIONS = ['none', 'push', 'crossfade', 'blur', 'shutter', 'glitch'];
const B = Object.assign({ characters: 3, speech: 2, moments: 1, slates: 3 }, asked.budgets || {});
// max_tags / max_stats are the older names of the same two budgets; they win,
// so a prompt node from before 2026-09-25 is still obeyed.
if (Number.isFinite(asked.max_tags)) B.tags = asked.max_tags;
if (Number.isFinite(asked.max_stats)) B.stats = asked.max_stats;

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

// A film that gets no graphics (Classic picked) is asked only for its
// transitions; its plan carries style 'classic', which draws nothing, so
// every reader of the plan keeps one shape.
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
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const clip = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n).trim();
// A box is four fractions of the picture, big enough to be a character and
// small enough not to be the whole frame.
const boxOf = (b) => {
  if (!Array.isArray(b) || b.length !== 4) return null;
  const v = b.map(Number);
  if (!v.every((n) => Number.isFinite(n))) return null;
  let [x, y, w, h] = v;
  x = Math.max(0, Math.min(1, x)); y = Math.max(0, Math.min(1, y));
  w = Math.min(1 - x, w); h = Math.min(1 - y, h);
  if (w < 0.04 || h < 0.04 || w * h > 0.8) return null;
  return [x, y, w, h].map((n) => Math.round(n * 1000) / 1000);
};

const byOrder = new Map();
for (const s of asked.scenes || []) byOrder.set(Number(s.order), s);

const items = [];
const usedScenes = new Set();
const usedTitles = new Set();
const n = { tags: 0, stats: 0, characters: 0, speech: 0, moments: 0, celebrate: 0, slates: 0 };
let lastSlate = -10;
const rejected = [];
for (const it of asked.graphics && Array.isArray(answer.items) ? answer.items : []) {
  const why = (reason) => rejected.push((it && it.kind) + '@' + (it && it.scene) + ': ' + reason);
  if (!it || typeof it !== 'object') continue;
  const order = Number(it.scene);
  const scene = byOrder.get(order);
  if (!scene) { why('no such scene'); continue; }
  if (!(Number(scene.chapter) > 0)) { why('cold open'); continue; }
  if (usedScenes.has(order)) { why('scene already has one'); continue; }
  const said = fold(scene.text);
  // The happy ending needs no quote: it is a scene, not a line.
  if (it.kind !== 'celebrate') {
    const quote = fold(it.quote);
    if (!quote || quote.split(' ').length > 12 || !said.includes(quote)) { why('quote not in the scene text'); continue; }
  }

  if (it.kind === 'person' || it.kind === 'place') {
    if (n.tags >= B.tags) { why('over the tag budget'); continue; }
    const title = clip(it.title, 40);
    if (title.length < 2) { why('no title'); continue; }
    // The name itself must be in the scene too, not only the quote: a quote
    // of "the emperor" titled "Augustus" would be an inference, not a label.
    const words = fold(title).split(' ').filter((w) => w.length >= 3);
    if (!words.length || !words.some((w) => said.includes(w))) { why('title not spoken in the scene'); continue; }
    if (usedTitles.has(fold(title))) { why('already tagged'); continue; }
    const subtitle = clip(it.subtitle, 56);
    items.push(Object.assign({ kind: it.kind, sceneOrder: order, title }, subtitle ? { subtitle } : {}));
    usedTitles.add(fold(title));
    n.tags++;
  } else if (it.kind === 'stat') {
    if (n.stats >= B.stats) { why('over the stat budget'); continue; }
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
    n.stats++;
  } else if (it.kind === 'character') {
    if (n.characters >= B.characters) { why('over the character budget'); continue; }
    const title = clip(it.title, 40);
    const name = fold(title).split(' ').filter((w) => w.length >= 3)[0];
    if (!name || !said.includes(name)) { why('name not in the scene'); continue; }
    if (usedTitles.has(name)) { why('already introduced'); continue; }
    const box = boxOf(it.box);
    // The card shows the scene's own still; with neither a still nor a box
    // there is nothing either design could draw.
    const image = scene.image ? asked.media + String(scene.image).replace(/^\/+/, '') : null;
    if (!box && !image) { why('no box and no still'); continue; }
    items.push(Object.assign({ kind: 'character', sceneOrder: order, title }, box ? { box } : {}, image ? { image } : {}));
    usedTitles.add(name);
    n.characters++;
  } else if (it.kind === 'speech') {
    if (n.speech >= B.speech) { why('over the speech budget'); continue; }
    const text = clip(it.text, 60);
    // The line itself must be in the scene text, word for word as read.
    if (!text || !said.includes(fold(text))) { why('line not in the scene text'); continue; }
    const box = boxOf(it.box);
    items.push(Object.assign({ kind: 'speech', sceneOrder: order, text }, box ? { box } : {}));
    n.speech++;
  } else if (it.kind === 'moment') {
    if (n.moments >= B.moments) { why('over the moment budget'); continue; }
    const label = clip(it.label, 24);
    if (!label || label.split(' ').length > 4) { why('bad sticker label'); continue; }
    items.push({ kind: 'moment', sceneOrder: order, label });
    n.moments++;
  } else if (it.kind === 'celebrate') {
    if (n.celebrate >= 1) { why('one celebration'); continue; }
    items.push({ kind: 'celebrate', sceneOrder: order });
    n.celebrate++;
  } else if (it.kind === 'slate') {
    if (n.slates >= B.slates) { why('over the slate budget'); continue; }
    const pos = (asked.scenes || []).findIndex((s) => Number(s.order) === order);
    if (pos - lastSlate < 2) { why('two slates in a row'); continue; }
    const title = clip(it.title, 28);
    if (!title) { why('no title'); continue; }
    const subtitle = clip(it.subtitle, 32);
    items.push(Object.assign({ kind: 'slate', sceneOrder: order, title }, subtitle ? { subtitle } : {}));
    lastSlate = pos;
    n.slates++;
  } else {
    why('unknown kind');
    continue;
  }
  usedScenes.add(order);
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
console.log('GRAPHIC PLAN ' + asked.project_id + ': ' + style + ' (' + plan.source + '), transition ' + (transition || asked.picked_transition + ' (producer)') + ', ' + JSON.stringify(n) +
  (rejected.length ? ' — rejected ' + rejected.length + ': ' + rejected.slice(0, 12).join('; ') : ''));
return [{ json: {
  project_id: asked.project_id,
  plan,
  plan_b64: Buffer.from(JSON.stringify(plan), 'utf8').toString('base64'),
} }];
