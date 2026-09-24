// Applies ops-cs.json / ops-mg.json to the live snapshots offline and writes
// cs.expected.json / mg.expected.json, then walks the hook branch.
//
//   node db/port/cinematic-continuity/simulate.mjs
import fs from 'node:fs';
import path from 'node:path';

const dir = path.dirname(new URL(import.meta.url).pathname);
const fail = (m) => { throw new Error(m); };

function apply(liveFile, opsFile, outFile) {
  const live = JSON.parse(fs.readFileSync(path.join(dir, liveFile), 'utf8'));
  const W = JSON.parse(JSON.stringify(live.workflow || live));
  const ops = JSON.parse(fs.readFileSync(path.join(dir, opsFile), 'utf8'));
  const byName = (n) => W.nodes.find((x) => x.name === n);
  for (const op of ops) {
    const type = op.connectionType || 'main';
    if (op.type === 'updateNodeParameters') {
      const n = byName(op.nodeName) || fail(`no node ${op.nodeName}`);
      n.parameters = Object.assign({}, n.parameters, op.parameters);
    } else if (op.type === 'addNode') {
      if (byName(op.node.name)) fail(`${op.node.name} already exists`);
      W.nodes.push(Object.assign({ id: 'sim-' + op.node.name.replace(/\W+/g, '-').toLowerCase() }, op.node));
    } else if (op.type === 'addConnection') {
      if (!byName(op.source) || !byName(op.target)) fail(`unknown node in ${op.source} -> ${op.target}`);
      const c = (W.connections[op.source] = W.connections[op.source] || {});
      c[type] = c[type] || [];
      while (c[type].length <= op.sourceIndex) c[type].push([]);
      c[type][op.sourceIndex].push({ node: op.target, type, index: 0 });
    } else if (op.type === 'removeConnection') {
      const arr = ((W.connections[op.source] || {})[type] || [])[op.sourceIndex] || fail(`${op.source}[${op.sourceIndex}] has no edges`);
      const i = arr.findIndex((e) => e.node === op.target);
      if (i < 0) fail(`${op.source}[${op.sourceIndex}] -> ${op.target} was not there`);
      arr.splice(i, 1);
    } else fail(`unhandled ${op.type}`);
  }
  fs.writeFileSync(path.join(dir, outFile), JSON.stringify(W, null, 1) + '\n');
  console.log(`${opsFile}: ${ops.length} operations -> ${outFile} (${W.nodes.length} nodes, was ${(live.workflow || live).nodes.length})`);
  return W;
}

const cs = apply('cs.live.json', 'ops-cs.json', 'cs.expected.json');
apply('mg.live.json', 'ops-mg.json', 'mg.expected.json');

const outs = (W, n, idx) => { const m = ((W.connections[n] || {}).main) || []; return (idx == null ? m.flat() : m[idx] || []).map((e) => e.node); };
const eq = (a, b, m) => JSON.stringify(a) === JSON.stringify(b) || fail(`${m}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
eq(outs(cs, 'Combine Chapters'), ['Hook Wanted?'], 'Combine Chapters leads only to Hook Wanted?');
eq(outs(cs, 'Hook Wanted?', 0), ['Generate Hook'], 'Hook Wanted?[true]');
eq(outs(cs, 'Hook Wanted?', 1), ['Clear Hook Plan'], 'Hook Wanted?[false]');
eq(outs(cs, 'Clear Hook Plan'), ['No Hook Done'], 'Clear Hook Plan');
eq(outs(cs, 'No Hook Done'), ['Save Script To Airtable'], 'No Hook Done');
eq(outs(cs, 'Hook Plan Done'), ['Save Script To Airtable'], 'the hook path still reaches Save Script');
console.log('OK: Combine Chapters → Hook Wanted? → [true] Generate Hook … / [false] Clear Hook Plan → No Hook Done → Save Script To Airtable');
