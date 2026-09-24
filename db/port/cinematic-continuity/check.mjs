// Runs the original and the edited bodies of every node this change touches,
// on the same inputs, and proves:
//   1. a film that is NOT cinematic gets exactly the same output as before
//      (the three copies of the reference block, Voice Mode);
//   2. a cinematic film gets the new behaviour: the previous picture becomes
//      the previous SHOT when the place is the same and stays a palette when
//      it is not, the similarity guard no longer drops it, the shot count has
//      no scene held back for a hook, and the prompts carry the continuity
//      rules;
//   3. the shared reference block is still word for word identical in all
//      three copies.
//
//   node db/port/cinematic-continuity/check.mjs
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const dir = path.dirname(new URL(import.meta.url).pathname);
const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');
let passed = 0;
const ok = (c, m) => { assert.ok(c, m); passed++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); passed++; };

/**
 * n8n's globals for one Code-node run. `nodes` maps a node name to its items
 * (json objects) — or to a function (runIndex) => items for `.all(0, i)`.
 */
function run(body, { nodes = {}, json = {}, items = null, runIndex = 0, staticData = {} } = {}) {
  const $ = (name) => {
    const v = nodes[name];
    const executed = v !== undefined;
    const list = (i) => {
      const x = typeof v === 'function' ? v(i) : v;
      return (Array.isArray(x) ? x : x === undefined ? [] : [x]).map((j) => ({ json: j }));
    };
    return {
      isExecuted: executed,
      first: () => { if (!executed) throw new Error('unexecuted: ' + name); return list()[0] || { json: {} }; },
      all: (_o, i) => { if (!executed) throw new Error('unexecuted: ' + name); return list(i); },
      item: { json: executed ? (list()[0] || {}).json : {} },
    };
  };
  const $input = { all: () => (items || [json]).map((j) => ({ json: j })), first: () => ({ json }) };
  const quiet = { log: () => {} };
  const $getWorkflowStaticData = () => staticData;
  return new Function('$', '$json', '$input', '$runIndex', 'console', '$getWorkflowStaticData', body)($, json, $input, runIndex, quiet, $getWorkflowStaticData);
}

// A small real-shaped film: a bible with one place, one character; two scenes
// in the same place and a third somewhere else.
const bible = {
  characters: [{ name: 'Bungo Baggins', role: 'protagonist' }],
  objects: [],
  locations: [{ name: 'Hobbiton Hill — open excavation' }, { name: 'Bag End — finished interior' }],
};
const optsBase = {
  castRefs: { 'Bungo Baggins': 'user:1-image:cast' },
  castSheets: { 'Bungo Baggins': { kind: 'turnaround' } },
  locationRefs: { 'Hobbiton Hill — open excavation': 'user:1-image:plate1', 'Bag End — finished interior': 'user:1-image:plate2' },
};
const scene = (id, order, loc, prompt) => ({
  id,
  fields: {
    'Ordine Scenă': order,
    'Imagine First Frame': prompt,
    'Prompt Vizual': 'Bungo Baggins digs.',
    'Tag-uri Scenă': ['loc:' + loc, 'char:Bungo Baggins'],
    'Image Media ID': 'user:1-image:' + id,
  },
});
const P1 = 'Medium shot of Bungo Baggins swinging the iron mattock into the raw clay bank of the open excavation in hard noon light, ochre clay flying';
const P2 = 'Close shot of Bungo Baggins swinging the iron mattock into the raw clay bank of the open excavation in hard noon light, ochre clay flying'; // near-identical on purpose
const P3 = 'Wide shot of the finished hall of Bag End at blue hour, lamplight on cream plaster';
const s1 = scene('recA', 101, 'Hobbiton Hill — open excavation', P1);
const s2 = scene('recB', 102, 'Hobbiton Hill — open excavation', P2);
const s3 = scene('recC', 201, 'Bag End — finished interior', P3);

// ---------------------------------------------------------------------------
// 1. The shared block is identical in all three edited copies.
// ---------------------------------------------------------------------------
const blockOf = (s) => { const a = s.indexOf('// REFERENCE ASSEMBLY'); return s.slice(a, s.indexOf('return { norm, plan, apply, tagged };\n})();', a)); };
const files = ['mg-Build_Image_Request.js', 'mg-Evaluate_Image_Approval.js', 'cs-IR_Build_Request.js'];
const blocks = files.map((f) => blockOf(read('paste/' + f)));
ok(blocks[0] === blocks[1] && blocks[1] === blocks[2], 'the reference block is word for word identical in all three copies');
ok(blocks[0].includes("role: sameShot ? 'continuity' : 'palette'"), 'the block carries the continuity role');

// ---------------------------------------------------------------------------
// 2. Build Image Request (the batch).
// ---------------------------------------------------------------------------
function bir(which, category, cur, prev, runIndex = 1, prevLocTags) {
  const opts = { ...optsBase, ...(category ? { category } : {}) };
  return run(read(which + '/mg-Build_Image_Request.js'), {
    json: cur,
    runIndex,
    nodes: {
      'Receive Batch Input': { Aspect_Ratio: '16:9', Flow_Email: 'a@b.c' },
      'IMG Load Project': { fields: { 'Editing Options': JSON.stringify(opts), 'Story Bible': JSON.stringify(bible) } },
      'Decode Scene Image': () => (prev ? [{ mediaId: prev.fields['Image Media ID'] }] : []),
      'Build Image Request': () => (prev ? [{ rawPrompt: prev.fields['Imagine First Frame'], ...(prevLocTags ? { locTags: prevLocTags } : {}) }] : []),
    },
  })[0].json;
}
for (const cat of ['', 'story', 'documentary', 'kids']) {
  for (const [cur, prev] of [[s2, s1], [s3, s2], [s1, null]]) {
    eq(bir('paste', cat, cur, prev, prev ? 1 : 0), bir('original', cat, cur, prev, prev ? 1 : 0), `Build Image Request changed for category "${cat}" on ${cur.id}`);
  }
}
// Story: the near-identical prompt drops the previous frame (the guard, unchanged).
ok(!bir('paste', 'story', s2, s1).refs.some((r) => r.role === 'palette'), 'story: similarity guard still drops the previous frame');
// Cinematic, same place: the previous frame is KEPT and becomes the previous shot.
let c = bir('paste', 'cinematic', s2, s1, 1, ['Hobbiton Hill — open excavation']);
ok(c.refs.some((r) => r.role === 'continuity' && r.id === 'user:1-image:recA'), 'cinematic same place: previous picture is the previous SHOT');
ok(/PREVIOUS SHOT of this same continuous scene/.test(c.requestBody.prompt), 'cinematic same place: the prompt names it');
ok(c.used.continuity === true && !c.used.palette, 'cinematic same place: used.continuity');
eq(c.locTags, ['Hobbiton Hill — open excavation'], 'cinematic: the node emits its own place for the next run');
// Cinematic, different place: palette only.
c = bir('paste', 'cinematic', s3, s2, 1, ['Hobbiton Hill — open excavation']);
ok(c.refs.some((r) => r.role === 'palette') && !c.refs.some((r) => r.role === 'continuity'), 'cinematic new place: stays a palette');
// Cinematic, previous run from before the deploy (no locTags): palette, never a guess.
c = bir('paste', 'cinematic', s2, s1, 1, undefined);
ok(c.refs.some((r) => r.role === 'palette') && !c.refs.some((r) => r.role === 'continuity'), 'cinematic with no known previous place: palette');
ok(bir('paste', 'story', s2, s1).locTags === undefined, 'story: no locTags key is added to the output');

// ---------------------------------------------------------------------------
// 3. Evaluate Image Approval (the gate's regen).
// ---------------------------------------------------------------------------
function eia(which, category) {
  const opts = { ...optsBase, ...(category ? { category } : {}) };
  const recs = [s1, { ...s2, fields: { ...s2.fields, 'Regenerează Imagine': true } }, { ...s3, fields: { ...s3.fields, 'Regenerează Imagine': true } }];
  return run(read(which + '/mg-Evaluate_Image_Approval.js'), {
    items: recs,
    nodes: {
      'Sort & Cap Scenes': recs.map((r) => ({ id: r.id })),
      'IMG Load Project': { fields: { 'Editing Options': JSON.stringify(opts), 'Story Bible': JSON.stringify(bible) } },
      'Receive Batch Input': { Aspect_Ratio: '16:9' },
    },
  })[0].json;
}
for (const cat of ['', 'story', 'documentary', 'kids']) eq(eia('paste', cat), eia('original', cat), `Evaluate Image Approval changed for "${cat}"`);
const e = eia('paste', 'cinematic');
ok(e.regen[0].refs.some((r) => r.role === 'continuity'), 'gate regen, cinematic same place: previous SHOT');
ok(e.regen[1].refs.some((r) => r.role === 'palette') && !e.regen[1].refs.some((r) => r.role === 'continuity'), 'gate regen, cinematic new place: palette');

// ---------------------------------------------------------------------------
// 4. IR Build Request (the site's regen).
// ---------------------------------------------------------------------------
function irb(which, category, cur) {
  const opts = { ...optsBase, ...(category ? { category } : {}) };
  return run(read(which + '/cs-IR_Build_Request.js'), {
    nodes: {
      'IR Load Scene': cur,
      'IR Load Project': { fields: { 'Editing Options': JSON.stringify(opts), 'Story Bible': JSON.stringify(bible), Format: '16:9' } },
      'IR Load Siblings': { records: [s1, s2, s3] },
    },
  })[0].json;
}
for (const cat of ['', 'story', 'documentary', 'kids']) for (const cur of [s1, s2, s3]) eq(irb('paste', cat, cur), irb('original', cat, cur), `IR Build Request changed for "${cat}" on ${cur.id}`);
ok(irb('paste', 'cinematic', s2).refs.some((r) => r.role === 'continuity'), 'site regen, cinematic same place: previous SHOT, even with near-identical prompts');
ok(!irb('paste', 'story', s2).refs.some((r) => r.role === 'palette' || r.role === 'continuity'), 'site regen, story: similarity guard unchanged');
ok(!irb('paste', 'cinematic', s3).refs.some((r) => r.role === 'continuity'), 'site regen, cinematic new place: no continuity');

// ---------------------------------------------------------------------------
// 5. Voice Mode: identical for everything but cinematic segmentRules.
// ---------------------------------------------------------------------------
const eo = (o) => ({ fields: { 'Editing Options': JSON.stringify(o) } });
for (const o of [{}, { category: 'story' }, { category: 'documentary' }, { category: 'kids', categoryOptions: { visual_style: 'clay' } }, { category: 'story', facesOff: false }]) {
  eq(run(read('paste/cs-Voice_Mode.js'), { nodes: { 'Fetch Project Record': eo(o) } }), run(read('original/cs-Voice_Mode.js'), { nodes: { 'Fetch Project Record': eo(o) } }), `Voice Mode changed for ${JSON.stringify(o)}`);
}
const vmOld = run(read('original/cs-Voice_Mode.js'), { nodes: { 'Fetch Project Record': eo({ category: 'cinematic' }) } })[0].json;
const vmNew = run(read('paste/cs-Voice_Mode.js'), { nodes: { 'Fetch Project Record': eo({ category: 'cinematic' }) } })[0].json;
ok(/\(f\) CONTINUITY/.test(vmNew.segmentRules), 'Voice Mode: cinematic segmenter gets the continuity rule');
for (const k of Object.keys(vmOld)) if (k !== 'segmentRules') eq(vmNew[k], vmOld[k], `Voice Mode cinematic ${k} unchanged`);

// ---------------------------------------------------------------------------
// 6. The writing path: no hook scene held back, continuity rules present,
//    the guard counts the whole length, and the new examples pass the guard.
// ---------------------------------------------------------------------------
const stub = { Lenght: 95, Tema: 'T', Tonalitate: 'Cinematic', Pace: 'Normal', Style: 'Nature', p: { invention: 'i', visual: 'v' }, fields: { 'Editing Options': '{}' }, output: { concept: {}, chapters: [{ chapter_number: 1, chapter_title: 'A', shot_count: 12, energy: 'calm', chapter_summary: 's' }] }, claimsList: '' };
const render = (src, json = {}) => src.slice(1).replace(/\{\{([\s\S]*?)\}\}/g, (_, x) => { const v = new Function('$', '$json', 'return (' + x + ');')(() => ({ first: () => ({ json: stub }) }), json); return v == null ? '' : String(v); });
const tr = render(read('paste/cs-Cine_Treatment.txt'));
ok(/hold EXACTLY 12 shots/.test(tr), 'Treatment: 95 s -> 12 shots, none held back for a hook');
ok(/the shot counts must add up to EXACTLY 12\./.test(tr) && /plan EXACTLY 2 SEQUENCE/.test(tr), 'Treatment: counts agree');
ok(!/teaser is made separately/.test(tr) && /no separate opening teaser/.test(tr), 'Treatment: no teaser');
ok(/CONTINUITY IS THIS FILM'S SPINE/.test(tr), 'Treatment: continuity section');
const sl = render(read('paste/cs-Cine_Shot_List.txt'), stub.output);
ok(/CONTINUITY — THE FIRST RULE OF THIS FILM/.test(sl) && sl.indexOf('CONTINUITY — THE FIRST RULE') < sl.indexOf('THE CRAFT'), 'Shot List: continuity rule first');
const cg = read('paste/cs-Cine_Guard.js');
const examples = read('paste/cs-Cine_Shot_List.txt').split('\n').filter((l) => /^(WIDE|MEDIUM|EXTREME)[^·]*·/.test(l));
eq(examples.length, 3, 'Shot List: three consecutive example lines');
const treat = { output: { chapters: [{ chapter_number: 1, chapter_title: 'Clay', shot_count: 3 }] } };
const r = run(cg, { nodes: { 'Cine Treatment': treat, 'Receive Project Data': { Lenght: 24 } }, json: { output: '[CHAPTER 1: Clay]\n' + examples.join('\n') } })[0].json;
eq(r.retry, false, "the new examples pass Cine Guard's own checks");
eq(r.cine.ordered, 3, 'Guard: 24 s -> 3 shots, none held back for a hook');

console.log(`check.mjs: ${passed} assertions passed`);
