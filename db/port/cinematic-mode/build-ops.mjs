// Turns paste/ + the new-node definitions into the exact `update_workflow`
// operations this change applies to Claude Scripting (gkEtGMecv4TC3ZHp), so
// the MCP call is generated from committed files rather than composed in a
// tool call (db/port/lib/README.md, "The mandatory canonical-source-file
// convention").
//
//   node db/port/cinematic-mode/build-ops.mjs      # writes ops.json
//
// The graph change, in one picture:
//
//   Save Story Bible → Cinematic? ─[false]→ Generate Outline → … (Story path, untouched)
//                                  └[true]→ Cine Treatment → Cine Shot List → Cine Guard → If Cine Retry
//                                                                ↑                      │[true]
//                                                                └──────────────────────┘
//                                                                      If Cine Retry[false] → FC Prep
//
// It rejoins at `FC Prep`, which is where `If Narration Retry`[1] enters, and
// Cine Guard hands on the exact shape Narration Guard does, so Deep Search
// (which skips a non-documentary and writes its report row), Combine
// Chapters, the hook and everything after it run unchanged.
import fs from 'node:fs';
import path from 'node:path';

const dir = path.dirname(new URL(import.meta.url).pathname);
const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');

const OPENAI = { openAiApi: { id: 'oPGuXelJ6pnDePIs', name: 'OpenAI account' } };
// The same model and limits as every other writing node in this workflow
// (Outline Model, Narration Model, Editor Model).
const MODEL = {
  model: { __rl: true, value: 'gpt-5.4', mode: 'list', cachedResultName: 'gpt-5.4' },
  builtInTools: {},
  options: { timeout: 300000, maxRetries: 2 },
};
const IF = (id, left) => ({
  conditions: {
    options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 3 },
    conditions: [{ id, leftValue: left, rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }],
    combinator: 'and',
  },
  options: {},
});

export const newNodes = [
  {
    name: 'Cinematic?',
    type: 'n8n-nodes-base.if',
    typeVersion: 2.3,
    position: [2150, 380],
    // Strict `=== true`, the same reading Plan Scene Splits and Combine
    // Chapters make of the same flag: one owner (Voice Mode), one meaning.
    parameters: IF('cinematic-path', "={{ $('Voice Mode').first().json.cinematic === true }}"),
  },
  {
    name: 'Cine Treatment',
    type: '@n8n/n8n-nodes-langchain.agent',
    typeVersion: 3.1,
    position: [2400, 160],
    parameters: { promptType: 'define', text: read('paste/Cine Treatment.txt'), hasOutputParser: true, options: {} },
  },
  {
    name: 'Cine Treatment Model',
    type: '@n8n/n8n-nodes-langchain.lmChatOpenAi',
    typeVersion: 1.3,
    position: [2368, 360],
    credentials: OPENAI,
    parameters: MODEL,
  },
  {
    name: 'Cine Treatment Parser',
    type: '@n8n/n8n-nodes-langchain.outputParserStructured',
    typeVersion: 1.3,
    position: [2528, 360],
    parameters: { jsonSchemaExample: read('paste/Cine Treatment Parser.json').trim() },
  },
  {
    name: 'Cine Shot List',
    type: '@n8n/n8n-nodes-langchain.agent',
    typeVersion: 3.1,
    position: [2752, 160],
    parameters: { promptType: 'define', text: read('paste/Cine Shot List.txt'), options: {} },
  },
  {
    name: 'Cine Shot Model',
    type: '@n8n/n8n-nodes-langchain.lmChatOpenAi',
    typeVersion: 1.3,
    position: [2736, 360],
    credentials: OPENAI,
    parameters: MODEL,
  },
  {
    name: 'Cine Guard',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [3040, 160],
    parameters: { jsCode: read('paste/Cine Guard.js') },
  },
  {
    name: 'If Cine Retry',
    type: 'n8n-nodes-base.if',
    typeVersion: 2.3,
    position: [3280, 160],
    parameters: IF('cine-retry', '={{ $json.retry }}'),
  },
];

// [source, sourceIndex, target, connectionType]
export const edges = [
  ['Save Story Bible', 0, 'Cinematic?', 'main'],
  ['Cinematic?', 0, 'Cine Treatment', 'main'],
  ['Cinematic?', 1, 'Generate Outline', 'main'],
  ['Cine Treatment Model', 0, 'Cine Treatment', 'ai_languageModel'],
  ['Cine Treatment Parser', 0, 'Cine Treatment', 'ai_outputParser'],
  ['Cine Treatment', 0, 'Cine Shot List', 'main'],
  ['Cine Shot Model', 0, 'Cine Shot List', 'ai_languageModel'],
  ['Cine Shot List', 0, 'Cine Guard', 'main'],
  ['Cine Guard', 0, 'If Cine Retry', 'main'],
  ['If Cine Retry', 0, 'Cine Shot List', 'main'],
  ['If Cine Retry', 1, 'FC Prep', 'main'],
];
export const removals = [['Save Story Bible', 0, 'Generate Outline', 'main']];

const ops = [
  // Bodies of the existing nodes first. On their own they are inert for a
  // Story film and harmless for a Cinematic one (Combine Chapters would only
  // read Cine Treatment once the branch exists).
  { type: 'updateNodeParameters', nodeName: 'Voice Mode', parameters: { jsCode: read('paste/cs-Voice_Mode.js') } },
  { type: 'updateNodeParameters', nodeName: 'Plan Scene Splits', parameters: { jsCode: read('paste/cs-Plan_Scene_Splits.js') } },
  { type: 'updateNodeParameters', nodeName: 'Combine Chapters', parameters: { jsCode: read('paste/cs-Combine_Chapters.js') } },
  // Only `jsonBody` — updateNodeParameters MERGES, so the node's URL,
  // credential binding and timeout stay exactly as stored.
  { type: 'updateNodeParameters', nodeName: 'Rewrite Script', parameters: { jsonBody: read('paste/cs-Rewrite_Script.txt') } },
  ...newNodes.map((n) => ({ type: 'addNode', node: n })),
  // `source` / `target` / `sourceIndex` — NOT `sourceOutput`, which is
  // accepted and silently ignored (CLAUDE.md, cross-cutting gotchas). The If
  // node's false arm is sourceIndex 1.
  ...removals.map(([source, sourceIndex, target, connectionType]) => ({ type: 'removeConnection', source, target, sourceIndex, connectionType })),
  ...edges.map(([source, sourceIndex, target, connectionType]) => ({ type: 'addConnection', source, target, sourceIndex, connectionType })),
];

fs.writeFileSync(path.join(dir, 'ops.json'), JSON.stringify(ops, null, 1) + '\n');
console.log(`ops.json: ${ops.length} operations, ${JSON.stringify(ops).length} bytes`);
for (const o of ops) console.log('  ' + o.type + ' ' + (o.nodeName || (o.node && o.node.name) || `${o.source}[${o.sourceIndex}] -${o.connectionType}-> ${o.target}`));
