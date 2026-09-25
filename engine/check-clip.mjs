// Clips: the engine's scene-video-regen port against the LIVE Media
// Generation nodes it replaces (fixtures/clip/, version in its manifest).
//
//   node --experimental-strip-types check-clip.mjs      (part of npm run check)
//
// Each function in src/clip/regen.ts runs beside its node, fed the same
// inputs: n8n's `$`, `$input`, `$json`, the workflow static data (compared
// AFTER the run too — the counters are behaviour) and a frozen `Date.now`.
// The one intended difference, the audio-filter note, is asserted as such.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as R from './src/clip/regen.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const F = (f) => fs.readFileSync(path.join(here, 'fixtures', 'clip', f), 'utf8');
const EX = JSON.parse(F('expressions.json'));
const NOW = Date.parse('2026-09-25T20:00:00.000Z');
class FixedDate extends Date { static now() { return NOW; } }

let passed = 0, failed = 0;
const canon = (v) => JSON.stringify(v === undefined ? null : JSON.parse(JSON.stringify(v)));
const is = (label, got, want) => {
  if (canon(got) === canon(want)) { passed++; return; }
  failed++;
  console.log(`  FAIL ${label}\n       got  ${canon(got).slice(0, 500)}\n       want ${canon(want).slice(0, 500)}`);
};
const clone = (x) => JSON.parse(JSON.stringify(x));
const tryRun = (f) => { try { return f(); } catch (e) { return { error: e.message }; } };

/** A node body or expression, run as n8n runs it. `nodes`: name → json, or absent (throws, like an unexecuted node). */
function n8n(src, { nodes = {}, json = {}, input = [], sd = {}, executed = {} } = {}) {
  const $ = (n) => {
    const has = n in nodes;
    return {
      isExecuted: executed[n] ?? has,
      first: () => { if (!has) throw new Error(`Node '${n}' hasn't been executed`); return { json: nodes[n] }; },
      all: () => { if (!has) throw new Error(`Node '${n}' hasn't been executed`); return [{ json: nodes[n] }]; },
      get item() { return { json: nodes[n] }; },
    };
  };
  const $input = { all: () => input.map((j) => ({ json: j })), first: () => ({ json: input[0] }) };
  const body = src.startsWith('={{') ? `return (${src.replace(/^=\{\{\s*/, '').replace(/\s*\}\}$/, '')});` : src;
  const out = new Function('$', '$json', '$input', '$runIndex', '$getWorkflowStaticData', 'console', 'Date', body)($, json, $input, 0, () => sd, { log() {} }, FixedDate);
  return Array.isArray(out) && out[0] && 'json' in out[0] ? out[0].json : out;
}

// --- Scenes -------------------------------------------------------------------------------
const hex = (s) => Buffer.from(s).toString('hex');
const IMG_MANAGER = 'CAMS-image:abc-email:' + hex('fermafabiz@gmail.com') + '-x';
const IMG_OTHER = 'CAMS-image:def-email:' + hex('houseofvideos01@gmail.com') + '-y';
const scene = (over = {}) => ({ 'Regenerează Video': true, 'Image Media ID': IMG_MANAGER, 'Video Scenă URL': 'Slow push-in as Livia lifts the grain sack onto the scale. Negative: morphing, text', 'Voiceover URL': 'https://v/1.mp3', ...over });
const project = (editing = {}, fmt = '16:9') => ({ Format: fmt, 'Editing Options': JSON.stringify(editing) });
const rows = {
  plain: { scene: scene(), project: project(), project_id: 'recP' },
  feedback: { scene: scene({ 'Observații Scenă': 'She keeps holding the sack. Negative: none' }), project: project(), project_id: 'recP' },
  machineNote: { scene: scene({ 'Observații Scenă': 'AUTO-REWRITE-VIDEO (attempt 2): refused' }), project: project(), project_id: 'recP' },
  rejectedNote: { scene: scene({ 'Observații Scenă': 'REJECTED by the video filter' }), project: project(), project_id: 'recP' },
  tailOnly: { scene: scene({ 'Video Scenă URL': 'Negative: morphing' }), project: project(), project_id: 'recP' },
  notAsking: { scene: scene({ 'Regenerează Video': false }), project: project(), project_id: 'recP' },
  noImage: { scene: scene({ 'Image Media ID': '' }), project: project(), project_id: 'recP' },
  noMotion: { scene: scene({ 'Video Scenă URL': '  ' }), project: project(), project_id: 'recP' },
  portrait: { scene: scene(), project: project({}, '9:16'), project_id: 'recP' },
  twoTakes: { scene: scene({ 'Versiuni Media': JSON.stringify([{ kind: 'video' }, { kind: 'video' }, { kind: 'image' }]) }), project: project(), project_id: 'recP' },
  twoTakesPaidOff: { scene: scene({ 'Versiuni Media': [{ kind: 'video' }, { kind: 'video' }] }), project: project({ rescueVideoModel: '' }), project_id: 'recP' },
  customModel: { scene: scene(), project: project({ videoModel: 'veo-3.1-fast' }), project_id: 'recP' },
  endFrameOn: { scene: scene(), project: project({ endFrame: true }), project_id: 'recP' },
  endFrameString: { scene: scene(), project: project({ endFrame: 'true' }), project_id: 'recP' },
  otherAccount: { scene: scene({ 'Image Media ID': IMG_OTHER }), project: project(), project_id: 'recP' },
  judgeOff: { scene: scene(), project: project({ motionJudge: false }), project_id: 'recP' },
  badOptions: { scene: scene(), project: { Format: '16:9', 'Editing Options': '{nope' }, project_id: 'recP' },
};

// --- VRW Build Regen + VRW Refuse ---------------------------------------------------------------
for (const [label, row] of Object.entries(rows)) {
  const live = tryRun(() => n8n(F('VRW Build Regen.js'), { nodes: { 'Video Regen Webhook': { body: { scene_id: 'recS1' } } }, input: [row] }));
  is(`build: ${label}`, tryRun(() => R.buildVideoRegen('recS1', row)), live);
}
is('build: no scene id', tryRun(() => R.buildVideoRegen('', rows.plain)), tryRun(() => n8n(F('VRW Build Regen.js'), { nodes: { 'Video Regen Webhook': { body: {} } }, input: [rows.plain] })));
is('build: missing row', tryRun(() => R.buildVideoRegen('recS1', null)), tryRun(() => n8n(F('VRW Build Regen.js'), { nodes: { 'Video Regen Webhook': { body: { scene_id: 'recS1' } } }, input: [] })));
const fieldsOfQuery = (q, json) => JSON.parse(n8n('={{ ' + q.slice(q.lastIndexOf('{{ JSON.stringify(') + 3, q.lastIndexOf(') }}') + 1) + ' }}', { json }));
for (const reason of ['this scene has no Flow image id…', '']) {
  is(`refuse fields: ${JSON.stringify(reason)}`, R.refusalFields(reason), fieldsOfQuery(EX.refuse, { sceneId: 'recS1', reason }));
}

// --- Prep Video Regen ---------------------------------------------------------------------------------
const built = {};
for (const [label, row] of Object.entries(rows)) {
  const b = R.buildVideoRegen('recS1', row);
  if (!b.ok) continue;
  built[label] = b;
  const live = tryRun(() => n8n(F('Prep Video Regen.js'), { json: clone(b), nodes: { 'Video Regen Webhook': {} } }));
  is(`prep: ${label}`, tryRun(() => R.prepVideoRegen(clone(b), NOW)), live);
}
const P = (label) => R.prepVideoRegen(clone(built[label]), NOW);

// --- End frame --------------------------------------------------------------------------------------
for (const [label, sd] of [['endFrameOn', {}], ['endFrameOn', { endFrameOffAt: NOW - 60_000 }], ['endFrameOn', { endFrameOffAt: NOW - 7 * 3600_000 }], ['endFrameString', {}], ['plain', {}]]) {
  const p = P(label);
  const live = n8n(F('RG End Frame Prompt.js'), { json: clone(p), sd: clone(sd) });
  const ts = R.endFramePlan(p, clone(sd), NOW);
  is(`end frame plan: ${label} ${JSON.stringify(sd)}`, ts, { efOk: live.efOk, ...(live.efOk ? { efRequest: live.efRequest } : { efReason: live.efReason }) });
  if (live.efOk) {
    for (const ref of [IMG_MANAGER, IMG_OTHER, 'no-owner']) {
      const efRequest = { ...live.efRequest, reference_1: ref };
      is(`end frame body: ${ref.slice(0, 16)}`, R.endFrameBody(efRequest), n8n(EX.endFrameSubmit, { nodes: { 'RG End Frame Prompt': { efRequest } } }));
    }
  }
}
for (const resp of [{ media: [{ image: { generatedImage: { mediaGenerationId: 'CAMS-image:end' } } }] }, { error: { message: '400 bad end frame' } }, { media: [] }, null]) {
  const live = n8n(F('RG Attach End Frame.js'), { json: resp, nodes: { 'RG End Frame Prompt': { id: 'recS1' } } });
  is(`attach end frame: ${JSON.stringify(resp).slice(0, 40)}`, R.attachEndFrame(resp), { endImage: live.endImage, efError: live.efError });
}

// --- Submit Video Regen ---------------------------------------------------------------------------
const submitCases = [
  ['plain', {}], ['feedback', {}], ['portrait', {}], ['otherAccount', {}], ['twoTakes', {}], ['customModel', {}],
  ['plain', { attached: { sceneId: 'recS1', endImage: 'END1' } }],
  ['plain', { attached: { sceneId: 'recOTHER', endImage: 'END1' } }],
  ['plain', { attached: { sceneId: 'recS1', endImage: 'END1' }, cooldown: { sceneId: 'recS1', dropEndFrame: true } }],
  ['plain', { resubmit: 'fromPrep' }],
  ['plain', { resubmit: 'fromPrep', attached: { sceneId: 'recS1', endImage: 'END1' }, morph: true }],
  ['plain', { resubmit: 'stale' }],
];
for (const [label, extra] of submitCases) {
  const p = P(label);
  let resubmit = null;
  if (extra.resubmit === 'fromPrep') resubmit = R.motionResubmit({ attempt: 1, morph: !!extra.morph, problems: ['permanence 0.2', 'loop'] }, p, {});
  if (extra.resubmit === 'stale') resubmit = { sceneId: 'recS1', motionPrompt: 'OLD CORRECTED', baseMotion: 'a different base', seed: 7 };
  const $json = resubmit && extra.resubmit === 'fromPrep' && !extra.viaGuard ? resubmit : p;
  const nodes = { 'Prep Video Regen': p };
  if (resubmit) nodes['RG Motion Resubmit'] = resubmit;
  if (extra.attached) nodes['RG Attach End Frame'] = extra.attached;
  if (extra.cooldown) nodes['Regen Cooldown Guard'] = extra.cooldown;
  const live = n8n(EX.submit, { json: clone($json), nodes: clone(nodes) });
  is(`submit: ${label} ${JSON.stringify(Object.keys(extra))}`, R.submitBody({ p: clone($json), resubmit, attached: extra.attached, cooldown: extra.cooldown }), live);
}
// A resubmit guard re-feeds Prep's payload after a re-roll: the corrected prompt must still ride.
{
  const p = P('plain');
  const resubmit = R.motionResubmit({ attempt: 1, problems: ['permanence 0.2'] }, p, {});
  const live = n8n(EX.submit, { json: clone(p), nodes: { 'Prep Video Regen': p, 'RG Motion Resubmit': resubmit } });
  is('submit: re-fed Prep payload keeps the re-roll correction and seed', R.submitBody({ p: clone(p), resubmit }), live);
}

// --- Cooldown guard ------------------------------------------------------------------------------------
for (const [label, sd, attached, err] of [
  ['first 429', {}, false, { error: { message: '429 Too Many Requests' } }],
  ['with end frame, i2v error', {}, true, { error: { message: 'endImage not supported for i2v' } }],
  ['third end-frame failure', { endFrameFails: 2, endFrameFailAt: NOW - 1000 }, true, { error: { description: 'busy' } }],
  ['stale fail window', { endFrameFails: 2, endFrameFailAt: NOW - 2 * 3600_000 }, true, { message: 'x' }],
  ['over the cap', { submitCooldowns: { 'regen:recS1': 20 } }, false, { error: { message: '429' } }],
]) {
  const p = P('plain');
  const sdLive = clone(sd), sdTs = clone(sd);
  const nodes = { 'Prep Video Regen': p };
  if (attached) nodes['RG Attach End Frame'] = { sceneId: 'recS1', endImage: 'END1' };
  const live = tryRun(() => n8n(F('Regen Cooldown Guard.js'), { nodes, input: [err], sd: sdLive }));
  const ts = tryRun(() => { const o = R.cooldownGuard(p, err, sdTs, NOW, attached); delete o.last; delete o.n; return o; });
  is(`cooldown: ${label}`, ts, live);
  is(`cooldown state: ${label}`, sdTs, sdLive);
}

// --- Poll check / extract --------------------------------------------------------------------------------
for (const [label, item, sd] of [
  ['running', { status: 'processing' }, {}],
  ['completed', { status: 'COMPLETED', response: {} }, {}],
  ['url only', { status: 'x', response: { a: 'https://flow-content.google/video/1' } }, {}],
  ['failed', { status: 'failed', error: 'PUBLIC_ERROR_PROMINENT_PEOPLE' }, {}],
  ['cancelled', { status: 'cancelled' }, {}],
  ['timed out', { status: 'processing' }, { regenPolls: { recS1: 20 } }],
  ['not yet timed out', { status: 'processing' }, { regenPolls: { recS1: 19 } }],
]) {
  const sdLive = clone(sd), sdTs = clone(sd);
  const live = n8n(F('Check Video Regen.js'), { input: [clone(item)], nodes: { 'Prep Video Regen': { id: 'recS1' } }, sd: sdLive });
  is(`poll: ${label}`, R.checkPoll(clone(item), 'recS1', sdTs), live);
  is(`poll state: ${label}`, sdTs, sdLive);
}
for (const [label, item] of [
  ['structured', { response: { media: [{ video: { generatedVideo: { fifeUrl: 'https://flow-content.google/video/a.mp4', mediaGenerationId: 'CAMS-video:1' } } }] } }],
  ['found by search', { deep: { x: ['https://flow-content.google/video/b.mp4', 'id-video:2'] } }],
  ['no url', { status: 'completed' }],
]) {
  is(`extract: ${label}`, tryRun(() => R.extractVideo(item)), tryRun(() => n8n(F('Extract Regen Video URL.js'), { input: [item] })));
}
for (const j of [{ error: 'PUBLIC_ERROR_PROMINENT_PEOPLE_FILTER' }, { error: 'MINOR' }, { e: 'AUDIO_GENERATION_FILTERED' }, { e: 'SAFETY' }, { e: 'timeout' }]) {
  is(`filter failure?: ${JSON.stringify(j)}`, R.isFilterFailure(j), n8n(EX.filterFailure, { json: j }));
}
{
  const live = fieldsOfQuery(EX.markFiltered, {});
  is('filtered fields (picture refusal) = Mark Regen Filtered', R.filteredFields({ error: 'PUBLIC_ERROR_PROMINENT_PEOPLE' }), live);
  const audio = R.filteredFields({ error: 'PUBLIC_ERROR_AUDIO_FILTERED', reason: 'AUDIO_GENERATION_FILTERED' });
  is('filtered fields (sound refusal): same writes, the advice that fits (intended difference)', { ...audio, 'Observații Scenă': undefined }, { ...live, 'Observații Scenă': undefined });
  is('the sound-refusal note is not the picture note', /SOUND/.test(audio['Observații Scenă']) && audio['Observații Scenă'] !== live['Observații Scenă'], true);
}
for (const [label, sd] of [['first', {}], ['fourth', { regenResubmits: { recS1: 3 }, regenPolls: { recS1: 12 } }], ['fifth', { regenResubmits: { recS1: 4 } }]]) {
  const p = P('plain');
  const sdLive = clone(sd), sdTs = clone(sd);
  is(`resubmit guard: ${label}`, tryRun(() => R.resubmitGuard(clone(p), sdTs)), tryRun(() => n8n(F('Regen Resubmit Guard.js'), { nodes: { 'Prep Video Regen': p }, sd: sdLive })));
  is(`resubmit guard state: ${label}`, sdTs, sdLive);
}

// --- Motion judge ---------------------------------------------------------------------------------------------
const ev = { Video_Signed_URL: 'https://flow-content.google/video/a.mp4', Video_Media_Id: 'CAMS-video:1' };
for (const [label, prepLabel, e, sd] of [['judged', 'plain', ev, {}], ['with feedback', 'feedback', ev, {}], ['judge off', 'judgeOff', ev, {}], ['no url', 'plain', { Video_Signed_URL: '', Video_Media_Id: '' }, {}], ['already re-rolled', 'plain', ev, { motionRerolls: { 'regen:recS1': 1 } }]]) {
  const p = P(prepLabel);
  const sdLive = clone(sd), sdTs = clone(sd);
  const live = n8n(F('RG Motion Prep.js'), { json: clone(e), nodes: { 'Prep Video Regen': p }, sd: sdLive });
  const ts = R.motionPrep(p, e, sdTs);
  is(`motion prep: ${label}`, ts, live);
  is(`motion prep state: ${label}`, sdTs, sdLive);
  if (ts.ok) is(`motion judge body: ${label}`, R.motionJudgeBody(ts, 'https://render/sheet.jpg'), n8n(EX.motionJudge, { json: { url: 'https://render/sheet.jpg' }, nodes: { 'RG Motion Prep': ts } }));
}
const answer = (o) => ({ choices: [{ message: { content: typeof o === 'string' ? o : 'Here: ' + JSON.stringify(o) } }] });
for (const [label, judge, sd] of [
  ['clean', answer({ direction: 1, permanence: 0.9, untouched: 1, coherent: 0.9, morph: false, loop: false, problems: [] }), {}],
  ['wrong direction', answer({ direction: 0.2, permanence: 1, untouched: 1, coherent: 1, problems: ['goes left'] }), {}],
  ['vanishing + loop', answer({ direction: 1, permanence: 0.3, untouched: 0.4, coherent: 0.5, morph: false, loop: true, problems: ['a', 'b', 'c', 'd', 'e'] }), {}],
  ['morph', answer({ morph: true }), {}],
  ['thresholds exactly', answer({ direction: 0.5, permanence: 0.5, untouched: 0.45, coherent: 0.45 }), {}],
  ['missing scores keep', answer({ problems: ['?'] }), {}],
  ['unreadable', answer('no json here'), {}],
  ['no answer', {}, {}],
  ['wrong again after a re-roll', answer({ direction: 0 }), { motionRerolls: { 'regen:recS1': 1 } }],
]) {
  const p = P('plain');
  const prep = R.motionPrep(p, ev, {});
  const sdLive = clone(sd), sdTs = clone(sd);
  const live = n8n(F('RG Motion Verdict.js'), { json: clone(judge), nodes: { 'RG Motion Prep': prep }, sd: sdLive });
  is(`motion verdict: ${label}`, R.motionVerdict(prep, clone(judge), sdTs), live);
  is(`motion verdict state: ${label}`, sdTs, sdLive);
}
for (const [label, v, prepLabel] of [
  ['permanence', { attempt: 1, problems: ['permanence 0.3'] }, 'plain'],
  ['everything', { attempt: 1, morph: true, loop: true, problems: ['direction 0.1', 'permanence 0.2', 'untouched 0.1', 'coherence 0.2'] }, 'plain'],
  ['nothing mapped', { attempt: 1, problems: ['odd 0.1'] }, 'feedback'],
  ['tail-only prompt', { attempt: 1, problems: ['permanence 0.2'] }, 'tailOnly'],
]) {
  const p = P(prepLabel);
  const sdLive = {}, sdTs = {};
  is(`motion resubmit: ${label}`, R.motionResubmit(v, clone(p), sdTs), n8n(F('RG Motion Resubmit.js'), { json: clone(v), nodes: { 'Prep Video Regen': p }, sd: sdLive }));
  is(`motion resubmit state: ${label}`, sdTs, sdLive);
}

// --- What lands on the scene -------------------------------------------------------------------------------------
{
  const live = JSON.parse(n8n(EX.writeVideo, { json: { video_url: 'https://stored/clip.mp4' }, nodes: { 'Prep Video Regen': { id: 'recS1' }, 'Extract Regen Video URL': { Video_Media_Id: 'CAMS-video:1' } } }));
  is('written fields = Write Regen Video (Scene Final URL = the stored copy)', R.writtenFields('https://stored/clip.mp4', 'CAMS-video:1'), live.fields);
}
is('the poll interval, retry wait and cooldown the engine uses are the live ones', [30, 15, 60], [EX.waits['Wait Video Regen'].amount, EX.waits['Wait Video Regen Retry'].amount, EX.waits['Wait Regen Cooldown'].amount]);

const total = passed + failed;
console.log(`clip: ${failed || total === 0 ? 'RESULT: FAIL' : 'RESULT: OK'} ${passed}/${total}`);
if (failed || total === 0) process.exit(1);
