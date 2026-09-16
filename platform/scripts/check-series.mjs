// The series helpers (lib/series.ts): how a film's Story Bible and references
// become a show, how a show goes back out as Lore, and the three automatic
// steps that keep a show in step with its episodes — name reconciliation,
// the write-back of what an episode invented, and the union of references.
//
//   node --experimental-strip-types --no-warnings --import ./scripts/alias-loader.mjs scripts/check-series.mjs
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const S = await import(join(root, 'lib', 'series.ts'));
let n = 0;
const ok = (label, fn) => { fn(); n++; console.log('OK   ' + label); };

// --- normalizing a Story Bible ---
ok('bible: a JSON string, characters without a name dropped, visual_description read', () => {
  const b = S.normalizeSeriesBible(JSON.stringify({ characters: [{ name: 'Pip', role: 'protagonist', visual_description: 'a red fox' }, { role: 'x' }], locations: [{ name: 'Meadow', visual_description: 'green' }], visual_style: { palette: 'warm', bad: 3 }, continuity_rules: ['one', 2] }));
  assert.deepEqual(b.characters, [{ name: 'Pip', role: 'protagonist', description: 'a red fox' }]);
  assert.deepEqual(b.locations, [{ name: 'Meadow', description: 'green' }]);
  assert.deepEqual(b.visualStyle, { palette: 'warm' });
  assert.deepEqual(b.continuityRules, ['one']);
});
ok('bible: junk never throws', () => {
  assert.deepEqual(S.normalizeSeriesBible('{not json').characters, []);
  assert.deepEqual(S.normalizeSeriesBible(null).characters, []);
});

// --- names ---
ok('matchName: exact, diacritics and case off', () => {
  assert.equal(S.matchName('pip', ['Pip', 'Momo']), 'Pip');
  assert.equal(S.matchName('Grandma Ana', ['Grandma Ána']), 'Grandma Ána');
});
ok('matchName: whole-word containment either way, only when unique', () => {
  assert.equal(S.matchName('Pip', ['Pip the Fox', 'Momo']), 'Pip the Fox');
  assert.equal(S.matchName('Pip the Fox', ['Pip', 'Momo']), 'Pip');
  assert.equal(S.matchName('Pip', ['Pip the Fox', 'Pip the Elder']), null);
  assert.equal(S.matchName('Pip', ['Pippa']), null);
});
ok('matchName: same given name only when unique on the candidate side, never on two letters', () => {
  assert.equal(S.matchName('Sam Boyd', ['Sam Boyd Jr', 'Bill Boyd']), 'Sam Boyd Jr');
  assert.equal(S.matchName('Boyd', ['Sam Boyd', 'Bill Boyd']), null);
  assert.equal(S.matchName('Al', ['Al Green', 'Al Blue']), null);
});

// --- reconcile: the episode's refs re-keyed to its bible's spelling ---
const refs = S.normalizeSeriesRefs({
  castRefs: { Pip: 'f1', Momo: 'f2', Crowley: 'f9' },
  castSheets: { Pip: { id: 'f1', url: '', kind: 'turnaround' }, Momo: { id: 'f2', url: '', kind: 'portrait' } },
  objectRefs: { 'The Boat': 'o1' },
  locationRefs: { Meadow: 'l1' },
  locationPlates: { Meadow: { id: 'l1', url: '' } },
});
const bible = S.normalizeSeriesBible({ characters: [{ name: 'Pip the Fox', visual_description: 'x' }, { name: 'Momo', visual_description: 'y' }, { name: 'Zed', visual_description: 'new' }], objects: [{ name: 'The Little Boat', visual_description: 'b' }], locations: [{ name: 'The Meadow', visual_description: 'm' }] });
ok('reconcile: renamed where unambiguous, untouched where exact, kept where unmatched', () => {
  const r = S.reconcileRefsToBible(refs, bible);
  assert.deepEqual(r.refs.castRefs, { 'Pip the Fox': 'f1', Momo: 'f2', Crowley: 'f9' });
  assert.deepEqual(r.refs.castSheets['Pip the Fox'], { id: 'f1', url: '', kind: 'turnaround' });
  assert.deepEqual(r.refs.objectRefs, { 'The Little Boat': 'o1' });
  assert.deepEqual(r.refs.locationRefs, { 'The Meadow': 'l1' });
  assert.deepEqual(r.refs.locationPlates['The Meadow'].id, 'l1');
  assert.deepEqual(r.renamed.map((x) => x.from + '>' + x.to).sort(), ['Meadow>The Meadow', 'Pip>Pip the Fox', 'The Boat>The Little Boat']);
});
ok('reconcile: nothing to do is a no-op with an empty renamed list', () => {
  const r = S.reconcileRefsToBible(refs, S.normalizeSeriesBible({ characters: [{ name: 'Pip', visual_description: 'x' }, { name: 'Momo', visual_description: 'y' }] }));
  assert.deepEqual(r.renamed, []);
  assert.deepEqual(r.refs.castRefs, refs.castRefs);
});

// --- write-back: what the episode invented joins the show ---
ok('mergeBibles: only genuinely new names are added; a respelling is not new', () => {
  const base = S.normalizeSeriesBible({ characters: [{ name: 'Pip', visual_description: 'x' }], locations: [{ name: 'Meadow', visual_description: 'm' }], visual_style: { palette: 'warm' }, continuity_rules: ['r'] });
  const m = S.mergeBibles(base, bible);
  assert.deepEqual(m.added, { characters: ['Momo', 'Zed'], objects: ['The Little Boat'], locations: [] });
  assert.equal(m.bible.characters.length, 3);
  assert.deepEqual(m.bible.visualStyle, { palette: 'warm' });
});

// --- union: earlier wins ---
ok('mergeRefs: the show first, an episode fills only the gaps', () => {
  const u = S.mergeRefs(refs, S.normalizeSeriesRefs({ castRefs: { Pip: 'NEW', Zed: 'z1' } }));
  assert.equal(u.castRefs.Pip, 'f1');
  assert.equal(u.castRefs.Zed, 'z1');
});

// --- Lore ---
ok('lore: the exact names come first, the recap last, under 8000 chars', () => {
  const s = { id: 'recAAAAAAAAAAAAA1', name: 'Pip', premise: 'A fox.', previously: 'Ep1: it rained.', channelName: '', category: 'kids', tone: null, language: 'English', aspect: '16:9', voiceId: '', settings: S.normalizeSeriesSettings({}), bible, refs, sourceProjectId: null, createdAt: null, updatedAt: null };
  const l = S.composeSeriesLore(s, 2, 'extra canon');
  assert.ok(l.indexOf('USE EXACTLY THESE NAMES') < l.indexOf('CHARACTERS'));
  assert.ok(l.includes('Pip the Fox; Momo; Zed'));
  assert.ok(l.indexOf('WHAT HAS HAPPENED') > l.indexOf('CONTINUITY') || !l.includes('CONTINUITY'));
  assert.ok(l.indexOf('WHAT HAS HAPPENED') > l.indexOf('extra canon'));
  assert.ok(l.endsWith('Ep1: it rained.'));
  assert.ok(l.length <= 8000);
});

ok('lore: a recap too long for the budget loses its OLDEST lines, never the newest', () => {
  const previously = Array.from({ length: 40 }, (_, i) => `Episode ${i + 1} — Title ${i + 1}: ${'x'.repeat(300)}`).join('\n');
  const s = { id: 'recAAAAAAAAAAAAA1', name: 'Pip', premise: 'A fox.', previously, channelName: '', category: 'kids', tone: null, language: 'English', aspect: '16:9', voiceId: '', settings: S.normalizeSeriesSettings({}), bible, refs, sourceProjectId: null, createdAt: null, updatedAt: null };
  const l = S.composeSeriesLore(s, 41, '');
  assert.ok(l.length <= 8000);
  assert.ok(l.includes('Episode 40 — Title 40'));
  assert.ok(!l.includes('Episode 1 — Title 1:'));
  assert.ok(l.endsWith('x'.repeat(300)));
  // and the canon above it is whole
  assert.ok(l.includes('CHARACTERS') && l.includes('Pip the Fox; Momo; Zed'));
});

console.log(`${n}/${n} passed`);
