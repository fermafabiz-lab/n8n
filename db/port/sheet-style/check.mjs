// Two proofs, both offline:
//  1. On any non-kids project the after bodies emit byte-identical request
//     bodies to the before bodies (the live nodes), so no existing film's
//     sheets change.
//  2. On a kids project every sheet and plate prompt starts with the same
//     words Voice Mode puts at the head of every scene, the "Photorealistic"
//     finish is gone, an unknown style key falls back to illustrated like
//     Voice Mode does — and the KIDS_STYLES table in both after files is
//     byte-identical to the one in the Voice Mode file kept beside them.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(here, p), 'utf8');
const table = (src) => { const m = src.match(/const KIDS_STYLES = \{[\s\S]*?\n\};/); assert.ok(m, 'KIDS_STYLES table missing'); return m[0]; };

// --- the table is one table ---
const vm = table(read('paste/Voice Mode.cs-draft-6e21cddc.js'));
for (const n of ['Cast Sheet Prep', 'Set Plate Prep']) assert.equal(table(read(`paste/${n}.after.js`)), vm, `${n}: KIDS_STYLES differs from Voice Mode`);
console.log('KIDS_STYLES: identical in Voice Mode, Cast Sheet Prep, Set Plate Prep (' + (vm.match(/^\s+\w+: /gm) || []).length + ' keys)');

// --- a stub of what the nodes read ---
const bible = { characters: [
  { name: 'Sam Boyd', role: 'protagonist', visual_description: 'a tall man in a grey coat' },
  { name: 'Bill Boyd', role: 'brother', visual_description: 'a short man in a blue suit' },
  { name: 'Crowley', role: 'extra', visual_description: 'a clerk' } ],
  objects: [{ name: 'The Red Car', visual_description: 'a red 1960s coupe' }],
  locations: [{ name: 'The Warehouse', visual_description: 'a brick warehouse by the river' }, { name: 'The Office', visual_description: 'a wood-panelled office' }] };
const scenes = ['Sam Boyd', 'Sam Boyd', 'Sam Boyd|Bill Boyd', 'Sam Boyd|The Red Car', 'Bill Boyd|The Red Car'].map((who, i) => ({
  id: 'rec' + i, scene_order: 100 + i, visual_prompt: '',
  tags: who.split('|').map((n) => (n === 'The Red Car' ? 'obj:' : 'char:') + n).concat(['loc:The Warehouse']) }));
const run = (body, editingOptions) => {
  const nodes = {
    'IMG Load Project': { first: () => ({ json: { fields: { 'Editing Options': JSON.stringify(editingOptions), 'Story Bible': JSON.stringify(bible) } } }) },
    'Save User Ref Id': { isExecuted: false, first: () => ({ json: {} }) },
    'Receive Batch Input': { first: () => ({ json: { Project_ID: 'recTEST', Aspect_Ratio: '16:9', Flow_Email: 'x@y.z' } }) },
    'Load Scene Cast': { all: () => scenes.map((s) => ({ json: s })) },
  };
  const $ = (name) => { if (!nodes[name]) throw new Error('unstubbed node ' + name); return nodes[name]; };
  const log = console.log; console.log = () => {};
  try { return new Function('$', body)($).map((it) => it.json); } finally { console.log = log; }
};
const prompts = (items) => items.filter((i) => !i.skip).map((i) => ({ name: i.name, sheet: i.sheet, prompt: i.requestBody.prompt }));

for (const n of ['Cast Sheet Prep', 'Set Plate Prep']) {
  const before = read(`paste/${n}.before.js`), after = read(`paste/${n}.after.js`);
  // 1. every non-kids shape, byte-identical
  for (const eo of [{}, { category: 'story' }, { category: 'documentary', categoryOptions: { visual_style: 'illustrated' } }, { category: 'cinematic' }, { categoryOptions: { visual_style: 'felt' } }]) {
    assert.deepEqual(run(after, eo), run(before, eo), `${n}: non-kids output changed for ${JSON.stringify(eo)}`);
  }
  const base = prompts(run(before, { category: 'story' }));
  assert.ok(base.length, `${n}: stub produced no work`);
  assert.ok(base.every((p) => /[Pp]hotorealistic/.test(p.prompt)), `${n}: non-kids prompts should still say photorealistic`);
  console.log(`${n}: non-kids → ${base.length} request(s), byte-identical to the live node`);
  // 2. kids
  const vmTable = JSON.parse('{' + vm.replace(/^const KIDS_STYLES = \{/, '').replace(/\n\};$/, '').replace(/\/\/[^\n]*/g, '').replace(/(\w+): '((?:[^'\\]|\\.)*)'/g, (_, k, v) => `"${k}": "${v.replace(/\\'/g, "'")}"`).replace(/(\w+): "/g, '"$1": "').replace(/,\s*$/, '') + '}');
  for (const [key, expectKey] of [['illustrated', 'illustrated'], ['cartoon3d', 'cartoon3d'], ['felt', 'felt'], ['brick', 'brick'], ['', 'illustrated'], ['nonsense', 'illustrated']]) {
    const out = prompts(run(after, { category: 'kids', categoryOptions: { visual_style: key } }));
    assert.equal(out.length, base.length, `${n}: kids made a different number of sheets`);
    for (const p of out) {
      assert.ok(p.prompt.startsWith(vmTable[expectKey] + '. '), `${n}/${key}: prompt does not open with the ${expectKey} prefix`);
      assert.ok(!/[Pp]hotorealistic/.test(p.prompt), `${n}/${key}: kids prompt still says photorealistic`);
      assert.ok(/exactly that style/.test(p.prompt), `${n}/${key}: kids finish missing`);
    }
  }
  console.log(`${n}: kids → prefix leads every prompt for 6 keys incl. fallback, no "photorealistic" left`);
  console.log('  sample (kids/illustrated): ' + prompts(run(after, { category: 'kids', categoryOptions: { visual_style: 'illustrated' } }))[0].prompt.slice(0, 260) + ' …');
}
console.log('OK');
