// Voice: the engine's pickVoice and request builders against the LIVE n8n
// bodies and expressions they replace — Media Generation's `AB *` nodes and
// Claude Scripting's `VR *` nodes (fixtures/voice/, versions in its manifest).
//
//   node --experimental-strip-types check-voice.mjs      (part of npm run check)
//
// Every case runs through BOTH n8n pickers with their own stubs (the batch
// reads the default voice from its trigger and the film from a refetch; the
// regen webhook from the project row and an /api/at list) and through the one
// TS function. The expressions (`={{ … }}`) are evaluated as n8n would.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as V from './src/voice/voice.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const F = (f) => fs.readFileSync(path.join(here, 'fixtures', 'voice', f), 'utf8');
const EX = JSON.parse(F('expressions.json'));

let passed = 0, failed = 0;
const canon = (v) => JSON.stringify(v === undefined ? null : JSON.parse(JSON.stringify(v)));
const is = (label, got, want) => {
  if (canon(got) === canon(want)) { passed++; return; }
  failed++;
  console.log(`  FAIL ${label}\n       got  ${canon(got).slice(0, 400)}\n       want ${canon(want).slice(0, 400)}`);
};

/** `$(name)` over a map of node name → item json (or array for .all()). */
const dollar = (nodes) => (n) => {
  if (!(n in nodes)) throw new Error(`no stub for $('${n}')`);
  const v = nodes[n];
  const list = Array.isArray(v) ? v : [v];
  return { first: () => ({ json: list[0] }), all: () => list.map((j) => ({ json: j })), item: { json: list[0] } };
};
const runBody = (src, nodes) => new Function('$', '$json', '$input', '$runIndex', src)(dollar(nodes), {}, { all: () => [] }, 0)[0].json;
/** An n8n expression `={{ expr }}` evaluated with the same `$`. */
const runExpr = (expr, nodes) => new Function('$', `return (${expr.replace(/^=\{\{\s*/, '').replace(/\s*\}\}$/, '')});`)(dollar(nodes));

// --- Cases --------------------------------------------------------------------
const V1 = 'elevenlabs_AAAAAAAAAAAAAAAAAAAA', V2 = 'elevenlabs_BBBBBBBBBBBBBBBBBBBB', V3 = 'elevenlabs_CCCCCCCCCCCCCCCCCCCC';
const scene = (id, order, text, extra = {}) => ({ id, createdTime: '2026-09-01T00:00:00.000Z', fields: { 'Ordine Scenă': order, 'Script Scenă': text, ...extra } });
const film = [
  scene('recS1', 1, 'A hook line.'),
  scene('recS2', 101, '[NARRATOR] It began at dawn. [CHARACTER: Maria] Where is he? [CHARACTER: Ion] Here.'),
  scene('recS3', 102, '[CHARACTER: Ion] We go now. [NARRATOR] They went.'),
  scene('recS4', 201, 'Chapter two, plain.'),
  scene('recS5', 305, '[CHARACTER: Ana] Only me here.'),
  scene('recS6', 202, ''),
];
const project = (editing, voice = V1) => ({ id: 'recP', fields: { 'Voice ID': voice, 'Editing Options': editing === undefined ? undefined : JSON.stringify(editing) } });
const cases = [];
const add = (label, proj, sc) => cases.push({ label, proj, sc });
for (const s of film) {
  add(`off / ${s.id}`, project({}), s);
  add(`chapters cast / ${s.id}`, project({ multiVoiceMode: 'chapters', cast: [V2, V3] }), s);
  add(`chapters explicit / ${s.id}`, project({ multiVoiceMode: 'chapters', cast: [V2], chapterVoices: { hook: V3, 2: V1, 3: 'junk' } }), s);
  add(`characters / ${s.id}`, project({ multiVoiceMode: 'characters', cast: [V2, V3] }), s);
  add(`characters assigned / ${s.id}`, project({ multiVoiceMode: 'characters', cast: [V2, V3], castAssign: { Ion: V1, Maria: 'nope' } }), s);
}
add('no project voice → Bella', project({}, ''), film[1]);
add('project voice without _ → Bella', project({ multiVoiceMode: 'chapters', cast: [V2] }, 'hpp4J3'), film[3]);
add('characters with an empty cast', project({ multiVoiceMode: 'characters', cast: ['bad'] }), film[1]);
add('editing options malformed', { id: 'recP', fields: { 'Voice ID': V2, 'Editing Options': '{oops' } }, film[1]);
add('editing options absent', { id: 'recP', fields: { 'Voice ID': V2 } }, film[2]);
add('scene order missing, chapters', project({ multiVoiceMode: 'chapters', cast: [V2, V3] }), { id: 'recX', fields: { 'Script Scenă': 'x' } });
add('cinematic', project({ category: 'cinematic' }), film[0]);
add('voice tone set', project({ voice: { stability: 0.4, similarity: 0.8, style: 0.1 } }), film[0]);
add('voice tone, speakerBoost false', project({ voice: { stability: '0.4', similarity: 1, style: 0, speakerBoost: false } }), film[0]);
add('voice tone half set', project({ voice: { stability: 0.4, similarity: 2, style: 0.1 } }), film[0]);
add('voice tone garbage', project({ voice: 'loud' }), film[0]);

// --- Run ------------------------------------------------------------------------
for (const { label, proj, sc } of cases) {
  const ts = V.pickVoice({ projectVoice: proj.fields['Voice ID'], projectFields: proj.fields, scene: sc, allScenes: film });
  const ab = runBody(F('mg-AB Pick Voice.js'), {
    'Receive Batch Input': { Voice_ID: proj.fields['Voice ID'] },
    'AB Load Project': proj, 'AB Current Scene': sc, 'Refetch Scenes For Audio': film,
  });
  const vr = runBody(F('cs-VR Pick Voice.js'), {
    'VR Load Project': proj, 'VR Load Scene': sc, 'VR Load All Scenes': { records: film },
  });
  is(`${label}: batch picker`, ts, ab);
  is(`${label}: regen picker`, ts, vr);

  for (const [wf, p, cur] of [['mg', 'AB Load Project', 'AB Current Scene'], ['cs', 'VR Load Project', 'VR Load Scene']]) {
    const nodes = { [p]: proj, [cur]: sc, 'AB Pick Voice': ts, 'VR Pick Voice': ts };
    is(`${label}: ${wf} spoken text`, V.speakText(sc), runExpr(EX[wf].speakText, nodes));
    is(`${label}: ${wf} voice id`, ts.voice_id.replace(/^elevenlabs_/, ''), runExpr(EX[wf].voiceId, nodes));
    const vs = runExpr(EX[wf].voiceSettings, nodes);
    is(`${label}: ${wf} voice settings`, V.voiceSettings(proj.fields), vs === '' ? null : JSON.parse(vs));
    is(`${label}: ${wf} tts-multi body`, V.multiBody(ts, proj.fields), runExpr(EX[wf].multiBody, nodes));
    is(`${label}: ${wf} model + format`, [V.MODEL, V.OUTPUT_FORMAT], [EX[wf].model, EX[wf].outputFormat]);
  }
  is(`${label}: no speech`, V.noSpeech(sc, proj.fields), runExpr(EX.mg.noSpeech, { 'AB Current Scene': sc, 'AB Load Project': proj }));
}

// The pin: absent in n8n (VR Pick Voice never reads body.voice_id), so it is
// pinned to what CLAUDE.md and the site say it does.
{
  const pick = V.pickVoice({ projectVoice: V1, projectFields: project({ multiVoiceMode: 'characters', cast: [V2, V3] }).fields, scene: film[1], allScenes: film });
  is('a pin beats the mode rule and makes the take single-voice', V.applyPin(pick, V3), { voice_id: V3, multi: false, segments: [] });
  is('a placeholder pin is ignored', V.applyPin(pick, 'default'), pick);
  is('the n8n regen picker ignores the pin (why the engine differs)', /voice_id/.test(F('cs-VR Pick Voice.js').replace(/voice_id:/g, '')) && /body/.test(F('cs-VR Pick Voice.js')), false);
}
// The multi guard's ceiling, from both bodies.
is('multi poll ceiling = the live guards', V.MULTI_MAX_POLLS, [F('mg-AB Multi Guard.js'), F('cs-VR Multi Guard.js')].map((b) => Number(/> (\d+)\)/.exec(b)[1])).reduce((a, b) => (a === b ? a : NaN)));

const total = passed + failed;
console.log(`voice: ${failed || total === 0 ? 'RESULT: FAIL' : 'RESULT: OK'} ${passed}/${total}`);
if (failed || total === 0) process.exit(1);
