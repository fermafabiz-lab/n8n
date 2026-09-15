// Check the caption timing model: where the highlight sits inside a scene.
//
// The captions are anchored to the take at both ends by construction — the
// first word starts with it, the last ends with it — so what this checks is
// everything between: that a word's slot is proportional to what it costs to
// SAY, that the allocation cannot drift or run backwards, and that markup
// never becomes a word.
//
// It also measures the model against ground truth, which is the only part of
// this that is evidence rather than assertion: for every scene of the fixture
// the real take length is known (ffprobe, from the assemble step), so the
// model can be asked to predict it from the text alone and be scored. The
// number to watch is the mean absolute error against the best possible
// UNIFORM rate — if that gap ever closes, this model is not buying anything.
//
//   node --experimental-strip-types scripts/check-captions.mjs [props.json]
import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const {wordTimings, spokenWords, estimateSpeechSeconds, activeWordIndex, stripTags, captionAt} =
	await import(join(root, 'src', 'captionTiming.ts'));
/** What FinalVideo renders at. A word narrower than one frame is never drawn. */
const FPS = 24;

const propsPath =
	process.argv.slice(2).find((a) => a.endsWith('.json')) ??
	join(root, 'trigger', 'studio-props.json');

let failed = false;
const check = (ok, label, detail = '') => {
	console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${label}${detail ? `   ${detail}` : ''}`);
	if (!ok) failed = true;
};
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

console.log('\n--- invariants ---');

{
	const text = 'În 1941, responsabilitatea a fost transferată. Nimeni nu a semnat.';
	const t = wordTimings(text, 6);
	check(t.length === spokenWords(text).length, 'one timing per spoken word', `${t.length} words`);
	check(near(t[0].start, 0), 'first word starts with the take');
	check(near(t.at(-1).end, 6), 'last word ends with the take');
	check(
		t.every((w, i) => w.end > w.start && (i === 0 || near(w.start, t[i - 1].end))),
		'windows are contiguous and forward-only',
	);
	// The whole point: a long word may not get the same slot as a short one.
	const byWord = Object.fromEntries(t.map((w) => [w.word, w.end - w.start]));
	check(
		byWord['responsabilitatea'] > 2.5 * byWord['a'],
		'a long word gets a longer slot than a short one',
		`responsabilitatea ${byWord['responsabilitatea'].toFixed(2)}s vs a ${byWord['a'].toFixed(2)}s`,
	);
	// A pause belongs to the word it follows, so the highlight waits on
	// "transferată." rather than jumping ahead into the silence.
	const stop = t.find((w) => w.word === 'transferată.');
	const nextWord = t[t.indexOf(stop) + 1];
	check(
		stop.end - stop.start > nextWord.end - nextWord.start,
		'the word before a full stop holds the pause',
	);
}

{
	// Markup is never spoken, so it must neither be timed nor printed.
	const tagged = '[CHARACTER: Maria] Nu mai am ce să spun. [NARRATOR] Şi a plecat.';
	const words = spokenWords(tagged);
	check(!words.some((w) => w.includes('[') || w.includes(']')), 'speaker tags are stripped');
	check(words.length === 9, 'only the spoken words are counted', `${words.length} words`);
	check(stripTags('[NARRATOR]') === '', 'a line that is only markup yields nothing');
	check(wordTimings('[NARRATOR]', 4).length === 0, 'and produces no timings');
}

{
	// Degenerate inputs must not throw or produce a zero-length first word —
	// the caller reads this as "no captions", and an exception here would take
	// the whole composition down mid-render.
	const cases = [
		['', 5],
		['   ', 5],
		['un cuvânt', 0],
		['un cuvânt', -1],
		['un cuvânt', NaN],
	];
	check(
		cases.every(([text, s]) => wordTimings(text, s).length === 0),
		'empty text and non-positive lengths return no timings',
	);
	// A take shorter than the pauses the text implies still leaves every word a
	// window, because the pauses scale down with it rather than off the top.
	const tight = wordTimings('Da. Nu. Poate. Sigur.', 0.4);
	check(
		tight.length === 4 && tight.every((w) => w.end > w.start),
		'a take shorter than its own pauses still gives every word a window',
	);
}

{
	const t = wordTimings('unu doi trei patru', 4);
	check(activeWordIndex(t, 0) === 0, 'the first word is active at t=0');
	check(activeWordIndex(t, 3.999) === t.length - 1, 'the last word is active just before the end');
	check(activeWordIndex(t, -0.1) === -1, 'nothing is active before the take');
	check(activeWordIndex(t, 4.5) === -1, 'nothing is active after it');
	check(
		t.every((w, i) => activeWordIndex(t, (w.start + w.end) / 2) === i),
		'the middle of every window selects its own word',
	);
}

// ---- what actually reaches the screen ----
//
// Walking every frame of the fixture through `captionAt` is the only way to
// catch an off-by-one between the chunk list and the timing list: the render
// would show a caption, on time, with the highlight one word off — and no
// still could tell you.
{
	const film = JSON.parse(readFileSync(propsPath, 'utf8')).scenes ?? [];
	const last = film.at(-1);
	const total = last ? last.startSeconds + last.durationSeconds : 0;
	const perScene = new Map();
	let mismatched = 0;
	let outOfChunk = 0;

	for (let f = 0; f * (1 / FPS) < total; f++) {
		const t = f / FPS;
		const active = captionAt(film, t);
		if (!active) continue;
		if (active.activeInChunk < 0 || active.activeInChunk >= active.chunk.length) outOfChunk++;
		const scene = film.find(
			(s) => t >= s.startSeconds && t < s.startSeconds + s.durationSeconds,
		);
		const words = spokenWords(scene.narratorText);
		// The word painted bright must be the word the model says is being said.
		if (active.chunk[active.activeInChunk] !== words[active.wordIndex]) mismatched++;
		if (!perScene.has(scene)) perScene.set(scene, []);
		perScene.get(scene).push(active.wordIndex);
	}

	check(outOfChunk === 0, 'the highlight is always inside the chunk on screen');
	check(mismatched === 0, 'the highlighted word is the word the timing selected');

	let notMonotonic = 0;
	let badStart = 0;
	let badEnd = 0;
	let skipped = 0;
	for (const [scene, seq] of perScene) {
		if (seq.some((v, i) => i > 0 && v < seq[i - 1])) notMonotonic++;
		if (seq[0] !== 0) badStart++;
		if (seq.at(-1) !== spokenWords(scene.narratorText).length - 1) badEnd++;
		// A word whose window is narrower than a frame is never drawn. Legal, but
		// it is the shape of "the captions skip words", so it is counted.
		const seen = new Set(seq);
		skipped += spokenWords(scene.narratorText).length - seen.size;
	}
	check(notMonotonic === 0, 'the highlight never runs backwards', `${perScene.size} scenes`);
	check(badStart === 0, 'every scene starts on its first word');
	check(badEnd === 0, 'every scene ends on its last word');
	check(skipped === 0, `no word is too short to be drawn at ${FPS}fps`, `${skipped} skipped`);
}

// ---- the measurement ----
//
// Predict each take's real length from its text alone and score it. Both
// models are given their best possible constant: the uniform one is fitted
// here, so this is not a straw man.
const scenes = (JSON.parse(readFileSync(propsPath, 'utf8')).scenes ?? []).filter(
	(s) => s.speechSeconds > 0 && s.narratorText?.trim(),
);
console.log(`\n--- predicting take length from text (${scenes.length} measured takes) ---`);
if (!scenes.length) {
	console.log('  no measured takes in this fixture — not checked');
} else {
	const real = scenes.map((s) => Math.min(s.speechSeconds, s.durationSeconds));
	const mine = scenes.map((s) => estimateSpeechSeconds(s.narratorText));
	const counts = scenes.map((s) => spokenWords(s.narratorText).length);

	let bestRate = 0;
	let bestErr = Infinity;
	for (let k = 0.1; k <= 1.2; k += 0.001) {
		const e = counts.reduce((a, n, i) => a + Math.abs(k * n - real[i]), 0);
		if (e < bestErr) {
			bestErr = e;
			bestRate = k;
		}
	}
	const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
	const mineErr = mean(mine.map((p, i) => Math.abs(p - real[i])));
	const uniErr = bestErr / scenes.length;

	scenes.forEach((s, i) => {
		const d = mine[i] - real[i];
		console.log(
			`  ${String(counts[i]).padStart(3)}w  real ${real[i].toFixed(2)}s  model ${mine[i].toFixed(2)}s  ` +
				`${d >= 0 ? '+' : ''}${d.toFixed(2)}s  (${((100 * Math.abs(d)) / real[i]).toFixed(0)}%)`,
		);
	});
	console.log(
		`\n  syllables + pauses   mean abs error ${mineErr.toFixed(3)}s\n` +
			`  best uniform rate    mean abs error ${uniErr.toFixed(3)}s   (at ${bestRate.toFixed(3)}s/word)`,
	);
	check(
		mineErr < uniErr,
		'the cost model beats the best uniform rate',
		`${(uniErr / mineErr).toFixed(1)}x`,
	);
}

console.log(
	`\nWhat this cannot prove: whether the highlight is on the right word, which\n` +
		`needs the alignment ElevenLabs returns from /with-timestamps. Until then the\n` +
		`model is anchored at both ends of every take, so an error is bounded by one\n` +
		`scene and can never accumulate down the film.\n`,
);
process.exit(failed ? 1 : 0);
