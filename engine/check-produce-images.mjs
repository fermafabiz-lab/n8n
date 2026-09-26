// The production pass's IMAGE stage: src/produce/images.ts against the LIVE
// Media Generation nodes (fixtures/produce-images/, version in its manifest).
//
//   node --experimental-strip-types check-produce-images.mjs      (in npm run check)
//
// Each function runs beside its node on the same inputs, including what the node
// reads from its own PREVIOUS run (the n-1 chain), the static-data counters
// (compared after the run too) and a frozen Date.now.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as P from './src/produce/images.ts';
import * as G from './src/produce/gates.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const F = (f) => fs.readFileSync(path.join(here, 'fixtures', 'produce-images', f), 'utf8');
const EX = JSON.parse(F('expressions.json'));
const NOW = Date.parse('2026-09-26T15:00:00.000Z');
class FixedDate extends Date { static now() { return NOW; } }
let passed = 0, failed = 0;
const canon = (v) => JSON.stringify(v === undefined ? null : JSON.parse(JSON.stringify(v)));
const is = (label, got, want) => {
  if (canon(got) === canon(want)) { passed++; return; }
  failed++;
  console.log(`  FAIL ${label}\n       got  ${canon(got).slice(0, 500)}\n       want ${canon(want).slice(0, 500)}`);
};
const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
const tryRun = (f) => { try { return f(); } catch (e) { return { error: e.message }; } };

/** n8n's `$`: nodes[name] = json | [json…] (for .all()); prevRuns[name] = the json of the run before this one. */
function n8n(src, { nodes = {}, prevRuns = {}, json = {}, input = [], sd = {}, runIndex = 0, executionId = 'exec-1' } = {}) {
  const $ = (n) => {
    const has = n in nodes;
    const list = () => { if (!has) throw new Error(`Node '${n}' hasn't been executed`); return (Array.isArray(nodes[n]) ? nodes[n] : [nodes[n]]).map((j) => ({ json: j })); };
    return {
      isExecuted: has,
      first: () => list()[0],
      all: (branch, run) => (run !== undefined ? (prevRuns[n] ? [{ json: prevRuns[n] }] : []) : list()),
      get item() { return list()[0]; },
    };
  };
  const $input = { all: () => input.map((j) => ({ json: j })), first: () => ({ json: input[0] }) };
  const body = src.startsWith('={{') ? `return (${src.replace(/^=\{\{\s*/, '').replace(/\s*\}\}$/, '')});` : src;
  const out = new Function('$', '$json', '$input', '$runIndex', '$getWorkflowStaticData', 'console', 'Date', '$execution', body)($, json, $input, runIndex, () => sd, { log() {} }, FixedDate, { id: executionId });
  return Array.isArray(out) && out[0] && 'json' in out[0] ? (out.length > 1 || src.includes('return out;') || src.includes('return items.slice') ? out.map((o) => o.json) : out[0].json) : out;
}
const fieldsOfQuery = (q, opts) => JSON.parse(n8n('={{ ' + q.slice(q.lastIndexOf('{{ JSON.stringify(') + 3, q.lastIndexOf(') }}') + 1) + ' }}', opts));

// --- A film ------------------------------------------------------------------------------------
const hex = (s) => Buffer.from(s).toString('hex');
const id = (acct, n) => `user:2923-email:${hex(acct)}-image:${n}`;
const A0 = 'fermafabiz@gmail.com', A1 = 'houseofvideos01@gmail.com', A2 = 'houseofvideos02@gmail.com';
const bible = { characters: [{ name: 'Livia', role: 'protagonist', visual_description: 'a woman in her forties, grey stola' }, { name: 'Cato' }], objects: [{ name: 'Grain Sack' }], locations: [{ name: 'Ostia Harbour', visual_description: 'a busy quay' }] };
const refs = { castRefs: { Livia: id(A0, 'cast-li'), Cato: id(A0, 'cast-ca') }, castSheets: { Livia: { kind: 'turnaround', url: 'https://flow/li.png?Expires=' + (NOW / 1000 + 3600) }, Cato: { kind: 'portrait', url: 'https://flow/ca.png?Expires=' + (NOW / 1000 - 10) } }, objectRefs: { 'Grain Sack': id(A0, 'obj-sack') }, locationRefs: { 'Ostia Harbour': id(A0, 'loc-ostia') }, locationPlates: { 'Ostia Harbour': { url: 'https://flow/ostia.png' } } };
const project = (editing = {}) => ({ fields: { 'Editing Options': JSON.stringify(editing), 'Story Bible': JSON.stringify(bible) } });
const S = (sid, order, fields) => ({ id: sid, createdTime: '2026-09-01T00:00:00.000Z', fields: { 'Ordine Scenă': order, ...fields } });
const scenes = [
  S('recA', 1, { 'Imagine First Frame': 'Dawn over Ostia harbour, grain ships arriving', 'Prompt Vizual': 'Livia watches the ships', 'Tag-uri Scenă': ['char:Livia', 'loc:Ostia Harbour'] }),
  S('recB', 101, { 'Imagine First Frame': 'Livia and Cato weigh a grain sack on the quay', 'Tag-uri Scenă': ['char:Livia', 'char:Cato', 'obj:Grain Sack', 'loc:Ostia Harbour'] }),
  S('recC', 102, { 'Prompt Vizual': 'Cato walks the empty quay at dusk' }),
  S('recD', 103, { 'Imagine First Frame': 'Livia at the scale', 'Observații Scenă': 'AUTO-REWRITE (attempt 1): refused' }),
  S('recE', 104, {}),
  S('recF', 105, { 'Imagine First Frame': 'Close on hands', 'Imagine Scenă': [{ url: 'https://x' }] }),
];

// --- Build Image Request ----------------------------------------------------------------------------
const buildCases = [];
for (const sc of scenes) {
  buildCases.push([`${sc.id} plain`, sc, project(refs), {}, null, {}, '16:9']);
  buildCases.push([`${sc.id} cinematic with prev`, sc, project({ ...refs, category: 'cinematic' }), {}, { mediaId: id(A0, 'prev'), rawPrompt: 'Dawn over Ostia harbour, grain ships arriving', locTags: ['Ostia Harbour'] }, {}, '9:16']);
}
buildCases.push(['prev, dissimilar prompt', scenes[1], project(refs), {}, { mediaId: id(A0, 'prev'), rawPrompt: 'A completely different sentence about mountains' }, {}, '16:9']);
buildCases.push(['prev, near-identical prompt drops it', scenes[1], project(refs), {}, { mediaId: id(A0, 'prev'), rawPrompt: 'Livia and Cato weigh a grain sack on the quay' }, {}, '16:9']);
buildCases.push(['strict re-roll', scenes[1], project(refs), {}, null, { consistencyRerolls: { recB: 1 }, consistencyNotes: { recB: 'identity 0.3: wrong face' } }, '16:9']);
buildCases.push(['user photo, stored', scenes[0], project({ ...refs, refImageMediaId: id(A0, 'user') }), {}, null, {}, '16:9']);
buildCases.push(['user photo, this pass', scenes[0], project(refs), { refImageMediaId: id(A0, 'user2'), castRefs: { Livia: id(A0, 'fresh-li') } }, null, {}, '16:9']);
buildCases.push(['flow email given', scenes[2], project(refs), {}, null, {}, '16:9', A2]);
buildCases.push(['malformed options', scenes[1], { fields: { 'Editing Options': '{', 'Story Bible': '' } }, {}, null, {}, '16:9']);
for (const [label, scene, proj, ov, prev, sd0, aspect, email] of buildCases) {
  const nodes = { 'Receive Batch Input': { Aspect_Ratio: aspect, ...(email ? { Flow_Email: email } : {}) }, 'IMG Load Project': proj };
  if (ov.refImageMediaId) nodes['Save User Ref Id'] = { media_id: ov.refImageMediaId };
  if (ov.castRefs) nodes['Save Cast Refs'] = { cast_refs: ov.castRefs };
  const prevRuns = prev ? { 'Decode Scene Image': { mediaId: prev.mediaId }, 'Build Image Request': { rawPrompt: prev.rawPrompt, ...(prev.locTags ? { locTags: prev.locTags } : {}) } } : {};
  const sdLive = clone(sd0), sdTs = clone(sd0);
  const live = tryRun(() => n8n(F('Build Image Request.js'), { json: clone(scene), nodes, prevRuns, sd: sdLive, runIndex: prev ? 1 : 0 }));
  const ts = tryRun(() => P.buildImageRequest({ scene: clone(scene), aspectRatio: aspect, flowEmail: email, projectFields: proj.fields, overrides: ov, prev, state: sdTs }));
  is(`build: ${label}`, ts, live);
  is(`build state: ${label}`, sdTs, sdLive);
}
is('needs image', scenes.map((s) => P.needsImage(s)), scenes.map((s) => n8n(EX.needsImage, { json: s })));

// --- IMG Account + Generate Scene Image ----------------------------------------------------------------
const assign = [{ id: 'recA', flowEmail: A0 }, { id: 'recB', flowEmail: A1 }, { id: 'recC', flowEmail: A2 }, { id: 'recD', flowEmail: A1 }];
for (const [label, sceneId, avoid] of [['block free', 'recB', {}], ['block avoided', 'recB', { [A1]: NOW + 1000 }], ['all avoided', 'recB', { [A0]: NOW + 1, [A1]: NOW + 1, [A2]: NOW + 1 }], ['avoid expired', 'recB', { [A1]: NOW - 1 }], ['unknown scene', 'recZ', {}]]) {
  const sd = { imgAvoid: avoid };
  is(`img account: ${label}`, P.imgAccount(sceneId, assign, clone(sd), NOW), n8n(F('IMG Account.js'), { nodes: { 'Build Image Request': { sceneId }, 'Assign Accounts': assign }, sd: clone(sd) }));
}
{
  const src = P.buildImageRequest({ scene: scenes[1], aspectRatio: '16:9', projectFields: project(refs).fields, prev: { mediaId: id(A2, 'prev') }, state: {} });
  const fresh = { [A1]: { [id(A0, 'cast-li')]: id(A1, 'cast-li-copy') } };
  const stored = { [A1]: { [id(A0, 'loc-ostia')]: id(A1, 'loc-copy'), [id(A0, 'cast-li')]: id(A1, 'stale') } };
  for (const [label, chosen, fr, st] of [['on its block with copies', { sceneId: 'recB', imgAccount: A1 }, fresh, stored], ['failed over to manager', { sceneId: 'recB', imgAccount: A0 }, {}, {}], ['no choice made', null, {}, stored], ['choice for another scene', { sceneId: 'recX', imgAccount: A2 }, fresh, {}]]) {
    const nodes = { 'Build Image Request': src, 'Assign Accounts': assign, 'IMG Load Project': { fields: { 'Editing Options': JSON.stringify({ flowRefs: st }) } }, 'Build Flow Refs': { flowRefs: fr } };
    if (chosen) nodes['IMG Account'] = chosen;
    is(`generate body: ${label}`, P.generateBody(clone(src), assign, chosen, { fresh: fr, stored: st }), n8n(EX.generate, { nodes }));
  }
}

// --- Decode, error routing, the refusal ladder ----------------------------------------------------------
for (const [label, resp] of [['a picture', { media: [{ image: { generatedImage: { fifeUrl: 'https://f/x.png', mediaGenerationId: id(A0, 'new') } } }] }], ['silent refusal', { media: [{ image: { generatedImage: { prompt: 'x', seed: 1 } } }] }], ['empty', {}]]) {
  is(`decode: ${label}`, tryRun(() => P.decodeSceneImage(resp, 'recB')), tryRun(() => n8n(F('Decode Scene Image.js'), { json: resp, nodes: { 'Build Image Request': { sceneId: 'recB' } } })));
}
for (const [label, err] of [
  ['captcha', { error: { message: '403 - captcha_quality: PUBLIC_ERROR_UNUSUAL_ACTIVITY' } }],
  ['traffic', { error: { message: '429 TOO_MUCH_TRAFFIC' } }],
  ['people filter', { error: { message: '400 PUBLIC_ERROR_PROMINENT_PEOPLE_FILTER_FAILED' } }],
  ['silent', { error: { message: 'FLOW_NO_IMAGE — …' } }],
  ['minor', { error: { description: 'MINOR detected' } }],
  ['timeout', { error: { message: 'ETIMEDOUT' } }],
  ['credits', { error: { message: 'insufficient credits' } }],
  ['402 code', { error: { httpCode: 402 } }],
  ['status in text', { error: { message: 'x "httpCode":"503" y' } }],
]) {
  is(`route: ${label}`, tryRun(() => P.routeImageError(clone(err))), tryRun(() => n8n(F('IMG Error Router.js'), { input: [clone(err)] })));
}
for (const [label, scene, err, sd0] of [
  ['first people refusal', scenes[1], { error: { message: 'PROMINENT' } }, {}],
  ['silent refusal', scenes[1], { error: { message: 'FLOW_NO_IMAGE' } }, {}],
  ['already noted', scenes[3], { error: { message: 'MINOR' } }, {}],
  ['fifth: give up', scenes[1], { error: { message: 'FILTER' } }, { imgRewrites: { recB: 4 } }],
]) {
  const sdLive = clone(sd0), sdTs = clone(sd0);
  const live = n8n(F('Prep Flow Reject.js'), { json: err, nodes: { 'Loop Images': scene, 'Build Image Request': { rawPrompt: 'the prompt that was sent' } }, sd: sdLive });
  const ts = P.prepFlowReject(scene, err, 'the prompt that was sent', sdTs);
  is(`flow reject: ${label}`, ts, live);
  is(`flow reject state: ${label}`, sdTs, sdLive);
  is(`rewrite body: ${label}`, P.rewritePromptBody(ts), n8n(EX.rewrite, { json: ts }));
  for (const answer of [{ choices: [{ message: { content: '  A calm quay, no faces.  ' } }] }, {}]) {
    is(`rewritten fields: ${label} ${JSON.stringify(answer).slice(0, 20)}`, P.rewrittenFields(ts, answer), fieldsOfQuery(EX.applyRewritten, { json: answer, nodes: { 'Prep Flow Reject': ts } }));
  }
  is(`rejected fields: ${label}`, P.rejectedFields(ts), fieldsOfQuery(EX.markRejected, { json: ts, nodes: { 'Loop Images': scene } }));
}

// --- IMG Cooldown Guard -----------------------------------------------------------------------------------
for (const [label, err, used, sd0] of [
  ['throttled, alternative free', { imgThrottled: true, error: { message: '403 UNUSUAL' } }, A1, {}],
  ['throttled, everyone avoided', { imgThrottled: true, lastError: 'x' }, A1, { imgAvoid: { [A0]: NOW + 5, [A2]: NOW + 5 } }],
  ['throttled, fifth hold', { imgThrottled: true }, A1, { imgCooldowns: { recB: 4 }, imgAvoid: { [A0]: NOW + 5, [A2]: NOW + 5 } }],
  ['not throttled', { error: { message: '503' } }, A1, {}],
  ['over the cap', { error: { message: '503' } }, A1, { imgCooldowns: { recB: 20 } }],
  ['no account used', { imgThrottled: true }, '', {}],
]) {
  const sdLive = clone(sd0), sdTs = clone(sd0);
  const nodes = { 'Build Image Request': { sceneId: 'recB' }, 'Assign Accounts': assign };
  if (used) nodes['IMG Account'] = { imgAccount: used };
  is(`cooldown: ${label}`, tryRun(() => P.imgCooldown('recB', clone(err), used, assign, sdTs, NOW)), tryRun(() => n8n(F('IMG Cooldown Guard.js'), { input: [clone(err)], nodes, sd: sdLive })));
  is(`cooldown state: ${label}`, sdTs, sdLive);
}

// --- The consistency judge --------------------------------------------------------------------------------
{
  const dec = { sceneId: 'recB', url: 'https://flow/new.png', mediaId: id(A0, 'new') };
  for (const [label, sceneIdx, proj, ov] of [['cast + place', 1, project(refs), {}], ['no refs', 4, project({}), {}], ['user photo', 0, project({ ...refs, refImageMediaId: id(A0, 'u'), refImage: 'https://site/photo.jpg' }), {}], ['this pass\'s sheets', 1, project({ ...refs, castSheets: {} }), { castSheets: refs.castSheets, locationPlates: refs.locationPlates }]]) {
    const req = tryRun(() => P.buildImageRequest({ scene: scenes[sceneIdx], aspectRatio: '16:9', projectFields: proj.fields, state: {} }));
    if (req.error) continue;
    const nodes = { 'Build Image Request': req, 'IMG Load Project': proj };
    if (ov.castSheets) nodes['Save Cast Refs'] = { cast_sheets: ov.castSheets };
    if (ov.locationPlates) nodes['Save Set Plates'] = { location_plates: ov.locationPlates };
    const ts = P.judgePrep(dec, req, proj.fields, ov, NOW);
    is(`judge prep: ${label}`, ts, n8n(F('Judge Prep.js'), { json: dec, nodes }));
    if (!ts.skip) is(`judge request: ${label}`, ts.body, n8n(EX.judgeRequest, { json: ts }));
  }
  const answer = (o) => ({ choices: [{ message: { content: typeof o === 'string' ? o : JSON.stringify(o) } }] });
  for (const [label, prep, ans, sd0] of [
    ['ok', { skip: false }, answer({ identity: 0.9, wardrobe: 0.8, place: 0.9, sheet_leak: false }), {}],
    ['identity drift', { skip: false }, answer({ identity: 0.3, wardrobe: 0.9, problems: ['wrong face', 'b', 'c', 'd', 'e'] }), {}],
    ['sheet leak', { skip: false }, answer({ identity: 1, sheet_leak: true }), {}],
    // Between two plausible thresholds: 0.55 is drift at the live 0.6 and would pass at 0.5.
    ['identity 0.55, wardrobe 0.58', { skip: false }, answer({ identity: 0.55, wardrobe: 0.58, place: 0.56 }), {}],
    ['place exactly at threshold', { skip: false }, answer({ place: 0.55, identity: 0.6, wardrobe: 0.6 }), {}],
    ['drift after two re-rolls', { skip: false }, answer({ place: 0.1 }), { consistencyRerolls: { recB: 2 } }],
    ['unreadable', { skip: false }, answer('nope'), {}],
    ['skipped', { skip: true }, {}, {}],
  ]) {
    const sdLive = clone(sd0), sdTs = clone(sd0);
    is(`judge verdict: ${label}`, P.judgeVerdict(dec, prep, clone(ans), sdTs), n8n(F('Judge Verdict.js'), { json: clone(ans), nodes: { 'Decode Scene Image': dec, 'Judge Prep': prep }, sd: sdLive }));
    is(`judge verdict state: ${label}`, sdTs, sdLive);
  }
}
is('written image fields = Write Scene Image', P.writtenImageFields('M1'), JSON.parse(n8n(EX.writeImage, { json: { sceneId: 'recB', url: 'u', mediaId: 'M1' } })).fields);
is('the waits the engine will use are the live ones', { pace: 8, between: 2, gate: 15 }, { pace: EX.waits['Flow Pace'].amount, between: EX.waits['Wait Between Images'].amount, gate: EX.waits['Wait Image Approval'].amount });

// --- The skeleton: Sort & Cap, Assign Accounts, the gates, More Batches? ---------------------------------
{
  const row = (sid, order, f = {}, created = '2026-09-01T00:00:00.000Z') => ({ id: sid, createdTime: created, fields: { 'Ordine Scenă': order, ...f } });
  const film = [
    row('r1', 1, { 'Scene Final URL': 'https://c/1.mp4' }),
    row('r2', 101, {}),
    row('r3', 102, { 'Scene Final URL': 'https://c/3.mp4', 'Regenerează Video': true }),
    row('r4', 103, { 'Scene Final URL': 'https://c/4.mp4' }),
    row('r5', null, {}, '2026-08-31T00:00:00.000Z'),
    row('r6', 104, { 'Scene Final URL': 'drive:nope', 'Regenerează Voce': true }),
  ];
  is('sort & cap', G.sortAndCap(clone(film)).map((r) => r.id), n8n(F('Sort & Cap Scenes.js'), { input: clone(film), sd: {} }).map((r) => r.id));
  is('sort & cap: nothing approved', tryRun(() => G.sortAndCap([])), tryRun(() => n8n(F('Sort & Cap Scenes.js'), { input: [], sd: {} })));

  const acct = (a, n) => `user:2923-email:${hex(a)}-image:${n}`;
  const rows = Array.from({ length: 7 }, (_, i) => row('s' + i, 101 + i, i === 5 ? { 'Image Media ID': acct(A0, 'x') } : {}));
  const refsFor = { castRefs: { Livia: acct(A0, 'li') }, locationRefs: { Ostia: acct(A0, 'os') } };
  const copies = (a) => ({ [acct(A0, 'li')]: acct(a, 'li'), [acct(A0, 'os')]: acct(a, 'os') });
  for (const [label, editing, fresh] of [
    ['one account', { flowAccounts: 1 }, undefined],
    ['three, no refs to copy', { flowAccounts: 3 }, undefined],
    ['three, copies complete', { flowAccounts: 3, ...refsFor, flowRefs: { [A1]: copies(A1), [A2]: copies(A2) } }, undefined],
    ['three, 02 missing a copy', { flowAccounts: 3, ...refsFor, flowRefs: { [A1]: copies(A1), [A2]: { [acct(A0, 'li')]: acct(A2, 'li') } } }, undefined],
    ['three, a copy filed under the wrong account', { flowAccounts: 3, ...refsFor, flowRefs: { [A1]: copies(A2) } }, undefined],
    ['three, fresh copies this pass', { flowAccounts: 3, ...refsFor }, { [A1]: copies(A1), [A2]: copies(A2) }],
    ['flowAccounts refused', { flowAccounts: '3' }, undefined],
  ]) {
    const proj = { fields: { 'Editing Options': JSON.stringify(editing) } };
    const nodes = { 'IMG Load Project': proj };
    if (fresh) nodes['Build Flow Refs'] = { flowRefs: fresh };
    is(`assign accounts: ${label}`, G.assignAccounts(clone(rows), proj.fields, fresh).map((r) => [r.id, r.flowEmail, r.flowBlock]), n8n(F('Assign Accounts.js'), { input: clone(rows), nodes }).map((r) => [r.id, r.flowEmail, r.flowBlock]));
  }

  const att = [{ url: 'https://m/i.jpg' }];
  const gateRows = [
    row('g1', 1, { 'Aprobare Imagine': true, 'Imagine Scenă': att, 'Aprobare Voce': true, 'Voiceover URL': 'https://v/1.mp3', 'Script Scenă': 'x', 'Aprobare Video': true, 'Scene Final URL': 'https://c/1.mp4' }),
    row('g2', 101, { 'Aprobare Imagine': true, 'Imagine Scenă': att, 'Aprobare Voce': true, 'Script Scenă': '', 'Aprobare Video': true, 'Scene Final URL': 'https://c/2.mp4' }),
    row('g3', 102, { 'Aprobare Imagine': true, 'Imagine Scenă': [], 'Aprobare Voce': true, 'Voiceover URL': 'u', 'Script Scenă': 'y', 'Aprobare Video': false, 'Scene Final URL': 'https://c/3.mp4' }),
    row('g4', 103, { 'Aprobare Imagine': true, 'Imagine Scenă': att, 'Aprobare Voce': true, 'Script Scenă': 'z', 'Regenerează Imagine': true, 'Aprobare Video': true, 'Scene Final URL': '' }),
    row('gX', 900, { 'Aprobare Imagine': false }),
  ];
  const variants = [
    ['all approved', ['g1', 'g2'], gateRows, {}],
    ['an image missing its file', ['g1', 'g2', 'g3'], gateRows, {}],
    ['a voice missing its take', ['g1', 'g4'], gateRows, {}],
    ['cinematic needs no takes', ['g1', 'g4'], gateRows, { category: 'cinematic' }],
    ['duplicates and a stranger', ['g1', 'g2'], [...gateRows, gateRows[0]], {}],
    ['empty pass', [], gateRows, {}],
  ];
  for (const [label, expected, input, editing] of variants) {
    const proj = { fields: { 'Editing Options': JSON.stringify(editing), 'Story Bible': '{}' } };
    const live = n8n(F('Evaluate Image Approval.js'), { input: clone(input), nodes: { 'Sort & Cap Scenes': expected.map((x) => ({ id: x })), 'IMG Load Project': proj, 'AB Load Project': proj, 'Receive Batch Input': { Aspect_Ratio: '16:9' } } });
    const ts = G.assetGate(expected, clone(input), proj.fields);
    is(`asset gate: ${label}`, { allApproved: ts.allApproved, total: ts.total, imagesApproved: ts.imagesApproved, voicesApproved: ts.voicesApproved, flagged: ts.flagged }, { allApproved: live.allApproved, total: live.total, imagesApproved: live.imagesApproved, voicesApproved: live.voicesApproved, flagged: (live.regen || []).map((r) => r.id) });
    const liveV = n8n(F('Evaluate Video Approval.js'), { input: clone(input), nodes: { 'Sort & Cap Scenes': expected.map((x) => ({ id: x })) } });
    const tsV = G.videoGate(expected, clone(input));
    is(`video gate: ${label}`, { allApproved: tsV.allApproved, total: tsV.total, approved: tsV.approved, firstVideo: tsV.flaggedVideo[0] || null, firstVoice: tsV.flaggedVoice[0] || null }, { allApproved: liveV.allApproved, total: liveV.total, approved: liveV.approved, firstVideo: liveV.regen ? liveV.regen.id : null, firstVoice: liveV.voiceRegen ? liveV.voiceRegen.id : null });
  }

  for (const [label, rows2, pass] of [['one missing', gateRows, 0], ['none missing', gateRows.slice(0, 2), 3], ['cap reached', gateRows, 11]]) {
    is(`more passes: ${label}`, G.morePasses(clone(rows2), pass), n8n(F('More Batches?.js'), { input: clone(rows2), runIndex: pass }));
  }

  for (const [label, status, checks, flaggedIds, bounced0] of [
    ['waiting', 'Setări Finale', 3, [], []],
    ['confirmed', 'Asamblare', 3, [], []],
    ['timed out', 'Setări Finale', 481, [], []],
    ['a missed re-shoot bounces once', 'Setări Finale', 3, ['g2'], []],
    ['already bounced', 'Setări Finale', 3, ['g2'], ['g2']],
    ['empty status', '', 3, [], []],
  ]) {
    const scenesNow = gateRows.map((r) => ({ ...r, fields: { ...r.fields, 'Regenerează Video': flaggedIds.includes(r.id) } }));
    const sd = bounced0.length ? { 'sgBounced_exec-1': bounced0 } : {};
    const live = n8n(F('Settings Gate Guard.js'), { input: clone(scenesNow), nodes: { 'Fetch Final Settings': { fields: { 'Status General': status } } }, sd, runIndex: checks });
    const b = new Set(bounced0);
    is(`settings gate: ${label}`, G.settingsGate({ 'Status General': status }, clone(scenesNow), checks, b), live);
    is(`settings gate bounced: ${label}`, [...b].sort(), (sd['sgBounced_exec-1'] || []).slice().sort());
  }
}

const total = passed + failed;
console.log(`produce images: ${failed || total === 0 ? 'RESULT: FAIL' : 'RESULT: OK'} ${passed}/${total}`);
if (failed || total === 0) process.exit(1);
