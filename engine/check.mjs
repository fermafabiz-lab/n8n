// Final Assembly in code, phase 1: the engine's TypeScript modules must give
// what the n8n Code nodes give, byte for byte after a JSON round trip, on a
// real film and on every branch we can reach.
//
//   cd engine && npm run check
//
// Four layers, each guarding the one after it:
//   0. The n8n bodies under fixtures/ are still the committed sources
//      (db/port/story-close/Final Assembly.after.json + the Source Watermark
//      and motion-packs Caption Colour pastes), so a later edit to any of
//      them is a loud failure here.
//   1. The harness is faithful: the n8n bodies, run on Final Assembly
//      execution 16974's recorded inputs, reproduce its recorded outputs.
//   2. TS equals n8n: both chains run on Rome, on every mutation in
//      fixtures/mutations.mjs and on two synthetic films, compared step by
//      step (errors compared by message).
//   3. The composed requests (planAssemble / planRender) equal the /assemble
//      body 16974 sent, and the /render body the LIVE n8n chain builds from
//      16974's inputs (= what 16974 sent + `category`).
// Plus the speed (D2) table against remotion/server/speed.mjs.
//
// No network, no database, no n8n. `RESULT: OK n/n` only if n > 0.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as E from './src/assembly/index.ts';
import { mutations, expectedDivergence } from './fixtures/mutations.mjs';
import { worldFromProps } from './fixtures/from-props.mjs';
import { normalizeSpeed as serverNormalizeSpeed } from '../remotion/server/speed.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, '..');
// The LIVE version the engine must match, and the one execution 16974 ran
// on. They differ in Caption Colour only (362a9c56 added `category` and
// `motionPack` for the motion packs); layer 1 replays 16974 on the version
// it actually ran, everything else is held to the live one.
const CURRENT = '362a9c56';
const RECORDED = '309157bd';
const bodiesDir = (v) => path.join(here, 'fixtures', 'n8n-' + v);
const BODIES = bodiesDir(CURRENT);
const bodyOf = (v, name) => fs.readFileSync(path.join(bodiesDir(v), name + '.js'), 'utf8');
const body = (name) => bodyOf(CURRENT, name);
const rome = JSON.parse(fs.readFileSync(path.join(here, 'fixtures', 'rome-16974.json'), 'utf8'));
const rec = (node) => rome.nodes[node].items;

// ---------------------------------------------------------------------------
let passed = 0, failed = 0;
const quiet = process.argv.includes('--quiet');
const canon = (v) => {
  if (v === undefined) return undefined;
  const walk = (x) => Array.isArray(x) ? x.map(walk)
    : (x && typeof x === 'object') ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, walk(x[k])])) : x;
  return JSON.stringify(walk(JSON.parse(JSON.stringify(v))));
};
function is(label, got, want) {
  const g = canon(got), w = canon(want);
  if (g === w) { passed++; if (!quiet) console.log('  ok   ' + label); return true; }
  failed++;
  console.log('  FAIL ' + label + '\n         got  ' + String(g).slice(0, 600) + '\n         want ' + String(w).slice(0, 600));
  return false;
}
const ok = (label, cond) => is(label, !!cond, true);
const clone = (x) => JSON.parse(JSON.stringify(x));

// ---------------------------------------------------------------------------
// The n8n side: a Code-node body run as n8n runs it. `nodes` maps a node name
// to its output items (plain json), or to {executed: false} for a node that
// did not run on this path — `$(name).isExecuted` is false and reading its
// items throws, which is what Build Timeline's try/catch is written against.
function runN8n(name, { nodes = {}, json = {}, items = [], runIndex = 0, random, version = CURRENT } = {}) {
  const $ = (n) => {
    const s = nodes[n];
    const executed = !!s && s.executed !== false;
    const list = () => { if (!executed) throw new Error(`Node '${n}' hasn't been executed`); return s.map((j) => ({ json: j })); };
    return {
      isExecuted: executed,
      first: () => list()[0],
      last: () => list()[list().length - 1],
      all: () => list(),
      get item() { return list()[0]; },
    };
  };
  const $input = { all: () => items.map((j) => ({ json: j })), first: () => ({ json: items[0] }) };
  const math = Object.create(Math);
  if (random !== undefined) math.random = () => random;
  const logs = [];
  const fn = new Function('$', '$json', '$input', '$runIndex', 'console', 'Math', bodyOf(version, name));
  const out = fn($, json, $input, runIndex, { log: (...a) => logs.push(a.join(' ')) }, math);
  return { items: out.map((o) => o.json), logs };
}

// A world is everything the workflow reads from outside itself.
function romeWorld() {
  const toneFolder = rec('Match Tone Folder')[0].folderId;
  const toneFiles = rec('List Tone Folder')[0].files;
  const pickedAt = toneFiles.filter((f) => f && f.id && !(f.mimeType || '').includes('folder')).findIndex((f) => f.id === rec('Pick Music Track')[0].id);
  const n = toneFiles.filter((f) => f && f.id && !(f.mimeType || '').includes('folder')).length;
  const assembled = clone(rec('Render Guard')[0]); delete assembled.lost;
  return {
    name: 'rome',
    webhookBody: rec('Assemble Webhook')[0].body,
    sceneRows: clone(rec('Fetch Approved Scenes')),
    project: clone(rec('Fetch Project Info')[0]),
    script: clone(rec('Fetch Script Titles')[0]),
    rootFiles: clone(rec('List Music')[0].files),
    driveFolders: { [toneFolder]: clone(toneFiles) },
    random: (pickedAt + 0.5) / n,
    assembled,
    assemblePolls: rome.nodes['Render Guard'].runs - 1,
  };
}

// Each chain returns its steps in order, stopping at the first throw.
function attempt(steps, key, f) {
  if (steps.error) return;
  try { steps[key] = f(); } catch (e) { steps.error = { at: key, message: e.message }; }
}

function n8nChain(world, version = CURRENT) {
  const w = clone(world);
  const run = (name, opts = {}) => runN8n(name, { ...opts, version });
  const s = {};
  const nodes = {};
  if (w.receive) nodes['Receive Project ID'] = [w.receive]; else nodes['Receive Project ID'] = { executed: false };
  if (w.webhookBody) {
    attempt(s, 'trigger', () => run('Normalize Assemble Input', { json: { body: w.webhookBody } }).items[0]);
    if (s.error) return s;
    nodes['Normalize Assemble Input'] = [s.trigger];
  } else nodes['Normalize Assemble Input'] = { executed: false };
  // Fetch Approved Scenes has alwaysOutputData: no rows is one empty item.
  nodes['Fetch Approved Scenes'] = w.sceneRows.length ? w.sceneRows : [{}];
  attempt(s, 'clips', () => run('Prepare Clips', { items: nodes['Fetch Approved Scenes'] }).items);
  if (s.error) return s;
  nodes['Prepare Clips'] = s.clips;
  nodes['Fetch Project Info'] = [w.project];
  nodes['List Music'] = [{ files: w.rootFiles }];
  attempt(s, 'toneFolder', () => run('Match Tone Folder', { nodes, items: nodes['List Music'] }).items[0]);
  const listing = { files: (w.driveFolders || {})[s.toneFolder.folderId] || [] };
  attempt(s, 'music', () => run('Pick Music Track', { nodes, items: [listing], random: w.random }).items[0]);
  nodes['Pick Music Track'] = [s.music];
  attempt(s, 'timeline', () => run('Build Timeline', { nodes }).items[0]);
  if (s.error) return s;
  nodes['Build Timeline'] = [s.timeline];
  attempt(s, 'assembled', () => run('Render Guard', { items: [w.assembled], runIndex: w.assemblePolls ?? 0 }).items[0]);
  if (s.error) return s;
  nodes['Render Guard'] = [s.assembled];
  nodes['Fetch Script Titles'] = w.script ? [w.script] : [];
  attempt(s, 'props', () => run('Build Remotion Props', { nodes }).items[0].body);
  attempt(s, 'caption', () => run('Caption Colour', { nodes, json: { body: clone(s.props) } }).items[0].body);
  attempt(s, 'motif', () => run('Attach Motif Cards', { nodes, json: { body: clone(s.caption) } }).items[0].body);
  attempt(s, 'watermark', () => { const r = run('Source Watermark', { nodes, json: { body: clone(s.motif) } }); s.log = r.logs; return r.items[0].body; });
  // Submit Graphics' jsonBody expression.
  attempt(s, 'render', () => Object.assign({}, s.watermark, { resolution: (s.timeline.resolution || '720p') }));
  return s;
}

function tsChain(world) {
  const w = clone(world);
  const s = {};
  const triggers = {};
  if (w.receive) triggers.receive = w.receive;
  if (w.webhookBody) {
    attempt(s, 'trigger', () => E.normalizeInput(w.webhookBody));
    if (s.error) return s;
    triggers.normalize = s.trigger;
  }
  attempt(s, 'clips', () => E.prepareClips(w.sceneRows));
  if (s.error) return s;
  const pf = w.project.fields;
  attempt(s, 'toneFolder', () => E.matchToneFolder(pf, w.rootFiles));
  attempt(s, 'music', () => E.pickMusicTrack(pf, w.rootFiles, (w.driveFolders || {})[s.toneFolder.folderId] || [], () => w.random));
  attempt(s, 'timeline', () => E.buildTimeline({ clips: s.clips, triggers, projectFields: pf, music: s.music }));
  if (s.error) return s;
  attempt(s, 'assembled', () => E.judgeAssemblePoll(w.assembled, w.assemblePolls ?? 0));
  if (s.error) return s;
  attempt(s, 'props', () => E.buildProps({ clips: s.clips, triggers, projectFields: pf, script: w.script, assembled: s.assembled }).body);
  attempt(s, 'caption', () => E.graphicStyles(E.captionColour(s.props, pf), pf, w.sceneRows, s.clips));
  attempt(s, 'motif', () => E.attachMotifCards(s.caption, pf, w.sceneRows, s.clips));
  attempt(s, 'watermark', () => { const r = E.sourceWatermark(s.motif, pf, w.sceneRows, s.clips); s.log = [r.log]; return r.body; });
  attempt(s, 'render', () => Object.assign({}, s.watermark, { resolution: (s.timeline.resolution || '720p') }));
  // The composed entry points must agree with the step-by-step chain.
  if (!s.error) {
    const input = { triggers, sceneRows: w.sceneRows, project: w.project };
    const assembly = E.planAssemble({ ...input, music: s.music });
    s.planAssemble = assembly.timeline.body;
    s.planRender = E.planRender({ ...input, assembly, script: w.script, assembled: s.assembled }).body;
  }
  return s;
}

const STEPS = ['trigger', 'clips', 'toneFolder', 'music', 'timeline', 'assembled', 'props', 'caption', 'motif', 'watermark', 'render', 'log', 'error'];
function compareChains(label, world) {
  const a = n8nChain(world), b = tsChain(world);
  let clean = true;
  for (const k of STEPS) {
    if (!(k in a) && !(k in b)) continue;
    const quietOk = canon(a[k]) === canon(b[k]);
    if (quietOk) { passed++; continue; }
    clean = false;
    is(`${label}: ${k}`, b[k], a[k]);
  }
  if (!a.error) {
    clean = is(`${label}: planAssemble = Build Timeline body`, b.planAssemble, a.timeline.body) && clean;
    clean = is(`${label}: planRender = Submit Graphics body`, b.planRender, a.render) && clean;
  }
  if (!quiet && clean) console.log(`  ok   ${label}` + (a.error ? `  (both stop at ${a.error.at}: ${a.error.message})` : ''));
  return a;
}

// ---------------------------------------------------------------------------
console.log('Layer 0 — the fixture bodies are the committed sources');
{
  // Each version = story-close's after.json, the Source Watermark paste on
  // top (309157bd), and the motion-packs Caption Colour on top of that
  // (362a9c56). A later edit to any of those files, or to a fixture, fails here.
  const after = JSON.parse(fs.readFileSync(path.join(repo, 'db/port/story-close/Final Assembly.after.json'), 'utf8'));
  const wf = after.workflow || after;
  const base = Object.fromEntries(wf.nodes.filter((n) => n.parameters && n.parameters.jsCode).map((n) => [n.name, n.parameters.jsCode]));
  const read = (f) => fs.readFileSync(path.join(repo, f), 'utf8');
  const sources = {
    '309157bd': { ...base, 'Source Watermark': read('db/port/watermark-open-once/paste/Source Watermark.js'), 'Caption Colour': read('db/port/motion-packs/original/fa-Caption_Colour.js') },
    '362a9c56': { ...base, 'Source Watermark': read('db/port/watermark-open-once/paste/Source Watermark.js'), 'Caption Colour': read('db/port/motion-packs/paste/fa-Caption_Colour.js') },
  };
  for (const v of [RECORDED, CURRENT]) {
    const manifest = JSON.parse(fs.readFileSync(path.join(bodiesDir(v), 'manifest.json'), 'utf8'));
    is(`manifest names version ${v}`, manifest.versionId.slice(0, 8), v);
    is(`${v}: same set of Code nodes`, Object.keys(sources[v]).sort(), manifest.nodes);
    // The pastes carry a trailing newline the live nodes do not.
    for (const name of manifest.nodes) is(`${v}: ${name} === committed source`, bodyOf(v, name).trimEnd(), sources[v][name].trimEnd());
  }
  const changed = JSON.parse(fs.readFileSync(path.join(bodiesDir(CURRENT), 'manifest.json'), 'utf8')).nodes.filter((n) => bodyOf(CURRENT, n) !== bodyOf(RECORDED, n));
  is(`${RECORDED} → ${CURRENT} changed only Caption Colour`, changed, ['Caption Colour']);
}

// ---------------------------------------------------------------------------
console.log('\nLayer 1 — the n8n bodies reproduce execution 16974');
{
  const a = n8nChain(romeWorld(), RECORDED);
  ok('the chain ran to the end', !a.error || console.log(a.error));
  is('Normalize Assemble Input', a.trigger, rec('Normalize Assemble Input')[0]);
  is('Prepare Clips (11 clips)', a.clips, rec('Prepare Clips'));
  is('Match Tone Folder', a.toneFolder, rec('Match Tone Folder')[0]);
  is('Pick Music Track', a.music, rec('Pick Music Track')[0]);
  is('Build Timeline', a.timeline, rec('Build Timeline')[0]);
  is('Render Guard', a.assembled, rec('Render Guard')[0]);
  is('Build Remotion Props', a.props, rec('Build Remotion Props')[0].body);
  is('Caption Colour', a.caption, rec('Caption Colour')[0].body);
  is('Attach Motif Cards', a.motif, rec('Attach Motif Cards')[0].body);
  is('Source Watermark', a.watermark, rec('Source Watermark')[0].body);
  ok('Rome is the shape it is believed to be (11 scenes, hook, 1 card, provenance)',
    a.clips.length === 11 && a.props.hookPlan && a.motif.textCards.length === 1 && a.watermark.scenes.every((s) => s.provenance));
}

// ---------------------------------------------------------------------------
console.log('\nLayer 2 — the engine equals n8n');
const romeSteps = compareChains('rome, as recorded', romeWorld());
for (const [label, mutate] of Object.entries(mutations)) {
  const w = romeWorld();
  mutate(w);
  if (expectedDivergence[label]) { console.log(`  skip ${label}: ${expectedDivergence[label]}`); continue; }
  compareChains(label, w);
}
for (const [file, opts] of [
  ['db/port/motif-rescue/peking-props.json', { id: 'Peking', category: 'documentary', extra: { watermarkOpenOnce: true } }],
  ['remotion/motif/boyd-props.json', { id: 'Boyd', category: 'story', extra: { hookPlan: { style: 'action', beats: ['a'] }, sfx: false } }],
]) {
  const w = worldFromProps(path.join(repo, file), opts);
  compareChains(`${opts.id} (synthetic, ${w.sceneRows.length} scenes)`, w);
  const m = worldFromProps(path.join(repo, file), opts);
  m.receive = { Project_ID: m.project.id, Aspect: '9:16', No_Captions: 'yes' };
  compareChains(`${opts.id}, receive path 9:16 no captions`, m);
}

console.log('\nLayer 2 — webhook bodies');
for (const b of [{ Project_ID: 'rec1' }, { project_id: 'rec2', aspect: '9:16', captions: 'no' }, { Project_ID: 'rec3', aspect: '1:1', no_captions: 'true' }, {}, null, { Project_ID: '' }]) {
  const n = (() => { try { return runN8n('Normalize Assemble Input', { json: { body: b } }).items[0]; } catch (e) { return { error: e.message }; } })();
  const t = (() => { try { return E.normalizeInput(b); } catch (e) { return { error: e.message }; } })();
  is(`normalizeInput(${JSON.stringify(b)})`, t, n);
}

console.log('\nLayer 2 — poll guards');
{
  const cases = [
    [{ status: 'running', progress: 0.4 }, 3], [{ status: 'DONE', outputUrl: 'u', verify: { a: 1 } }, 9],
    [{ error: 'job not found' }, 12], [{ error: { message: 'Request failed with status code 404' } }, 5],
    [{ error: { description: 'Not Found' } }, 5], [{ error: 'Not Found', status: 'running' }, 5],
    [{ error: 'job not found' }, 721], [{ error: 'job not found' }, 2161], [{ error: 'job not found' }, 4321],
    [{ status: 'error', error: 'ffmpeg exploded' }, 2], [{ status: 'error' }, 2],
    [{ status: 'running' }, 720], [{ status: 'running' }, 721], [{ status: 'running', progress: 0.9 }, 2161], [{ status: 'running' }, 4321], [{}, 0],
  ];
  const tryN = (f) => { try { return f(); } catch (e) { return { error: e.message }; } };
  for (const [j, polls] of cases) {
    is(`assemble poll ${JSON.stringify(j)} @${polls}`, tryN(() => E.judgeAssemblePoll(clone(j), polls)), tryN(() => runN8n('Render Guard', { items: [clone(j)], runIndex: polls }).items[0]));
    for (const resolution of ['720p', '1080p']) {
      is(`graphics poll ${JSON.stringify(j)} @${polls} ${resolution}`, tryN(() => E.judgeGraphicsPoll(clone(j), polls, resolution)),
        tryN(() => runN8n('Graphics Guard', { items: [clone(j)], runIndex: polls, nodes: { 'Build Timeline': [{ resolution }] } }).items[0]));
    }
  }
  const g = rome.nodes['Graphics Guard'];
  const last = clone(g.items[0]); delete last.lost;
  is('graphics guard on 16974\'s last poll', E.judgeGraphicsPoll(last, g.runs - 1, '720p'), g.items[0]);
}

// ---------------------------------------------------------------------------
console.log('\nLayer 3 — the composed requests equal what 16974 sent');
{
  const w = romeWorld();
  const triggers = { normalize: E.normalizeInput(w.webhookBody) };
  const input = { triggers, sceneRows: w.sceneRows, project: w.project };
  const music = E.pickMusicTrack(w.project.fields, w.rootFiles, w.driveFolders[E.matchToneFolder(w.project.fields, w.rootFiles).folderId], () => w.random);
  const assembly = E.planAssemble({ ...input, music });
  is('/assemble body', assembly.timeline.body, rec('Build Timeline')[0].body);
  const assembled = E.judgeAssemblePoll(w.assembled, w.assemblePolls);
  const render = E.planRender({ ...input, assembly, script: w.script, assembled });
  // 16974 ran on 309157bd; the live version adds `category` (and
  // `motionPack` when one is picked) and nothing else — so the request today
  // is the recorded one plus exactly that.
  const recorded = Object.assign({}, rec('Source Watermark')[0].body, { resolution: rec('Build Timeline')[0].resolution });
  is('/render body = what 16974 sent + category', render.body, { ...recorded, category: 'story' });
  is('/render body = the live n8n chain on the same inputs', render.body, romeSteps.render);
  is('watermark log line', render.log, romeSteps.log);
}

// ---------------------------------------------------------------------------
console.log('\nGraphic styles + transitions — engine = the next Caption Colour (db/port/kids-cine-graphics)');
{
  // The live body the next Final Assembly publish carries, run on Rome with a
  // graphic plan and a pick; the engine's captionColour + graphicStyles must
  // give the same body. Without either key both are today's output, which
  // Layer 2 already holds on every fixture.
  const next = fs.readFileSync(path.join(repo, 'db/port/kids-cine-graphics/paste/fa-Caption_Colour.js'), 'utf8');
  const w = romeWorld();
  const a = n8nChain(w);
  const orders = w.sceneRows.map((r) => (r.fields || {})['Ordine Scenă']).filter((o) => o !== undefined);
  const plan = { style: 'reportage', source: 'ai', items: [
    { kind: 'person', sceneOrder: orders[4], title: 'Augustus', subtitle: 'Emperor' },
    { kind: 'stat', sceneOrder: orders[5], value: 40, suffix: 'M', label: 'modii' },
    { kind: 'place', sceneOrder: 99999, title: 'Nowhere' },
  ] };
  for (const [label, extra] of [['AI plan', { graphicPlan: plan }], ['pick beats plan', { graphicPlan: plan, graphicStyle: 'cinematic' }], ['classic', { graphicPlan: plan, graphicStyle: 'classic' }], ['pick, no plan', { graphicStyle: 'handwritten' }], ['unknown', { graphicStyle: 'neon' }], ['plan transition', { graphicPlan: { ...plan, transition: 'blur' } }], ['picked transition', { graphicPlan: { ...plan, transition: 'blur' }, transitionStyle: 'shutter' }], ['kids, transition only', { category: 'kids', graphicPlan: { style: 'classic', transition: 'crossfade', items: [] } }], ['picked none', { transitionStyle: 'none', graphicPlan: { ...plan, transition: 'glitch' } }], ['kids plan', { category: 'kids', graphicPlan: { style: 'kidsAll', transition: 'crossfade', items: [{ kind: 'character', sceneOrder: orders[4], title: 'Pip', box: [0.1, 0.1, 0.3, 0.6], image: 'https://x/y.png' }, { kind: 'celebrate', sceneOrder: orders[5] }] } }], ['cinematic plan', { category: 'cinematic', graphicPlan: { style: 'cineNeon', items: [{ kind: 'slate', sceneOrder: orders[4], title: 'H10', subtitle: '18:42' }] } }]]) {
    const project = clone(w.project);
    const opts = JSON.parse(project.fields['Editing Options'] || '{}');
    project.fields['Editing Options'] = JSON.stringify({ ...opts, ...extra });
    const nodes = { 'Fetch Project Info': [project], 'Fetch Approved Scenes': w.sceneRows, 'Prepare Clips': a.clips };
    const $ = (n) => ({ first: () => ({ json: nodes[n][0] }), all: () => nodes[n].map((j) => ({ json: j })) });
    const n8n = new Function('$', '$json', next)($, { body: clone(a.props) })[0].json.body;
    const ts = E.graphicStyles(E.captionColour(clone(a.props), project.fields), project.fields, w.sceneRows, a.clips);
    is(`${label}: engine = n8n`, ts, n8n);
  }
  ok('the AI plan maps two of three items (the third scene is not in the film)', (() => {
    const project = clone(w.project);
    project.fields['Editing Options'] = JSON.stringify({ ...JSON.parse(project.fields['Editing Options'] || '{}'), graphicPlan: plan });
    const b = E.graphicStyles(clone(a.props), project.fields, w.sceneRows, a.clips);
    return b.graphicStyle === 'reportage' && b.graphicItems.length === 2 && b.graphicItems.every((g) => Number.isInteger(g.sceneIndex));
  })());
}

// ---------------------------------------------------------------------------
console.log('\nSpeed (D2) — agrees with the render server');
{
  const values = [undefined, null, '', 'slow', 'Normal', ' FAST ', 'brisk', 0, -1, 0.49, 0.5, 0.8, 0.9, 0.995, 1, 1.005, 1.1, 1.25, 2, 2.01, '1.25', '0.8x', NaN, Infinity, true, [], {}];
  for (const v of values) is(`normalizeSpeed(${JSON.stringify(v) ?? String(v)})`, E.normalizeSpeed(v), serverNormalizeSpeed(v));
  is('SPEED_BY_PACE matches the server', E.SPEED_BY_PACE, { slow: 0.9, normal: 1, fast: 1.1 });
  const film = (speed, pace) => ({ Pace: pace, 'Editing Options': JSON.stringify(speed === undefined ? {} : { speed }) });
  is('no speed, Pace Slow → 0.9', E.playbackSpeed(film(undefined, 'Slow')), 0.9);
  is('speed wins over Pace', E.playbackSpeed(film(1.25, 'Slow')), 1.25);
  is('speed null falls back to Pace', E.playbackSpeed(film(null, 'Fast')), 1.1);
  is('refused speed is 1, not Pace', E.playbackSpeed(film(7, 'Fast')), 1);
  is('nothing at all → 1', E.playbackSpeed(undefined), 1);
  is('Rome (speed 1, Pace Normal) → 1', E.playbackSpeed(rec('Fetch Project Info')[0].fields), 1);
  const derive = fs.readFileSync(path.join(repo, 'platform/lib/data/derive.ts'), 'utf8');
  ok('the site resolves speed in the same order (Editing Options first, then Pace)',
    /opts\.speed === undefined \|\| opts\.speed === null\s*\?\s*normalizeSpeed\(r\.paceRaw\)\s*:\s*normalizeSpeed\(opts\.speed\)/.test(derive));
}

// ---------------------------------------------------------------------------
const total = passed + failed;
console.log(`\n${failed || total === 0 ? 'RESULT: FAIL' : 'RESULT: OK'} ${passed}/${total}`);
if (failed || total === 0) process.exit(1);
