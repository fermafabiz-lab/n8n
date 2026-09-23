// Runs the Cinematic path's node bodies offline, against real text from two
// real Cinematic films (fixtures.json: the Hobbit film of 2026-09-20 and the
// astronaut film of 2026-09-06), and proves the two things this change has to
// be true about:
//
//   1. A film that is NOT cinematic gets exactly what it got before — every
//      edited body (Voice Mode, Plan Scene Splits, Combine Chapters, Rewrite
//      Script) is run in its original/ and its paste/ form on the same input
//      and the outputs must be deep-equal.
//   2. A cinematic film gets the new behaviour: shots cut on lines, the plan
//      read from Cine Treatment, the shot list checked and repaired by Cine
//      Guard, and both new prompts compiling.
//
//   node db/port/cinematic-mode/check.mjs
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const dir = path.dirname(new URL(import.meta.url).pathname);
const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');
const fx = JSON.parse(read('fixtures.json'));
let passed = 0;
const ok = (cond, msg) => {
  assert.ok(cond, msg);
  passed++;
};
const eq = (a, b, msg) => {
  assert.deepEqual(a, b, msg);
  passed++;
};

/** Run a Code-node body with the n8n globals it uses stubbed from `nodes`. */
function run(body, { nodes = {}, json = {}, items = null, runIndex = 0 } = {}) {
  const $ = (name) => {
    if (!(name in nodes)) throw new Error(`Referenced node is unexecuted: ${name}`);
    const v = nodes[name];
    const all = Array.isArray(v) ? v : [v];
    return { first: () => ({ json: all[0] }), all: () => all.map((j) => ({ json: j })), item: { json: all[0] } };
  };
  const $input = { all: () => (items || [json]).map((j) => ({ json: j })), first: () => ({ json }) };
  const quiet = { log: () => {} };
  return new Function('$', '$json', '$input', '$runIndex', 'console', 'Buffer', body)($, json, $input, runIndex, quiet, Buffer);
}
const eo = (o) => ({ fields: { 'Editing Options': JSON.stringify(o) } });

// ---------------------------------------------------------------------------
// 1. Voice Mode — byte-identical for every non-cinematic project shape.
// ---------------------------------------------------------------------------
const vmOld = read('original/cs-Voice_Mode.js');
const vmNew = read('paste/cs-Voice_Mode.js');
const shapes = [
  {},
  { category: 'story' },
  { category: 'documentary' },
  { category: 'kids', categoryOptions: { style: 'clay' } },
  { category: 'story', multiVoiceMode: 'characters', cast: [{ name: 'Maria' }], categoryOptions: { narration: 'none' } },
  { category: 'story', hookStyle: 'question', facesOff: true },
];
for (const o of shapes) {
  const a = run(vmOld, { nodes: { 'Fetch Project Record': eo(o) } });
  const b = run(vmNew, { nodes: { 'Fetch Project Record': eo(o) } });
  eq(b, a, `Voice Mode changed for a non-cinematic project: ${JSON.stringify(o)}`);
}
const vmCineOld = run(vmOld, { nodes: { 'Fetch Project Record': eo({ category: 'cinematic' }) } })[0].json;
const vmCine = run(vmNew, { nodes: { 'Fetch Project Record': eo({ category: 'cinematic' }) } })[0].json;
ok(vmCine.cinematic === true, 'Voice Mode: cinematic flag');
ok(/EVERY SHOT IS ALREADY DESIGNED/.test(vmCine.segmentRules), 'Voice Mode: cinematic segmentRules are the new ones');
ok(!/SILENT FILM MODE: narrator_text is a silent shot note/.test(vmCine.segmentRules), 'Voice Mode: old cinematic segmentRules gone');
for (const k of Object.keys(vmCineOld)) if (k !== 'segmentRules') eq(vmCine[k], vmCineOld[k], `Voice Mode: cinematic ${k} must not change`);

// ---------------------------------------------------------------------------
// 2. Plan Scene Splits — identical for story; one line = one scene for cinematic.
// ---------------------------------------------------------------------------
const pssOld = read('original/cs-Plan_Scene_Splits.js');
const pssNew = read('paste/cs-Plan_Scene_Splits.js');
const chapter = (ord, script) => ({ id: 'rec' + ord, fields: { Ordine: ord, 'Script Capitol': script, 'Titlu Capitol': 'T' + ord } });
const storyItems = [chapter(0, fx.hobbitHook), chapter(1, fx.hobbitChapter1), chapter(2, fx.astroChapter1)];
for (const vm of [{ cinematic: false, closing: { wanted: true } }, { cinematic: false, closing: { wanted: false } }]) {
  const a = run(pssOld, { nodes: { 'Voice Mode': vm }, items: storyItems });
  const b = run(pssNew, { nodes: { 'Voice Mode': vm }, items: storyItems });
  eq(b, a, 'Plan Scene Splits changed for a non-cinematic film');
}
const shots = [
  'WIDE, LOW ANGLE · slow crane down · Dawn mist lifts off the untouched shoulder of Hobbiton Hill as Bungo walks the chalked circle of his future door · low gold sun raking from the left · Sound: larks, wet grass underfoot',
  'EXTREME CLOSE-UP · locked-off · The iron spade bites through turf into dark wet earth and levers a clean square of sod upward · soft morning light, dew on every blade · Sound: the tear of roots',
  '3. MEDIUM · tracking left to right · Bungo pushes the loaded wheelbarrow down the plank ramp toward the first spoil terrace below · hard noon, short black shadows · Sound: the wheel on wet planks',
];
const cineItems = [chapter(0, fx.hobbitHook), chapter(1, shots.join('\n'))];
const cineOut = run(pssNew, { nodes: { 'Voice Mode': { cinematic: true, closing: { wanted: false } } }, items: cineItems });
eq(cineOut[1].json.sceneCount, 3, 'Plan Scene Splits: 3 shot lines -> 3 scenes');
eq(cineOut[1].json.sceneChunks[0], shots[0], 'Plan Scene Splits: a shot line reaches the segmenter verbatim');
ok(cineOut[1].json.sceneChunks[2].startsWith('MEDIUM ·'), 'Plan Scene Splits: stray numbering stripped from a shot line');
eq(cineOut[0].json.sceneCount, fx.hobbitHook.split('\n').length, 'Plan Scene Splits: the hook is still cut on its lines');
const oldOnShots = run(pssOld, { nodes: { 'Voice Mode': { cinematic: true, closing: { wanted: false } } }, items: cineItems });
ok(oldOnShots[1].json.sceneCount !== 3 || oldOnShots[1].json.sceneChunks[0] !== shots[0], 'control: the OLD splitter does not keep shot lines whole (this is the bug being fixed)');
// A long cinematic film: 37 shots stay 37 scenes, never re-balanced by words.
const many = Array.from({ length: 37 }, (_, i) => shots[i % 2].replace('Bungo', 'Bungo ' + i));
eq(run(pssNew, { nodes: { 'Voice Mode': { cinematic: true } }, items: [chapter(1, many.join('\n'))] })[0].json.sceneCount, 37, 'Plan Scene Splits: 37 shots -> 37 scenes');

// ---------------------------------------------------------------------------
// 3. Combine Chapters — story reads Generate Outline exactly as before;
//    cinematic reads Cine Treatment and never touches Generate Outline.
// ---------------------------------------------------------------------------
const ccOld = read('original/cs-Combine_Chapters.js');
const ccNew = read('paste/cs-Combine_Chapters.js');
const guardShape = { chapters: [{ chapter_number: 1, chapter_title: 'A', narrator_script: fx.hobbitChapter1 }] };
const outline = { output: { project_title: 'P', target_duration: '95', story_spine: { protagonist: 'Bungo' }, chapters: [{ chapter_number: 1, chapter_title: 'A', chapter_summary: 'S\nENDS WITH: x\nLEADS INTO: y' }] } };
eq(
  run(ccNew, { nodes: { 'Generate Outline': outline, 'Voice Mode': { cinematic: false } }, json: guardShape }),
  run(ccOld, { nodes: { 'Generate Outline': outline }, json: guardShape }),
  'Combine Chapters changed for a non-cinematic film',
);
const treatment = {
  output: {
    project_title: 'Under the Hill',
    target_duration: '95 seconds',
    concept: { subject: 'A hobbit hole dug by hand', feeling: 'pride of craft', visual_arc: 'dawn to lamplight', signature_images: ['a'], sound_world: 'spade, larks', ending_image: 'the green door at blue hour' },
    chapters: [
      { chapter_number: 1, chapter_title: 'Turf', shot_count: 3, energy: 'calm', chapter_summary: 'Dig.\nOPENS ON: x\nENDS WITH: y', narrator_script: '' },
      { chapter_number: 2, chapter_title: 'Door', shot_count: 2, energy: 'release', chapter_summary: 'Build.\nOPENS ON: x\nENDS WITH: z', narrator_script: '' },
    ],
  },
};
const ccCine = run(ccNew, { nodes: { 'Cine Treatment': treatment, 'Voice Mode': { cinematic: true } }, json: { chapters: [{ chapter_number: 1, chapter_title: 'Turf', narrator_script: shots.join('\n') }] } })[0].json.output;
eq(ccCine.project_title, 'Under the Hill', 'Combine Chapters: cinematic title from Cine Treatment');
eq(ccCine.story_spine, treatment.output.concept, 'Combine Chapters: the concept stands in for the spine');
eq(ccCine.chapters[0].chapter_summary, treatment.output.chapters[0].chapter_summary, 'Combine Chapters: the sequence plan reaches the segmenter');
eq(ccCine.chapters[0].narrator_script.split('\n').length, 3, 'Combine Chapters: shot lines survive');

// ---------------------------------------------------------------------------
// 4. Cine Guard.
// ---------------------------------------------------------------------------
const cg = read('paste/Cine Guard.js');
const rp = { Lenght: 48 }; // 5 shots
const nodesCG = { 'Cine Treatment': treatment, 'Receive Project Data': rp };
const S = (who, n) => `MEDIUM · slow dolly-in · ${who} lifts sod number ${n} from the bank and lays it on the growing stack beside the cut · low gold light · Sound: turf tearing, larks`;
const good = `[CHAPTER 1: Turf]\n${S('Bungo', 1)}\n${S('Bungo', 2)}\n${S('Minto', 3)}\n\n[CHAPTER 2: Door]\n${S('Minto', 4)}\n${S('Daisy', 5)}`;
let r = run(cg, { nodes: nodesCG, json: { output: good } })[0].json;
eq(r.retry, false, 'Cine Guard: a clean list passes first time');
eq(r.chapters.map((c) => c.narrator_script.split('\n').length), [3, 2], 'Cine Guard: shots per sequence');
eq(r.min, 0, 'Cine Guard: no word floor for Deep Search to report against');
ok(r.output.startsWith('[CHAPTER 1: Turf]\n'), 'Cine Guard: output keeps the marker lines');
for (const k of ['output', 'retry', 'chapters', 'words', 'target', 'min', 'max']) ok(k in r, `Cine Guard: emits Narration Guard's ${k}`);

// Tolerated without a retry: bold markers, numbering, bullets, "Shot n:".
const messy = `**[CHAPTER 1: Turf]**\n1. ${S('Bungo', 1)}\n- ${S('Bungo', 2)}\nShot 3: ${S('Minto', 3)}\n[CHAPTER 2: Door]\n• ${S('Minto', 4)}\n\n${S('Daisy', 5)}`;
r = run(cg, { nodes: nodesCG, json: { output: messy } })[0].json;
eq(r.retry, false, 'Cine Guard: formatting noise is cleaned, not retried');
ok(r.chapters[0].narrator_script.split('\n')[0].startsWith('MEDIUM ·'), 'Cine Guard: numbering stripped');

// Wrong count: first attempt retries with feedback naming the sequence.
const wrong = `[CHAPTER 1: Turf]\n${S('a', 1)}\n${S('b', 2)}\n${S('c', 3)}\n${S('d', 4)}\n${S('e', 5)}\n[CHAPTER 2: Door]\n${S('f', 6)}\n${S('g', 7)}`;
r = run(cg, { nodes: nodesCG, json: { output: wrong }, runIndex: 0 })[0].json;
eq(r.retry, true, 'Cine Guard: wrong shot count retries once');
ok(/Sequence 1 has 5 shot line\(s\); the treatment gives it exactly 3/.test(r.guardFeedback), 'Cine Guard: feedback names the sequence and both counts');
eq(r.output, wrong, 'Cine Guard: the retry carries the previous list for the writer to fix');
// Second attempt: accepted, surplus cut from the MIDDLE (first and last kept).
r = run(cg, { nodes: nodesCG, json: { output: wrong }, runIndex: 1 })[0].json;
eq(r.retry, false, 'Cine Guard: second attempt is accepted');
eq(r.chapters[0].narrator_script.split('\n'), [S('a', 1), S('b', 2), S('e', 5)], 'Cine Guard: surplus cut from the middle — the opening and closing frames survive');

// Speech, bad form, thin lines.
const speechy = good.replace(S('Bungo', 2), 'CLOSE-UP · locked-off · Bungo looks up and says "this is the place" to Minto across the cut · noon · Sound: wind');
r = run(cg, { nodes: nodesCG, json: { output: speechy } })[0].json;
ok(r.retry && /Speech or narration/.test(r.guardFeedback), 'Cine Guard: speech in a silent film is sent back');
r = run(cg, { nodes: nodesCG, json: { output: good.replace(S('Daisy', 5), 'Daisy plants seeds in the new terrace as the sun goes down over the valley and the birds settle.') } })[0].json;
ok(r.retry && /five-field form/.test(r.guardFeedback), 'Cine Guard: a prose line is sent back for the form');
r = run(cg, { nodes: nodesCG, json: { output: good.replace(S('Daisy', 5), 'WIDE · static · Door · dusk · Sound: wind') } })[0].json;
ok(r.retry && /Too thin to shoot/.test(r.guardFeedback), 'Cine Guard: a thin line is sent back');

r = run(cg, { nodes: nodesCG, json: { output: good.replace(S('Daisy', 5), 'WIDE, LATERAL · fast track · Bungo runs the loaded wheelbarrow left to right down the spoil path, then tips the dark load into the terraces below · hard noon · Sound: wheel rattle') } })[0].json;
ok(r.retry && /chained with "then"/.test(r.guardFeedback), 'Cine Guard: a chained action is sent back');
const longAction = 'WIDE · slow dolly-in · ' + Array.from({ length: 45 }, (_, i) => 'word' + i).join(' ') + ' · noon · Sound: wind';
r = run(cg, { nodes: nodesCG, json: { output: good.replace(S('Daisy', 5), longAction) } })[0].json;
ok(r.retry && /action over 40 words/.test(r.guardFeedback), 'Cine Guard: an overlong action is sent back');
// The real line that tripped the old whole-line ceiling in probe 16582 (70+ words, a 28-word action) now passes.
const rich = 'WIDE, LATERAL LOW TRACKING · fast track with wheelbarrow · Bungo and Daisy Noakes run the loaded Hobbit earthwork wheelbarrow left to right down the rough spoil path toward the newly edged terraces below · hard noon glare straight overhead, earth-brown haze, black shadows under the wheel and raw tunnel mouth above · Sound: wheel rattle, boots and bare feet on planks, loose soil slumping, wind over the open hill';
r = run(cg, { nodes: nodesCG, json: { output: good.replace(S('Daisy', 5), rich) } })[0].json;
eq(r.retry, false, 'Cine Guard: a rich five-field line is not "too long"');

// Shots before any marker belong to sequence 1.
r = run(cg, { nodes: nodesCG, json: { output: `${S('a', 1)}\n${S('b', 2)}\n${S('c', 3)}\n[CHAPTER 2: Door]\n${S('d', 4)}\n${S('e', 5)}` } })[0].json;
eq(r.retry, false, 'Cine Guard: a forgotten first marker is not a failure');
eq(r.chapters[0].chapter_title, 'Turf', 'Cine Guard: the unmarked shots take sequence 1 and its planned title');

// Nothing at all: throws, never an empty film.
assert.throws(() => run(cg, { nodes: nodesCG, json: { output: '' }, runIndex: 1 }), /holds no shots/);
passed++;

// ---------------------------------------------------------------------------
// 5. Rewrite Script — story message byte-identical, cinematic one a shot list.
// ---------------------------------------------------------------------------
function evalExpr(src, cinematic) {
  const body = src.replace(/^=\{\{/, '').replace(/\}\}\s*$/, '');
  const $ = (name) => ({
    first: () => ({ json: name === 'Voice Mode' ? { cinematic } : { fields: { 'Observații Script': 'fb', 'Script Content': 'SCRIPT' } } }),
  });
  return new Function('$', 'return (' + body + ');')($);
}
const rsOld = read('original/cs-Rewrite_Script.txt');
const rsNew = read('paste/cs-Rewrite_Script.txt');
eq(evalExpr(rsNew, false), evalExpr(rsOld, false), 'Rewrite Script changed for a non-cinematic film');
eq(evalExpr(rsNew, undefined), evalExpr(rsOld, undefined), 'Rewrite Script: a missing flag is the story arm');
const rsCine = evalExpr(rsNew, true).messages[0].content;
ok(/SHOT LIST/.test(rsCine) && /five-field form/.test(rsCine) && !/spoken narration/.test(rsCine), 'Rewrite Script: cinematic films keep a shot list on rejection');
ok(/producer's feedback/.test(rsCine) && /film's running time/.test(rsCine), 'Rewrite Script: apostrophes survived the escaping');

// ---------------------------------------------------------------------------
// 6. The two new prompts: every {{ }} compiles and evaluates, and the example
//    lines in the shot-list prompt pass the guard's own form check.
// ---------------------------------------------------------------------------
const proxy = () =>
  new Proxy(function () {}, {
    get: (t, k) => (k === Symbol.toPrimitive ? () => '' : k === 'first' ? () => ({ json: stubJson }) : proxy()),
    apply: () => proxy(),
  });
const stubJson = {
  Lenght: 95,
  Tema: 'A hobbit builds Bag End',
  Tonalitate: 'Cinematic',
  Pace: 'Normal',
  Style: 'Nature',
  p: { invention: 'inv', visual: 'vis' },
  fields: { 'Editing Options': JSON.stringify({ producerBrief: 'every step from digging to the inside', mustInclude: ['the green door'] }) },
  output: treatment.output,
  claimsList: 'E1. x',
};
function renderPrompt(src, json) {
  assert.ok(src.startsWith('='), 'prompt must start with =');
  let n = 0;
  const outText = src.slice(1).replace(/\{\{([\s\S]*?)\}\}/g, (_, expr) => {
    n++;
    const $ = () => ({ first: () => ({ json: stubJson }) });
    const v = new Function('$', '$json', 'return (' + expr + ');')($, json);
    return v == null ? '' : typeof v === 'string' ? v : String(v);
  });
  return { n, outText };
}
const tr = renderPrompt(read('paste/Cine Treatment.txt'), {});
ok(tr.n >= 10, 'Cine Treatment: expressions found');
ok(/hold EXACTLY 11 shots/.test(tr.outText), 'Cine Treatment: 95 s -> 11 shots');
ok(/plan EXACTLY 2 SEQUENCE/.test(tr.outText), 'Cine Treatment: 11 shots -> 2 sequences');
ok(/every step from digging to the inside/.test(tr.outText) && /the green door/.test(tr.outText), "Cine Treatment: the producer's brief and must-include reach the plan");
ok(!/STORY SPINE|protagonist/i.test(tr.outText), 'Cine Treatment: no story spine is asked for');
const sl1 = renderPrompt(read('paste/Cine Shot List.txt'), treatment);
ok(!/CORRECTIONS REQUIRED/.test(sl1.outText), 'Cine Shot List: first pass carries no corrections');
ok(/SEQUENCE 1: Turf — 3 shots/.test(sl1.outText) && /SEQUENCE 2: Door — 2 shots/.test(sl1.outText), 'Cine Shot List: per-sequence shot counts');
const sl2 = renderPrompt(read('paste/Cine Shot List.txt'), { output: wrong, guardFeedback: '1. Sequence 1 has 5' });
ok(/CORRECTIONS REQUIRED/.test(sl2.outText) && sl2.outText.includes(wrong), 'Cine Shot List: a retry carries the feedback and the previous list');
const examples = read('paste/Cine Shot List.txt').split('\n').filter((l) => /^(WIDE|EXTREME|MEDIUM)[^·]*·/.test(l));
eq(examples.length, 3, 'Cine Shot List: three example lines');
const exList = `[CHAPTER 1: Turf]\n${examples.join('\n')}\n[CHAPTER 2: Door]\n${S('d', 4)}\n${S('e', 5)}`;
r = run(cg, { nodes: nodesCG, json: { output: exList } })[0].json;
eq(r.retry, false, "Cine Shot List: its own examples pass Cine Guard's checks");

// The parser example is valid JSON with the fields Cine Guard and Combine read.
const parser = JSON.parse(read('paste/Cine Treatment Parser.json'));
ok(parser.concept && Array.isArray(parser.chapters) && 'shot_count' in parser.chapters[0] && 'chapter_summary' in parser.chapters[0], 'Cine Treatment Parser: shape');

console.log(`check.mjs: ${passed} assertions passed`);
