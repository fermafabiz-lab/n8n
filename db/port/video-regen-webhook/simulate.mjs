// Applies ops.json to the live snapshot, offline, and writes mg.expected.json.
//
//   node db/port/video-regen-webhook/simulate.mjs
//
// This is the pre-flight `diff-workflow.mjs` was written for, run BEFORE the
// edit instead of after: the dangling-$('…')-reference scan and the Drive
// resource/operation scan both work on a file, so there is no reason to find
// out from production. After the apply, the published draft is diffed against
// this same file — if they are not identical, something was retyped wrong.
import fs from 'node:fs';
import path from 'node:path';

const dir = path.dirname(new URL(import.meta.url).pathname);
const live = JSON.parse(fs.readFileSync(path.join(dir, 'mg.live.json'), 'utf8'));
const W = JSON.parse(JSON.stringify(live.workflow || live));
const ops = JSON.parse(fs.readFileSync(path.join(dir, 'ops.json'), 'utf8'));

const byName = (n) => W.nodes.find((x) => x.name === n);
let applied = 0;
for (const op of ops) {
  if (op.type === 'updateNodeParameters') {
    const n = byName(op.nodeName);
    if (!n) throw new Error(`updateNodeParameters: no node ${op.nodeName}`);
    n.parameters = Object.assign({}, n.parameters, op.parameters);
  } else if (op.type === 'addNode') {
    if (byName(op.node.name)) throw new Error(`addNode: ${op.node.name} already exists`);
    W.nodes.push(Object.assign({ id: 'sim-' + op.node.name.replace(/\W+/g, '-').toLowerCase() }, op.node));
  } else if (op.type === 'addConnection') {
    const c = (W.connections[op.source] = W.connections[op.source] || { main: [] });
    while (c.main.length <= op.sourceIndex) c.main.push([]);
    c.main[op.sourceIndex].push({ node: op.target, type: 'main', index: 0 });
  } else if (op.type === 'removeConnection') {
    const c = W.connections[op.source];
    if (!c) throw new Error(`removeConnection: ${op.source} has none`);
    const before = c.main[op.sourceIndex].length;
    c.main[op.sourceIndex] = c.main[op.sourceIndex].filter((e) => e.node !== op.target);
    if (c.main[op.sourceIndex].length === before) throw new Error(`removeConnection: ${op.source}[${op.sourceIndex}] -> ${op.target} was not there`);
  } else {
    throw new Error(`simulate: unhandled operation ${op.type}`);
  }
  applied++;
}
fs.writeFileSync(path.join(dir, 'mg.expected.json'), JSON.stringify(W, null, 1) + '\n');
console.log(`applied ${applied} operations -> mg.expected.json (${W.nodes.length} nodes)`);

// --- the two walks that matter ---------------------------------------------
const walk = (start, stop = new Set()) => {
  const seen = new Set(); const q = [start]; const order = [];
  while (q.length) {
    const n = q.shift();
    if (seen.has(n) || stop.has(n)) continue;
    seen.add(n); order.push(n);
    const c = W.connections[n];
    if (c && c.main) c.main.forEach((outs) => (outs || []).forEach((e) => q.push(e.node)));
  }
  return order;
};

const fromHook = walk('Video Regen Webhook', new Set(['Wait Video Approval']));
console.log('\nwebhook path reaches ' + fromHook.length + ' nodes:');
console.log('  ' + fromHook.join('\n  '));
const must = ['Prep Video Regen', 'Submit Video Regen', 'Write Regen Video', 'VRW End', 'RG Motion Prep', 'Download Regen Clip'];
for (const m of must) {
  if (!fromHook.includes(m)) throw new Error(`webhook path does NOT reach ${m}`);
}
if (fromHook.includes('Wait Video Approval')) throw new Error('webhook path re-enters the batch gate');
if (fromHook.includes('Loop Scenes') || fromHook.includes('Loop Images') || fromHook.includes('Loop Audio')) {
  throw new Error('webhook path reaches a batch loop');
}
console.log('\n  OK: the webhook reaches the whole RG tail and stops at VRW End,');
console.log('      never at Wait Video Approval and never inside a batch loop.');

// The batch must still be able to get back to its gate.
for (const t of ['Write Regen Video', 'Mark Regen Filtered']) {
  const gate = walk(t).includes('Wait Video Approval');
  if (!gate) throw new Error(`${t} can no longer reach Wait Video Approval — the batch gate is broken`);
}
console.log('  OK: both terminals still reach Wait Video Approval on the batch arm.');
