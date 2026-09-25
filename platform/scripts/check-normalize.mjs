// Fixtures for the `normalize*` family in lib/data/derive.ts — the hand-rolled
// validation layer for every field in `Editing Options`. Each one was
// "verified manually on N inputs" once, during the feature it shipped with,
// with nothing persisted: this replaces that with a real, re-runnable test
// for all twelve, covering both halves of the pattern they share — REFUSE an
// out-of-range or malformed value back to a safe default, and CLAMP a value
// that is present but needs rounding/bounding.
//
// This does not replace the functions with anything, and it is not the same
// job as the Zod boundary schemas at the API routes: those check the SHAPE
// of what arrives before normalize runs; this pins the SEMANTICS normalize
// itself is supposed to enforce (refuse vs. clamp, and the exact defaults).
//
//   node --experimental-strip-types --no-warnings --import ./scripts/alias-loader.mjs scripts/check-normalize.mjs
//
// The --import is needed because derive.ts imports `@/lib/provenance` — see
// alias-loader.mjs for why Node's own loader can't resolve that on its own.
// --no-warnings only silences Node's own MODULE_TYPELESS_PACKAGE_JSON perf
// notice (derive.ts is large enough to trip its CJS-then-ESM reparse
// heuristic); it does not touch this script's own OK/FAIL output.
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const derive = await import(join(root, 'lib', 'data', 'derive.ts'));
const {
	normalizeVoiceTone,
	normalizeSpeed,
	normalizeCaptionColor,
	normalizeSfxLevel,
	SFX_LEVEL_DEFAULT,
	normalizeMusicLevel,
	MUSIC_LEVEL_DEFAULT,
	normalizeStatus,
	normalizeHookStyle,
	normalizeHookPlan,
	normalizeHookRegen,
	normalizeMusicTrack,
	normalizeVideoModel,
	normalizeFlowAccounts,
	FLOW_ACCOUNTS_MAX,
	normalizePublishing,
} = derive;

const results = [];
const check = (name, got, want) => {
	const ok = JSON.stringify(got) === JSON.stringify(want);
	results.push(ok);
	console.log(`${ok ? 'OK  ' : 'FAIL'} ${name} -> ${JSON.stringify(got)} (want ${JSON.stringify(want)})`);
};

// --- normalizeVoiceTone --------------------------------------------------
check('voice tone: absent -> null', normalizeVoiceTone(undefined), null);
check('voice tone: empty object -> null (no real number in it)', normalizeVoiceTone({}), null);
check('voice tone: array -> null', normalizeVoiceTone([1, 2, 3]), null);
check('voice tone: one real field clamps the rest to defaults', normalizeVoiceTone({stability: 0.2}), {
	stability: 0.2, similarity: 0.75, style: 0, speakerBoost: true,
});
check('voice tone: out-of-range values CLAMP to [0,1], not refuse', normalizeVoiceTone({stability: 99, similarity: -5, style: 0.4}), {
	stability: 1, similarity: 0, style: 0.4, speakerBoost: true,
});
check('voice tone: speakerBoost only false when explicitly false', normalizeVoiceTone({stability: 0.5, speakerBoost: false}).speakerBoost, false);

// --- normalizeSpeed -------------------------------------------------------
check('speed: absent -> 1', normalizeSpeed(undefined), 1);
check('speed: pace word "slow" -> 0.9', normalizeSpeed('slow'), 0.9);
check('speed: pace word is case/space insensitive', normalizeSpeed('  Fast  '), 1.1);
check('speed: unknown string falls through to Number()', normalizeSpeed('nonsense'), 1);
check('speed: zero or negative refused -> 1', normalizeSpeed(0), 1);
check('speed: out of [0.5,2] refused -> 1', normalizeSpeed(3), 1);
check('speed: within 0.01 of 1 collapses to 1', normalizeSpeed(1.005), 1);
check('speed: a real rate passes through', normalizeSpeed(0.8), 0.8);

// --- normalizeCaptionColor -------------------------------------------------
check('caption color: absent -> null (white default)', normalizeCaptionColor(undefined), null);
check('caption color: "none"/"white"/"off" -> null', normalizeCaptionColor('white'), null);
check('caption color: bad hex -> null', normalizeCaptionColor('not-a-color'), null);
check('caption color: 3-digit hex expands to 6', normalizeCaptionColor('#abc'), '#AABBCC');
check('caption color: 6-digit hex uppercased', normalizeCaptionColor('e8b84b'), '#E8B84B');

// --- normalizeSfxLevel / normalizeMusicLevel (identical shape) ------------
check('sfx level: absent -> default 0.35', normalizeSfxLevel(undefined), SFX_LEVEL_DEFAULT);
check('sfx level: below floor 0.05 refused -> default', normalizeSfxLevel(0.01), SFX_LEVEL_DEFAULT);
check('sfx level: above 1 refused -> default', normalizeSfxLevel(1.5), SFX_LEVEL_DEFAULT);
check('sfx level: valid value rounds to 2 decimals', normalizeSfxLevel(0.123), 0.12);
check('music level: absent -> default 0.22', normalizeMusicLevel(undefined), MUSIC_LEVEL_DEFAULT);
check('music level: below floor refused -> default', normalizeMusicLevel(0), MUSIC_LEVEL_DEFAULT);
check('music level: valid value rounds to 2 decimals', normalizeMusicLevel(0.678), 0.68);

// --- normalizeStatus -------------------------------------------------------
check('status: lowercases and strips diacritics', normalizeStatus('Așteaptă Aprobare Imagine'), 'asteapta aprobare imagine');
check('status: plain ascii passes through lowercased', normalizeStatus('Finalizat'), 'finalizat');

// --- normalizeHookStyle -----------------------------------------------------
check('hook style: absent -> auto', normalizeHookStyle(undefined), 'auto');
check('hook style: unknown id -> auto', normalizeHookStyle('not-a-style'), 'auto');
check('hook style: known id passes through', normalizeHookStyle('teaser'), 'teaser');
check('hook style: case-insensitive', normalizeHookStyle('SLATE'), 'slate');

// --- normalizeHookPlan -------------------------------------------------------
check('hook plan: absent -> null', normalizeHookPlan(undefined), null);
check('hook plan: unknown style -> null (whole plan refused)', normalizeHookPlan({style: 'bogus'}), null);
check('hook plan: minimal valid plan', normalizeHookPlan({style: 'teaser', beats: ['  a  ', '', 'b']}), {
	style: 'teaser', silent: false, beats: ['a', 'b'],
	card: {line1: '', line2: '', source: ''},
	chosenBy: 'ai', writtenAt: null,
});
check('hook plan: silent style forces silent true even if omitted', normalizeHookPlan({style: 'slate'}).silent, true);
check('hook plan: chosenBy refuses anything but producer/default -> ai', normalizeHookPlan({style: 'teaser', chosenBy: 'bogus'}).chosenBy, 'ai');

// --- normalizeHookRegen -------------------------------------------------------
check('hook regen: absent -> null', normalizeHookRegen(undefined), null);
check('hook regen: style resolves through normalizeHookStyle', normalizeHookRegen({style: 'bogus'}), {style: 'auto', at: null});
check('hook regen: non-string at -> null', normalizeHookRegen({style: 'teaser', at: 12345}), {style: 'teaser', at: null});

// --- normalizeMusicTrack -------------------------------------------------------
check('music track: absent -> null (auto by tone)', normalizeMusicTrack(undefined), null);
check('music track: no id -> null', normalizeMusicTrack({name: 'Curious Story'}), null);
check('music track: id with whitespace refused (markup guard)', normalizeMusicTrack({id: 'abc 123'}), null);
check('music track: id with a quote refused', normalizeMusicTrack({id: 'abc"123'}), null);
check('music track: valid id, no name -> name falls back to id', normalizeMusicTrack({id: 'drive123'}), {id: 'drive123', name: 'drive123'});
check('music track: valid id and name', normalizeMusicTrack({id: 'drive123', name: 'Curious Story'}), {id: 'drive123', name: 'Curious Story'});

// --- normalizeVideoModel -------------------------------------------------------
check('video model: absent -> null (free default)', normalizeVideoModel(undefined), null);
check('video model: unknown id -> null', normalizeVideoModel('veo-9-imaginary'), null);
check('video model: the free id itself normalizes to null (one spelling of absent)', normalizeVideoModel('veo-3.1-lite-low-priority'), null);
check('video model: a real paid id passes through', normalizeVideoModel('veo-3.1-fast'), 'veo-3.1-fast');

// --- normalizeFlowAccounts -----------------------------------------------------
// REFUSES rather than clamps, and refuses DOWN to 1: asking for more accounts
// than are linked must not quietly become "use them all", because the number
// decides how a film's scenes are cut into blocks and a block pointed at an
// account that does not exist produces clips nobody can use. 1 is what every
// film had before the accounts were added.
check('flow accounts: absent -> 1', normalizeFlowAccounts(undefined), 1);
check('flow accounts: empty string -> 1', normalizeFlowAccounts(''), 1);
check('flow accounts: 0 -> 1', normalizeFlowAccounts(0), 1);
check('flow accounts: negative -> 1', normalizeFlowAccounts(-2), 1);
check('flow accounts: above the linked count -> 1, NOT clamped to the max', normalizeFlowAccounts(9), 1);
check('flow accounts: a fraction is not a count -> 1', normalizeFlowAccounts(2.5), 1);
check('flow accounts: nonsense -> 1', normalizeFlowAccounts('all of them'), 1);
check('flow accounts: the numeric string the form posts', normalizeFlowAccounts('3'), 3);
check('flow accounts: 1 stays 1', normalizeFlowAccounts(1), 1);
check('flow accounts: 2 stays 2', normalizeFlowAccounts(2), 2);
check('flow accounts: the max passes through', normalizeFlowAccounts(FLOW_ACCOUNTS_MAX), FLOW_ACCOUNTS_MAX);

// --- normalizePublishing -------------------------------------------------------
check('publishing: absent -> review state, empty fields', normalizePublishing(undefined), {
	state: 'review', ytTitle: '', description: '', notes: '', ytUrl: '',
});
check('publishing: unknown state refused -> review', normalizePublishing({state: 'bogus'}).state, 'review');
check('publishing: known state passes through', normalizePublishing({state: 'posted'}).state, 'posted');
check('publishing: ytTitle clamped to 200 chars', normalizePublishing({ytTitle: 'x'.repeat(250)}).ytTitle.length, 200);
check('publishing: description clamped to 5500 chars', normalizePublishing({description: 'x'.repeat(6000)}).description.length, 5500);
check('publishing: non-string fields become empty strings, not thrown away silently', normalizePublishing({notes: 12345}).notes, '');

// --- motion packs (lib/motion-packs.ts) -----------------------------------------
// The render's half of the same rules is remotion/scripts/check-motion.mjs;
// the ids and the Story default must match it.
const mp = await import(join(root, 'lib', 'motion-packs.ts'));
check('motion pack: absent -> null (Auto, the category decides)', mp.normalizeMotionPack(undefined), null);
check('motion pack: unknown refused -> null', mp.normalizeMotionPack('flashy'), null);
check('motion pack: the four ids pass', ['classic', 'editorial', 'punch', 'lowerThird'].map(mp.normalizeMotionPack), ['classic', 'editorial', 'punch', 'lowerThird']);
check('motion pack: case matters (the render reads lowerThird exactly)', mp.normalizeMotionPack('lowerthird'), null);
check('motion pack: Story defaults to editorial', mp.defaultMotionPackFor('story'), 'editorial');
check('motion pack: every other category defaults to classic', ['documentary', 'cinematic', 'kids', null].map(mp.defaultMotionPackFor), ['classic', 'classic', 'classic', 'classic']);

// --- graphic styles (lib/graphic-styles.ts) --------------------------------------
// Same five ids as remotion/src/graphics/styles.ts and the two n8n nodes in
// db/port/graphic-styles (whose own check is db/port/graphic-styles/check.mjs).
const gs = await import(join(root, 'lib', 'graphic-styles.ts'));
check('graphic style: absent -> null (AI picks)', gs.normalizeGraphicStyle(undefined), null);
check('graphic style: unknown refused -> null', gs.normalizeGraphicStyle('neon'), null);
check('graphic style: the five ids pass', ['classic', 'reportage', 'editorial', 'cinematic', 'handwritten'].map(gs.normalizeGraphicStyle), ['classic', 'reportage', 'editorial', 'cinematic', 'handwritten']);
check('graphic style: offered on every category', ['story', 'documentary', 'kids', 'cinematic', null].map(gs.offersGraphicStyle), [true, true, true, true, true]);
check('graphic style: each category offers its own set', ['story', 'kids', 'cinematic', 'odd'].map((c) => gs.graphicStylesFor(c).map((g) => g.id).join(',')), ['reportage,editorial,cinematic,handwritten,classic', 'kidsStorybook,kidsPlayful,kidsAll,classic', 'cineFilm,cineNeon,cineMemory,classic', 'reportage,editorial,cinematic,handwritten,classic']);
check('graphic style: the kids and cinematic ids pass', ['kidsAll', 'cineNeon'].map(gs.normalizeGraphicStyle), ['kidsAll', 'cineNeon']);
check('graphic plan: kids and cinematic items are read',
  gs.normalizeGraphicPlan({ style: 'kidsAll', items: [
    { kind: 'character', sceneOrder: 2, title: 'Pip', box: [0.1, 0.1, 0.2, 0.3], image: 'https://x' },
    { kind: 'speech', sceneOrder: 3, text: 'Oh dear!' },
    { kind: 'moment', sceneOrder: 4, label: 'Found it!' },
    { kind: 'celebrate', sceneOrder: 5 },
    { kind: 'slate', sceneOrder: 6, title: 'H10', subtitle: '18:42' },
  ] }).items.map((i) => i.kind).join(','), 'character,speech,moment,celebrate,slate');
check('graphic plan: garbage -> null', gs.normalizeGraphicPlan({ style: 'neon', items: [] }), null);
check('graphic plan: malformed items dropped, good ones kept',
  gs.normalizeGraphicPlan({ style: 'reportage', source: 'ai', why: 'x', at: null, items: [
    { kind: 'person', sceneOrder: 3, title: 'Augustus', subtitle: 'Emperor' },
    { kind: 'stat', sceneOrder: 4, value: 40, suffix: 'M', label: 'modii' },
    { kind: 'person', sceneOrder: 0, title: 'Nobody' },
    { kind: 'stat', sceneOrder: 5, value: 'lots', label: 'x' },
    { kind: 'map', sceneOrder: 6, title: 'x' },
  ] }).items,
  [{ kind: 'person', sceneOrder: 3, title: 'Augustus', subtitle: 'Emperor' }, { kind: 'stat', sceneOrder: 4, value: 40, label: 'modii', suffix: 'M' }]);
check('graphic plan: its transition is read, a bad one dropped',
  [gs.normalizeGraphicPlan({ style: 'classic', transition: 'blur', items: [] }).transition, gs.normalizeGraphicPlan({ style: 'classic', transition: 'wipe', items: [] }).transition], ['blur', null]);

// --- transitions (lib/transition-styles.ts) ---------------------------------------
const ts = await import(join(root, 'lib', 'transition-styles.ts'));
check('transition: absent -> null (AI picks)', ts.normalizeTransitionStyle(undefined), null);
check('transition: none is a real choice', ts.normalizeTransitionStyle('none'), 'none');
check('transition: the six ids pass', ['none', 'push', 'crossfade', 'blur', 'shutter', 'glitch'].map(ts.normalizeTransitionStyle), ['none', 'push', 'crossfade', 'blur', 'shutter', 'glitch']);
check('transition: unknown refused', ts.normalizeTransitionStyle('wipe'), null);

console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
