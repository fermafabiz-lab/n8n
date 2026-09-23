// Applies ops.json to the live snapshot, offline, and writes cs.expected.json
// — the workflow as it must look after the apply. After the real apply the
// draft is diffed against this file; any difference means something was
// retyped wrong on the way in.
//
//   node db/port/cinematic-mode/simulate.mjs
import fs from 'node:fs';
import path from 'node:path';

const dir = path.dirname(new URL(import.meta.url).pathname);
const live = JSON.parse(fs.readFileSync(path.join(dir, 'cs.live.json'), 'utf8'));
const W = JSON.parse(JSON.stringify(live.workflow || live));
const ops = JSON.parse(fs.readFileSync(path.join(dir, 'ops.json'), 'utf8'));
const byName = (n) => W.nodes.find((x) => x.name === n);

for (const op of ops) {
  const type = op.connectionType || 'main';
  if (op.type === 'updateNodeParameters') {
    const n = byName(op.nodeName);
    if (!n) throw new Error(`updateNodeParameters: no node ${op.nodeName}`);
    n.parameters = Object.assign({}, n.parameters, op.parameters);
  } else if (op.type === 'addNode') {
    if (byName(op.node.name)) throw new Error(`addNode: ${op.node.name} already exists`);
    W.nodes.push(Object.assign({ id: 'sim-' + op.node.name.replace(/\W+/g, '-').toLowerCase() }, op.node));
  } else if (op.type === 'addConnection') {
    if (!byName(op.source) || !byName(op.target)) throw new Error(`addConnection: unknown node in ${op.source} -> ${op.target}`);
    const c = (W.connections[op.source] = W.connections[op.source] || {});
    c[type] = c[type] || [];
    while (c[type].length <= op.sourceIndex) c[type].push([]);
    c[type][op.sourceIndex].push({ node: op.target, type, index: 0 });
  } else if (op.type === 'removeConnection') {
    const arr = ((W.connections[op.source] || {})[type] || [])[op.sourceIndex];
    if (!arr) throw new Error(`removeConnection: ${op.source}[${op.sourceIndex}] has no ${type} edges`);
    const i = arr.findIndex((e) => e.node === op.target);
    if (i < 0) throw new Error(`removeConnection: ${op.source}[${op.sourceIndex}] -> ${op.target} was not there`);
    arr.splice(i, 1);
  } else throw new Error(`simulate: unhandled ${op.type}`);
}
fs.writeFileSync(path.join(dir, 'cs.expected.json'), JSON.stringify(W, null, 1) + '\n');
console.log(`applied ${ops.length} operations -> cs.expected.json (${W.nodes.length} nodes, was ${(live.workflow || live).nodes.length})`);

// --- the walks that matter --------------------------------------------------
const outs = (n, idx) => {
  const m = (W.connections[n] || {}).main || [];
  return (idx == null ? m.flat() : m[idx] || []).map((e) => e.node);
};
const walk = (start, stop) => {
  const seen = new Set(); const q = [start]; const order = [];
  while (q.length) {
    const n = q.shift();
    if (seen.has(n)) continue;
    seen.add(n); order.push(n);
    if (stop.has(n)) continue;
    outs(n).forEach((x) => q.push(x));
  }
  return order;
};
const fail = (m) => { throw new Error(m); };
const eq = (a, b, m) => JSON.stringify(a) === JSON.stringify(b) || fail(`${m}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);

eq(outs('Save Story Bible'), ['Cinematic?'], 'Save Story Bible must lead only to Cinematic?');
eq(outs('Cinematic?', 0), ['Cine Treatment'], 'Cinematic?[true]');
eq(outs('Cinematic?', 1), ['Generate Outline'], 'Cinematic?[false]');
eq(outs('If Cine Retry', 0), ['Cine Shot List'], 'If Cine Retry[true] loops to the writer');
eq(outs('If Cine Retry', 1), ['FC Prep'], 'If Cine Retry[false] rejoins at FC Prep');
eq(outs('If Narration Retry', 1), ['FC Prep'], 'the Story path still enters FC Prep the same way');

const cine = walk('Cine Treatment', new Set(['Combine Chapters']));
for (const m of ['Cine Shot List', 'Cine Guard', 'FC Prep', 'FC Apply', 'FC Save Report', 'FC Done', 'Combine Chapters']) cine.includes(m) || fail(`cinematic path does not reach ${m}`);
for (const m of ['Generate Outline', 'Write Full Narration', 'Edit Full Narration', 'Narration Guard']) cine.includes(m) && fail(`cinematic path reaches ${m}`);
const story = walk('Generate Outline', new Set(['Combine Chapters']));
for (const m of ['Cine Treatment', 'Cine Shot List', 'Cine Guard']) story.includes(m) && fail(`story path reaches ${m}`);
console.log('OK: cinematic path  ' + cine.join(' → '));
console.log('OK: story path      ' + story.slice(0, 5).join(' → ') + ' → …');

// ai sub-nodes wired to the right agents
const ai = (n, t) => (((W.connections[n] || {})[t] || [])[0] || []).map((e) => e.node);
eq(ai('Cine Treatment Model', 'ai_languageModel'), ['Cine Treatment'], 'treatment model');
eq(ai('Cine Treatment Parser', 'ai_outputParser'), ['Cine Treatment'], 'treatment parser');
eq(ai('Cine Shot Model', 'ai_languageModel'), ['Cine Shot List'], 'shot model');
console.log('OK: models and parser wired');
