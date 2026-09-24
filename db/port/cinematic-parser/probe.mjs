// The throwaway probe: the NEW Cine Treatment prompt and parser, followed by the
// live Cine Shot List / Cine Guard, fed the exact inputs of the film that died
// at Cine Treatment Parser (execution 16640, recA0UObjuWIU0H07, 160 s cyberpunk
// commute). Its bible and brief are read from Postgres.
//   node db/port/cinematic-parser/probe.mjs   # writes probe-ops.json
import fs from 'node:fs';
import path from 'node:path';
const dir = path.dirname(new URL(import.meta.url).pathname);
const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');
const live = JSON.parse(read('cs.live.json'));
const node = (n) => JSON.parse(JSON.stringify(live.nodes.find((x) => x.name === n)));
const PID = 'recA0UObjuWIU0H07';
const PG = { postgres: { id: 'eRjiNDQFuDSTJpGK', name: 'HOV Postgres' } };
const code = (name, x, json) => ({ type: 'addNode', node: { name, type: 'n8n-nodes-base.code', typeVersion: 2, position: [x, -300], parameters: { jsCode: 'return [{ json: ' + JSON.stringify(json) + ' }];' } } });
const pg = (name, x, query) => ({ type: 'addNode', node: { name, type: 'n8n-nodes-base.postgres', typeVersion: 2.6, position: [x, -300], credentials: PG, parameters: { operation: 'executeQuery', options: {}, query } } });
const take = (n, params, dy = 200) => { const x = node(n); delete x.id; if (params) x.parameters = { ...x.parameters, ...params }; x.position = [x.position[0], x.position[1] + dy]; if (/lmChatOpenAi/.test(x.type)) x.credentials = { openAiApi: { id: 'oPGuXelJ6pnDePIs', name: 'OpenAI account' } }; delete x.webhookId; return { type: 'addNode', node: x }; };
const ops = [
  code('Receive Project Data', 200, { Project_ID: PID, Tema: 'The commute of an average person to work in cyberpank ', Tonalitate: 'Cinematic', Pace: 'Normal', Lenght: '160', Language: 'English', Style: 'Cyberpunk', Lore: '' }),
  pg('Fetch Project Record', 400, `select json_build_object('Editing Options', editing_options::text) as fields from hov.project where id = '${PID}'`),
  code('Genre Profile', 600, JSON.parse(read('fixture-genre.json'))),
  pg('Generate Story Bible', 800, `select story_bible::jsonb as output from hov.project where id = '${PID}'`),
  code('Extract Claims', 1000, { output: '', notes: '', claims: [], claimsList: '', refs: [], thin: false, researched: false }),
  code('Voice Mode', 1200, JSON.parse(read('fixture-voice.json'))),
  take('Cine Treatment', { text: '=' + read('paste/Cine_Treatment.txt').replace(/^=/, '') }),
  take('Cine Treatment Model'),
  take('Cine Treatment Parser', { jsonSchemaExample: read('paste/Cine_Treatment_Parser.json') }),
  take('Cine Shot List'),
  take('Cine Shot Model'),
  take('Cine Guard'),
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
