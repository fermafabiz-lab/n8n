// Images: the engine's regeneration request against the LIVE n8n code it
// replaces (fixtures/image/, versions in its manifest).
//
//   node --experimental-strip-types check-image.mjs      (part of npm run check)
//
// Three things are held here:
//   1. the REFERENCE ASSEMBLY block is still identical in its three live
//      copies (Build Image Request, Evaluate Image Approval, IR Build Request) —
//      CLAUDE.md's "change one, change all three", checked instead of trusted;
//   2. the engine's CONS.plan gives what each live copy gives, on every case;
//   3. buildRegenRequest / decodeFlowImage / rejectionNote equal IR Build
//      Request, IR Decode Image and IR Mark Rejected.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONS } from './src/image/references.ts';
import * as I from './src/image/request.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const F = (f) => fs.readFileSync(path.join(here, 'fixtures', 'image', f), 'utf8');
const EX = JSON.parse(F('expressions.json'));
let passed = 0, failed = 0;
const canon = (v) => JSON.stringify(v === undefined ? null : JSON.parse(JSON.stringify(v)));
const is = (label, got, want) => {
  if (canon(got) === canon(want)) { passed++; return; }
  failed++;
  console.log(`  FAIL ${label}\n       got  ${canon(got).slice(0, 500)}\n       want ${canon(want).slice(0, 500)}`);
};
const dollar = (nodes) => (n) => {
  if (!(n in nodes)) throw new Error(`no stub for $('${n}')`);
  const v = nodes[n];
  return { first: () => ({ json: v }), all: () => [{ json: v }], item: { json: v } };
};
const tryRun = (f) => { try { return f(); } catch (e) { return { error: e.message }; } };

// --- 1. the three copies ----------------------------------------------------------
const END = 'return { norm, plan, apply, tagged };\n})();';
const blockOf = (src) => { const a = src.indexOf('const CONS = (function () {'); return src.slice(a, src.indexOf(END, a) + END.length); };
const copies = {
  'IR Build Request': blockOf(F('cs-IR Build Request.js')),
  'Build Image Request': blockOf(F('mg-Build Image Request.js')),
  'Evaluate Image Approval': blockOf(F('mg-Evaluate Image Approval.js')),
};
is('the three live copies of REFERENCE ASSEMBLY are identical', new Set(Object.values(copies)).size, 1);
const liveCONS = Object.fromEntries(Object.entries(copies).map(([k, b]) => [k, new Function(`${b}\nreturn CONS;`)()]));

// --- Cases ------------------------------------------------------------------------
const bible = {
  characters: [{ name: 'Marcus Aurelius', role: 'protagonist' }, { name: 'Livia', role: 'wife' }, { name: 'Marcus Varro', role: 'rival' }, { name: 'Cato' }],
  objects: [{ name: 'Grain Ship' }, { name: 'Bronze Scale' }],
  locations: [{ name: 'Ostia Harbour' }, { name: 'Forum Granary' }],
};
const refsAll = {
  castRefs: { 'Marcus Aurelius': 'cast-ma', Livia: 'cast-li', 'Marcus Varro': 'cast-mv', Cato: 'cast-ca' },
  castSheets: { Livia: { kind: 'turnaround' }, 'Marcus Aurelius': { kind: 'portrait' } },
  objectRefs: { 'Grain Ship': 'obj-ship', 'Bronze Scale': 'obj-scale' },
  locationRefs: { 'Ostia Harbour': 'loc-ostia', 'Forum Granary': 'loc-forum' },
};
const S = (id, order, fields) => ({ id, createdTime: '2026-09-01T00:00:00.000Z', fields: { 'Ordine Scenă': order, ...fields } });
const siblings = [
  S('recA', 1, { 'Imagine First Frame': 'Wide dawn shot of Ostia harbour with grain ships arriving under grey sky', 'Prompt Vizual': 'Marcus Aurelius watches ships', 'Image Media ID': 'img-a', 'Tag-uri Scenă': ['char:Marcus Aurelius', 'loc:Ostia Harbour'] }),
  S('recB', 101, { 'Imagine First Frame': 'Livia counts sacks beside a bronze scale in the granary, warm lamplight', 'Prompt Vizual': 'Livia and Cato at the granary', 'Image Media ID': 'img-b', 'Tag-uri Scenă': ['char:Livia', 'char:Cato', 'char:Marcus Aurelius', 'obj:Bronze Scale', 'loc:Forum Granary'] }),
  S('recC', 102, { 'Imagine First Frame': 'Livia counts sacks beside a bronze scale in the granary, warm lamplight again', 'Prompt Vizual': 'Marcus and Livia argue about grain ships', 'Image Media ID': 'img-c' }),
  S('recD', 103, { 'Prompt Vizual': 'The grain ship leaves Ostia Harbour at dusk', 'Image Media ID': '' }),
  S('recE', 201, { 'Imagine First Frame': 'Close on Cato hands', 'Image Media ID': 'img-e', 'Tag-uri Scenă': ['loc:Forum Granary'] }),
  S('recF', 202, { 'Imagine First Frame': 'Cato walks out into the forum granary yard', 'Image Media ID': 'img-f', 'Tag-uri Scenă': ['char:Cato', 'loc:Forum Granary'] }),
];
const proj = (editing, extra = {}) => ({ 'Editing Options': JSON.stringify(editing), 'Story Bible': JSON.stringify(bible), Format: '16:9', ...extra });
const cases = [];
for (const sc of siblings) {
  cases.push([`${sc.id} full refs`, sc, siblings, proj(refsAll)]);
  cases.push([`${sc.id} no refs`, sc, siblings, proj({})]);
  cases.push([`${sc.id} cinematic`, sc, siblings, proj({ ...refsAll, category: 'cinematic' })]);
}
const withNote = (sc, note) => ({ ...sc, fields: { ...sc.fields, 'Observații Scenă': note } });
cases.push(['user photo on scene 1', siblings[0], siblings, proj({ ...refsAll, refImageMediaId: 'user-photo' })]);
cases.push(['user photo not uploaded yet', siblings[0], siblings, proj({ ...refsAll, refImage: 'https://x/p.jpg' })]);
cases.push(['reviewer adjustment', withNote(siblings[1], 'Make the lamplight colder.'), siblings, proj(refsAll)]);
cases.push(['after a refusal: nothing attached', withNote(siblings[1], 'Image regeneration REJECTED: faces'), siblings, proj(refsAll)]);
cases.push(['after an auto-rewrite', withNote(siblings[2], 'AUTO-REWRITE (attempt 2)'), siblings, proj(refsAll)]);
cases.push(['a FAILED note is not an adjustment', withNote(siblings[1], 'Voice regeneration FAILED: quota'), siblings, proj(refsAll)]);
cases.push(['9:16', siblings[4], siblings, proj(refsAll, { Format: '9:16' })]);
cases.push(['no image prompt', S('recX', 301, {}), siblings, proj(refsAll)]);
cases.push(['bible and options malformed', siblings[1], siblings, { 'Editing Options': '{', 'Story Bible': 'nope' }]);
cases.push(['siblings out of order', siblings[5], siblings.slice().reverse(), proj(refsAll)]);
// Prompt similarity right between two plausible thresholds: 6 shared words of
// 11 = 0.545, so the live 0.55 keeps the previous frame and a 0.5 would drop it.
{
  const w = (n, p) => Array.from({ length: n }, (_, i) => `${p}word${String.fromCharCode(97 + i)}`).join(' ');
  const prev = S('recP1', 401, { 'Imagine First Frame': `${w(6, 'same')} ${w(5, 'prev')}`, 'Image Media ID': 'img-p1' });
  const cur = S('recP2', 402, { 'Imagine First Frame': `${w(6, 'same')} ${w(5, 'curr')}` });
  cases.push(['prompt overlap 6/11 keeps the previous frame', cur, [prev, cur], proj({})]);
  const cur2 = S('recP3', 402, { 'Imagine First Frame': `${w(7, 'same')} ${w(4, 'curr')}` });
  const prev2 = S('recP4', 401, { 'Imagine First Frame': `${w(7, 'same')} ${w(4, 'prev')}`, 'Image Media ID': 'img-p4' });
  cases.push(['prompt overlap 7/11 drops it', cur2, [prev2, cur2], proj({})]);
}

// --- 2 + 3 ------------------------------------------------------------------------
for (const [label, scene, sibs, pf] of cases) {
  const live = tryRun(() => new Function('$', '$json', 'console', F('cs-IR Build Request.js'))(dollar({
    'IR Load Scene': scene, 'IR Load Siblings': { records: sibs }, 'IR Load Project': { fields: pf },
  }), {}, { log() {} })[0].json);
  const ts = tryRun(() => { const r = I.buildRegenRequest({ scene, siblings: sibs, projectFields: pf }); delete r.log; return r; });
  is(`${label}: IR Build Request`, ts, live);
  if (!live.error) {
    // The plan itself, per live copy, on the same arguments IR passes.
    for (const [name, C] of Object.entries(liveCONS)) {
      const args = { f: scene.fields, opts: JSON.parse(pf['Editing Options']?.startsWith('{"') ? pf['Editing Options'] : '{}'), bible, prompt: live.prompt, prevId: 'img-prev', userRefId: '', isFirstScene: false, afterRefusal: false, strict: label.includes('adjust'), strictNotes: 'drift', continuity: label.includes('cinematic'), prevF: sibs[0].fields };
      is(`${label}: CONS.plan = ${name}`, CONS.plan(args), C.plan(args));
    }
  }
}
// The request the engine actually sends differs in exactly one key.
{
  const a = I.buildRegenRequest({ scene: siblings[1], siblings, projectFields: proj(refsAll) });
  const b = I.buildRegenRequest({ scene: siblings[1], siblings, projectFields: proj(refsAll), captchaRetry: I.REGEN_CAPTCHA_RETRY });
  is('engine request = n8n request with captchaRetry 5', b.requestBody, { ...a.requestBody, captchaRetry: 5 });
}
// Decode and the refusal note.
const decodeLive = (resp) => tryRun(() => new Function('$', '$json', F('cs-IR Decode Image.js'))(dollar({ 'IR Build Request': { sceneId: 'recB' } }), resp)[0].json);
for (const [label, resp] of [
  ['a picture', { media: [{ image: { generatedImage: { fifeUrl: 'https://flow/x.png', mediaGenerationId: 'CAMS-image:abc' } } }] }],
  ['no media', { media: [] }], ['no id', { media: [{ image: { generatedImage: { fifeUrl: 'u' } } }] }], ['garbage', { error: 'x' }],
]) {
  const live = decodeLive(resp);
  const ts = tryRun(() => ({ sceneId: 'recB', ...I.decodeFlowImage(resp) }));
  is(`decode: ${label}`, live.error ? { error: live.error } : ts, live.error ? { error: ts.error } : live);
}
const markLive = (json) => new Function('$json', `return (${EX.markRejected.replace(/^=\{\{\s*/, '').replace(/\s*\}\}$/, '')});`)(json).fields['Observații Scenă'];
for (const e of [{ description: 'PUBLIC_ERROR_PROMINENT_PEOPLE' }, { message: '403 UNUSUAL_ACTIVITY' }, {}, undefined]) {
  is(`rejection note: ${JSON.stringify(e)}`, I.rejectionNote(String((e && (e.description || e.message)) || '')), markLive({ error: e }));
}
is('the model is the live one', I.IMAGE_MODEL, /const MODEL = '([^']+)'/.exec(F('cs-IR Build Request.js'))[1]);

const total = passed + failed;
console.log(`image: ${failed || total === 0 ? 'RESULT: FAIL' : 'RESULT: OK'} ${passed}/${total}`);
if (failed || total === 0) process.exit(1);
