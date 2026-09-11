// Check the cold open: where the hook ends, and when its card may hold the frame.
//
// The card is the part that is right in a still and wrong on the boundary
// frame: it must be gone before the chapter card's flare peaks on the first
// story scene, it must never be drawn when it cannot be read, and a plan that
// arrives broken must draw nothing rather than take the render down. None of
// that can be seen in Studio, so it is walked here.
//
//   node --experimental-strip-types scripts/check-hook.mjs
import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const {hookEndSeconds, hookCardWindow, normalizeHookPlan, SILENT_HOOK_STYLES} = await import(
	join(root, 'src', 'hook.ts')
);
// FLASH_IN * FLASH_PEAK from src/components/LightLeak.tsx — the lead by which a
// card's flare precedes the frame it hides. Copied, because a .tsx cannot be
// loaded by --experimental-strip-types; asserted below so it cannot drift.
const FLASH_LEAD = 0.55 * 0.28;
{
	const src = readFileSync(join(root, 'src', 'components', 'LightLeak.tsx'), 'utf8');
	const num = (name) => Number((src.match(new RegExp(`export const ${name} = ([0-9.]+);`)) ?? [])[1]);
	if (Math.abs(num('FLASH_IN') * num('FLASH_PEAK') - FLASH_LEAD) > 1e-9) {
		console.error(`FLASH_LEAD drifted: LightLeak says ${num('FLASH_IN')} * ${num('FLASH_PEAK')}`);
		process.exit(1);
	}
}

let failed = false;
const check = (ok, label, detail = '') => {
	console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${label}${detail ? `   ${detail}` : ''}`);
	if (!ok) failed = true;
};

const scene = (start, dur, chapter, text = 'x') => ({
	narratorText: text,
	startSeconds: start,
	durationSeconds: dur,
	chapter,
});
// A teaser of four three-second shots, then the story.
const TEASER = [
	scene(0, 3, 0),
	scene(3, 3, 0),
	scene(6, 3, 0),
	scene(9, 3.5, 0),
	scene(12.5, 8, 1),
	scene(20.5, 8, 1),
];

console.log('\n--- where the hook ends ---');
check(hookEndSeconds(TEASER) === 12.5, 'the hook ends where chapter 1 begins', '12.5s');
check(hookEndSeconds([scene(0, 8, 1), scene(8, 8, 1)]) === 0, 'a film with no chapter 0 has no hook');
check(hookEndSeconds([scene(0, 3, 0), scene(3, 3, 0)]) === 0, 'a film that is only chapter 0 holds no card');
check(hookEndSeconds([]) === 0, 'no scenes, no hook');
// The pre-2026-09-11 shape: one voiced 8s scene at order 1.
check(hookEndSeconds([scene(0, 8.2, 0), scene(8.2, 7, 1)]) === 8.2, 'an old single-scene hook still measures');

console.log('\n--- reading the plan ---');
const plan = (over = {}) =>
	normalizeHookPlan({
		style: 'question',
		silent: false,
		beats: ['One student.', 'A bank with three vaults.'],
		card: {line1: 'How did he walk out unseen?', line2: '', source: ''},
		chosenBy: 'ai',
		...over,
	});
check(plan() !== null && plan().style === 'question', 'a well-formed plan is read');
check(normalizeHookPlan(null) === null, 'null draws nothing');
check(normalizeHookPlan('teaser') === null, 'a string draws nothing');
check(normalizeHookPlan({style: 'ballad'}) === null, 'an unknown style draws nothing');
check(plan({beats: 'not a list'}).beats.length === 0, 'beats that are not a list read as none');
check(plan({card: null}).card.line1 === '', 'a missing card reads as an empty one');
check(
	SILENT_HOOK_STYLES.every((s) => normalizeHookPlan({style: s, card: {}}).silent === true),
	'every silent style reads as silent even when the flag is missing',
);
check(
	normalizeHookPlan({style: 'teaser', silent: true, card: {}}).silent === true,
	'an explicit silent flag is kept',
);
check(
	plan({card: {line1: '  How   did he\n walk out? ', line2: '', source: ''}}).card.line1 ===
		'How did he walk out?',
	'card lines are whitespace-normalized',
);

console.log('\n--- the card window ---');
const end = hookEndSeconds(TEASER);
{
	const w = hookCardWindow(plan(), end);
	check(w !== null, 'a question over a 12.5s teaser gets a card');
	check(w.from > 0, 'it does not begin on frame 0', `${w.from}s`);
	check(w.to <= end - FLASH_LEAD, 'it is gone before the chapter flare leads the first story frame', `${w.to}s vs ${(end - FLASH_LEAD).toFixed(3)}s`);
	check(w.to - w.from >= 1.6, 'it is on screen long enough to read', `${(w.to - w.from).toFixed(2)}s`);
	check(w.to - w.from <= 4.2, 'and not longer than a question needs', `${(w.to - w.from).toFixed(2)}s`);
}
{
	const w = hookCardWindow(plan({style: 'slate', card: {line1: 'The bank', line2: '1931', source: ''}}), 6.2);
	check(w !== null && Math.abs(w.to - (6.2 - 0.55)) < 1e-9, 'a slate holds its one shot to the boundary clearance', `${w && w.to}s`);
}
for (const s of ['teaser', 'action', 'cliffhanger']) {
	check(
		hookCardWindow(plan({style: s, card: {line1: 'stray text', line2: '', source: ''}}), end) === null,
		`${s} draws no card even when the model wrote one`,
	);
}
check(hookCardWindow(plan({card: {line1: '', line2: 'x', source: ''}}), end) === null, 'an empty line1 draws nothing');
check(hookCardWindow(plan(), 0) === null, 'no hook, no card');
check(hookCardWindow(plan(), 1.8) === null, 'a hook too short to read a card in draws none');
check(hookCardWindow(null, end) === null, 'no plan, no card');

console.log(
	`\nWhat this cannot tell you is how the card LOOKS over a real teaser — render\n` +
		`the HookQuestion / HookSlate / HookFigure probes in src/probe.tsx for that.\n`,
);
process.exit(failed ? 1 : 0);
