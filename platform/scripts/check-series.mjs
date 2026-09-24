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

// --- the whole brief a show freezes ---
ok('settings: a film becomes a format — length, look, overlays, levels, hands-off', () => {
  const st = S.seriesSettingsFromProject(
    {
      category: 'kids', categoryOptions: { visual_style: 'clay' },
      chapterCards: false, endScreen: true, sfx: true, drawnCards: false, music: true,
      sourceWatermark: false, sfxLevel: 0.5, musicLevel: 0.3, captionColor: '#ffcc00',
      autoApprove: true, speed: 0.9, hookStyle: 'teaser', videoModel: 'veo-3.1-fast',
      multiVoiceMode: 'characters', cast: ['v1', 'v2'],
    },
    { lengthSeconds: 180, style: 'soft clay, warm light', noCaptions: false },
  );
  assert.equal(st.lengthSeconds, 180);
  assert.equal(st.style, 'soft clay, warm light');
  assert.equal(st.sfxLevel, 0.5);
  assert.equal(st.musicLevel, 0.3);
  assert.equal(st.captionColor, '#FFCC00');
  assert.equal(st.autoApprove, true);
  assert.equal(st.multiVoiceMode, 'characters');
  assert.deepEqual(st.cast, ['v1', 'v2']);
  // the FORM's field names, and captions read off the project's inverted column
  assert.deepEqual(st.finishes, {
    captions: true, chapter_cards: false, end_screen: true,
    sfx: true, drawn_cards: false, music: true, source_watermark: false,
  });
});
ok('settings: no_captions true means the switch is off', () => {
  const st = S.seriesSettingsFromProject({}, { lengthSeconds: null, style: null, noCaptions: true });
  assert.equal(st.finishes.captions, false);
  // a film that answered nothing else leaves every other switch unstored,
  // so the brief keeps its own default rather than inheriting a guess
  assert.deepEqual(Object.keys(st.finishes), ['captions']);
  assert.equal(st.lengthSeconds, null);
  assert.equal(st.style, null);
});
ok('settings: a series stored before this opens exactly as a fresh brief', () => {
  const st = S.normalizeSeriesSettings({ categoryOptions: { visual_style: 'cel' }, speed: 1 });
  assert.deepEqual(st.finishes, {});
  assert.equal(st.lengthSeconds, null);
  assert.equal(st.sfxLevel, null);
  assert.equal(st.musicLevel, null);
  assert.equal(st.captionColor, null);
  assert.equal(st.autoApprove, null);
  assert.equal(st.style, null);
});
ok('settings: out-of-range levels and junk are refused, never clamped into a lie', () => {
  const st = S.normalizeSeriesSettings({ sfxLevel: 4, musicLevel: 'loud', lengthSeconds: 99999, captionColor: 'red', autoApprove: 'yes', finishes: { music: 'on', nope: true } });
  assert.equal(st.sfxLevel, null);
  assert.equal(st.musicLevel, null);
  assert.equal(st.lengthSeconds, null);
  assert.equal(st.captionColor, null);
  assert.equal(st.autoApprove, null);
  assert.deepEqual(st.finishes, {});
});

// --- the prefill the brief opens with ---
ok('prefill: carries the show, its people and the titles already used', () => {
  const s = { id: 'recAAAAAAAAAAAAA1', name: 'Pip', premise: 'A fox.', previously: 'Episode 1 — One: it rained.', channelName: '', category: 'kids', tone: 'Childish', language: 'English', aspect: '16:9', voiceId: 'v', settings: S.seriesSettingsFromProject({ music: true }, { lengthSeconds: 120, style: 'clay', noCaptions: false }), bible, refs, sourceProjectId: null, createdAt: null, updatedAt: null };
  const p = S.seriesPrefill(s, 4, ['One', 'Two', 'Three']);
  assert.equal(p.episodeNo, 4);
  assert.equal(p.lengthSeconds, 120);
  assert.equal(p.style, 'clay');
  assert.equal(p.finishes.music, true);
  assert.deepEqual(p.characters, ['Pip the Fox', 'Momo', 'Zed']);
  assert.deepEqual(p.episodeTitles, ['One', 'Two', 'Three']);
  assert.equal(p.premise, 'A fox.');
  assert.ok(p.previously.includes('it rained'));
});
ok('prefill: only the last twelve titles travel, and a show with none is fine', () => {
  const s = { id: 'recAAAAAAAAAAAAA1', name: 'Pip', premise: '', previously: '', channelName: '', category: 'story', tone: null, language: 'English', aspect: '16:9', voiceId: '', settings: S.normalizeSeriesSettings({}), bible, refs, sourceProjectId: null, createdAt: null, updatedAt: null };
  const many = Array.from({ length: 20 }, (_, i) => `Ep ${i + 1}`);
  assert.deepEqual(S.seriesPrefill(s, 21, many).episodeTitles, many.slice(-12));
  assert.deepEqual(S.seriesPrefill(s, 1).episodeTitles, []);
  // premise falls back to the bible's logline, which is what the show is
  assert.equal(S.seriesPrefill(s, 1).premise, bible.logline);
});

// --- a show frozen before the whole brief was carried ---
const OLD_ROW = { categoryOptions: { visual_style: 'felt' }, speed: 0.8, hookStyle: 'auto', multiVoiceMode: 'off', cast: [], voice: { stability: 0.35, similarity: 0.75, style: 0.4, speakerBoost: true } };

// --- which gates a show signs off by itself (lib/hands-off.ts) ---
ok('hands-off steps: a show freezes WHICH gates its first film signed off', () => {
  const st = S.seriesSettingsFromProject(
    { autoApprove: true, autoApproveSteps: ['video', 'images', 'bogus'] },
    { lengthSeconds: 90, style: null, noCaptions: false },
  );
  assert.deepEqual(st.autoApproveSteps, ['images', 'video']);
  assert.equal(st.autoApprove, true);
});
ok('hands-off steps: a show from before the choice keeps only its switch', () => {
  const st = S.normalizeSeriesSettings({ autoApprove: true });
  assert.equal(st.autoApproveSteps, null);
  assert.equal(st.autoApprove, true);
});
ok('hands-off steps: a show that said the old switch is not narrowed by its film', () => {
  const stored = S.normalizeSeriesSettings({ ...OLD_ROW, autoApprove: true });
  const derived = S.seriesSettingsFromProject({ autoApprove: true, autoApproveSteps: ['images'] }, { lengthSeconds: 90, style: null, noCaptions: false });
  const out = S.fillSeriesSettings(stored, derived);
  assert.equal(out.autoApprove, true);
  assert.equal(out.autoApproveSteps, null);
});
ok('hands-off steps: a show that never said anything learns the list', () => {
  const stored = S.normalizeSeriesSettings(OLD_ROW);
  const derived = S.seriesSettingsFromProject({ autoApprove: true, autoApproveSteps: ['images'] }, { lengthSeconds: 90, style: null, noCaptions: false });
  const out = S.fillSeriesSettings(stored, derived);
  assert.deepEqual(out.autoApproveSteps, ['images']);
});


ok('fill: an old show learns length, overlays and levels from its first film', () => {
  const stored = S.normalizeSeriesSettings(OLD_ROW);
  assert.equal(S.hasFullSettings(stored), false);
  const derived = S.seriesSettingsFromProject(
    { sfx: true, music: false, drawnCards: false, chapterCards: false, endScreen: true, sfxLevel: 0.35, musicLevel: 0.22, autoApprove: true },
    { lengthSeconds: 90, style: 'felt puppets', noCaptions: false },
  );
  const out = S.fillSeriesSettings(stored, derived);
  assert.equal(S.hasFullSettings(out), true);
  assert.equal(out.lengthSeconds, 90);
  assert.equal(out.style, 'felt puppets');
  assert.equal(out.autoApprove, true);
  assert.equal(out.finishes.chapter_cards, false);
  assert.equal(out.finishes.drawn_cards, false);
  assert.equal(out.finishes.captions, true);
  // and what the show already said is untouched
  assert.equal(out.speed, 0.8);
  assert.equal(out.hookStyle, 'auto');
  assert.deepEqual(out.categoryOptions, { visual_style: 'felt' });
  assert.equal(out.voice.stability, 0.35);
});
ok('fill: it can only ever ADD — the show always beats the film it came from', () => {
  const stored = S.normalizeSeriesSettings({ ...OLD_ROW, lengthSeconds: 240, autoApprove: false, finishes: { music: true } });
  const derived = S.seriesSettingsFromProject(
    { music: false, sfx: true, autoApprove: true },
    { lengthSeconds: 90, style: 'x', noCaptions: true },
  );
  const out = S.fillSeriesSettings(stored, derived);
  assert.equal(out.lengthSeconds, 240);
  assert.equal(out.autoApprove, false);
  assert.equal(out.finishes.music, true);     // the show's own switch stands
  assert.equal(out.finishes.sfx, true);       // and the ones it never froze are filled
  assert.equal(out.finishes.captions, false);
});
ok('fill: a show that already has everything is already done', () => {
  const full = S.seriesSettingsFromProject({ music: true }, { lengthSeconds: 120, style: 'clay', noCaptions: false });
  assert.equal(S.hasFullSettings(full), true);
  assert.deepEqual(S.fillSeriesSettings(full, S.normalizeSeriesSettings({})), full);
});
ok('fill: multiVoiceMode is only taken from the film while the show says "off"', () => {
  const a = S.fillSeriesSettings(S.normalizeSeriesSettings({}), S.normalizeSeriesSettings({ multiVoiceMode: 'characters' }));
  assert.equal(a.multiVoiceMode, 'characters');
  const b = S.fillSeriesSettings(S.normalizeSeriesSettings({ multiVoiceMode: 'chapters' }), S.normalizeSeriesSettings({ multiVoiceMode: 'characters' }));
  assert.equal(b.multiVoiceMode, 'chapters');
});

console.log(`${n}/${n} passed`);
