// The throwaway probe: the NEW Cine Treatment / Cine Shot List / Cine Guard on
// the Hobbit film's real bible (read from Postgres), as build-ops sends them.
//   node db/port/cinematic-continuity/probe.mjs   # writes probe-ops.json
import fs from 'node:fs';
import path from 'node:path';
const dir = path.dirname(new URL(import.meta.url).pathname);
const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');
const live = JSON.parse(read('cs.live.json'));
const node = (n) => JSON.parse(JSON.stringify(live.nodes.find((x) => x.name === n)));
const code = (name, x, json) => ({ type: 'addNode', node: { name, type: 'n8n-nodes-base.code', typeVersion: 2, position: [x, -300], parameters: { jsCode: 'return [{ json: ' + JSON.stringify(json) + ' }];' } } });
const take = (n, params, dy = 200) => { const x = node(n); delete x.id; if (params) x.parameters = { ...x.parameters, ...params }; x.position = [x.position[0], x.position[1] + dy]; if (/lmChatOpenAi/.test(x.type)) x.credentials = { openAiApi: { id: 'oPGuXelJ6pnDePIs', name: 'OpenAI account' } }; delete x.webhookId; return { type: 'addNode', node: x }; };
const ops = [
  code('Receive Project Data', 200, { Project_ID: 'probe', Tema: 'A Hobbit from the Lord of The Rings constructing his underground Bag End house', Tonalitate: 'Cinematic', Pace: 'Normal', Lenght: 95, Language: 'English', Style: 'Nature', Lore: '' }),
  code('Fetch Project Record', 400, { fields: { 'Editing Options': JSON.stringify({ category: 'cinematic', producerBrief: 'The film should cover every single step from digging to the inside of the house' }) } }),
  code('Genre Profile', 600, { p: { format: 'cinematic short film', invention: 'Invention is REQUIRED. Do not hedge, do not cite, do not qualify. Once a rule of this world is set, it stays consistent.', visual: 'Anamorphic feel, shallow depth of field, motivated practical light, deep blacks, blocking that places the character in relation to the space. The hour changes between chapters — dusk, night, blue hour, harsh noon — and weather is part of the story.' } }),
  { type: 'addNode', node: { name: 'Generate Story Bible', type: 'n8n-nodes-base.postgres', typeVersion: 2.6, position: [800, -300], credentials: { postgres: { id: 'eRjiNDQFuDSTJpGK', name: 'HOV Postgres' } }, parameters: { operation: 'executeQuery', options: {}, query: "select story_bible::jsonb as output from hov.project where id = 'rec0w52EKvBoBlBLF'" } } },
  code('Extract Claims', 1000, { claimsList: '' }),
  code('Voice Mode', 1200, { cinematic: true }),
  take('Cine Treatment', { text: read('paste/cs-Cine_Treatment.txt') }),
  take('Cine Treatment Model'),
  take('Cine Treatment Parser'),
  take('Cine Shot List', { text: read('paste/cs-Cine_Shot_List.txt') }),
  take('Cine Shot Model'),
  take('Cine Guard', { jsCode: read('paste/cs-Cine_Guard.js') }),
  take('If Cine Retry'),
  { type: 'addNode', node: { name: 'FC Prep', type: 'n8n-nodes-base.noOp', typeVersion: 1, position: [3500, 360], parameters: {} } },
  ...[['Start', 'Receive Project Data'], ['Receive Project Data', 'Fetch Project Record'], ['Fetch Project Record', 'Genre Profile'], ['Genre Profile', 'Generate Story Bible'], ['Generate Story Bible', 'Extract Claims'], ['Extract Claims', 'Voice Mode'], ['Voice Mode', 'Cine Treatment'], ['Cine Treatment', 'Cine Shot List'], ['Cine Shot List', 'Cine Guard'], ['Cine Guard', 'If Cine Retry']].map(([s, t]) => ({ type: 'addConnection', source: s, target: t, sourceIndex: 0, connectionType: 'main' })),
  { type: 'addConnection', source: 'If Cine Retry', target: 'Cine Shot List', sourceIndex: 0, connectionType: 'main' },
  { type: 'addConnection', source: 'If Cine Retry', target: 'FC Prep', sourceIndex: 1, connectionType: 'main' },
  { type: 'addConnection', source: 'Cine Treatment Model', target: 'Cine Treatment', sourceIndex: 0, connectionType: 'ai_languageModel' },
  { type: 'addConnection', source: 'Cine Treatment Parser', target: 'Cine Treatment', sourceIndex: 0, connectionType: 'ai_outputParser' },
  { type: 'addConnection', source: 'Cine Shot Model', target: 'Cine Shot List', sourceIndex: 0, connectionType: 'ai_languageModel' },
];
fs.writeFileSync(path.join(dir, 'probe-ops.json'), JSON.stringify(ops) + '\n');
console.log('probe-ops.json', ops.length, JSON.stringify(ops).length);
