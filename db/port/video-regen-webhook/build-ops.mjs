// Turns paste/ + the new-node definitions into the exact `update_workflow`
// operations this change applies, so the MCP call is generated from committed
// files rather than composed in a tool call (db/port/lib/README.md, "The
// mandatory canonical-source-file convention").
//
//   node db/port/video-regen-webhook/build-ops.mjs         # writes ops.json
//
// It reads the LIVE snapshot for the one node whose parameters are more than
// a single body (`Submit Video Regen`), so the untouched keys come back
// exactly as n8n stored them instead of being retyped.
import fs from 'node:fs';
import path from 'node:path';

const dir = path.dirname(new URL(import.meta.url).pathname);
const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');
const live = JSON.parse(read('mg.live.json'));
const W = live.workflow || live;
const node = (n) => {
  const x = W.nodes.find((a) => a.name === n);
  if (!x) throw new Error(`no live node named ${n}`);
  return x;
};

const PG = { postgres: { id: 'eRjiNDQFuDSTJpGK', name: 'HOV Postgres' } };
/** Airtable-shaped record ids only — this string is interpolated into SQL. */
const SAFE_ID = (expr) => `{{ String(${expr} || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 40) }}`;

// ---------------------------------------------------------------------------
// The nine new nodes.
// ---------------------------------------------------------------------------
const newNodes = [
  {
    name: 'Video Regen Webhook',
    type: 'n8n-nodes-base.webhook',
    typeVersion: 2,
    position: [-1600, 2960],
    // THE ONE DELIBERATE DEVIATION from its three siblings on Claude Scripting
    // (`scene-text-regen`, `scene-image-regen`, `scene-voice-regen`), which
    // all take n8n's default `lastNode` and answer when the workflow ends.
    // Those finish in seconds. This one is a Veo submit plus a poll loop —
    // minutes — and the site's fetch gives every webhook 15 s before it
    // aborts, so `lastNode` would report a failure on every successful
    // regeneration. `onReceived` answers the moment the run starts, which is
    // also the honest answer: the request was accepted, not completed.
    parameters: { httpMethod: 'POST', path: 'scene-video-regen', responseMode: 'onReceived', options: {} },
  },
  {
    name: 'VRW Load Scene',
    type: 'n8n-nodes-base.postgres',
    typeVersion: 2.6,
    position: [-1380, 2960],
    credentials: PG,
    // alwaysOutputData so a scene id that matches nothing arrives at
    // `VRW Build Regen` as one empty item and throws there, loudly, instead
    // of ending the run with no node having executed and no trace of why.
    alwaysOutputData: true,
    parameters: {
      operation: 'executeQuery',
      options: {},
      // Both rows in one query, in the Airtable-shaped `fields` form the whole
      // tail already speaks — the same shape `IMG Load Project` and `Fetch
      // Scene Videos` hand the batch path.
      query: `select sv.fields as scene, pv.fields as project, s.project_id
from hov.at_scene sv
join hov.scene s on s.id = sv.id
join hov.at_project pv on pv.id = s.project_id
where sv.id = $hov$${SAFE_ID('$json.body.scene_id')}$hov$`,
    },
  },
  {
    name: 'VRW Build Regen',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [-1160, 2960],
    parameters: { jsCode: read('paste/mg-VRW_Build_Regen.js') },
  },
  {
    name: 'VRW Can Regen?',
    type: 'n8n-nodes-base.if',
    typeVersion: 2.3,
    position: [-940, 2960],
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 3 },
        conditions: [{ id: 'vrw-can-regen', leftValue: '={{ $json.ok }}', rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }],
        combinator: 'and',
      },
      options: {},
    },
  },
  {
    name: 'VRW Refuse?',
    type: 'n8n-nodes-base.if',
    typeVersion: 2.3,
    position: [-720, 3080],
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 3 },
        conditions: [{ id: 'vrw-should-write', leftValue: '={{ $json.write }}', rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }],
        combinator: 'and',
      },
      options: {},
    },
  },
  {
    name: 'VRW Refuse',
    type: 'n8n-nodes-base.postgres',
    typeVersion: 2.6,
    position: [-500, 3080],
    credentials: PG,
    parameters: {
      operation: 'executeQuery',
      options: {},
      // THE LOCAL EXIT. `Regenerează Video` is cleared by code inside a run,
      // and the UI shows the in-flight state INSTEAD of the button row — so a
      // webhook that gave up without clearing it would leave the scene
      // unapprovable, unretryable and waiting forever, which is the dead end
      // CLAUDE.md names once per in-flight flag. The note starts with
      // "REJECTED" on purpose: `Evaluate Video Approval` strips exactly that
      // prefix out of the producer's feedback slot, so this sentence can
      // never be handed to Veo as a shot instruction on the next attempt.
      //
      // Approval is deliberately NOT touched. The request that set this flag
      // already un-approved the clip, and whether the clip that survived is
      // good enough is the producer's call, not this node's.
      query: `select * from hov.at_write($hov$scene$hov$, $hov$${SAFE_ID('$json.sceneId')}$hov$,
  $hov\${{ JSON.stringify({ "Regenerează Video": false, "Status Producție Scenă": "Așteaptă Aprobare Video", "Observații Scenă": 'REJECTED — ' + String($json.reason || 'this scene cannot be re-shot') + '. Nothing was thrown away: the clip you have is still there.' }) }}$hov$::jsonb)`,
    },
  },
  {
    name: 'VRW Video Done?',
    type: 'n8n-nodes-base.if',
    typeVersion: 2.3,
    position: [2150, 1760],
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 3 },
        // `Prep Video Regen` is the node that knows which door this run came
        // through, and it is on every path that reaches here.
        conditions: [{ id: 'vrw-video-done', leftValue: "={{ $('Prep Video Regen').first().json.viaWebhook }}", rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }],
        combinator: 'and',
      },
      options: {},
    },
  },
  {
    name: 'VRW Filtered Done?',
    type: 'n8n-nodes-base.if',
    typeVersion: 2.3,
    position: [368, 1900],
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 3 },
        conditions: [{ id: 'vrw-filtered-done', leftValue: "={{ $('Prep Video Regen').first().json.viaWebhook }}", rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }],
        combinator: 'and',
      },
      options: {},
    },
  },
  {
    name: 'VRW End',
    type: 'n8n-nodes-base.noOp',
    typeVersion: 1,
    position: [-280, 3080],
    parameters: {},
  },
];

// ---------------------------------------------------------------------------
// Connections. The two `removeConnection`s are the whole reason the terminals
// need an If at all: on the batch path `Write Regen Video` and `Mark Regen
// Filtered` go back to `Wait Video Approval` and the gate polls again, which
// is right for a batch and wrong for a webhook — that loop reads
// `$('Sort & Cap Scenes')`, a node only the batch executes.
// ---------------------------------------------------------------------------
const edges = [
  ['Video Regen Webhook', 0, 'VRW Load Scene'],
  ['VRW Load Scene', 0, 'VRW Build Regen'],
  ['VRW Build Regen', 0, 'VRW Can Regen?'],
  ['VRW Can Regen?', 0, 'Prep Video Regen'],
  ['VRW Can Regen?', 1, 'VRW Refuse?'],
  ['VRW Refuse?', 0, 'VRW Refuse'],
  ['VRW Refuse?', 1, 'VRW End'],
  ['VRW Refuse', 0, 'VRW End'],
  ['Write Regen Video', 0, 'VRW Video Done?'],
  ['VRW Video Done?', 0, 'VRW End'],
  ['VRW Video Done?', 1, 'Wait Video Approval'],
  ['Mark Regen Filtered', 0, 'VRW Filtered Done?'],
  ['VRW Filtered Done?', 0, 'VRW End'],
  ['VRW Filtered Done?', 1, 'Wait Video Approval'],
];
const removals = [
  ['Write Regen Video', 0, 'Wait Video Approval'],
  ['Mark Regen Filtered', 0, 'Wait Video Approval'],
];

const ops = [
  // Bodies first, so that if anything below fails the workflow is still
  // coherent: the four edited nodes are a no-op improvement on their own.
  { type: 'updateNodeParameters', nodeName: 'Prep Video Regen', parameters: { jsCode: read('paste/mg-Prep_Video_Regen.js') } },
  { type: 'updateNodeParameters', nodeName: 'RG End Frame Prompt', parameters: { jsCode: read('paste/mg-RG_End_Frame_Prompt.js') } },
  { type: 'updateNodeParameters', nodeName: 'RG Motion Prep', parameters: { jsCode: read('paste/mg-RG_Motion_Prep.js') } },
  // Only `jsonBody`. `updateNodeParameters` MERGES rather than replaces
  // (verified against a throwaway workflow: sending one key left the node's
  // other parameters untouched), and this node's untouched keys include a
  // useapi bearer token typed straight into a header parameter — which is a
  // parameter, not a credential, so the API does not redact it. Sending the
  // whole object would copy that token into ops.json and into this commit.
  { type: 'updateNodeParameters', nodeName: 'Submit Video Regen', parameters: { jsonBody: read('paste/mg-Submit_Video_Regen.txt') } },
  ...newNodes.map((n) => ({ type: 'addNode', node: n })),
  // `source` / `target` / `sourceIndex`, NOT from/to/fromOutput, and NOT
  // `sourceOutput`. Two separate traps, and only the first one is loud:
  //
  //   * from/to/fromOutput is REJECTED, the whole call rolls back, nothing
  //     is half-applied. Fine.
  //   * `sourceOutput: 1` is ACCEPTED and SILENTLY IGNORED — the edge lands
  //     on output 0. On an If node that puts both branches on `true`, which
  //     here would have sent every refusal into `Prep Video Regen` (a throw)
  //     and every webhook run back into the batch gate (the exact failure
  //     this change exists to prevent). It was caught only by diffing the
  //     live draft against the simulated one, edge for edge. `check-live.mjs`
  //     now asserts it directly.
  ...removals.map(([source, sourceIndex, target]) => ({ type: 'removeConnection', source, target, sourceIndex })),
  ...edges.map(([source, sourceIndex, target]) => ({ type: 'addConnection', source, target, sourceIndex })),
];

// A generated SQL string is the one thing here nobody reads twice, and the
// dollar-quote is a single character away from being wrong in a way Postgres
// reports as a syntax error at runtime, on a producer's click. `$hov$$` (a
// doubled dollar before an n8n expression) is exactly the slip this caught
// once already, so it is now impossible to ship.
for (const op of ops) {
  const q = op.node && op.node.parameters && op.node.parameters.query;
  if (!q) continue;
  if (q.includes('$hov$$')) throw new Error(`${op.node.name}: doubled $ before an n8n expression — the dollar-quote opens as $hov$ and the expression starts with {{`);
  const opens = (q.match(/\$hov\$/g) || []).length;
  if (opens % 2 !== 0) throw new Error(`${op.node.name}: ${opens} $hov$ delimiters — they must pair`);
  if (/\$\d/.test(q)) throw new Error(`${op.node.name}: a $ followed by a digit — Postgres reads that as a positional parameter`);
}

fs.writeFileSync(path.join(dir, 'ops.json'), JSON.stringify(ops, null, 1) + '\n');
console.log(`ops.json: ${ops.length} operations, ${JSON.stringify(ops).length} bytes`);
for (const o of ops) console.log('  ' + o.type + ' ' + (o.nodeName || (o.node && o.node.name) || `${o.from}[${o.fromOutput}] -> ${o.to}`));
