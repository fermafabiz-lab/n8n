// Text cards: explicit (motif) cards and derived (claim / figure) cards are
// merged, one card per scene, the explicit one winning its scene.
//
// Pinned on 2026-09-23 after the New York remote-work film shipped with ONE
// drawn card in six minutes: one compare card had survived Scripting's
// validator, and a non-empty explicit list used to bypass the derivation
// entirely — so the twenty spoken figures that would otherwise have become
// cards were silenced by the one card that was accepted.
//
//   node --experimental-strip-types scripts/check-cards.mjs
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const {buildTextCards} = await import(join(root, 'src', 'textCards.ts'));

let failed = 0;
const check = (name, got, want) => {
	const ok = JSON.stringify(got) === JSON.stringify(want);
	if (!ok) failed++;
	console.log(`${ok ? 'OK  ' : 'FAIL'} ${name} -> ${JSON.stringify(got)}${ok ? '' : ` (want ${JSON.stringify(want)})`}`);
};

// A six-scene film: hook, then chapter 1 (three scenes), then chapter 2 (two).
// Scene 1 starts exactly where the hook ends, and the derivation keeps half a
// second clear of the hook, so it never carries a derived card — by design.
const scenes = [
	{narratorText: '', startSeconds: 0, durationSeconds: 6, chapter: 0},
	{narratorText: 'It began in 1907 with a wager.', startSeconds: 6, durationSeconds: 8, chapter: 1},
	{narratorText: 'Nobody expected the steppe.', startSeconds: 14, durationSeconds: 8, chapter: 1},
	{narratorText: 'Only 38% of the cars reached the river.', startSeconds: 22, durationSeconds: 8, chapter: 1},
	{narratorText: 'Paris was 9,000 miles away.', startSeconds: 30, durationSeconds: 8, chapter: 2},
	{narratorText: 'They arrived in August.', startSeconds: 38, durationSeconds: 8, chapter: 2},
];
const route = {sceneIndex: 2, variant: 'route', headline: '', stops: [], seconds: 3.4, minSeconds: 2.8};
const routeOnChapterStart = {...route, sceneIndex: 4};

const kinds = (cards) => cards.map((c) => `${c.sceneIndex}:${c.variant}`);

// 1. No explicit cards: the derivation alone, exactly as before.
check(
	'derived alone: a figure card on every scene that speaks a figure',
	kinds(buildTextCards({scenes, explicit: [], chapterCardsOn: false, hookSeconds: 6})),
	['3:figure', '4:figure'],
);

// 2. One explicit card does NOT silence the derived ones any more.
check(
	'explicit + derived merge, in timeline order',
	kinds(buildTextCards({scenes, explicit: [route], chapterCardsOn: false, hookSeconds: 6})),
	['2:route', '3:figure', '4:figure'],
);

// 3. The explicit card wins its own scene.
check(
	'an explicit card on a figure scene replaces the figure card',
	kinds(buildTextCards({scenes, explicit: [{...route, sceneIndex: 3}], chapterCardsOn: false, hookSeconds: 6})),
	['3:route', '4:figure'],
);

// 4. Chapter cards on: a chapter's first scene is owned, for explicit and derived alike.
check(
	'chapter cards on: nothing lands on a chapter start',
	kinds(buildTextCards({scenes, explicit: [routeOnChapterStart], chapterCardsOn: true, hookSeconds: 6})),
	['3:figure'],
);

// 5. Chapter cards off: the same explicit card on the same scene is kept.
check(
	'chapter cards off: the route on a chapter start is drawn',
	kinds(buildTextCards({scenes, explicit: [routeOnChapterStart], chapterCardsOn: false, hookSeconds: 6})),
	['3:figure', '4:route'],
);

// 6. An explicit card pointing outside the film is ignored, not thrown on.
check(
	'an explicit card off the end of the film is dropped',
	kinds(buildTextCards({scenes, explicit: [{...route, sceneIndex: 40}], chapterCardsOn: false, hookSeconds: 6})),
	['3:figure', '4:figure'],
);

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
