// Phase 3, the shadow run: on films n8n has already finished, build the
// engine's /assemble and /render requests from the LIVE database rows and
// diff them against what n8n actually sent. Nothing is submitted.
//
//   node --experimental-strip-types engine/shadow/shadow.mjs <live.json> <exec-*.json>...
//
// <live.json>   the saved get_execution of read-inputs.workflow.js (the
//               engine's loadInputs(), run on the box through n8n)
// <exec-*.json> saved get_execution(includeData) of Final Assembly runs,
//               with at least Build Timeline, Render Guard, Source Watermark,
//               Pick Music Track and the Fetch nodes
//
// What the engine takes from the execution, because it is not in the
// database: the assemble server's answer (Render Guard's last output — the
// graphics request is built from Railway's own measurement) and the random
// music pick. Everything else comes from the live rows.
//
// The only INTENDED difference is `speed` (D2 — n8n stopped sending it).
// Any other difference fails the run. The live rows are also diffed against
// the rows n8n read, so a failure caused by the data having changed since
// the render can be told apart from a bug in the port — but it still fails,
// and a human decides which it was. (Status General and Link Video Final
// always differ: the render itself wrote them.)
import fs from 'node:fs';
import * as E from '../src/assembly/index.ts';

const [livePath, ...execPaths] = process.argv.slice(2);
if (!livePath || !execPaths.length) {
  console.error('usage: shadow.mjs <live.json> <exec-*.json>...');
  process.exit(2);
}

const runData = (file) => JSON.parse(fs.readFileSync(file, 'utf8')).data.resultData.runData;
const items = (rd, node) => (rd[node] ? rd[node][rd[node].length - 1].data.main[0].map((i) => i.json) : null);
const liveRows = items(runData(livePath), 'Read Engine Inputs');
const live = new Map(liveRows.map((r) => [r.project_id, r]));

/** Every path where a and b differ, after a JSON round trip (what the wire carries). */
function diff(a, b, at = '', out = []) {
  a = a === undefined ? undefined : JSON.parse(JSON.stringify(a));
  b = b === undefined ? undefined : JSON.parse(JSON.stringify(b));
  if (JSON.stringify(a) === JSON.stringify(b)) return out;
  const obj = (x) => x && typeof x === 'object';
  if (obj(a) && obj(b) && Array.isArray(a) === Array.isArray(b)) {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) diff(a[k], b[k], at ? `${at}.${k}` : k, out);
    return out;
  }
  out.push({ path: at || '(root)', n8n: a, engine: b });
  return out;
}
const INTENDED = new Set(['speed']);
const short = (v) => { const s = JSON.stringify(v); return s === undefined ? 'undefined' : s.length > 90 ? s.slice(0, 87) + '...' : s; };

let unexplained = 0;
const report = [];
for (const file of execPaths) {
  const rd = runData(file);
  const exec = JSON.parse(fs.readFileSync(file, 'utf8')).execution;
  const project = items(rd, 'Fetch Project Info')[0];
  const row = live.get(project.id);
  const name = (project.fields['Nume Proiect'] || '').slice(0, 50);
  console.log(`\n== ${exec.id}  ${project.id}  "${name}"  (${exec.startedAt.slice(0, 16)})`);
  if (!row) { console.log('   no live row: the project is gone'); unexplained++; continue; }

  // The data drift, if any: live rows against the rows n8n read.
  const byId = (rows) => new Map((rows || []).map((r) => [r.id, r]));
  const thenScenes = byId(items(rd, 'Fetch Approved Scenes')), nowScenes = byId(row.scene_rows);
  const drift = [];
  for (const id of new Set([...thenScenes.keys(), ...nowScenes.keys()])) {
    for (const d of diff(thenScenes.get(id), nowScenes.get(id))) drift.push(`scene ${id}: ${d.path}`);
  }
  for (const d of diff(project, row.project)) drift.push(`project: ${d.path}`);
  for (const d of diff(items(rd, 'Fetch Script Titles')?.[0], row.script)) drift.push(`script: ${d.path}`);
  console.log(`   data since the render: ${drift.length ? drift.length + ' field(s) changed' : 'unchanged'}`);
  for (const d of drift.slice(0, 8)) console.log(`     ${d}`);
  if (drift.length > 8) console.log(`     … ${drift.length - 8} more`);

  // The engine's requests from the live rows.
  const webhookBody = items(rd, 'Assemble Webhook')?.[0]?.body || { Project_ID: project.id };
  const triggers = { normalize: E.normalizeInput(webhookBody) };
  const input = { triggers, sceneRows: row.scene_rows, project: row.project };
  const music = items(rd, 'Pick Music Track')?.[0] || null;
  const assembly = E.planAssemble({ ...input, music });
  const assembled = items(rd, 'Render Guard')[0];
  const render = E.planRender({ ...input, assembly, script: row.script, assembled });
  const engineRender = { ...render.body, speed: E.playbackSpeed(row.project.fields) };

  const n8nAssemble = items(rd, 'Build Timeline')[0].body;
  const n8nRender = { ...items(rd, 'Source Watermark')[0].body, resolution: items(rd, 'Build Timeline')[0].resolution || '720p' };
  const a = diff(n8nAssemble, assembly.timeline.body);
  const r = diff(n8nRender, engineRender);
  const bad = [...a.map((d) => ({ ...d, req: '/assemble' })), ...r.map((d) => ({ ...d, req: '/render' }))].filter((d) => !INTENDED.has(d.path));
  console.log(`   /assemble: ${a.length ? a.length + ' difference(s)' : 'IDENTICAL'} (${assembly.timeline.body.scenes.length} scenes)`);
  console.log(`   /render:   ${r.length ? r.length + ' difference(s)' : 'IDENTICAL'}`);
  for (const d of [...a.map((x) => ({ ...x, req: '/assemble' })), ...r.map((x) => ({ ...x, req: '/render' }))]) {
    console.log(`     ${INTENDED.has(d.path) ? 'intended ' : 'UNEXPLAINED'} ${d.req} ${d.path}: n8n ${short(d.n8n)} → engine ${short(d.engine)}`);
  }
  // Strict: data drift is printed to help explain a difference, never to excuse one.
  unexplained += bad.length;
  report.push({ execution: exec.id, project: project.id, name, drift: drift.length, assembleDiffs: a.length, renderDiffs: r.length, unexpected: bad.map((d) => `${d.req} ${d.path}`) });
}

console.log(`\n${unexplained ? 'RESULT: FAIL' : 'RESULT: OK'} ${report.length} film(s) — ${unexplained} unexplained difference(s)`);
fs.writeFileSync(new URL('./last-report.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
process.exit(unexplained ? 1 : 0);
