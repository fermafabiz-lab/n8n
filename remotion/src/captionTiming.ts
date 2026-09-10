/**
 * When each word of a take is spoken.
 *
 * The captions used to spread a scene's words evenly over the take:
 * `perWord = speechSeconds / words.length`. That is exact at the two ends of
 * the scene and wrong everywhere in between, because "și" and
 * "responsabilitatea" do not take the same time to say. Measured on real
 * scenes, the highlight drifted 0.3–0.65s from the voice mid-scene — one to
 * two words at these rates, which is what the producer saw as captions that
 * are simply not on the voice, worse on some lines than others.
 *
 * So a word's slot is now proportional to what it costs to SAY: a small fixed
 * onset, plus its syllables, plus the pause that follows a clause or a
 * sentence. The result is normalized to the take's measured length, which is
 * the property that matters most — **the allocation is anchored at both
 * ends**, so the first word starts at 0, the last ends exactly on
 * `speechSeconds`, and an error in the middle cannot accumulate the way a
 * guessed words-per-second rate does.
 *
 * ## What it cannot do
 *
 * This is an estimate of a performance, not a measurement of one. Scored
 * against the six ffprobe-measured takes of the Studio fixture
 * (`npm run check:captions`) it predicts a take's real length to a mean
 * absolute error of **0.42s**, against **0.95s** for the best possible uniform
 * rate — 2.3× better, and still not exact. Four of the six land within 1%; the
 * two that miss (by 15% and 19%) are both read SLOWER than the model expects,
 * and both are near the top of the film, which is suggestive of a hook read
 * with more space — two samples, so an observation and not a finding.
 * ElevenLabs is non-deterministic anyway: the same line comes back at
 * different lengths, so no model of the text alone can close that gap.
 *
 * The exact answer is the alignment ElevenLabs already computes: synthesizing
 * through `/with-timestamps` returns per-character times, which would make
 * this module a lookup instead of a model. That needs the TTS nodes to change
 * and a new field on the scene, and it cannot be applied to a film that is
 * already made — which is the whole reason this exists.
 */

import type {SceneCaption} from './types';

/**
 * Speaker tags are markup, not speech.
 *
 * `[NARRATOR]` and `[CHARACTER: Maria]` mark who reads a line in `characters`
 * multi-voice mode. Both TTS paths strip them before synthesis, so they are
 * never heard — but the captions counted them as words, which both stole time
 * from the words that ARE spoken and printed the tag on screen. `textCards.ts`
 * has always stripped them; this side never did.
 */
export const stripTags = (text: string): string =>
	(text || '').replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * The words a viewer hears, in order — the single owner of that split.
 *
 * Both the caption text and the timing model index the same array, so one of
 * them re-deriving it with a slightly different rule would put the highlight
 * on the wrong word with nothing on screen to explain why.
 */
export const spokenWords = (text: string): string[] =>
	stripTags(text).split(/\s+/).filter(Boolean);

/**
 * Syllables, counted as vowel groups.
 *
 * Crude by design and good enough for a RATIO between two words, which is all
 * this is used for. Romanian diacritics are in the class because "hotărâre" is
 * four syllables and a Latin-only test reads it as two.
 */
const syllables = (word: string): number => {
	const clean = word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
	if (!clean) return 1;
	// A digit is read as a word of its own ("2019" is four syllables in RO,
	// five in EN); one per digit is closer than treating it as no vowels.
	const digits = (clean.match(/\d/g) ?? []).length;
	const groups = clean.match(/[aeiouyăâîàáéèíóúü]+/gu)?.length ?? 0;
	return Math.max(1, groups + digits);
};

/**
 * The cost model, in seconds. Fitted on measured takes (see the header) with
 * `LEAD` pinned small rather than to its best value — the fit put it near
 * zero, which is plausible for a syllable-timed read but would let a one-
 * syllable word collapse to almost nothing on a six-point fit.
 *
 * These are also used ABSOLUTELY, not just as ratios, for the fallback when a
 * take's real length was never measured — so they must stay in real seconds.
 */
const LEAD = 0.04;
const PER_SYLLABLE = 0.175;
const SENTENCE_PAUSE = 0.45;
const CLAUSE_PAUSE = 0.35;

const endsSentence = (word: string): boolean => /[.!?…]["'”’)\]]?$/.test(word);
const endsClause = (word: string): boolean => /[,;:—–]["'”’)\]]?$/.test(word);

/** The pause charged AFTER a word, in seconds. */
const pauseAfter = (word: string): number =>
	endsSentence(word) ? SENTENCE_PAUSE : endsClause(word) ? CLAUSE_PAUSE : 0;

export type WordTiming = {
	word: string;
	/** Seconds from the start of the take. */
	start: number;
	end: number;
};

/**
 * How long this text would take to read, in seconds, with nothing measured.
 *
 * Only reached when the assemble step could not probe the take — the old
 * fallback there was a flat 2.6 words/second, which is roughly 30% out for
 * Romanian and puts the captions a couple of seconds off by the end of a long
 * scene.
 */
export function estimateSpeechSeconds(text: string): number {
	const words = spokenWords(text);
	if (!words.length) return 0;
	let total = 0;
	words.forEach((w, i) => {
		total += LEAD + PER_SYLLABLE * syllables(w);
		// The pause after the last word is silence at the end of the take, not
		// part of the read.
		if (i < words.length - 1) total += pauseAfter(w);
	});
	return total;
}

/**
 * Each spoken word with the window it occupies, filling `speechSeconds`
 * exactly.
 *
 * Returns an empty list for text that is only markup or whitespace, which the
 * caller must treat as "no captions" rather than as a zero-length first word.
 */
export function wordTimings(text: string, speechSeconds: number): WordTiming[] {
	const words = spokenWords(text);
	if (!words.length || !(speechSeconds > 0)) return [];

	const costs = words.map((w) => LEAD + PER_SYLLABLE * syllables(w));
	// A pause belongs to the word it follows, so the highlight stays on the
	// last word of a sentence while the voice takes its breath — rather than
	// jumping to the next word and waiting there, which reads as running early.
	const pauses = words.map((w, i) => (i < words.length - 1 ? pauseAfter(w) : 0));

	const spoken = costs.reduce((a, b) => a + b, 0);
	const paused = pauses.reduce((a, b) => a + b, 0);
	// Pauses are shortened alongside the words when the take is faster than the
	// model expects, instead of being subtracted first — taken off the top, a
	// take shorter than its own pauses would leave the words no time at all.
	const scale = speechSeconds / (spoken + paused);

	const out: WordTiming[] = [];
	let t = 0;
	for (let i = 0; i < words.length; i++) {
		const start = t;
		t += (costs[i] + pauses[i]) * scale;
		out.push({word: words[i], start, end: t});
	}
	// Float error only, but the end of the take is the one number every caller
	// compares against, so it is pinned rather than nearly right.
	out[out.length - 1].end = speechSeconds;
	return out;
}

/**
 * Which word is being spoken at `elapsed` seconds into the take, or -1 before
 * the first and after the last.
 *
 * Linear rather than a binary search on purpose: this runs once per frame over
 * one scene's words (tens, not thousands), and the loop is the version that
 * can be read against the timings it walks.
 */
export function activeWordIndex(timings: WordTiming[], elapsed: number): number {
	if (!timings.length || elapsed < 0) return -1;
	for (let i = 0; i < timings.length; i++) {
		if (elapsed < timings[i].end) return i;
	}
	return -1;
}

/** Most words on screen at once. Four is a glance, not a paragraph. */
const CHUNK_SIZE = 4;

const buildChunks = (text: string) => {
	// Tags are stripped here as well as in the timing model, because these are
	// the words that get PRINTED: `[CHARACTER: Maria]` was appearing on screen
	// on every multi-voice film.
	const words = spokenWords(text);
	const chunks: string[][] = [];
	for (let i = 0; i < words.length; i += CHUNK_SIZE) {
		chunks.push(words.slice(i, i + CHUNK_SIZE));
	}
	// Avoid a lonely 1-word last chunk: merge it into the previous one.
	if (chunks.length > 1 && chunks[chunks.length - 1].length === 1) {
		const last = chunks.pop()!;
		chunks[chunks.length - 1].push(...last);
	}
	return {words, chunks};
};

/**
 * Which words are worth an accent, judged over the WHOLE line rather than one
 * word at a time.
 *
 * The per-word version of this test counted any capitalised word, which is
 * only a keyword rule in a language that capitalises proper nouns and nothing
 * else mid-sentence. The scripts are Romanian, every sentence opens with a
 * capital, and the chunker cuts every four words — so "Bocancii", "Uite",
 * "După", "Feribot" all scored, and the accent stopped meaning anything.
 *
 * A capital only counts when the previous word did not end a sentence. Numbers
 * always count, and so do very long words, which is where the rule started.
 */
const keywordFlags = (words: string[]): boolean[] =>
	words.map((word, i) => {
		const clean = word.replace(/[^\p{L}\p{N}]/gu, '');
		if (!clean) return false;
		if (/\d/.test(clean)) return true;
		if (/^\p{Lu}/u.test(clean)) {
			const prev = i > 0 ? words[i - 1] : null;
			// Sentence-initial, so the capital says nothing about the word.
			if (prev === null || /[.!?:;…]["'”’)\]]?$/.test(prev)) return false;
			return true;
		}
		return clean.length >= 11;
	});

/**
 * What is on screen at `seconds`, or null for a frame with no caption.
 *
 * Lives here rather than in the component so the whole decision — which
 * scene, which chunk, which word — can be exercised without React. The
 * off-by-one between the chunk list and the timing list is exactly the bug
 * that would put the highlight on the wrong word with nothing on screen to
 * explain it, and it is unreachable from a component test.
 */
export const captionAt = (scenes: SceneCaption[], seconds: number) => {
	const scene = scenes.find(
		(s) => seconds >= s.startSeconds && seconds < s.startSeconds + s.durationSeconds,
	);
	if (!scene) return null;

	const {words, chunks} = buildChunks(scene.narratorText);
	if (words.length === 0) return null;
	const flags = keywordFlags(words);

	// Words are spoken during speechSeconds. When the assemble step could not
	// measure the take, the fallback reads the text with the same cost model
	// rather than assuming a flat words-per-second rate — that flat rate was
	// ~30% out for Romanian, which on a long scene is seconds.
	const speech = scene.speechSeconds && scene.speechSeconds > 0
		? Math.min(scene.speechSeconds, scene.durationSeconds)
		: Math.min(estimateSpeechSeconds(scene.narratorText), scene.durationSeconds);

	const elapsed = seconds - scene.startSeconds;
	if (elapsed > speech + 0.35) return null; // narration over → captions off

	const timings = wordTimings(scene.narratorText, speech);
	if (!timings.length) return null;
	// Past the last word the highlight stays on it for the remaining beat,
	// rather than blanking the line while the take finishes.
	const found = activeWordIndex(timings, elapsed);
	const wordIndex = found === -1 ? timings.length - 1 : found;

	let count = 0;
	for (const chunk of chunks) {
		if (wordIndex < count + chunk.length) {
			return {
				chunk,
				activeInChunk: wordIndex - count,
				keywords: flags.slice(count, count + chunk.length),
				/** Position in the scene's spoken words — for tests and debugging. */
				wordIndex,
			};
		}
		count += chunk.length;
	}
	return null;
};
