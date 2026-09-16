// Runs the four Code-node bodies in paste/ (and original/ as the control)
// with n8n's `$` stubbed, against the real endings this change was built on.
//
//   node db/port/story-close/check.mjs
//
// It exercises exactly the branches the apply relies on: Voice Mode emits
// `closing` only for a Story or a Kids story (and byte-identical prompt
// blocks for every other category), Narration Guard flags the two films that
// ended on their climax and passes a draft with a resolution paragraph, Plan
// Scene Splits gives that paragraph its own scene and leaves every other
// chapter as it was, and Build Timeline puts the hold on the last voiced
// scene and nowhere else.
import fs from 'node:fs';
import path from 'node:path';

const dir = path.dirname(new URL(import.meta.url).pathname);
const body = (which, f) => fs.readFileSync(path.join(dir, which, f), 'utf8');

let failed = 0, passed = 0;
const is = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) passed++; else failed++;
  console.log((ok ? '  ok  ' : '  FAIL') + ' ' + label + (ok ? '' : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`));
};
const ok = (label, cond) => is(label, !!cond, true);

/** Run a Code-node body as n8n does: `$` is the node accessor, `$json`/`$input`/`$runIndex` are globals. */
function run(src, { nodes = {}, json = {}, items = [], runIndex = 0 } = {}) {
  const $ = (name) => {
    const n = nodes[name];
    if (!n) throw new Error(`no stub for $('${name}')`);
    return { first: () => ({ json: n }), all: () => (Array.isArray(n) ? n.map((j) => ({ json: j })) : [{ json: n }]), item: { json: n }, isExecuted: true };
  };
  const $input = { all: () => items, first: () => items[0] };
  const fn = new Function('$', '$json', '$input', '$runIndex', 'console', src);
  const logs = [];
  const out = fn($, json, $input, runIndex, { log: (...a) => logs.push(a.join(' ')) });
  return { out, logs };
}

const project = (editing) => ({ fields: { 'Editing Options': JSON.stringify(editing) } });

// ---------------------------------------------------------------------------
console.log('Voice Mode');
{
  const vm = (which, editing) => run(body(which, 'cs-Voice_Mode.js'), { nodes: { 'Fetch Project Record': project(editing) } }).out[0].json;
  const story = vm('paste', { category: 'story' });
  const absent = vm('paste', {});
  const kids = vm('paste', { category: 'kids', categoryOptions: { visual_style: 'clay' } });
  const doc = vm('paste', { category: 'documentary' });
  const cine = vm('paste', { category: 'cinematic' });
  is('story wants a resolution', story.closing, { wanted: true, kids: false });
  is('absent category is a story', absent.closing, { wanted: true, kids: false });
  is('kids wants a warm one', kids.closing, { wanted: true, kids: true });
  is('documentary does not', doc.closing, { wanted: false, kids: false });
  is('cinematic does not', cine.closing, { wanted: false, kids: false });
  ok('story writer gets rule 17', /\n17\. THE RESOLUTION/.test(story.narrationRules));
  ok('story outline gets the beat and the third line', /THE RESOLUTION — a story is not over/.test(story.closingOutline) && /^RESOLVES WITH: </.test(story.closingOutlineLine));
  ok('story editor gets 4c', /\n4c\. THE RESOLUTION/.test(story.closingEditor));
  ok('story segmenter gets the resolution scene', /THE RESOLUTION SCENE/.test(story.segmentRules));
  ok('kids outline REPLACES beat 5', /REPLACES beat 5/.test(kids.closingOutline));
  ok('kids writer keeps rules (a)-(e) and gains the warm close', /KIDS STORY MODE/.test(kids.narrationRules) && /picture book closes/.test(kids.narrationRules));
  ok('story outline has no kids clause', !/CHILDREN/.test(story.closingOutline));
  // Every other category renders byte-identical prompt blocks to the live body.
  for (const [label, editing] of [['documentary', { category: 'documentary' }], ['cinematic', { category: 'cinematic' }], ['dialogue documentary', { category: 'documentary', multiVoiceMode: 'characters', cast: ['a', 'b'] }]]) {
    const before = vm('original', editing), after = vm('paste', editing);
    for (const k of ['narrationRules', 'segmentRules', 'hookRules', 'hookStyleRules', 'hookSegmentRules']) is(`${label}: ${k} byte-identical`, after[k], before[k]);
    is(`${label}: nothing injected`, [after.closingOutline, after.closingOutlineLine, after.closingEditor], ['', '', '']);
  }
  // A story's pre-existing blocks are the old ones plus the new text, nothing else.
  const b = vm('original', { category: 'story' });
  ok('story narrationRules = old + rule 17', story.narrationRules.startsWith(b.narrationRules) && story.narrationRules.length > b.narrationRules.length);
  ok('story segmentRules = old + resolution scene', story.segmentRules.startsWith(b.segmentRules));
  is('story hookRules unchanged', story.hookRules, b.hookRules);
}

// ---------------------------------------------------------------------------
console.log('Narration Guard');
{
  const guard = (which, text, { closing, spine, len = 120 } = {}) => {
    const outline = { output: { story_spine: spine || { protagonist: 'Jack Miller, a Brick City patrol officer' }, chapters: [{ chapter_number: 1, chapter_title: 'T' }] } };
    const r = run(body(which, 'cs-Narration_Guard.js'), {
      json: { output: text },
      nodes: { 'Generate Outline': outline, 'Receive Project Data': { Lenght: len }, 'Fetch Project Record': project({ category: 'story' }), 'Voice Mode': { closing: closing || { wanted: true, kids: false } } },
      runIndex: 0,
    });
    return r.out[0].json;
  };
  const resolutionOf = (j) => (j.editorFeedback || '').split('\n').filter((p) => /resolution|ends on its climax/i.test(p));

  // The Lego chase as it shipped (recfpdoAt59JtXTNc): the last paragraph IS the climax.
  const lego = `[CHAPTER 1: The Chase]\nJack Miller wants one thing: the stolen Ferrari stopped before the harbour. He loses the inside line and three car lengths, and with them his last chance before the gate.\n\nMarco breaks for the fence line instead. Jack closes beside a row of oil drums, grabs his shoulder, and drives him face-first onto the wet concrete. The cuffs click shut under police lights. The Ferrari stays at the shattered gate, and Marco's road out of Brick City ends under the barrier Jack dropped.`;
  let g = guard('paste', lego);
  ok('Lego chase: flagged (last paragraph is the climax, no Jack after it)', g.retry === true && resolutionOf(g).length === 1);
  // Its last paragraph names Jack and is 4 sentences / 52 words — the TOO LONG branch, which is the honest reading: it is the climax, not a resolution.
  ok('Lego chase: the message says which rule', /chapter, not a resolution|never says what becomes of/.test(resolutionOf(g)[0]));
  g = guard('original', lego);
  is('control: the live guard has no resolution check to fail', resolutionOf(g), []);

  // One paragraph only — the film ends on its climax outright.
  const one = `[CHAPTER 1: T]\nJack Miller wants the Ferrari stopped before the harbour. He loses three car lengths at the bend. Marco breaks for the fence line. Jack drives him onto the wet concrete and the cuffs click shut under police lights.`;
  g = guard('paste', one);
  ok('one paragraph: flagged as ending on its climax', /ends on its climax/.test(resolutionOf(g)[0] || ''));

  // The same story with a resolution paragraph: passes.
  const good = lego + `\n\nBy morning the Ferrari is back on its owner's drive and Marco is in a cell on Harbour Street. Jack signs the report, hands in the barrier key, and drives home at the speed limit for the first time in a week.`;
  g = guard('paste', good);
  is('resolution paragraph naming Jack: no resolution problem', resolutionOf(g), []);

  // Resolution that forgets the protagonist.
  const nameless = lego + `\n\nBy morning the Ferrari is back on its owner's drive and the harbour gate is welded shut. The barrier stays down for a week while the city argues about who pays.`;
  g = guard('paste', nameless);
  ok('resolution without the protagonist: asked to say what becomes of Jack', /becomes of Jack/.test(resolutionOf(g)[0] || ''));

  // Too thin to be a scene.
  const thin = lego + `\n\nJack drives home.`;
  g = guard('paste', thin);
  ok('one short sentence: too thin', /too thin/.test(resolutionOf(g)[0] || ''));

  // A "you" film: the spine gives no name, so the name test is skipped.
  const you = `[CHAPTER 1: T]\nYou want the rebuilt machine out of the shop before the masked crowd arrives. The drive bursts once and you rebuild it by hand.\n\nBy dawn you ride the machine straight out from the wolf-marked shop and into the road, and the crowd parts. The shop stays open behind you, and for the first time the road is yours.`;
  g = guard('paste', you, { spine: { protagonist: 'you, a man teleported into a masked city' } });
  is('second-person film: passes without a name', resolutionOf(g), []);

  // Kids: same shape, warmer ask.
  const clay = `[CHAPTER 1: The Houses Learn the Builders]\nMoss counts three roofs and one cold night left. Bramble hauls the Brick Sled. Wisp shapes the windows.\n\nMoss takes the Amber Work Lantern and forces the door. Wisp calls Moss's name from the walls. Bramble rushes in after him. The house closes and keeps Bramble.\n\nMoss stays outside with the Bone Trowel. The lantern burns in the middle house. Bramble and Wisp answer from behind the clay. The homes are finished, and Moss is the only one left outside.`;
  g = guard('paste', clay, { closing: { wanted: true, kids: true }, spine: { protagonist: 'Moss, a small clay builder' } });
  // 4 sentences, 36 words, names Moss: the SHAPE passes — warmth is the outline's and writer's job, not a regex's.
  is('clay builders: shape passes (warmth is asked in the prompts, not measured)', resolutionOf(g), []);
  g = guard('paste', `[CHAPTER 1: T]\nMoss counts three roofs. Bramble hauls the sled.\n\nThe house closes and keeps Bramble.`, { closing: { wanted: true, kids: true }, spine: { protagonist: 'Moss' } });
  ok('kids ask carries the warm clause', /warm: everyone safe, home and together/.test(resolutionOf(g)[0] || ''));

  // Not wanted: nothing is checked, whatever the draft looks like.
  g = guard('paste', one, { closing: { wanted: false, kids: false } });
  is('documentary: no resolution check', resolutionOf(g), []);
  // Dialogue films sit outside the gate, like every other check.
  const dlg = run(body('paste', 'cs-Narration_Guard.js'), { json: { output: one }, nodes: { 'Generate Outline': { output: { story_spine: { protagonist: 'Jack' }, chapters: [{ chapter_number: 1 }] } }, 'Receive Project Data': { Lenght: 120 }, 'Fetch Project Record': project({ category: 'story', multiVoiceMode: 'characters', cast: ['a'] }), 'Voice Mode': { closing: { wanted: true, kids: false } } } }).out[0].json;
  is('dialogue film: outside the gate', resolutionOf(dlg), []);
}

// ---------------------------------------------------------------------------
console.log('Plan Scene Splits');
{
  const splits = (which, chapters, closing = { wanted: true }) => run(body(which, 'cs-Plan_Scene_Splits.js'), {
    items: chapters.map((c) => ({ json: { fields: { Ordine: c.o, 'Script Capitol': c.s } } })),
    nodes: { 'Voice Mode': { closing } },
  });
  const sentence = (n) => Array.from({ length: n }, (_, i) => `Sentence number ${i + 1} carries a particular the viewer could not have guessed here.`).join(' ');
  const hook = 'One student.\nA bank with three vaults.\nPast the guards, alone.';
  const climax = sentence(8); // ~104 words → 5 scenes
  const resolution = 'By morning the Ferrari is back on its owner\'s drive and Marco is in a cell. Jack signs the report and drives home at the speed limit.';
  const chapters = [{ o: 0, s: hook }, { o: 1, s: sentence(6) }, { o: 2, s: climax + '\n\n' + resolution }];
  const r = splits('paste', chapters);
  const last = r.out[2].json.sceneChunks;
  is('the resolution paragraph is the last scene, verbatim', last[last.length - 1], resolution);
  is('the hook still cuts on its lines', r.out[0].json.sceneChunks, hook.split('\n'));
  is('a middle chapter is unchanged vs the live body', r.out[1].json.sceneChunks, splits('original', chapters).out[1].json.sceneChunks);
  ok('the log says so', r.logs.some((l) => /resolution paragraph -> its own 1 scene/.test(l)));
  // The same last chapter under the live body: the resolution is folded or split by arithmetic, never guaranteed its own scene.
  const before = splits('original', chapters).out[2].json.sceneChunks;
  ok('control: the live body did not keep it whole', before[before.length - 1] !== resolution);
  // A runt tail (under 12 words) falls through to ordinary chunking.
  const runt = splits('paste', [{ o: 1, s: climax + '\n\nJack drives home.' }]).out[0].json.sceneChunks;
  is('a runt tail falls through', runt, splits('original', [{ o: 1, s: climax + '\n\nJack drives home.' }]).out[0].json.sceneChunks);
  // No paragraph break, or not a story: exactly the live behaviour.
  is('no blank line: unchanged', splits('paste', [{ o: 1, s: climax + ' ' + resolution }]).out[0].json.sceneChunks, splits('original', [{ o: 1, s: climax + ' ' + resolution }]).out[0].json.sceneChunks);
  is('documentary: unchanged', splits('paste', chapters, { wanted: false }).out[2].json.sceneChunks, splits('original', chapters).out[2].json.sceneChunks);
  // CRLF from an edited script is fine.
  is('CRLF paragraph break works', (() => { const c = splits('paste', [{ o: 1, s: (climax + '\r\n\r\n' + resolution) }]).out[0].json.sceneChunks; return c[c.length - 1]; })(), resolution);
}

// ---------------------------------------------------------------------------
console.log('Build Timeline');
{
  const timeline = (which, editing, clips) => run(body(which, 'fa-Build_Timeline.js'), {
    nodes: {
      'Prepare Clips': clips,
      'Receive Project ID': { Aspect: '16:9' },
      'Normalize Assemble Input': {},
      'Fetch Project Info': { fields: { 'Editing Options': JSON.stringify(editing), Format: '16:9' } },
      'Pick Music Track': { url: null },
    },
  }).out[0].json.body;
  const clips = [
    { url: 'v0', voiceUrl: 'http://a0', chapter: 0, seconds: 3 },
    { url: 'v1', voiceUrl: 'http://a1', chapter: 1 },
    { url: 'v2', voiceUrl: 'http://a2', chapter: 1 },
    { url: 'v3', voiceUrl: '', chapter: 1 }, // a silent tail shot
  ];
  const story = timeline('paste', { category: 'story' }, clips);
  is('story: the last VOICED scene holds 1.5s', story.scenes.map((s) => s.gapSeconds), [undefined, undefined, 1.5, undefined]);
  is('kids: 2s', timeline('paste', { category: 'kids' }, clips).scenes[2].gapSeconds, 2);
  is('absent category: a story', timeline('paste', {}, clips).scenes[2].gapSeconds, 1.5);
  is('documentary: untouched', timeline('paste', { category: 'documentary' }, clips).scenes.map((s) => s.gapSeconds), [undefined, undefined, undefined, undefined]);
  is('cinematic: untouched', timeline('paste', { category: 'cinematic' }, clips).scenes.map((s) => s.gapSeconds), [undefined, undefined, undefined, undefined]);
  // Everything else in the body is what the live node builds.
  const strip = (b) => { const c = JSON.parse(JSON.stringify(b)); c.scenes.forEach((s) => delete s.gapSeconds); return c; };
  is('story body otherwise identical to live', strip(story), strip(timeline('original', { category: 'story' }, clips)));
  // With a hook plan the teaser keeps its own 0.45 and only the last voiced scene changes.
  const hooked = timeline('paste', { category: 'story', hookPlan: { style: 'teaser' } }, clips);
  is('hook shot keeps 0.45, last voiced scene 1.5', hooked.scenes.map((s) => s.gapSeconds), [0.45, undefined, 1.5, undefined]);
  is('kids sceneGap for the other scenes is untouched', timeline('paste', { category: 'kids', categoryOptions: { narration_pace: 'very_slow' } }, clips).sceneGap, 1.2);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
