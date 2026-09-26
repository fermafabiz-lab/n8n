// The production pass's CLIP stage: src/produce/clips.ts against the LIVE
// Media Generation nodes (fixtures/produce-clips/, version in its manifest).
//
//   node --experimental-strip-types check-produce-clips.mjs      (in npm run check)
//
// Each function runs beside its node on the same inputs, with the static-data
// counters compared after the run too and a frozen Date.now. The pool is driven
// through whole films tick by tick, each side fed the other's last state, so a
// divergence anywhere in a sequence is caught where it happens.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as C from './src/produce/clips.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const F = (f) => fs.readFileSync(path.join(here, 'fixtures', 'produce-clips', f), 'utf8');
const EX = JSON.parse(F('expressions.json'));
let NOW = Date.parse('2026-09-26T15:00:00.000Z');
class FixedDate extends Date { static now() { return NOW; } }
let passed = 0, failed = 0;
const canon = (v) => JSON.stringify(v === undefined ? null : JSON.parse(JSON.stringify(v)));
const is = (label, got, want) => {
  if (canon(got) === canon(want)) { passed++; return; }
  failed++;
  console.log(`  FAIL ${label}\n       got  ${canon(got).slice(0, 600)}\n       want ${canon(want).slice(0, 600)}`);
};
const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
const tryRun = (f) => { try { return f(); } catch (e) { return { error: e.message }; } };

/** n8n's `$`: nodes[name] = json | [json…] (for .all()). */
function n8n(src, { nodes = {}, json = {}, input = [], sd = {}, prevNode = '' } = {}) {
  const $ = (n) => {
    const has = n in nodes;
    const list = () => { if (!has) throw new Error(`Node '${n}' hasn't been executed`); return (Array.isArray(nodes[n]) ? nodes[n] : [nodes[n]]).map((j) => ({ json: j })); };
    return { isExecuted: has, first: () => list()[0], all: () => list(), get item() { return list()[0]; } };
  };
  const $input = { all: () => input.map((j) => ({ json: j })), first: () => ({ json: input[0] }) };
  const body = src.startsWith('={{') ? `return (${src.replace(/^=\{\{\s*/, '').replace(/\s*\}\}$/, '')});` : src;
  const out = new Function('$', '$json', '$input', '$getWorkflowStaticData', '$prevNode', 'console', 'Date', body)($, json, $input, () => sd, { name: prevNode }, { log() {} }, FixedDate);
  return Array.isArray(out) && out[0] && 'json' in out[0] ? (out.length > 1 || src.includes('return recs') ? out.map((o) => o.json) : out[0].json) : out;
}
const fieldsOfQuery = (q, opts) => JSON.parse(n8n('={{ ' + q.slice(q.lastIndexOf('{{ JSON.stringify(') + 3, q.lastIndexOf(') }}') + 1) + ' }}', opts));

// --- A film on three accounts ------------------------------------------------------------------------
const hex = (s) => Buffer.from(s).toString('hex');
const A0 = 'fermafabiz@gmail.com', A1 = 'houseofvideos01@gmail.com', A2 = 'houseofvideos02@gmail.com';
const img = (acct, n) => `user:2923-email:${hex(acct)}-image:${n}`;
const S = (sid, order, fields) => ({ id: sid, createdTime: '2026-09-01T00:00:00.000Z', fields: { 'Ordine Scenă': order, 'Imagine Scenă': [{ url: 'https://m/' + sid + '.png' }], 'Video Scenă URL': 'Slow push-in as Livia lifts the grain sack onto the scale and holds it there', 'Voiceover URL': 'https://m/' + sid + '.mp3', ...fields } });
const film = [
  S('recA', 1, { 'Image Media ID': img(A0, 'a') }),
  S('recB', 101, { 'Image Media ID': img(A0, 'b') }),
  S('recC', 102, { 'Image Media ID': img(A0, 'c') }),
  S('recD', 103, { 'Image Media ID': img(A0, 'd') }),
  S('recE', 104, { 'Image Media ID': img(A1, 'e') }),
  S('recF', 105, { 'Image Media ID': img(A2, 'f'), 'Scene Final URL': 'https://m/f.mp4' }),
  S('recG', 106, { 'Image Media ID': 'no-owner-here' }),
];
const assign = [{ id: 'recA', flowEmail: A0 }, { id: 'recB', flowEmail: A0 }, { id: 'recC', flowEmail: A0 }, { id: 'recD', flowEmail: A0 }, { id: 'recE', flowEmail: A1 }, { id: 'recF', flowEmail: A2 }, { id: 'recG', flowEmail: A2 }];
const project = (editing = {}) => ({ fields: { 'Editing Options': JSON.stringify(editing) } });

// --- Sort Scenes For Video, the gates on the path ------------------------------------------------------
{
  const expected = ['recC', 'recA', 'recB'];
  for (const [label, rows] of [['ordered, deduped, foreign dropped', [film[0], film[1], film[2], film[0], S('recZ', 9, {})]], ['one missing its image', [film[0], { ...film[1], fields: { ...film[1].fields, 'Imagine Scenă': [] } }, film[2]]], ['empty', []]]) {
    is(`sort for video: ${label}`, tryRun(() => C.sortScenesForVideo(expected, clone(rows))), tryRun(() => n8n(F('Sort Scenes For Video.js'), { input: clone(rows), nodes: { 'Sort & Cap Scenes': expected.map((id) => ({ id })) } })));
  }
}
for (const e of [{}, { videoPool: true }, { videoPool: 'true' }, null]) {
  const proj = e === null ? { fields: { 'Editing Options': '{' } } : project(e);
  is(`video pool? ${JSON.stringify(e)}`, C.videoPoolOn(proj.fields), n8n(EX['Video Pool?'], { nodes: { 'IMG Load Project': proj } }));
}
for (const r of film) {
  is(`needs clip ${r.id}`, C.needsClip(r), n8n(EX['Needs Clip?'], { json: r }));
  is(`pool action ${r.id}`, n8n(EX['Pool Action?'], { json: { poolAction: 'poll' } }), true);
}
for (const j of [{ error: 'PROMINENT_PEOPLE' }, { x: { status: 'MINOR' } }, { a: 'AUDIO_GENERATION_FILTERED' }, { e: 'SAFETY' }, { error: 'VIDEO_GENERATION_TIMED_OUT' }]) {
  is(`filter failure ${JSON.stringify(j)}`, C.isFilterFailure(j), n8n(EX['Filter Failure?'], { json: j }));
}
is('waits', { firstPoll: C.WAITS.firstPoll, poll: C.WAITS.poll, pool: C.WAITS.pool, cooldown: C.WAITS.cooldown, imageWait: C.WAITS.imageWait },
  { firstPoll: EX.waits['Wait Video'], poll: EX.waits['Wait Retry'], pool: EX.waits['Pool Wait'], cooldown: EX.waits['Wait Submit Cooldown'], imageWait: EX.waits['VP Image Wait'] });

// --- Current Scene -------------------------------------------------------------------------------------------------
{
  const cases = [
    ['plain body scene', film[1], {}, {}, { Aspect_Ratio: '16:9' }],
    ['hook scene gets Fast', film[0], {}, {}, { Aspect_Ratio: '9:16', Flow_Email: A1 }],
    ['hook model switched off with free', film[0], { hookVideoModel: 'veo-3.1-lite-low-priority' }, {}, {}],
    ['hook model empty string', film[0], { hookVideoModel: '' }, {}, {}],
    ['paid base, hook ignored', film[0], { videoModel: 'veo-3.1-quality' }, {}, {}],
    ['takes as text', S('recT', 107, { 'Versiuni Media': JSON.stringify([{ kind: 'video' }, { kind: 'image' }, { kind: 'video' }]), 'Image Media ID': img(A0, 't') }), {}, {}, {}],
    ['takes as array', S('recT', 107, { 'Versiuni Media': [{ kind: 'video' }], 'Image Media ID': img(A0, 't') }), {}, {}, {}],
    ['takes garbage', S('recT', 107, { 'Versiuni Media': '[{', 'Image Media ID': img(A0, 't') }), {}, {}, {}],
    ['refused twice: a fresh seed', film[2], {}, { rewrites: { recC: 2 } }, {}],
    ['legacy Negative tail stripped', S('recN', 108, { 'Video Scenă URL': 'A cart rolls out of the gate.  Negative: no reversed motion, no oncoming vehicles' }), {}, {}, {}],
    ['order 0 is not a hook', S('recO', 0, {}), {}, {}, {}],
    ['malformed options', film[1], null, {}, {}],
  ];
  for (const [label, row, e, sd0, rb] of cases) {
    const proj = e === null ? { fields: { 'Editing Options': '{' } } : project(e);
    const sdLive = clone(sd0), sdTs = clone(sd0);
    is(`current scene: ${label}`, C.currentScene(clone(row), rb, proj.fields, sdTs), n8n(F('Current Scene.js'), { json: clone(row), nodes: { 'Receive Batch Input': rb, 'IMG Load Project': proj }, sd: sdLive }));
    is(`current scene state: ${label}`, sdTs, sdLive);
  }
}

// --- The pool, driven tick by tick ------------------------------------------------------------------------------
function tickBoth(label, pool, ctx) {
  const nodes = { 'IMG Load Project': { fields: ctx.projectFields }, 'Assign Accounts': ctx.assignments, 'Sort Scenes For Video': ctx.sortRows };
  NOW = ctx.now;
  const live = tryRun(() => n8n(F('Pool Tick.js'), { json: pool ? { pool: clone(pool) } : clone(ctx.input[0] || {}), input: clone(ctx.input), nodes }));
  const ts = tryRun(() => C.poolTick(clone(pool) || null, clone(ctx)));
  is(`pool tick: ${label}`, ts, live);
  return ts;
}
function recordBoth(label, pool, from, scene, x) {
  NOW = x.now;
  const nodes = { 'Pool Tick': { pool: clone(pool) }, 'Current Scene': clone(scene) };
  if (x.jobid !== undefined) nodes['Submit Video'] = { jobid: x.jobid };
  const live = tryRun(() => n8n(F('Pool Record.js'), { nodes, prevNode: from, input: [clone(x.guard || {})] }));
  const ts = tryRun(() => C.poolRecord(clone(pool), from, clone(scene), clone(x)));
  is(`pool record: ${label}`, ts, live);
  return ts && ts.pool;
}
{
  // One film, three accounts: the manager's block is long, so the other two go idle and steal.
  const rows = [film[1], film[2], film[3], film[4], film[5], film[6], S('recH', 109, { 'Image Media ID': img(A0, 'h') })];
  let t = NOW;
  const ctx = (extra = {}) => ({ input: rows, sortRows: rows, projectFields: project({ videoPool: true, ...extra.opts }).fields, assignments: assign, now: t, ...extra });
  let out = tickBoth('first tick builds the queue and submits', null, ctx());
  let pool = out.pool;
  const cs = (id) => C.currentScene(rows.find((r) => r.id === id), { Aspect_Ratio: '16:9' }, project({}).fields, {});
  // Submit recB → job.
  pool = recordBoth('recB accepted', pool, 'Pool Submitted?', { ...cs('recB'), poolAccount: A0 }, { jobid: 'job-b', now: t });
  out = tickBoth('second tick submits the next account', pool, ctx()); pool = out.pool;
  pool = recordBoth(`${out.poolSceneId} accepted`, pool, 'Pool Submitted?', { ...cs(out.poolSceneId), poolAccount: out.poolAccount }, { jobid: 'job-' + out.poolSceneId, now: t });
  out = tickBoth('third tick: the third account (G, no owner → its block)', pool, ctx()); pool = out.pool;
  pool = recordBoth(`${out.poolSceneId} accepted`, pool, 'Pool Submitted?', { ...cs(out.poolSceneId), poolAccount: out.poolAccount }, { jobid: '', now: t });
  out = tickBoth('every slot full, nothing due: wait', pool, ctx()); pool = out.pool;
  t += 20000;
  out = tickBoth('20 s later: poll the stalest', pool, ctx()); pool = out.pool;
  pool = recordBoth('still running', pool, 'Pool Retry?', cs(out.poolSceneId), { now: t });
  out = tickBoth('poll the other', pool, ctx()); pool = out.pool;
  pool = recordBoth('the clip landed', pool, 'Update Scene Record', cs(out.poolSceneId), { now: t });
  out = tickBoth('an idle account steals from the manager', pool, ctx()); pool = out.pool;
  const steal = out;
  const stealLive = n8n(F('Steal Record.js'), { json: { mediaGenerationId: img(steal.poolTo, 'copy') }, nodes: { 'Pool Tick': clone(steal) } });
  const stealTs = C.stealRecord(clone(steal), { mediaGenerationId: img(steal.poolTo, 'copy') });
  is('steal record: landed on the target', stealTs, stealLive);
  pool = stealTs.pool;
  out = tickBoth('the stolen scene is submitted on its new account', pool, ctx()); pool = out.pool;
  const stolenCs = { ...cs(out.poolSceneId), poolAccount: out.poolAccount };
  is('submit body: a stolen still', C.submitVideoBody(stolenCs, { assignments: assign, tick: out }), n8n(EX['Submit Video.jsonBody'], { nodes: { 'Current Scene': stolenCs, 'Assign Accounts': assign, 'Pool Tick': out } }));
  // Its submit is refused: back to the head of the queue, its account rests.
  const g = C.submitCooldownGuard(out.poolSceneId, { error: { message: '429' } }, {}, { inPool: true, now: t });
  pool = recordBoth('refused submit rests the account', pool, 'Pool Cooldown?', stolenCs, { guard: g, now: t });
  out = tickBoth('resting account is skipped', pool, ctx()); pool = out.pool;
  t += 61000;
  out = tickBoth('a minute later', pool, ctx()); pool = out.pool;
  pool = recordBoth('given up', pool, 'Pool Cooldown?', { ...cs('recH'), poolAccount: A0 }, { guard: { giveUp: true }, now: t });
  pool = recordBoth('filter rejection settles it', pool, 'Mark Video Prompt Rejected', cs('recD'), { now: t });
  pool = recordBoth('already had a clip', pool, 'Needs Clip?', cs('recC'), { now: t });
  // Drain: everything left resolves.
  for (let i = 0; i < 12; i++) {
    t += 25000;
    out = tickBoth(`drain ${i}`, pool, ctx()); pool = out.pool;
    if (out.poolAction === 'done') break;
    if (out.poolAction === 'wait') continue;
    if (out.poolAction === 'steal') { pool = C.stealRecord(out, { error: { message: 'boom' } }).pool; continue; }
    const from = out.poolAction === 'submit' ? 'Pool Submitted?' : 'Update Scene Record';
    pool = recordBoth(`drain ${i} ${from}`, pool, from, { ...cs(out.poolSceneId), poolAccount: out.poolAccount }, { jobid: 'j' + i, now: t });
  }
  is('the pool finished', out.poolAction, 'done');
}
{
  // Edge ticks.
  const rows = [film[1], film[2]];
  const base = { input: rows, sortRows: rows, assignments: assign, now: NOW };
  for (const [label, o] of [['per account 2', { videoPoolPerAccount: 2 }], ['per account 9 refused', { videoPoolPerAccount: 9 }], ['per account "2" refused', { videoPoolPerAccount: '2' }]]) {
    tickBoth(label, null, { ...base, projectFields: project(o).fields });
  }
  const polledOut = { per: 1, queue: [], inflight: [{ id: 'recB', account: A0, jobid: 'j', polls: 90, lastPollAt: 0 }], done: [], ticks: 3, accounts: [A0], stolen: {} };
  tickBoth('a clip polled 90 times is dropped', polledOut, { ...base, projectFields: project({}).fields });
  tickBoth('a scene missing from the sort throws', { per: 1, queue: [{ id: 'recQ', account: A0 }], inflight: [], done: [], ticks: 0, accounts: [A0], stolen: {} }, { ...base, projectFields: project({}).fields });
  tickBoth('the fresh still rides on the row', { per: 1, queue: [{ id: 'recB', account: A0 }], inflight: [], done: [], ticks: 0, accounts: [A0], stolen: {}, freshImage: { recB: img(A0, 'fresh') } }, { ...base, projectFields: project({}).fields });
  const noStill = [S('recB', 101, { 'Image Media ID': '' }), S('recC', 102, {}), S('recX', 103, {})];
  tickBoth('steal of a scene with no still', { per: 1, queue: [{ id: 'recC', account: A0 }, { id: 'recB', account: A0 }], inflight: [{ id: 'recX', account: A0, jobid: 'j', polls: 0, lastPollAt: NOW }], done: [], ticks: 0, accounts: [A0, A1], stolen: {} }, { input: noStill, sortRows: noStill, assignments: assign, now: NOW, projectFields: project({}).fields });
  tickBoth('only one queued on the donor: no steal', { per: 1, queue: [{ id: 'recB', account: A0 }], inflight: [{ id: 'recX', account: A0, jobid: 'j', polls: 0, lastPollAt: NOW }], done: [], ticks: 0, accounts: [A0, A1], stolen: {} }, { ...base, projectFields: project({}).fields });
}
for (const [label, resp, to] of [['wrong account', { mediaGenerationId: img(A0, 'x') }, A1], ['nested id', { mediaGenerationId: { mediaGenerationId: img(A1, 'x') } }, A1], ['no queue entry', { mediaGenerationId: img(A1, 'x') }, A1]]) {
  const tick = { poolAction: 'steal', poolSceneId: label === 'no queue entry' ? 'recZ' : 'recB', poolFrom: A0, poolTo: to, poolImageId: img(A0, 'b'), pool: { per: 1, queue: [{ id: 'recB', account: A0 }], inflight: [], done: [], ticks: 1, accounts: [A0, A1], stolen: {} } };
  is(`steal record: ${label}`, C.stealRecord(clone(tick), resp), n8n(F('Steal Record.js'), { json: resp, nodes: { 'Pool Tick': clone(tick) } }));
}
is('steal record: no pool', tryRun(() => C.stealRecord({}, {})), tryRun(() => n8n(F('Steal Record.js'), { json: {}, nodes: { 'Pool Tick': {} } })));
is('pool record: pool off passes through', C.poolRecord(null, 'Pool Retry?', {}, { now: NOW }), null);
{
  const pool = { per: 1, queue: [], inflight: [{ id: 'recB', account: A1, jobid: 'old', polls: 7, lastPollAt: 1 }], done: [], ticks: 4, accounts: [A0, A1], stolen: {} };
  const reloaded = C.currentScene(film[1], {}, project({}).fields, {});
  recordBoth('a motion re-roll keeps the account', pool, 'Pool Submitted?', reloaded, { jobid: 'new', now: NOW });
  recordBoth('a cooldown for a still that changed after the ladder', pool, 'Pool Cooldown?', { ...reloaded, videoRequest: { startImage: img(A2, 'new') } }, { guard: { giveUp: false, cooldown: 2 }, now: NOW });
  recordBoth('a cooldown with a stolen still', { ...pool, stolen: { recB: { image: img(A2, 'c'), account: A2 } } }, 'Pool Cooldown?', reloaded, { guard: {}, now: NOW });
}

// --- The end frame ---------------------------------------------------------------------------------------------------
{
  const cases = [
    ['off by default', film[1], {}, {}],
    ['a string "true" stays off', film[1], { endFrame: 'true' }, {}],
    ['opted in', film[1], { endFrame: true }, {}],
    ['opted in, paused', film[1], { endFrame: true }, { endFrameOffAt: NOW - 1000 }],
    ['opted in, pause expired', film[1], { endFrame: true }, { endFrameOffAt: NOW - 7 * 3600 * 1000 }],
    ['no start frame', S('recX', 110, {}), { endFrame: true }, {}],
    ['no motion', S('recX', 110, { 'Image Media ID': img(A0, 'x'), 'Video Scenă URL': 'Negative: stuff' }), { endFrame: true }, {}],
  ];
  for (const [label, row, e, sd0] of cases) {
    for (const rb of [{ Aspect_Ratio: '16:9' }, { Aspect_Ratio: '9:16', Flow_Email: A2 }]) {
      const cs = C.currentScene(row, rb, project(e).fields, {});
      is(`end frame prompt: ${label} ${rb.Aspect_Ratio}`, C.endFramePrompt(cs, rb, project(e).fields, clone(sd0), NOW), n8n(F('End Frame Prompt.js'), { nodes: { 'Current Scene': cs, 'Receive Batch Input': rb, 'IMG Load Project': project(e) }, sd: clone(sd0) }));
    }
  }
  for (const [label, src] of [['owner wins', { sceneId: 'recE', requestBody: { email: A0, reference_1: img(A2, 'e') } }], ['block account', { sceneId: 'recE', requestBody: { email: A0, reference_1: 'x' } }], ['unknown scene', { sceneId: 'recZ', requestBody: { email: A0 } }]]) {
    is(`end frame body: ${label}`, C.endFrameBody(src, assign), n8n(EX['Generate End Frame.jsonBody'], { nodes: { 'End Frame Prompt': src, 'Assign Accounts': assign } }));
  }
  for (const [label, resp] of [['a frame', { media: [{ image: { generatedImage: { mediaGenerationId: img(A0, 'end') } } }] }], ['error envelope', { error: { message: 'refused' } }], ['error string', { error: 'x' }], ['no id', { media: [] }], ['null', null]]) {
    is(`attach end frame: ${label}`, C.attachEndFrame('recB', resp), n8n(F('Attach End Frame.js'), { json: resp, nodes: { 'End Frame Prompt': { sceneId: 'recB' } } }));
  }
}

// --- Submit Video ------------------------------------------------------------------------------------------------------
{
  const csB = C.currentScene(film[1], { Aspect_Ratio: '16:9' }, project({}).fields, {});
  const csE = C.currentScene(film[4], { Aspect_Ratio: '9:16' }, project({}).fields, {});
  const csG = C.currentScene(film[6], {}, project({}).fields, {});
  const correction = C.motionResubmit({ sceneId: 'recB', attempt: 1, problems: ['permanence 0.2'] }, csB, {});
  const cases = [
    ['manager keeps the free model', csB, {}],
    ['invited account moves to lite', csE, {}],
    ['no owner: the block account', csG, {}],
    ['end frame attached', csB, { attached: { sceneId: 'recB', endImage: img(A0, 'end') } }],
    ['end frame of another scene', csB, { attached: { sceneId: 'recA', endImage: img(A0, 'end') } }],
    ['cooldown drops the end frame', csB, { attached: { sceneId: 'recB', endImage: 'e' }, guard: { sceneId: 'recB', dropEndFrame: true } }],
    ['motion re-roll: seed and correction', csB, { resubmit: correction }],
    ['motion re-roll on a stale prompt', csB, { resubmit: { ...correction, basePrompt: 'something older' } }],
    ['motion re-roll, morph drops the end frame', csB, { attached: { sceneId: 'recB', endImage: 'e' }, resubmit: { sceneId: 'recB', seed: 7, dropEndFrame: true } }],
    ['re-roll for another scene', csB, { resubmit: { ...correction, sceneId: 'recC' } }],
  ];
  for (const [label, cs, x] of cases) {
    const nodes = { 'Current Scene': cs, 'Assign Accounts': assign };
    if (x.attached) nodes['Attach End Frame'] = x.attached;
    if (x.guard) nodes['Submit Cooldown Guard'] = x.guard;
    if (x.resubmit) nodes['Motion Resubmit'] = x.resubmit;
    is(`submit body: ${label}`, C.submitVideoBody(cs, { assignments: assign, ...x }), n8n(EX['Submit Video.jsonBody'], { nodes }));
  }
  const cooldowns = [
    ['serial, first', 'recB', { error: { message: '403 captcha' } }, false, null, {}],
    ['serial, past the ceiling throws', 'recB', { message: 'x' }, false, null, { submitCooldowns: { recB: 20 } }],
    ['pool, past the ceiling gives up', 'recB', { status: 500 }, true, null, { submitCooldowns: { recB: 20 } }],
    ['end frame named in the refusal', 'recB', { error: { description: 'endImage not supported for I2V' } }, true, { sceneId: 'recB', endImage: 'e' }, {}],
    ['third end-frame failure in the hour', 'recB', { error: { message: '500' } }, false, { sceneId: 'recB', endImage: 'e' }, { endFrameFails: 2, endFrameFailAt: NOW - 1000 }],
    ['old failures forgotten', 'recB', { error: { message: '500' } }, false, { sceneId: 'recB', endImage: 'e' }, { endFrameFails: 2, endFrameFailAt: NOW - 2 * 3600 * 1000 }],
    ['another scene\'s end frame', 'recB', { error: { message: 'i2v' } }, false, { sceneId: 'recA', endImage: 'e' }, {}],
  ];
  for (const [label, sceneId, err, inPool, attached, sd0] of cooldowns) {
    const nodes = { 'Current Scene': { id: sceneId } };
    if (inPool) nodes['Pool Tick'] = { pool: { per: 1 } };
    if (attached) nodes['Attach End Frame'] = attached;
    const sdLive = clone(sd0), sdTs = clone(sd0);
    is(`cooldown: ${label}`, tryRun(() => C.submitCooldownGuard(sceneId, err, sdTs, { inPool, attached, now: NOW })), tryRun(() => n8n(F('Submit Cooldown Guard.js'), { input: [err], nodes, sd: sdLive })));
    is(`cooldown state: ${label}`, sdTs, sdLive);
    const g = tryRun(() => C.submitCooldownGuard(sceneId, err, clone(sd0), { inPool, attached, now: NOW }));
    if (!g.error) is(`pool cooldown? ${label}`, Boolean(g.inPool), n8n(EX['Pool Cooldown?'], { json: g }));
  }
  is('pool submitted? on', n8n(EX['Pool Submitted?'], { nodes: { 'Pool Tick': { pool: {} } } }), true);
  is('pool submitted? off', n8n(EX['Pool Submitted?'], { nodes: {} }), false);
  is('pool retry? off', n8n(EX['Pool Retry?'], { nodes: {} }), false);
  is('pool return?', [n8n(EX['Pool Return?'], { json: { pool: {} } }), n8n(EX['Pool Return?'], { json: {} })], [true, false]);
}

// --- Polling, failures ----------------------------------------------------------------------------------------------------
for (const [label, item, sd0] of [
  ['completed', { status: 'COMPLETED' }, {}],
  ['a video url is done', { status: 'running', r: 'https://flow-content.google/video/x' }, {}],
  ['failed', { status: 'failed', error: 'VIDEO_GENERATION_TIMED_OUT' }, {}],
  ['cancelled', { status: 'cancelled' }, {}],
  ['running', { status: 'running' }, { polls: { recB: 5 } }],
  ['the 21st poll times out', { status: 'running' }, { polls: { recB: 20 } }],
  ['no status', {}, {}],
]) {
  const sdLive = clone(sd0), sdTs = clone(sd0);
  is(`check job: ${label}`, C.checkJobStatus(clone(item), 'recB', sdTs), n8n(F('Check Job Status.js'), { input: [clone(item)], nodes: { 'Current Scene': { id: 'recB' } }, sd: sdLive }));
  is(`check job state: ${label}`, sdTs, sdLive);
}
for (const [label, item] of [
  ['the documented shape', { response: { media: [{ video: { generatedVideo: { fifeUrl: 'https://flow-content.google/video/a', mediaGenerationId: 'u-video:a' } } }] } }],
  ['found by walking', { x: [{ y: 'https://flow-content.google/p/video/b' }, 'id-video:b'] }],
  ['media id only', { a: 'z-video:c' }],
  ['nothing', { status: 'completed' }],
]) {
  is(`extract: ${label}`, tryRun(() => C.extractVideoUrl(item)), tryRun(() => n8n(F('Extract Video URL.js'), { input: [item] })));
}
for (const [label, failedJob, sd0] of [['first', { error: 'x' }, {}], ['fifth', { status: 'failed' }, { resubmits: { recB: 4 }, polls: { recB: 20 } }], ['sixth throws', { error: 'VIDEO_GENERATION_TIMED_OUT' }, { resubmits: { recB: 5 } }], ['sixth, no error', {}, { resubmits: { recB: 5 } }]]) {
  const sdLive = clone(sd0), sdTs = clone(sd0);
  is(`resubmit: ${label}`, tryRun(() => C.resubmitGuard('recB', failedJob, sdTs)), tryRun(() => n8n(F('Resubmit Guard.js'), { json: failedJob, nodes: { 'Current Scene': { id: 'recB' } }, sd: sdLive })));
  is(`resubmit state: ${label}`, sdTs, sdLive);
}

// --- The motion judge -------------------------------------------------------------------------------------------------------
{
  const ev = { Video_Signed_URL: 'https://flow-content.google/video/b', Video_Media_Id: 'b-video:1' };
  const csB = C.currentScene(film[1], {}, project({}).fields, {});
  const legacy = C.currentScene(S('recL', 111, { 'Video Scenă URL': 'A cart leaves the yard. Negative: no reversed motion' }), {}, project({}).fields, {});
  const preps = [
    ['judged', ev, csB, {}, {}],
    ['legacy tail stripped', ev, legacy, {}, {}],
    ['judge off', ev, csB, { motionJudge: false }, {}],
    ['no url', { Video_Signed_URL: '', Video_Media_Id: 'm' }, csB, {}, {}],
    ['no motion', ev, C.currentScene(S('recM', 112, { 'Video Scenă URL': '' }), {}, project({}).fields, {}), {}, {}],
    ['already re-rolled', ev, csB, {}, { motionRerolls: { recB: 1 } }],
  ];
  for (const [label, e, cs, o, sd0] of preps) {
    const sdLive = clone(sd0), sdTs = clone(sd0);
    const ts = C.motionPrep(e, cs, project(o).fields, sdTs);
    is(`motion prep: ${label}`, ts, n8n(F('Motion Prep.js'), { json: e, nodes: { 'Current Scene': cs, 'IMG Load Project': project(o) }, sd: sdLive }));
    is(`motion prep state: ${label}`, sdTs, sdLive);
    if (ts.ok) is(`motion judge body: ${label}`, C.motionJudgeBody(ts, 'https://r/sheet.png'), n8n(EX['Motion Judge.jsonBody'], { json: { url: 'https://r/sheet.png' }, nodes: { 'Motion Prep': ts } }));
  }
  const prep = C.motionPrep(ev, csB, project({}).fields, {});
  const ans = (o) => ({ choices: [{ message: { content: 'Here: ' + JSON.stringify(o) } }] });
  const verdicts = [
    ['all fine', ans({ direction: 1, permanence: 0.9, untouched: 1, coherent: 0.8, morph: false, loop: false, problems: [] }), {}],
    ['direction just under', ans({ direction: 0.49, permanence: 1, untouched: 1, coherent: 1 }), {}],
    ['direction at the bar', ans({ direction: 0.5, permanence: 0.5, untouched: 0.45, coherent: 0.45 }), {}],
    ['permanence', ans({ direction: 1, permanence: 0.3, untouched: 1, coherent: 1, problems: ['the sack vanishes', 'b', 'c', 'd', 'e'] }), {}],
    ['untouched just under', ans({ direction: 1, permanence: 1, untouched: 0.44, coherent: 1 }), {}],
    ['coherence just under', ans({ coherent: 0.44 }), {}],
    ['morph and loop', ans({ morph: true, loop: true }), {}],
    ['string scores are ignored', ans({ direction: '0.1', morph: 'true' }), {}],
    ['already spent', ans({ direction: 0.1 }), { motionRerolls: { recB: 1 } }],
    ['unreadable', { choices: [{ message: { content: 'no json here' } }] }, {}],
    ['the call failed', { error: { message: 'timeout' } }, {}],
  ];
  for (const [label, judge, sd0] of verdicts) {
    const sdLive = clone(sd0), sdTs = clone(sd0);
    const ts = C.motionVerdict(prep, judge, sdTs);
    is(`motion verdict: ${label}`, ts, n8n(F('Motion Verdict.js'), { json: judge, nodes: { 'Motion Prep': prep }, sd: sdLive }));
    is(`motion verdict state: ${label}`, sdTs, sdLive);
  }
  is('motion verdict: not judged', C.motionVerdict(C.motionPrep(ev, csB, project({ motionJudge: false }).fields, {}), {}, {}), n8n(F('Motion Verdict.js'), { json: {}, nodes: { 'Motion Prep': C.motionPrep(ev, csB, project({ motionJudge: false }).fields, {}) } }));
  const resubs = [
    ['permanence + untouched + loop + direction: capped at three', { sceneId: 'recB', ord: 101, attempt: 1, problems: ['direction 0.1', 'permanence 0.2', 'untouched 0.3'], loop: true }, csB],
    ['morph drops the end frame', { sceneId: 'recB', ord: 101, attempt: 1, morph: true, problems: ['morph'] }, csB],
    ['coherence', { sceneId: 'recB', attempt: 2, problems: ['coherence 0.2'] }, csB],
    ['unknown signal', { sceneId: 'recB', attempt: 1, problems: ['taste 0.1'] }, csB],
    ['empty action: prompt unchanged', { sceneId: 'recB', attempt: 1, problems: ['permanence 0.1'] }, { ...csB, videoRequest: { prompt: 'Negative: speech' } }],
    ['no Negative in the prompt', { sceneId: 'recB', attempt: 1, problems: ['loop'] }, { ...csB, videoRequest: { prompt: 'just an action' } }],
  ];
  for (const [label, v, cs] of resubs) {
    const sdLive = {}, sdTs = {};
    is(`motion resubmit: ${label}`, C.motionResubmit(v, cs, sdTs), n8n(F('Motion Resubmit.js'), { json: v, nodes: { 'Current Scene': cs }, sd: sdLive }));
    is(`motion resubmit state: ${label}`, sdTs, sdLive);
  }
}

// --- The refusal ladder ---------------------------------------------------------------------------------------------------------
{
  const csB = C.currentScene(S('recB', 101, { 'Image Media ID': img(A1, 'b'), 'Observații Scenă': 'keep it slow' }), {}, project({}).fields, {});
  const pad = 'x'.repeat(3000);
  const ladders = [
    ['person', { error: { message: 'PUBLIC_ERROR_PROMINENT_PEOPLE_FILTER_FAILED' } }, {}],
    ['minor', { media: [{ mediaStatus: 'MINOR_UPLOAD' }] }, {}],
    ['audio, past the old 2 kB window', { echo: pad, media: [{ mediaStatus: 'AUDIO_GENERATION_FILTERED' }] }, {}],
    ['generic', { error: 'FILTER' }, {}],
    ['second attempt: the stronger steer', { error: 'PROMINENT' }, { rewrites: { recB: 1 } }],
    ['third: give up', { error: 'AUDIO_FILTERED' }, { rewrites: { recB: 2 } }],
  ];
  for (const [label, err, sd0] of ladders) {
    const sdLive = clone(sd0), sdTs = clone(sd0);
    const vp = C.vpPrep(csB, err, sdTs);
    is(`vp prep: ${label}`, vp, n8n(F('VP Prep.js'), { json: err, nodes: { 'Current Scene': csB }, sd: sdLive }));
    is(`vp prep state: ${label}`, sdTs, sdLive);
    const nodes = { 'VP Prep': vp };
    is(`vp give up? ${label}`, vp.giveUp, n8n('={{ $json.giveUp }}', { json: vp }));
    is(`vp rejected fields: ${label}`, C.vpRejectedFields(vp), fieldsOfQuery(EX['Mark Video Prompt Rejected.query'], { nodes }));
    is(`vp steer fields: ${label}`, C.vpSteerFields(vp), fieldsOfQuery(EX['VP Steer.query'], { nodes }));
    is(`vp note still: ${label}`, C.vpNoteStillFields(vp), fieldsOfQuery(EX['VP Note Still.query'], { nodes }));
    for (const answer of [{ choices: [{ message: { content: '  A calm quay at dusk, no resemblance to any real person.  ' } }] }, { choices: [{ message: { content: '   ' } }] }, {}]) {
      is(`vp apply: ${label} ${JSON.stringify(answer).slice(0, 30)}`, C.vpApplyFields(vp, answer), fieldsOfQuery(EX['VP Apply.query'], { json: answer, nodes }));
    }
    is(`vp prompt fix? ${label}`, C.vpPromptFix(vp), n8n(EX['VP Prompt Fix?'], { nodes }));
    is(`vp rewrite body: ${label}`, C.vpRewriteBody(vp), n8n(EX['VP Rewrite AI.jsonBody'], { nodes }));
    is(`vp fire regen: ${label}`, { scene_id: vp.sceneId }, n8n(EX['VP Fire Image Regen.jsonBody'], { nodes }));
    const q = EX['VP Image Check.query'];
    is(`vp check id: ${label}`, C.vpCheckId({ ...vp, sceneId: 'rec-B;drop' }), n8n('={{ ' + q.slice(q.indexOf('{{') + 2, q.indexOf('}}')).trim() + ' }}', { nodes: { 'VP Prep': { ...vp, sceneId: 'rec-B;drop' } } }));
  }
  const vp = C.vpPrep(csB, { error: 'FILTER' }, {});
  const rows = [
    ['ready', { image_media_id: img(A1, 'new'), regen_image: false, note: '' }, {}],
    ['flag still up', { image_media_id: img(A1, 'new'), regen_image: true, note: '' }, {}],
    ['unchanged: wait', { image_media_id: img(A1, 'b'), regen_image: true, note: 'AUTO-STEER' }, {}],
    ['refused too', { image_media_id: img(A1, 'b'), regen_image: false, note: 'Image regeneration REJECTED — x' }, {}],
    ['the 16th wait times out', { image_media_id: img(A1, 'b'), regen_image: true, note: '' }, { imageWaits: { 'recB:1': 15 } }],
    ['nulls', { image_media_id: null, regen_image: null, note: null }, {}],
  ];
  for (const [label, row, sd0] of rows) {
    const sdLive = clone(sd0), sdTs = clone(sd0);
    is(`vp image ready: ${label}`, C.vpImageReady(vp, row, sdTs), n8n(F('VP Image Ready.js'), { input: [row], nodes: { 'VP Prep': vp }, sd: sdLive }));
    is(`vp image ready state: ${label}`, sdTs, sdLive);
  }
}

// --- The clip lands ------------------------------------------------------------------------------------------------------------------
{
  const csB = C.currentScene(film[1], {}, project({}).fields, {});
  for (const mediaId of ['b-video:1', '']) {
    const live = JSON.parse(n8n(EX['Update Scene Record.jsonBody'], { json: { video_url: 'https://m/clip.mp4' }, nodes: { 'Current Scene': csB, 'Extract Video URL': { Video_Media_Id: mediaId } } }));
    is(`written fields ${mediaId || 'no id'}`, C.clipWrittenFields(csB, 'https://m/clip.mp4', mediaId), live.fields);
    is(`ingest field ${mediaId || 'no id'}`, ['video', csB.id], [live.field, live.sceneId]);
  }
  is('generating fields', C.generatingFields(), fieldsOfQuery(EX['Mark Generare Video.query'], { nodes: { 'Current Scene': csB } }));
}

// The fixtures must be the version the manifest names, and every file must be read.
{
  const manifest = JSON.parse(F('manifest.json'));
  const onDisk = fs.readdirSync(path.join(here, 'fixtures', 'produce-clips')).filter((f) => f !== 'manifest.json').sort();
  is('manifest lists every fixture', Object.keys(manifest.files).sort(), onDisk);
  is('manifest version', manifest.mediaGeneration.versionId, '527c67b7-a38d-48b3-b56e-3c52cec8b0bb');
}

const total = passed + failed;
console.log(`produce clips: ${failed || total === 0 ? 'RESULT: FAIL' : 'RESULT: OK'} ${passed}/${total}`);
if (failed || total === 0) process.exit(1);
