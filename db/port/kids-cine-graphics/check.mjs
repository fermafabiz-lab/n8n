#!/usr/bin/env node
//
// check.mjs — run the graphic-styles + transitions node bodies against
// fixtures, with no n8n and no network. Supersedes db/port/graphic-styles/
// check.mjs: the same assertions on the new bodies, plus transitions.
//
//     node db/port/transitions/check.mjs
//
// What it pins: Build Plan Prompt asks only for Story/Documentary and never for
// an explicit Classic; Parse Plan keeps only graphics whose quote AND name are
// in their scene, never on the cold open, one per scene, within the budgets;
// Caption Colour sends a style only when there is one and maps items from
// scene order to the render's index; Normalize Webhook Input stores only a
// known style. And every edit is ADDITIVE: with no graphic fields anywhere,
// both live bodies produce exactly what the originals produce.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
let failures = 0;
function ok(label, cond, detail) {
  if (cond) console.log(`  ok   ${label}`);
  else { failures += 1; console.log(`  FAIL ${label}${detail ? ' — ' + detail : ''}`); }
}

function runNode(path, { json = {}, nodes = {}, all = {} } = {}) {
  const body = readFileSync(join(here, path), 'utf8');
  const logs = [];
  const $ = (name) => {
    if (!(name in nodes) && !(name in all)) throw new Error(`No node called "${name}" could be found`);
    return {
      first: () => ({ json: nodes[name] }),
      all: () => (all[name] || [nodes[name]]).map((j) => ({ json: j })),
    };
  };
  const fn = new Function('$json', '$', 'Buffer', 'console', body);
  const out = fn(json, $, Buffer, { log: (...a) => logs.push(a.join(' ')) });
  return { out, logs };
}

// ---------------------------------------------------------------- fixtures
const SCENES = [
  { order: 1, chapter: 0, text: 'Forty million modii of grain a year fed Rome.' },
  { order: 2, chapter: 1, text: 'Augustus appointed a praefectus annonae because hunger meant riots.' },
  { order: 3, chapter: 1, text: 'Ships sailed from Alexandria carrying forty million modii of grain every year.' },
  { order: 4, chapter: 1, text: 'At Portus, the Claudian harbour, cargo moved onto river barges.' },
  { order: 5, chapter: 2, text: 'In Testaccio the Emporium stored it all, and Augustus inspected it again.' },
  { order: 6, chapter: 2, text: 'The people queued for their ration at the Porticus Minucia.' },
];
const FILM = { id: 'recTEST', name: 'How Rome fed a million people', tone: 'Documentary', language: 'English', length_seconds: 120, category: 'documentary', graphic_style: '', scenes: SCENES };

console.log('Build Plan Prompt');
{
  const r = runNode('paste/Build Plan Prompt.js', { json: FILM }).out;
  ok('asks for a documentary', r.length === 1);
  ok('budgets from length: 6 tags, 2 stats', r[0].json.max_tags === 6 && r[0].json.max_stats === 2, JSON.stringify([r[0].json.max_tags, r[0].json.max_stats]));
  ok('offers the style choice when nothing is picked', r[0].json.payload.messages[0].content.includes('GRAPHIC STYLE'));
  ok('marks the cold open', r[0].json.payload.messages[1].content[0].text.includes('SCENE 1 (cold open'));
  const p = runNode('paste/Build Plan Prompt.js', { json: { ...FILM, graphic_style: 'cinematic' } }).out;
  ok('a producer pick is passed on, no style menu', p[0].json.picked === 'cinematic' && !p[0].json.payload.messages[0].content.includes('GRAPHIC STYLE'));
  for (const [label, film] of [
    ['kids story, Classic and a picked transition', { ...FILM, category: 'kids', graphic_style: 'classic', transition_style: 'crossfade' }],
    ['cinematic, Classic and a picked transition', { ...FILM, category: 'cinematic', graphic_style: 'classic', transition_style: 'none' }],
    ['explicit classic with a picked transition', { ...FILM, graphic_style: 'classic', transition_style: 'push' }],
    ['no scenes yet', { ...FILM, scenes: [] }],
  ]) ok(`skips ${label}`, runNode('paste/Build Plan Prompt.js', { json: film }).out.length === 0);
  const KSC = SCENES.map((sc, i) => ({ ...sc, image: i ? 'rec' + i + '/image/x.png' : null }));
  const kids = runNode('paste/Build Plan Prompt.js', { json: { ...FILM, category: 'kids', scenes: KSC } }).out[0].json;
  const ksys = kids.payload.messages[0].content;
  ok('a kids film is offered the kids styles only', ksys.includes('kidsStorybook') && ksys.includes('kidsAll') && !ksys.includes('reportage'));
  ok('a kids film is asked for characters with a box', ksys.includes('- character:') && ksys.includes('box ='));
  const imgs = kids.payload.messages[1].content.filter((c) => c.type === 'image_url');
  ok('a kids film sends the stills of its story scenes, low detail', imgs.length === 5 && imgs.every((c) => c.image_url.detail === 'low' && c.image_url.url.startsWith('https://house-of-videos.com/media/rec')), JSON.stringify(imgs.map((c) => c.image_url.url)));
  const cine = runNode('paste/Build Plan Prompt.js', { json: { ...FILM, category: 'cinematic' } }).out[0].json;
  const csys = cine.payload.messages[0].content;
  ok('a cinematic film is offered the cinematic styles and slates only', csys.includes('cineNeon') && csys.includes('- slate:') && !csys.includes('- person:') && cine.payload.messages[1].content.length === 1);
  const both = runNode('paste/Build Plan Prompt.js', { json: FILM }).out[0].json.payload.messages[0].content;
  ok('a documentary is asked for style, transition and graphics', both.includes('GRAPHIC STYLE') && both.includes('TRANSITION') && both.includes('GRAPHICS'));
  ok('a documentary still gets its own family', both.includes('reportage') && both.includes('- person:') && !both.includes('kidsAll'));
  const pickedT = runNode('paste/Build Plan Prompt.js', { json: { ...FILM, transition_style: 'shutter' } }).out[0].json;
  ok('a picked transition is not asked for', pickedT.picked_transition === 'shutter' && !pickedT.payload.messages[0].content.includes('TRANSITION family'));
  ok('scenes as a JSON string are read', runNode('paste/Build Plan Prompt.js', { json: { ...FILM, scenes: JSON.stringify(SCENES) } }).out.length === 1);
}

console.log('Parse Plan');
const asked = runNode('paste/Build Plan Prompt.js', { json: FILM }).out[0].json;
const parse = (answer, a = asked) => runNode('paste/Parse Plan.js', {
  json: { choices: [{ message: { content: typeof answer === 'string' ? answer : JSON.stringify(answer) } }] },
  nodes: { 'Build Plan Prompt': a },
});
{
  const { out, logs } = parse({
    style: 'reportage', transition: 'shutter', why: 'An investigation of supply.',
    items: [
      { kind: 'stat', scene: 1, quote: 'Forty million modii', value: 40, suffix: 'M', label: 'modii a year' },
      { kind: 'person', scene: 2, quote: 'Augustus appointed', title: 'Augustus', subtitle: 'First emperor' },
      { kind: 'stat', scene: 3, quote: 'forty million modii', value: 40, suffix: 'M', label: 'modii of grain a year', caption: 'from Alexandria' },
      { kind: 'place', scene: 4, quote: 'Portus, the Claudian harbour', title: 'Portus, Claudian harbour', subtitle: 'Rome’s sea port' },
      { kind: 'person', scene: 5, quote: 'Augustus inspected', title: 'Augustus' },
      { kind: 'place', scene: 6, quote: 'the Porticus Minucia', title: 'Circus Maximus' },
      { kind: 'place', scene: 6, quote: 'queued for bread', title: 'Porticus Minucia' },
      { kind: 'place', scene: 99, quote: 'x', title: 'Nowhere' },
    ],
  });
  const plan = out[0].json.plan;
  ok('style kept, marked as the AI’s', plan.style === 'reportage' && plan.source === 'ai');
  ok('the AI’s transition is kept', plan.transition === 'shutter');
  ok('three graphics survive', plan.items.length === 3, JSON.stringify(plan.items));
  ok('nothing on the cold open', !plan.items.some((i) => i.sceneOrder === 1));
  ok('a stat keeps value, suffix, caption', plan.items.some((i) => i.kind === 'stat' && i.sceneOrder === 3 && i.value === 40 && i.suffix === 'M' && i.caption === 'from Alexandria'));
  ok('a person is tagged once', plan.items.filter((i) => i.title === 'Augustus').length === 1);
  ok('a title the scene never says is refused', !plan.items.some((i) => i.title === 'Circus Maximus'));
  ok('a quote the scene never says is refused', !plan.items.some((i) => i.title === 'Porticus Minucia'));
  ok('refusals are logged with reasons', logs.some((l) => l.includes('quote not in the scene text') && l.includes('title not spoken')), logs.join('\n'));
  ok('base64 round-trips', JSON.parse(Buffer.from(out[0].json.plan_b64, 'base64').toString('utf8')).items.length === 3);
}
{
  const many = Array.from({ length: 6 }, (_, i) => ({ kind: 'place', scene: 2 + (i % 5), quote: SCENES[1 + (i % 5)].text.split(' ').slice(0, 3).join(' '), title: SCENES[1 + (i % 5)].text.split(' ')[0] + ' X' + i }));
  const tight = { ...asked, max_tags: 2 };
  ok('the tag budget is enforced in code', parse({ style: 'editorial', items: many }, tight).out[0].json.plan.items.length <= 2);
}
{
  const r = parse({ style: 'editorial', items: [{ kind: 'stat', scene: 3, quote: 'forty million modii', value: 20, suffix: '\u201340M', label: 'modii' }] }).out[0].json.plan;
  ok('a range squeezed into the suffix is refused', r.items.length === 0, JSON.stringify(r.items));
}
ok('garbage writes nothing', parse('not json').out.length === 0);
ok('an unknown style writes nothing', parse({ style: 'neon', items: [] }).out.length === 0);
{
  const out = parse('not json', { ...asked, picked: 'handwritten' }).out;
  ok('garbage with a producer pick keeps the pick, no items', out.length === 1 && out[0].json.plan.style === 'handwritten' && out[0].json.plan.source === 'producer' && out[0].json.plan.items.length === 0);
}
ok('a producer pick beats the model’s style', parse({ style: 'reportage', items: [] }, { ...asked, picked: 'cinematic' }).out[0].json.plan.style === 'cinematic');

{
  const KSC = SCENES.map((sc, i) => ({ ...sc, image: i === 1 ? 'rec2/image/pip.png' : null }));
  const kAsked = runNode('paste/Build Plan Prompt.js', { json: { ...FILM, category: 'kids', scenes: KSC } }).out[0].json;
  const k = parse({ style: 'kidsAll', transition: 'crossfade', why: 'gentle', items: [
    { kind: 'character', scene: 2, quote: 'Augustus appointed', title: 'Augustus the Emperor', box: [0.4, 0.1, 0.3, 0.8] },
    { kind: 'character', scene: 5, quote: 'Augustus inspected', title: 'Augustus', box: [0.1, 0.1, 0.2, 0.2] },
    { kind: 'speech', scene: 3, quote: 'forty million modii', text: 'forty million modii of grain', box: [0.2, 0.2, 0.3, 0.6] },
    { kind: 'speech', scene: 4, quote: 'Portus', text: 'Hello there, friends!' },
    { kind: 'moment', scene: 6, quote: 'queued for their ration', label: 'Ration time!' },
    { kind: 'celebrate', scene: 4 },
    { kind: 'person', scene: 4, quote: 'Portus', title: 'Portus' },
  ] }, kAsked).out[0].json.plan;
  const kinds = k.items.map((i) => i.kind + '@' + i.sceneOrder).join(' ');
  ok('a kids plan keeps the kids kinds that check out', k.style === 'kidsAll' && kinds === 'character@2 speech@3 celebrate@4 moment@6', kinds);
  ok('a character carries its box and its scene still', JSON.stringify(k.items[0].box) === '[0.4,0.1,0.3,0.8]' && k.items[0].image === 'https://house-of-videos.com/media/rec2/image/pip.png');
  ok('a line nobody says is refused', !k.items.some((i) => i.text === 'Hello there, friends!'));
  ok('a kids style is refused for a documentary', parse({ style: 'kidsAll', items: [] }).out.length === 0);
  const bad = parse({ style: 'kidsAll', items: [{ kind: 'character', scene: 3, quote: 'forty million', title: 'Forty', box: [0, 0, 1, 1] }] }, { ...kAsked, scenes: SCENES }).out[0].json.plan;
  ok('a whole-frame box with no still is refused', bad.items.length === 0);
  const cAsked = runNode('paste/Build Plan Prompt.js', { json: { ...FILM, category: 'cinematic' } }).out[0].json;
  const c = parse({ style: 'cineNeon', transition: 'glitch', items: [
    { kind: 'slate', scene: 2, quote: 'Augustus appointed', title: 'Palatine Hill', subtitle: 'Rome · 27 BC' },
    { kind: 'slate', scene: 3, quote: 'Ships sailed', title: 'Alexandria' },
    { kind: 'slate', scene: 5, quote: 'In Testaccio', title: 'Testaccio' },
  ] }, cAsked).out[0].json.plan;
  ok('cinematic slates: never two in a row', c.style === 'cineNeon' && c.items.map((i) => i.sceneOrder).join(',') === '2,5', JSON.stringify(c.items));
  const cls = parse({ transition: 'crossfade' }, runNode('paste/Build Plan Prompt.js', { json: { ...FILM, category: 'kids', graphic_style: 'classic' } }).out[0].json).out[0].json.plan;
  ok('Classic kids film: classic, the transition, no items', cls.style === 'classic' && cls.transition === 'crossfade' && cls.items.length === 0);
  ok('a transition-only plan with no valid transition writes nothing', parse({ transition: 'wipe' }, runNode('paste/Build Plan Prompt.js', { json: { ...FILM, graphic_style: 'classic' } }).out[0].json).out.length === 0);
  ok('an invalid transition is dropped, the graphics kept', !('transition' in parse({ style: 'editorial', transition: 'wipe', items: [] }).out[0].json.plan));
  const pT = runNode('paste/Build Plan Prompt.js', { json: { ...FILM, transition_style: 'glitch' } }).out[0].json;
  ok('with a picked transition the AI’s is not stored', !('transition' in parse({ style: 'editorial', transition: 'push', items: [] }, pT).out[0].json.plan));
}

console.log('Caption Colour');
const PREP = [{ id: 'recB' }, { id: 'recC' }, { id: 'recD' }];
const FAS = [{ id: 'recA', fields: { 'Ordine Scenă': 1 } }, { id: 'recB', fields: { 'Ordine Scenă': 2 } }, { id: 'recC', fields: { 'Ordine Scenă': 3 } }, { id: 'recD', fields: { 'Ordine Scenă': 4 } }];
const cc = (file, opts) => runNode(file, {
  json: { body: { scenes: [{}, {}, {}], captionColor: undefined } },
  nodes: { 'Fetch Project Info': { fields: { 'Editing Options': JSON.stringify(opts) } } },
  all: { 'Fetch Approved Scenes': FAS, 'Prepare Clips': PREP },
}).out[0].json.body;
{
  const planOpts = { category: 'documentary', graphicPlan: { style: 'reportage', items: [
    { kind: 'person', sceneOrder: 3, title: 'Augustus' },
    { kind: 'stat', sceneOrder: 1, value: 40, label: 'x' },
  ] } };
  const b = cc('paste/fa-Caption_Colour.js', planOpts);
  ok('AI plan style reaches the render', b.graphicStyle === 'reportage');
  ok('items mapped to the rendered index, unrendered scenes dropped', JSON.stringify(b.graphicItems) === JSON.stringify([{ kind: 'person', title: 'Augustus', sceneIndex: 1 }]), JSON.stringify(b.graphicItems));
  ok('the producer’s pick beats the plan', cc('paste/fa-Caption_Colour.js', { ...planOpts, graphicStyle: 'cinematic' }).graphicStyle === 'cinematic');
  const classic = cc('paste/fa-Caption_Colour.js', { ...planOpts, graphicStyle: 'classic' });
  ok('explicit classic sends nothing', !('graphicStyle' in classic) && !('graphicItems' in classic));
  ok('an unknown style sends nothing', !('graphicStyle' in cc('paste/fa-Caption_Colour.js', { graphicStyle: 'neon' })));
  ok('the AI’s transition reaches the render', cc('paste/fa-Caption_Colour.js', { graphicPlan: { style: 'classic', transition: 'blur', items: [] } }).transitionStyle === 'blur');
  ok('a picked transition beats the plan', cc('paste/fa-Caption_Colour.js', { transitionStyle: 'push', graphicPlan: { style: 'classic', transition: 'blur', items: [] } }).transitionStyle === 'push');
  ok('picked none sends nothing', !('transitionStyle' in cc('paste/fa-Caption_Colour.js', { transitionStyle: 'none', graphicPlan: { style: 'classic', transition: 'blur', items: [] } })));
  ok('a kids film gets its transition and no graphics', (() => { const b = cc('paste/fa-Caption_Colour.js', { category: 'kids', graphicPlan: { style: 'classic', transition: 'crossfade', items: [] } }); return b.transitionStyle === 'crossfade' && !('graphicStyle' in b); })());
  for (const opts of [{}, { category: 'story', motionPack: 'punch', captionColor: '#ff0' }, { graphicStyle: 'classic', category: 'kids' }, planOpts]) {
    ok(`unchanged from the original without a style: ${JSON.stringify(opts)}`,
      JSON.stringify(cc('paste/fa-Caption_Colour.js', opts)) === JSON.stringify(cc('original/fa-Caption_Colour.js', opts)));
  }
}

console.log('Normalize Webhook Input');
{
  const src = readFileSync(join(here, 'paste/orch-Normalize_Webhook_Input.js'), 'utf8');
  const orig = readFileSync(join(here, 'original/orch-Normalize_Webhook_Input.js'), 'utf8');
  const added = src.split('\n').filter((l) => !orig.includes(l));
  ok('only the graphic style list changed', added.length === 2 && added.every((l) => /kidsStorybook|Kids story and Cinematic/.test(l)), added.join('\n'));
  const run = (file, b) => JSON.parse(new Function('$json', readFileSync(join(here, file), 'utf8'))({ body: b })[0].json.editingOptions);
  ok('a kids style is stored', run('paste/orch-Normalize_Webhook_Input.js', { graphic_style: 'kidsPlayful' }).graphicStyle === 'kidsPlayful');
  for (const b of [{}, { graphic_style: 'editorial', transition_style: 'push' }, { graphic_style: 'neon' }])
    ok(`unchanged from the original: ${JSON.stringify(b)}`, JSON.stringify(run('paste/orch-Normalize_Webhook_Input.js', b)) === JSON.stringify(run('original/orch-Normalize_Webhook_Input.js', b)));
}

console.log(failures ? `\n${failures} FAILED` : '\nall graphic-styles + transitions + kids/cinematic checks passed');
process.exit(failures ? 1 : 0);
