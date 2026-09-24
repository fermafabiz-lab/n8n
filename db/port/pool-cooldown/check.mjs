// Runs the three committed node bodies against a simulated pool — no n8n,
// no network. `node db/port/pool-cooldown/check.mjs`
//
// What it pins: a failed submit in the pool no longer holds the tick. The
// scene goes back to the head of the queue, its account rests, clips in
// flight on other accounts keep being polled, a queue blocked only by resting
// accounts WAITS rather than finishing, and the serial path is unchanged.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const body = (n) => readFileSync(join(here, 'paste', n + '.js'), 'utf8');
const GUARD = body('Submit Cooldown Guard');
const TICK = body('Pool Tick');
const RECORD = body('Pool Record');

let failures = 0;
const ok = (cond, msg) => { if (cond) console.log('  ok  ' + msg); else { failures++; console.log('  FAIL ' + msg); } };

const hex = (s) => Buffer.from(s, 'utf8').toString('hex');
const img = (acct, n) => `user:2923-email:${hex(acct)}-image:img${n}`;
const A = 'fermafabiz@gmail.com', B = 'houseofvideos01@gmail.com', C = 'houseofvideos02@gmail.com';

// n8n's globals, faked. `nodes` maps a node name to its items; a missing name
// throws, exactly as $('Never Ran') does in n8n.
function run(code, { nodes = {}, input = [], prev = '', sd = {} }) {
  const $ = (name) => {
    if (!(name in nodes)) throw new Error('node ' + name + ' has not run');
    const items = nodes[name];
    return { first: () => items[0], all: () => items };
  };
  const $input = { first: () => input[0], all: () => input };
  const $json = (input[0] || {}).json;
  const quiet = { log: () => {} };
  const fn = new Function('$', '$input', '$json', '$prevNode', '$getWorkflowStaticData', 'console', code);
  return fn($, $input, $json, { name: prev }, () => sd, quiet);
}

const rows = [
  { json: { id: 's1', fields: { 'Image Media ID': img(A, 1) } } },
  { json: { id: 's2', fields: { 'Image Media ID': img(A, 2) } } },
  { json: { id: 's3', fields: { 'Image Media ID': img(B, 3) } } },
  { json: { id: 's4', fields: { 'Image Media ID': img(C, 4) } } },
];
const baseNodes = {
  'IMG Load Project': [{ json: { fields: { 'Editing Options': '{}' } } }],
  'Assign Accounts': [],
  'Sort Scenes For Video': rows,
};

console.log('1. first tick builds the queue and submits');
let out = run(TICK, { nodes: baseNodes, input: rows })[0].json;
ok(out.poolAction === 'submit' && out.poolSceneId === 's1', 'first action is submit s1');
ok(out.pool.queue.length === 4 && out.pool.accounts.length === 3, 'queue of 4 on 3 accounts');

console.log('2. a failed submit in the pool does not wait in place');
const now = Date.now();
let pool = {
  per: 1, ticks: 5, accounts: [A, B, C], stolen: {}, done: [],
  inflight: [{ id: 's1', account: A, jobid: 'j1', polls: 1, lastPollAt: now - 30000 }, { id: 's3', account: B, jobid: 'j3', polls: 0, lastPollAt: now - 30000 }],
  queue: [{ id: 's2', account: A }, { id: 's4', account: C }],
};
const newStill = img(C, 44);
const failedScene = { id: 's4', poolAccount: C, fields: rows[3].json.fields, videoRequest: { startImage: newStill } };
const failNodes = { 'Pool Tick': [{ json: { pool } }], 'Current Scene': [{ json: failedScene }] };
const sd = {};
const g = run(GUARD, { nodes: failNodes, input: [{ json: { error: { message: '403 PUBLIC_ERROR_UNUSUAL_ACTIVITY' } } }], sd })[0].json;
ok(g.inPool === true && g.giveUp === false, 'guard marks the result as a pool result');
ok(sd.submitCooldowns.s4 === 1, 'per-scene counter still counts');

const rec = run(RECORD, { nodes: failNodes, input: [{ json: g }], prev: 'Pool Cooldown?' })[0].json.pool;
ok(rec.queue[0].id === 's4' && rec.queue[0].account === C, 'scene back at the head of the queue, same account');
ok(Number(rec.cooldownUntil[C]) > Date.now() + 50000, 'its account rests about a minute');
ok(rec.freshImage.s4 === newStill, 'the still this attempt used is kept');
ok(rec.inflight.length === 2, 'clips in flight on the other accounts are untouched');

console.log('3. the next ticks keep polling the others');
out = run(TICK, { nodes: baseNodes, input: [{ json: { pool: rec } }] })[0].json;
ok(out.poolAction === 'poll' && ['s1', 's3'].includes(out.poolSceneId), 'next tick polls a clip in flight (' + out.poolSceneId + ')');

const polled = JSON.parse(JSON.stringify(rec));
polled.inflight.forEach((j) => { j.lastPollAt = Date.now(); });
out = run(TICK, { nodes: baseNodes, input: [{ json: { pool: polled } }] })[0].json;
ok(out.poolAction === 'wait', 'nothing due, A and B busy, C resting → wait');

console.log('4. a queue blocked only by a resting account waits instead of finishing');
const onlyResting = JSON.parse(JSON.stringify(rec));
onlyResting.inflight = [];
onlyResting.queue = [{ id: 's4', account: C }];
out = run(TICK, { nodes: baseNodes, input: [{ json: { pool: onlyResting } }] })[0].json;
ok(out.poolAction === 'wait', 'wait, not done');

console.log('5. after the rest the scene is submitted with the still it last used');
const rested = JSON.parse(JSON.stringify(onlyResting));
rested.cooldownUntil[C] = Date.now() - 1;
out = run(TICK, { nodes: baseNodes, input: [{ json: { pool: rested } }] })[0].json;
ok(out.poolAction === 'submit' && out.poolSceneId === 's4' && out.poolAccount === C, 'submits s4 on its account');
ok(out.fields['Image Media ID'] === newStill, 'row carries the newer still, not the one loaded at the start of the pass');

console.log('6. a resting account is not a steal target, a working one still steals');
const stealPool = { per: 1, ticks: 1, accounts: [A, B, C], stolen: {}, done: [], inflight: [], queue: [{ id: 's1', account: A }, { id: 's2', account: A }], cooldownUntil: { [B]: Date.now() + 60000 } };
stealPool.inflight = [{ id: 's9', account: A, jobid: 'j9', polls: 0, lastPollAt: Date.now() }];
out = run(TICK, { nodes: baseNodes, input: [{ json: { pool: stealPool } }] })[0].json;
ok(out.poolAction === 'steal' && out.poolTo === C, 'steals to the free account C, never to resting B');

console.log('7. past MAX in the pool the scene is set aside, not the film killed');
const sdMax = { submitCooldowns: { s4: 20 } };
const gMax = run(GUARD, { nodes: failNodes, input: [{ json: { message: 'x' } }], sd: sdMax })[0].json;
ok(gMax.giveUp === true, 'guard gives up instead of throwing');
const recMax = run(RECORD, { nodes: failNodes, input: [{ json: gMax }], prev: 'Pool Cooldown?' })[0].json.pool;
ok(recMax.done.includes('s4') && !recMax.queue.some((q) => q.id === 's4'), 'scene in done, off the queue');

console.log('8. serial path unchanged');
const serialNodes = { 'Current Scene': [{ json: failedScene }] };
const gs = run(GUARD, { nodes: serialNodes, input: [{ json: { message: 'x' } }], sd: {} })[0].json;
ok(gs.inPool === false, 'no Pool Tick → not a pool result (goes to Wait Submit Cooldown)');
let threw = false;
try { run(GUARD, { nodes: serialNodes, input: [{ json: { message: 'x' } }], sd: { submitCooldowns: { s4: 20 } } }); } catch (e) { threw = /kept failing after 20/.test(e.message); }
ok(threw, 'past MAX the serial path still throws, as before');
const passthrough = run(RECORD, { nodes: serialNodes, input: [{ json: { a: 1 } }], prev: 'Pool Cooldown?' });
ok(passthrough[0].json.a === 1, 'Pool Record is still a pass-through with the pool off');

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
