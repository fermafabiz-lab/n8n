// The production pass's SETUP: src/produce/setup.ts against the LIVE Media
// Generation nodes (fixtures/produce-setup/, version in its manifest).
//
//   node --experimental-strip-types check-produce-setup.mjs      (in npm run check)
//
// Each function runs beside its node on the same inputs. The one deliberate
// difference (Save Flow Refs merges instead of replacing) is asserted as a
// difference, so it cannot quietly become the same as n8n or quietly drift.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as U from './src/produce/setup.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const F = (f) => fs.readFileSync(path.join(here, 'fixtures', 'produce-setup', f), 'utf8');
const EX = JSON.parse(F('expressions.json'));
let passed = 0, failed = 0;
const canon = (v) => JSON.stringify(v === undefined ? null : JSON.parse(JSON.stringify(v)));
const is = (label, got, want) => {
  if (canon(got) === canon(want)) { passed++; return; }
  failed++;
  console.log(`  FAIL ${label}\n       got  ${canon(got).slice(0, 600)}\n       want ${canon(want).slice(0, 600)}`);
};
const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
const tryRun = (f) => { try { return f(); } catch (e) { return { error: e.message }; } };

function n8n(src, { nodes = {}, json = {}, input = [], sd = {}, runIndex = 0, executionId = 'exec-1' } = {}) {
  const $ = (n) => {
    const has = n in nodes;
    const list = () => { if (!has) throw new Error(`Node '${n}' hasn't been executed`); return (Array.isArray(nodes[n]) ? nodes[n] : [nodes[n]]).map((j) => ({ json: j })); };
    return { isExecuted: has, first: () => list()[0], all: () => list(), get item() { return list()[0]; } };
  };
  const $input = { all: () => input.map((j) => ({ json: j })), first: () => ({ json: input[0] }) };
  const body = src.startsWith('={{') ? `return (${src.replace(/^=\{\{\s*/, '').replace(/\s*\}\}$/, '')});` : src;
  const out = new Function('$', '$json', '$input', '$runIndex', '$getWorkflowStaticData', '$execution', 'console', body)($, json, $input, runIndex, () => sd, { id: executionId }, { log() {} });
  return Array.isArray(out) && out[0] && 'json' in out[0] ? out.map((o) => o.json) : out;
}
const one = (x) => (Array.isArray(x) && x.length === 1 ? x[0] : x);
const patchOfQuery = (q, opts) => JSON.parse(n8n('={{ ' + q.slice(q.indexOf('{{ JSON.stringify(') + 3, q.indexOf(') }}') + 1) + ' }}', opts));

// --- A film -----------------------------------------------------------------------------------------------
const hex = (s) => Buffer.from(s).toString('hex');
const A0 = 'fermafabiz@gmail.com', A1 = 'houseofvideos01@gmail.com', A2 = 'houseofvideos02@gmail.com';
const fid = (acct, n) => `user:2923-email:${hex(acct)}-image:${n}`;
const bible = {
  characters: [
    { name: 'Livia Aurelia', role: 'protagonist', visual_description: 'a woman in her forties, grey stola' },
    { name: 'Cato', role: 'merchant', visual_description: 'a stout man, brown tunic' },
    { name: 'Marcus', visual_description: 'a boy of ten' },
    { name: 'Marcus Junior', visual_description: 'a toddler' },
    { name: 'Ghost', visual_description: '' },
    { name: 'Élodie', visual_description: 'a French trader, blue cloak' },
  ],
  objects: [{ name: 'Grain Ship', visual_description: 'a wide-bellied Roman freighter' }, { name: 'Scale', visual_description: 'a bronze steelyard' }, { name: 'Coin', visual_description: 'a silver denarius' }],
  locations: [{ name: 'Ostia Harbour', visual_description: 'a busy quay' }, { name: 'Granary', visual_description: 'a vaulted brick hall' }, { name: 'Nowhere', visual_description: '' }],
};
const project = (editing = {}, b = bible) => ({ fields: { 'Editing Options': JSON.stringify(editing), 'Story Bible': JSON.stringify(b) } });
const scenes = [
  { id: 's1', scene_order: 1, tags: ['char:Livia Aurelia', 'loc:Ostia Harbour', 'obj:Grain Ship'], visual_prompt: 'x' },
  { id: 's2', scene_order: 101, tags: ['char:Livia Aurelia', 'char:Cato', 'obj:Grain Ship', 'obj:Scale'], visual_prompt: '' },
  { id: 's3', scene_order: 102, tags: [], visual_prompt: 'Livia weighs grain while Cato counts coins' },
  { id: 's4', scene_order: 103, tags: null, visual_prompt: 'Marcus runs along the quay; Elodie watches' },
  { id: 's5', scene_order: 104, tags: ['char:Livia Aurelia'], visual_prompt: '' },
  { id: 's6', scene_order: 105, tags: ['loc:Granary'], visual_prompt: 'Élodie and Cato in the granary' },
  { id: '', scene_order: 106 },
];

// --- The producer's photo --------------------------------------------------------------------------------------
for (const e of [{}, { refImage: 'https://m/me.jpg' }, { refImage: 'https://m/me.jpg', refImageMediaId: 'x' }, { refImage: 'drive:me' }, null]) {
  const proj = e === null ? { fields: { 'Editing Options': '{' } } : project(e);
  is(`user ref? ${JSON.stringify(e)}`, U.userRefNeeded(proj.fields), n8n(EX['User Ref?'], { nodes: { 'IMG Load Project': proj } }));
}
is('user ref url', U.userRefUrl(project({ refImage: 'https://m/me.jpg' }).fields), n8n(EX['Download User Ref.url'], { nodes: { 'IMG Load Project': project({ refImage: 'https://m/me.jpg' }) } }));
is('user ref account', 'https://api.useapi.net/v1/google-flow/assets/' + encodeURIComponent(U.USER_REF_ACCOUNT), EX['Upload Asset To Flow.url']);
for (const [label, resp] of [['string', { mediaGenerationId: fid(A0, 'u') }], ['nested', { mediaGenerationId: { mediaGenerationId: fid(A0, 'u') } }], ['walked', { a: [{ b: 'x-asset:9' }] }], ['nothing', { ok: true }]]) {
  is(`extract asset: ${label}`, tryRun(() => U.extractAssetId(resp)), tryRun(() => one(n8n(F('Extract Asset Id.js'), { json: resp }))));
}
is('user ref patch', U.userRefPatch('m-1'), patchOfQuery(EX['Save User Ref Id.query'], { json: { mediaId: 'm-1' } }));

// --- Cast Sheet Prep ------------------------------------------------------------------------------------------------
{
  const cases = [
    ['a fresh film', project({}), scenes, {}, undefined],
    ['9:16, own email', project({}), scenes, { Aspect_Ratio: '9:16', Flow_Email: A2 }, undefined],
    ['the producer\'s photo stored', project({ refImageMediaId: fid(A0, 'me') }), scenes, {}, undefined],
    ['the photo uploaded this pass', project({}), scenes, {}, fid(A0, 'me2')],
    ['kids, clay', project({ category: 'kids', categoryOptions: { visual_style: 'clay' } }), scenes, {}, undefined],
    ['kids, unknown style falls back', project({ category: 'kids', categoryOptions: { visual_style: 'lego' } }), scenes, {}, undefined],
    ['sheets already made', project({ castRefs: { 'Livia Aurelia': 'a', Cato: 'b' }, castSheets: { 'Livia Aurelia': { kind: 'turnaround' } }, objectRefs: { 'Grain Ship': 'c' } }), scenes, {}, undefined],
    ['portrait upgraded to turnaround', project({ castRefs: { 'Livia Aurelia': 'a' }, castSheets: { 'Livia Aurelia': { kind: 'portrait' } } }), scenes, {}, undefined],
    ['no scene list: the old port', project({}), [], {}, undefined],
    ['a long film raises the lead bar', project({}), Array.from({ length: 50 }, (_, k) => ({ id: 'l' + k, tags: k < 4 ? ['char:Cato'] : (k < 6 ? ['char:Livia Aurelia'] : []), visual_prompt: '' })), {}, undefined],
    ['nothing to draw', project({}, { characters: [], objects: [] }), scenes, {}, undefined],
    ['a lead by the 10% rule', project({}), Array.from({ length: 50 }, (_, k) => ({ id: 'm' + k, tags: k < 5 ? ['char:Cato'] : [], visual_prompt: '' })), {}, undefined],
    ['a stored turnaround is never downgraded', project({ castRefs: { Cato: 'c' }, castSheets: { Cato: { kind: 'turnaround' } } }), [{ id: 'd1', tags: ['char:Cato'] }, { id: 'd2', tags: ['char:Cato'] }, { id: 'd3', tags: ['char:Marcus'] }], {}, undefined],
    ['objects are matched by their full name only', project({}, { characters: [], objects: [{ name: 'Silver Coin', visual_description: 'a denarius' }] }), [{ id: 'o1', tags: [], visual_prompt: 'a silver cup' }, { id: 'o2', tags: [], visual_prompt: 'silver light' }], {}, undefined],
    ['three object sheets at most', project({}, { characters: [], objects: ['A1x', 'B2x', 'C3x', 'D4x'].map((n) => ({ name: n, visual_description: 'd' })) }), [{ id: 'q1', tags: ['obj:A1x', 'obj:B2x', 'obj:C3x', 'obj:D4x'] }, { id: 'q2', tags: ['obj:A1x', 'obj:B2x', 'obj:C3x', 'obj:D4x'] }], {}, undefined],
    ['malformed bible', { fields: { 'Editing Options': '{}', 'Story Bible': '{' } }, scenes, {}, undefined],
    ['more than six characters', project({}, { characters: Array.from({ length: 9 }, (_, k) => ({ name: 'Char' + k, visual_description: 'd' })) }), [], {}, undefined],
  ];
  for (const [label, proj, rows, rb, saved] of cases) {
    const nodes = { 'IMG Load Project': proj, 'Load Scene Cast': rows, 'Receive Batch Input': rb };
    if (saved) nodes['Save User Ref Id'] = { media_id: saved };
    const live = n8n(F('Cast Sheet Prep.js'), { nodes });
    const ts = U.castSheetPrep({ projectFields: proj.fields, scenes: rows, flowEmail: rb.Flow_Email, aspectRatio: rb.Aspect_Ratio, savedUserRefId: saved });
    is(`cast sheet prep: ${label}`, ts, live);
    is(`cast sheet? ${label}`, ts.map((w) => !w.skip), live.map((w) => n8n(EX['Cast Sheet?'], { json: w })));
    for (const w of ts) if (!w.skip) is(`cast sheet body: ${label} ${w.name}`, U.sheetBody(w), n8n(EX['Generate Cast Sheet.jsonBody'], { json: w }));
  }
  is('sheets are drawn one at a time, 8 s apart', { batchSize: 1, batchInterval: U.SHEET_INTERVAL_MS }, EX['Generate Cast Sheet.batching'].batch);
  const prep = U.castSheetPrep({ projectFields: project({}).fields, scenes });
  const answers = prep.map((w, k) => (k === 1 ? { error: { message: 'refused' } } : { media: [{ image: { generatedImage: { mediaGenerationId: fid(A0, 'sheet' + k), fifeUrl: k === 2 ? 'data:x' : 'https://flow/s' + k + '.png' } } }] }));
  for (const [label, proj] of [['onto nothing', project({})], ['onto stored maps', project({ castRefs: { Old: 'o' }, castSheets: { Old: { id: 'o' } }, objectRefs: 'garbage' })]]) {
    const ts = U.collectCastRefs(prep, answers, proj.fields);
    is(`collect cast refs: ${label}`, ts, one(n8n(F('Collect Cast Refs.js'), { input: answers, nodes: { 'Cast Sheet Prep': prep, 'IMG Load Project': proj } })));
    is(`cast patch: ${label}`, U.castPatch(ts), patchOfQuery(EX['Save Cast Refs.query'], { json: ts }));
  }
  for (const pid of ['recAbcdefghijklmn', 'bad-id']) {
    const ts = U.ingestPrep(prep, answers, pid, false);
    is(`sheet ingest prep: ${pid}`, ts, one(n8n(F('Sheet Ingest Prep.js'), { nodes: { 'Cast Sheet Prep': prep, 'Generate Cast Sheet': answers, 'Receive Batch Input': { Project_ID: pid } } })));
    is(`sheet ingest? ${pid}`, !ts.skip, n8n(EX['Sheet Ingest?'], { json: ts }));
    if (!ts.skip) is('sheet ingest body', { field: 'sheets', projectId: ts.projectId, items: ts.items }, JSON.parse(n8n(EX['Ingest Sheets.jsonBody'], { json: ts })));
  }
  is('sheet ingest prep: nothing made', U.ingestPrep(prep, prep.map(() => ({})), 'recAbcdefghijklmn', false), one(n8n(F('Sheet Ingest Prep.js'), { nodes: { 'Cast Sheet Prep': prep, 'Generate Cast Sheet': prep.map(() => ({})), 'Receive Batch Input': { Project_ID: 'recAbcdefghijklmn' } } })));
}

// --- Set plates -------------------------------------------------------------------------------------------------------
{
  const many = { locations: Array.from({ length: 13 }, (_, k) => ({ name: 'Place' + k, visual_description: 'd' + k })) };
  for (const [label, proj, rb] of [['fresh', project({}), {}], ['9:16 own email', project({}), { Aspect_Ratio: '9:16', Flow_Email: A1 }], ['one stored', project({ locationRefs: { 'Ostia Harbour': 'x' } }), {}], ['kids felt', project({ category: 'kids', categoryOptions: { visual_style: 'felt' } }), {}], ['ten at most', project({}, many), {}], ['none', project({}, {}), {}]]) {
    const live = n8n(F('Set Plate Prep.js'), { nodes: { 'IMG Load Project': proj, 'Receive Batch Input': rb } });
    const ts = U.setPlatePrep(proj.fields, rb.Flow_Email, rb.Aspect_Ratio);
    is(`set plate prep: ${label}`, ts, live);
    is(`set plate? ${label}`, ts.map((w) => !w.skip), live.map((w) => n8n(EX['Set Plate?'], { json: w })));
    for (const w of ts) if (!w.skip) is(`plate body: ${label} ${w.name}`, U.sheetBody(w), n8n(EX['Generate Set Plate.jsonBody'], { json: w }));
  }
  const prep = U.setPlatePrep(project({}).fields);
  const answers = [{ media: [{ image: { generatedImage: { mediaGenerationId: fid(A0, 'p0'), fifeUrl: 'https://flow/p0.png' } } }] }, {}];
  for (const proj of [project({}), project({ locationRefs: { Old: 'o' }, locationPlates: null })]) {
    const ts = U.collectSetPlates(prep, answers, proj.fields);
    is('collect set plates', ts, one(n8n(F('Collect Set Plates.js'), { input: answers, nodes: { 'Set Plate Prep': prep, 'IMG Load Project': proj } })));
    is('plate patch', U.platePatch(ts), patchOfQuery(EX['Save Set Plates.query'], { json: ts }));
  }
  const ts = U.ingestPrep(prep, answers, 'recAbcdefghijklmn', true);
  is('plate ingest prep', ts, one(n8n(F('Plate Ingest Prep.js'), { nodes: { 'Set Plate Prep': prep, 'Generate Set Plate': answers, 'Receive Batch Input': { Project_ID: 'recAbcdefghijklmn' } } })));
  is('plate ingest?', !ts.skip, n8n(EX['Plate Ingest?'], { json: ts }));
  is('plate ingest body', { field: 'sheets', projectId: ts.projectId, items: ts.items }, JSON.parse(n8n(EX['Ingest Plates.jsonBody'], { json: ts })));
}

// --- Replication ----------------------------------------------------------------------------------------------------------
{
  const rows = [
    { flow_id: fid(A0, 'li'), kind: 'cast', name: 'Livia', url: 'https://m/li.png' },
    { flow_id: fid(A0, 'li'), kind: 'cast', name: 'Livia dup', url: 'https://m/li2.png' },
    { flow_id: fid(A0, 'ship'), kind: 'object', name: 'Ship', url: 'https://m/ship.png' },
    { flow_id: fid(A0, 'ostia'), kind: 'location', url: 'https://m/ostia.png' },
    { flow_id: '', url: 'https://m/x.png' },
    { flow_id: fid(A0, 'nourl'), url: null },
    { flow_id: fid(A0, 'nokind'), url: 'https://m/k.png' },
  ];
  const cases = [
    ['one account', { flowAccounts: 1 }, rows],
    ['no setting', {}, rows],
    ['two accounts', { flowAccounts: 2 }, rows],
    ['three, with the photo', { flowAccounts: 3, refImage: 'https://m/me.jpg', refImageMediaId: fid(A0, 'me') }, rows],
    ['three, some already copied', { flowAccounts: 3, flowRefs: { [A1]: { [fid(A0, 'li')]: fid(A1, 'li') } } }, rows],
    ['three, everything copied', { flowAccounts: 3, flowRefs: { [A1]: { [fid(A0, 'li')]: 1, [fid(A0, 'ship')]: 1, [fid(A0, 'ostia')]: 1, [fid(A0, 'nokind')]: 1 }, [A2]: { [fid(A0, 'li')]: 1, [fid(A0, 'ship')]: 1, [fid(A0, 'ostia')]: 1, [fid(A0, 'nokind')]: 1 } } }, rows],
    ['three, nothing stored', { flowAccounts: 3 }, []],
    ['four refused', { flowAccounts: 4 }, rows],
    ['"3" refused', { flowAccounts: '3' }, rows],
  ];
  for (const [label, e, r] of cases) {
    const live = n8n(F('Replicate Prep.js'), { input: r, nodes: { 'IMG Load Project': project(e) } });
    const ts = U.replicatePrep(project(e).fields, r);
    is(`replicate prep: ${label}`, ts, live);
    is(`replicate any? ${label}`, ts.map((w) => !!w.skip), live.map((w) => n8n(EX['Replicate Any?'], { json: w })));
  }
  // A whole replication loop: each side accumulates its own table.
  const work = U.replicatePrep(project({ flowAccounts: 3 }).fields, rows);
  const answers = work.map((w, k) => (k === 3 ? { mediaGenerationId: 'user:2923-email:6869-image:x' } : k === 0 ? { mediaGenerationId: fid(A2, 'misrouted') } : k === 1 ? { error: { message: 'boom' } } : k === 2 ? { mediaGenerationId: { mediaGenerationId: fid(w.account, 'n' + k) } } : { mediaGenerationId: fid(w.account, 'n' + k) }));
  const sd = {};
  const built = {};
  work.forEach((w, k) => {
    is(`upload url ${k}`, 'https://api.useapi.net/v1/google-flow/assets/' + encodeURIComponent(w.account), n8n('={{ ' + JSON.stringify('https://api.useapi.net/v1/google-flow/assets/') + ' + ' + EX['Upload Sheet To Account.url'].match(/\{\{(.*)\}\}/)[1] + ' }}', { nodes: { 'Replicate Prep': work }, runIndex: k }));
    is(`upload url prefix ${k}`, EX['Upload Sheet To Account.url'].startsWith('=https://api.useapi.net/v1/google-flow/assets/{{'), true);
    const live = one(n8n(F('Collect Replicated.js'), { json: answers[k], nodes: { 'Replicate Prep': work }, sd, runIndex: k, executionId: 'e9' }));
    is(`collect replicated ${k}`, U.collectReplicated(w, answers[k], built), live);
  });
  is('replicated table', built, sd.flowRefs.e9);
  const ts = U.buildFlowRefs(built);
  const live = one(n8n(F('Build Flow Refs.js'), { sd, executionId: 'e9' }));
  is('build flow refs', ts, live);
  is('build flow refs cleans static data', sd.flowRefs, {});
  is('refs to save?', [U.refsToSave(ts), U.refsToSave({ count: 0 })], [n8n(EX['Refs To Save?'], { json: ts }) > 0, n8n(EX['Refs To Save?'], { json: { count: 0 } }) > 0]);
  // THE DELIBERATE DIFFERENCE: n8n's write replaces the stored table; the engine merges into it.
  const storedProj = project({ flowRefs: { [A1]: { old: fid(A1, 'old') }, [A2]: { [fid(A0, 'li')]: fid(A2, 'stale') } } });
  const n8nPatch = patchOfQuery(EX['Save Flow Refs.query'], { json: ts });
  is('n8n replaces the stored table (the bug this port does not copy)', n8nPatch, { flowRefs: ts.flowRefs });
  const merged = U.flowRefsPatch(ts, storedProj.fields).flowRefs;
  is('engine keeps the older copies', merged[A1].old, fid(A1, 'old'));
  is('engine lets this pass win', Object.keys(ts.flowRefs[A2] || {}).every((k) => merged[A2][k] === ts.flowRefs[A2][k]), true);
  is('engine on a project with nothing stored = n8n', U.flowRefsPatch(ts, project({}).fields), n8nPatch);
}

// --- The rest of the chain -------------------------------------------------------------------------------------------------
is('load scene cast reads approved scenes in order', /s\.scene_approved[\s\S]*order by s\.scene_order/.test(EX['Load Scene Cast.query']), true);
is('load sheet media reads hov.sheet_media', /from hov\.sheet_media/.test(EX['Load Sheet Media.query']), true);
is('fetch approved scenes', /Aprobare Scenă/.test(EX['Fetch Approved Scenes.query']), true);
{
  const manifest = JSON.parse(F('manifest.json'));
  const onDisk = fs.readdirSync(path.join(here, 'fixtures', 'produce-setup')).filter((f) => f !== 'manifest.json').sort();
  is('manifest lists every fixture', Object.keys(manifest.files).sort(), onDisk);
  is('manifest version', manifest.mediaGeneration.versionId, '527c67b7-a38d-48b3-b56e-3c52cec8b0bb');
}

const total = passed + failed;
console.log(`produce setup: ${failed || total === 0 ? 'RESULT: FAIL' : 'RESULT: OK'} ${passed}/${total}`);
if (failed || total === 0) process.exit(1);
