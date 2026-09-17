// Asserts the SHAPE of the applied workflow — the things check.mjs cannot see
// because they live in connections rather than in node bodies.
//
//   node db/port/video-regen-webhook/check-live.mjs <snapshot.json>
//
// Point it at a fresh `get_workflow_details` / `get_workflow_version` dump
// (the envelope or the bare workflow, either is fine). It is the answer to a
// trap that cost a round trip here: `addConnection` accepts `sourceOutput: 1`
// and SILENTLY puts the edge on output 0. The correct key is `sourceIndex`.
// On an If node that means both branches fire on `true` — which would have
// sent every refusal into `Prep Video Regen` (a throw) and every webhook run
// back into the batch gate. Nothing complained; the workflow validated clean.
//
// So: never trust a branch index you did not read back.
import fs from 'node:fs';

const file = process.argv[2] || new URL('./mg.draft.json', import.meta.url).pathname;
const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
const W = raw.workflow || raw;
const conns = W.connections;
const byName = new Map(W.nodes.map((n) => [n.name, n]));

let pass = 0; const fails = [];
const ok = (label, cond) => { if (cond) pass++; else fails.push(label); };
const edges = (name, index) => ((conns[name] || {}).main || [])[index] || [];
const goes = (name, index, target) => edges(name, index).some((e) => e.node === target);

console.log(`${W.name} — ${W.nodes.length} nodes, version ${W.versionId}${W.activeVersionId ? ' (active ' + W.activeVersionId + ')' : ''}`);

// --- the nine nodes exist, with the types they are supposed to have ---------
for (const [name, type] of [
  ['Video Regen Webhook', 'n8n-nodes-base.webhook'],
  ['VRW Load Scene', 'n8n-nodes-base.postgres'],
  ['VRW Build Regen', 'n8n-nodes-base.code'],
  ['VRW Can Regen?', 'n8n-nodes-base.if'],
  ['VRW Refuse?', 'n8n-nodes-base.if'],
  ['VRW Refuse', 'n8n-nodes-base.postgres'],
  ['VRW Video Done?', 'n8n-nodes-base.if'],
  ['VRW Filtered Done?', 'n8n-nodes-base.if'],
  ['VRW End', 'n8n-nodes-base.noOp'],
]) ok(`${name} exists as ${type}`, byName.get(name) && byName.get(name).type === type);

// --- the webhook itself -----------------------------------------------------
const hook = byName.get('Video Regen Webhook');
ok('the path is scene-video-regen', hook && hook.parameters.path === 'scene-video-regen');
ok('POST', hook && hook.parameters.httpMethod === 'POST');
// The one deliberate deviation from its three siblings: a video regeneration
// takes minutes and the site aborts a webhook after 15 s, so `lastNode` would
// report a failure on every successful regeneration.
ok('responds on receipt, not at the end of the run', hook && hook.parameters.responseMode === 'onReceived');
ok('VRW Load Scene always emits an item (an unknown scene must throw loudly)',
  (byName.get('VRW Load Scene') || {}).alwaysOutputData === true);

// --- THE BRANCH INDICES. This is the whole reason this file exists. ---------
for (const [node, trueTarget, falseTarget] of [
  ['VRW Can Regen?', 'Prep Video Regen', 'VRW Refuse?'],
  ['VRW Refuse?', 'VRW Refuse', 'VRW End'],
  ['VRW Video Done?', 'VRW End', 'Wait Video Approval'],
  ['VRW Filtered Done?', 'VRW End', 'Wait Video Approval'],
]) {
  ok(`${node}: true -> ${trueTarget}`, goes(node, 0, trueTarget));
  ok(`${node}: false -> ${falseTarget}`, goes(node, 1, falseTarget));
  ok(`${node}: the false target is NOT also on true`, !goes(node, 0, falseTarget));
  ok(`${node}: exactly one edge per branch`, edges(node, 0).length === 1 && edges(node, 1).length === 1);
}

// --- the two paths, walked --------------------------------------------------
const walk = (start, stop = new Set()) => {
  const seen = new Set(); const q = [start];
  while (q.length) {
    const n = q.shift();
    if (seen.has(n) || stop.has(n)) continue;
    seen.add(n);
    ((conns[n] || {}).main || []).forEach((outs) => (outs || []).forEach((e) => q.push(e.node)));
  }
  return seen;
};
const hookPath = walk('Video Regen Webhook', new Set(['Wait Video Approval']));
for (const n of ['VRW Load Scene', 'VRW Build Regen', 'Prep Video Regen', 'RG End Frame Prompt', 'Submit Video Regen', 'Poll Video Regen', 'RG Motion Prep', 'Download Regen Clip', 'Upload Regen Clip To Drive', 'Write Regen Video', 'VRW End']) {
  ok(`the webhook reaches ${n}`, hookPath.has(n));
}
// And stops. A webhook run that fell into `Wait Video Approval` would poll the
// gate forever on `$('Sort & Cap Scenes')`, which only the batch executes.
ok('the webhook never re-enters the batch gate', !hookPath.has('Wait Video Approval'));
for (const loop of ['Loop Scenes', 'Loop Images', 'Loop Audio', 'Evaluate Video Approval']) {
  ok(`the webhook never reaches ${loop}`, !hookPath.has(loop));
}
// The batch arm still closes its own loop.
for (const t of ['Write Regen Video', 'Mark Regen Filtered']) {
  ok(`${t} still reaches Wait Video Approval (the batch arm)`, walk(t).has('Wait Video Approval'));
}

// --- no node in the tail asks a one-door node anything ----------------------
const OUTSIDE = ['Receive Batch Input', 'IMG Load Project', 'Fetch Scene Videos'];
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').split('\n').map((l) => l.replace(/(^|[^:'"`])\/\/.*$/, '$1')).join('\n');
const tail = ['RG End Frame Prompt', 'RG Motion Prep', 'Submit Video Regen', 'RG Attach End Frame', 'Regen Cooldown Guard', 'Check Video Regen', 'Extract Regen Video URL', 'RG Motion Verdict', 'RG Motion Resubmit', 'Set Regen Result', 'Write Regen Video', 'Mark Regen Filtered', 'Regen Resubmit Guard', 'Upload Regen Clip To Drive', 'Share Regen Clip'];
for (const name of tail) {
  const n = byName.get(name);
  if (!n) { fails.push(`${name} is missing`); continue; }
  const src = strip(JSON.stringify(n.parameters));
  for (const o of OUTSIDE) ok(`${name} never calls $('${o}')`, !src.includes(`$('${o}')`));
}
// Prep Video Regen is the one node allowed to, and only behind the guard.
const prep = byName.get('Prep Video Regen');
ok('Prep Video Regen owns the door discriminator', prep && prep.parameters.jsCode.includes("$('Video Regen Webhook').isExecuted"));
ok('Prep Video Regen carries the context downstream', prep && /viaWebhook: viaWebhook/.test(prep.parameters.jsCode));

if (fails.length) {
  console.error(`\ncheck-live — ${fails.length} FAILED of ${pass + fails.length}`);
  for (const f of fails) console.error('  ✗ ' + f);
  process.exit(1);
}
console.log(`\ncheck-live — ${pass}/${pass} passed`);
