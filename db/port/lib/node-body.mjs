#!/usr/bin/env node
// node-body.mjs <workflow-snapshot.json> <Node Name> [parameter.path]
//
// Print one node's parameters out of a saved workflow snapshot, without any
// network access. Companion to diff-workflow.mjs: that one answers "what
// changed between two snapshots", this one answers "what does this node say
// right now", which is the first thing you need before editing a node body.
//
// It accepts every snapshot shape this repo produces, because three different
// tools write them and they disagree about the envelope:
//   - get_workflow_version  -> { versionId, nodes, connections, ... }
//   - get_workflow_details  -> { workflow: { nodes, ... }, triggerInfo }
//   - a REST GET            -> { nodes, connections, ... }
//
// Why it exists: a Claude session editing a live node has to compare what it
// is about to paste against what is actually there, and both halves of that
// are large. `get_workflow_details` on a 500 KB workflow overflows the tool
// result and gets spilled to a file — which is fine, because this reads files.
//
// Examples:
//   node db/port/lib/node-body.mjs "Media Generation.draft.json" "Current Scene" jsCode
//   node db/port/lib/node-body.mjs "Claude Scripting.draft.json" "Rewrite Scene Text" jsonBody
//   node db/port/lib/node-body.mjs snap.json "Some Node"            # whole node
//   node db/port/lib/node-body.mjs snap.json --list                 # every node name
import { readFileSync } from 'node:fs';

const [file, name, path] = process.argv.slice(2);
if (!file || !name) {
  console.error('usage: node-body.mjs <snapshot.json> <Node Name|--list> [parameter.path]');
  process.exit(2);
}

let doc;
try {
  doc = JSON.parse(readFileSync(file, 'utf8'));
} catch (e) {
  console.error(`cannot read ${file}: ${e.message}`);
  process.exit(2);
}

const nodes = doc.nodes || doc.workflow?.nodes;
if (!Array.isArray(nodes)) {
  console.error(`${file} has no nodes array (keys: ${Object.keys(doc).join(', ')})`);
  process.exit(2);
}

if (name === '--list') {
  for (const n of nodes) console.log(`${n.name}\t${n.type}`);
  process.exit(0);
}

const node = nodes.find((n) => n.name === name);
if (!node) {
  console.error(`no node named ${JSON.stringify(name)}.`);
  const near = nodes
    .map((n) => n.name)
    .filter((n) => n.toLowerCase().includes(name.toLowerCase().split(' ')[0] || ''));
  if (near.length) console.error(`did you mean: ${near.join(' | ')}`);
  else console.error(`run with --list to see all ${nodes.length} names.`);
  process.exit(1);
}

if (!path) {
  console.log(JSON.stringify(
    { name: node.name, type: node.type, typeVersion: node.typeVersion, parameters: node.parameters },
    null, 1));
  process.exit(0);
}

let cur = node.parameters ?? {};
for (const key of path.split('.')) {
  if (cur == null) break;
  cur = Array.isArray(cur) ? cur[Number(key)] : cur[key];
}
if (cur === undefined || cur === null) {
  console.error(`node ${JSON.stringify(name)} has no parameter ${JSON.stringify(path)}`);
  console.error(`it has: ${Object.keys(node.parameters || {}).join(', ')}`);
  process.exit(1);
}
// A string parameter (jsCode, jsonBody, a prompt) is printed raw so it can be
// redirected to a file and diffed or syntax-checked directly.
process.stdout.write(typeof cur === 'string' ? cur : JSON.stringify(cur, null, 1) + '\n');
