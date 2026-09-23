// paste/ → the `update_workflow` operations for both workflows.
//
//   node db/port/cinematic-continuity/build-ops.mjs   # writes ops-cs.json, ops-mg.json
//
// Claude Scripting, the hook: a Cinematic film skips it.
//
//   Combine Chapters → Hook Wanted? ─[true]→ Generate Hook → … (unchanged)
//                                   └[false]→ Clear Hook Plan → No Hook Done → Save Script To Airtable
//
// `Save Script To Airtable` reads `$json.output`, which is exactly what
// `Combine Chapters` emits, so the bypass only has to hand that item on —
// after a Postgres node, which replaces `$json`, hence `No Hook Done`.
import fs from 'node:fs';
import path from 'node:path';

const dir = path.dirname(new URL(import.meta.url).pathname);
const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');
const PG = { postgres: { id: 'eRjiNDQFuDSTJpGK', name: 'HOV Postgres' } };

export const csNewNodes = [
  {
    name: 'Hook Wanted?',
    type: 'n8n-nodes-base.if',
    typeVersion: 2.3,
    position: [3832, 380],
    // true = write a hook. The Cinematic check is strict, the same reading
    // `Cinematic?` makes of the same flag.
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 3 },
        conditions: [
          {
            id: 'hook-wanted',
            leftValue: "={{ $('Voice Mode').first().json.cinematic !== true }}",
            rightValue: '',
            operator: { type: 'boolean', operation: 'true', singleValue: true },
          },
        ],
        combinator: 'and',
      },
      options: {},
    },
  },
  {
    name: 'Clear Hook Plan',
    type: 'n8n-nodes-base.postgres',
    typeVersion: 2.6,
    position: [4072, 380],
    credentials: PG,
    parameters: {
      operation: 'executeQuery',
      options: {},
      query:
        "-- A Cinematic film has no hook (2026-09-23, db/port/cinematic-continuity).\n" +
        "-- A film scripted again may still carry the plan an earlier run wrote, and\n" +
        "-- the render draws from it, so the plan is removed rather than left behind.\n" +
        "update hov.project\n" +
        "   set editing_options = coalesce(editing_options, '{}'::jsonb) - 'hookPlan'\n" +
        " where id = $hov${{ $('Receive Project Data').first().json.Project_ID }}$hov$\n" +
        "returning id;",
    },
  },
  {
    name: 'No Hook Done',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [4312, 380],
    parameters: {
      jsCode:
        "// Restore the stream after Clear Hook Plan, which answers with a project id.\n" +
        "// Save Script To Airtable reads $json.output, and Combine Chapters is what\n" +
        "// produced it — a Cinematic film's script is its shot list with no chapter 0.\n" +
        "return [$('Combine Chapters').first()];\n",
    },
  },
];
export const csEdges = [
  ['Combine Chapters', 0, 'Hook Wanted?'],
  ['Hook Wanted?', 0, 'Generate Hook'],
  ['Hook Wanted?', 1, 'Clear Hook Plan'],
  ['Clear Hook Plan', 0, 'No Hook Done'],
  ['No Hook Done', 0, 'Save Script To Airtable'],
];
export const csRemovals = [['Combine Chapters', 0, 'Generate Hook']];

const conn = (type, [source, sourceIndex, target]) => ({ type, source, target, sourceIndex, connectionType: 'main' });

const opsCs = [
  { type: 'updateNodeParameters', nodeName: 'Voice Mode', parameters: { jsCode: read('paste/cs-Voice_Mode.js') } },
  { type: 'updateNodeParameters', nodeName: 'IR Build Request', parameters: { jsCode: read('paste/cs-IR_Build_Request.js') } },
  { type: 'updateNodeParameters', nodeName: 'Cine Guard', parameters: { jsCode: read('paste/cs-Cine_Guard.js') } },
  { type: 'updateNodeParameters', nodeName: 'Cine Treatment', parameters: { text: read('paste/cs-Cine_Treatment.txt') } },
  { type: 'updateNodeParameters', nodeName: 'Cine Shot List', parameters: { text: read('paste/cs-Cine_Shot_List.txt') } },
  ...csNewNodes.map((n) => ({ type: 'addNode', node: n })),
  ...csRemovals.map((e) => conn('removeConnection', e)),
  ...csEdges.map((e) => conn('addConnection', e)),
];
const opsMg = [
  { type: 'updateNodeParameters', nodeName: 'Build Image Request', parameters: { jsCode: read('paste/mg-Build_Image_Request.js') } },
  { type: 'updateNodeParameters', nodeName: 'Evaluate Image Approval', parameters: { jsCode: read('paste/mg-Evaluate_Image_Approval.js') } },
];
for (const op of opsCs) {
  const q = op.node && op.node.parameters && op.node.parameters.query;
  if (!q) continue;
  if (q.includes('$hov$$')) throw new Error(`${op.node.name}: doubled $ before an expression`);
  if ((q.match(/\$hov\$/g) || []).length % 2) throw new Error(`${op.node.name}: unpaired $hov$`);
  if (/\$\d/.test(q)) throw new Error(`${op.node.name}: $ followed by a digit`);
}
fs.writeFileSync(path.join(dir, 'ops-cs.json'), JSON.stringify(opsCs) + '\n');
fs.writeFileSync(path.join(dir, 'ops-mg.json'), JSON.stringify(opsMg) + '\n');
console.log(`ops-cs.json: ${opsCs.length} operations (${JSON.stringify(opsCs).length} bytes); ops-mg.json: ${opsMg.length} (${JSON.stringify(opsMg).length} bytes)`);
