// A motif card placed inside the cold-open teaser (chapter 0) is moved to the
// scene that speaks its content, or refused — never accepted where the render
// cannot draw it. The fixture is the film that found it: "How Rome fed a
// million people" (Final Assembly 16974, 2026-09-24), whose route card sat on
// a 1.96 s hook beat and was dropped by the montage planner without a word.
//
//   node motif/check-teaser.mjs        (part of `npm run check`)

import {validateMotifCards} from './validate.mjs';

const scenes = [
	['One million people.', 0],
	['Rome could not feed itself.', 0],
	['Grain from across the sea.', 0],
	['Measured, stored, moved inland.', 0],
	['Augustus appointed a praefectus annonae because Rome could not feed itself.', 1],
	['Annual need ran to 20 to 40 million modii, carried by tax grain and private shippers from Sardinia, Sicily, Africa, and Egypt.', 1],
	['Claudius built Portus north of the Tiber mouth.', 1],
].map(([narratorText, chapter]) => ({narratorText, chapter}));

const quote = (sceneIndex, from) => ({kind: 'quote', sceneIndex, from});
const route = (sceneIndex, stopScene) => ({
	sceneIndex,
	variant: 'route',
	label: 'supply',
	stops: ['Sardinia', 'Sicily', 'Africa', 'Egypt'],
	sources: Object.fromEntries(
		['Sardinia', 'Sicily', 'Africa', 'Egypt'].map((s, k) => [`stops[${k}]`, quote(stopScene, s)]),
	),
});

let failures = 0;
const check = (ok, what) => {
	console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${what}`);
	if (!ok) failures++;
};

{
	// The Rome card: on teaser scene 2, quoting scene 5.
	const {accepted, report} = validateMotifCards({cards: [route(2, 5)], scenes, chapterCardsOn: false});
	check(accepted.length === 1 && accepted[0].sceneIndex === 5, 'a teaser card moves to the scene it quotes (2 → 5)');
	check(
		(report[0].notes ?? []).some((n) => /moved from scene 2/.test(n)),
		'the report says it was moved, and from where',
	);
}
{
	// A card whose content is only spoken inside the teaser has nowhere to go.
	const card = {
		sceneIndex: 1,
		variant: 'route',
		label: 'rome',
		stops: ['Rome', 'itself'],
		sources: {'stops[0]': quote(1, 'Rome'), 'stops[1]': quote(1, 'itself')},
	};
	const {accepted, report} = validateMotifCards({cards: [card], scenes, chapterCardsOn: false});
	check(accepted.length === 0, 'a card quoting only the teaser is refused');
	check(/teaser/.test(report[0].why ?? ''), 'and the refusal names the teaser');
}
{
	// A film made before the teaser has no chapter 0: nothing moves.
	const old = scenes.map((s) => ({...s, chapter: 1}));
	const {accepted} = validateMotifCards({cards: [route(2, 5)], scenes: old, chapterCardsOn: false});
	check(accepted.length === 1 && accepted[0].sceneIndex === 2, 'a film without a teaser keeps its card where it was placed');
}
{
	// A card already past the teaser is untouched.
	const {accepted} = validateMotifCards({cards: [route(5, 5)], scenes, chapterCardsOn: false});
	check(accepted.length === 1 && accepted[0].sceneIndex === 5, 'a card after the teaser stays on its scene');
}

if (failures) {
	console.log(`\n${failures} teaser check(s) failed`);
	process.exit(1);
}
console.log('\nall teaser checks passed');
