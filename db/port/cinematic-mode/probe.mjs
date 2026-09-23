// Writes probe-ops.json: the operations that turn an empty throwaway workflow
// (one Manual Trigger named "Start") into the Cinematic writing path running
// on a REAL film's inputs — the same node definitions build-ops.mjs sends to
// production, fed by Code stubs named exactly as the production nodes they
// stand in for, so every $('…') reference resolves as it will live.
//
//   node db/port/cinematic-mode/probe.mjs hobbit|astronaut
//
// The inputs are the two real Cinematic films diagnosed in the README: their
// Story Bible, length, brief, and the "Cinematic" genre profile row.
import fs from 'node:fs';
import path from 'node:path';
import { newNodes, edges } from './build-ops.mjs';

const dir = path.dirname(new URL(import.meta.url).pathname);
const fx = JSON.parse(fs.readFileSync(path.join(dir, 'fixtures.json'), 'utf8'));
const which = process.argv[2] || 'hobbit';
const FILMS = {
  hobbit: {
    Tema: 'A Hobbit from the Lord of The Rings constructing his underground Bag End house',
    Lenght: 95,
    Style: 'Nature',
    brief: 'The film should cover every single step from digging to the inside of the house',
    bible: fx.hobbitBible,
  },
  astronaut: {
    Tema: 'astronaut on a far away planet exploring it',
    Lenght: 300,
    Style: 'Space',
    brief: "About an astronaut exploring a far away planet and it's absolute beauty",
    bible: fx.astroBible,
  },
};
const f = FILMS[which];
if (!f) throw new Error('film: hobbit | astronaut');
// hov.genre_profile row for tone "Cinematic" (recpxleOibcgwkFM4), as read 2026-09-23.
const PROFILE = {
  format: 'cinematic short film',
  invention: 'Invention is REQUIRED. Do not hedge, do not cite, do not qualify. Once a rule of this world is set, it stays consistent.',
  visual:
    'Anamorphic feel, shallow depth of field, motivated practical light, deep blacks, blocking that places the character in relation to the space. The hour changes between chapters — dusk, night, blue hour, harsh noon — and weather is part of the story.',
};
const stub = (name, x, json) => ({
  type: 'addNode',
  node: { name, type: 'n8n-nodes-base.code', typeVersion: 2, position: [x, -300], parameters: { jsCode: 'return [{ json: ' + JSON.stringify(json) + ' }];' } },
});
const bible = f.bible || { logline: f.Tema, characters: [], objects: [], locations: [], visual_style: {}, motifs: [], continuity_rules: [] };
const ops = [
  stub('Receive Project Data', 200, { Project_ID: 'probe', Tema: f.Tema, Tonalitate: 'Cinematic', Pace: 'Normal', Lenght: f.Lenght, Language: 'English', Style: f.Style, Lore: '' }),
  stub('Fetch Project Record', 400, { fields: { 'Editing Options': JSON.stringify({ category: 'cinematic', producerBrief: f.brief }) } }),
  stub('Genre Profile', 600, { p: PROFILE }),
  stub('Generate Story Bible', 800, { output: bible }),
  stub('Extract Claims', 1000, { claimsList: '' }),
  stub('Voice Mode', 1200, { cinematic: true }),
  // The live model nodes carry a 300 s timeout; the probe keeps it.
  ...newNodes.filter((n) => n.name !== 'Cinematic?').map((n) => ({ type: 'addNode', node: { ...n, position: [n.position[0], n.position[1] + 200] } })),
  { type: 'addNode', node: { name: 'FC Prep', type: 'n8n-nodes-base.noOp', typeVersion: 1, position: [3500, 360], parameters: {} } },
  ...[['Start', 'Receive Project Data'], ['Receive Project Data', 'Fetch Project Record'], ['Fetch Project Record', 'Genre Profile'], ['Genre Profile', 'Generate Story Bible'], ['Generate Story Bible', 'Extract Claims'], ['Extract Claims', 'Voice Mode'], ['Voice Mode', 'Cine Treatment']].map(([s, t]) => ({ type: 'addConnection', source: s, target: t, sourceIndex: 0, connectionType: 'main' })),
  ...edges.filter(([s]) => s !== 'Save Story Bible' && s !== 'Cinematic?').map(([source, sourceIndex, target, connectionType]) => ({ type: 'addConnection', source, target, sourceIndex, connectionType })),
];
fs.writeFileSync(path.join(dir, `probe-ops.${which}.json`), JSON.stringify(ops) + '\n');
console.log(`probe-ops.${which}.json: ${ops.length} operations`);
