import type {MontageCard} from './montage';
import type {EvidenceClaim, SceneCaption, TextCardSpec} from './types';

/**
 * Text cards — the second source the montage cuts to.
 *
 * A card has to EARN its place, and the test is simple: does it show something
 * the narration is not already saying? A card that reprints the sentence being
 * spoken is worse than no card at all, because the captions are already
 * printing it — three copies of one line.
 *
 * So there are exactly two kinds, both of which add information rather than
 * repeat it:
 *
 * - `claim`  — a sourced claim from the Evidence pack, WITH its source and
 *              date. The attribution is the point: it is never spoken aloud,
 *              and putting it on screen is what a documentary super is for.
 * - `figure` — a number the narration says out loud, set large. A spoken
 *              figure is the single most common thing real editors super,
 *              because a listener cannot hold "thirty-eight percent" but can
 *              read 38%.
 *
 * Both are derived in CODE, with no model involved, so a card can never be
 * invented. When Scripting eventually writes cards deliberately, an explicit
 * `textCards` prop bypasses all of this.
 */

/** Pipeline speaker tags are never printed, exactly as both TTS paths strip them. */
const clean = (s: string) => s.replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * A figure worth supering. Deliberately narrow: "3" is noise, 1923 and 38% are
 * not. Ordered by how strongly each kind rewards being read rather than heard.
 */
const FIGURE_PATTERNS: RegExp[] = [
	// Percentages — the clearest win of all.
	/(\d[\d.,]*\s*(?:%|percent|la sut[ăa]))/i,
	// Years. Bounded to plausible ones so a 4-digit quantity is not read as a date.
	/\b(1[0-9]{3}|20[0-2][0-9])\b/,
	// Scaled quantities, both languages the producer writes in.
	/(\d[\d.,]*\s*(?:million|billion|trillion|thousand|milioane|miliarde|mii))/i,
	// Bare numbers, but only once they are large enough to be a fact.
	/\b(\d{3,}(?:[.,]\d{3})*)\b/,
];

/**
 * Words that dangle once the figure they governed is gone — prepositions the
 * figure was the object of, and any article or conjunction the window happened
 * to end on.
 */
const DANGLING = /\s+(by|to|at|of|with|from|for|and|or|a|an|the|la|cu|de|din|prin|pe|si|\u0219i|iar|un|o)$/i;

/**
 * The words that say what the figure MEANS.
 *
 * Which side they are on is decided by punctuation, not by a preference. A
 * quantity normally governs the noun that follows it ("16 billion hours every
 * day", "of women"), but when the figure CLOSES its clause the noun is behind
 * it — and taking the next words then yields the continuation instead of the
 * subject. That is how "raise global output by 26%, according to the same
 * modelling" produced the card "26% — according to the same modelling", which
 * says nothing at all.
 */
const contextAround = (sentence: string, figure: string): string => {
	const at = sentence.indexOf(figure);
	if (at === -1) return '';
	const rest = sentence.slice(at + figure.length);
	// Stop at the first clause boundary: past it the words belong to another
	// thought, and "hours every single day, and three" is not a label.
	const after = rest
		.replace(/^[\s,.;:—-]+/, '')
		.split(/[,;:.!?…]/)[0]
		.split(/\s+/)
		.filter(Boolean);
	const before = sentence.slice(0, at).split(/\s+/).filter(Boolean);

	// A comma or full stop straight after the figure ends the clause: look back.
	const closesClause = /^\s*[,;.!?…]/.test(rest) || rest.trim() === '';
	// A backward kicker is the noun phrase the figure attaches to, so it is
	// deliberately tighter than a forward one: reaching further back picks up the
	// start of a different phrase ("Closing the gap would raise global output").
	const back = () => fitKicker(before.slice(-4), 28);
	if (closesClause && before.length >= 2) return back();
	if (after.length >= 2) return fitKicker(after);
	return before.length ? back() : '';
};

/**
 * A kicker is one display line, so it is bounded by WIDTH, not by a word count.
 * A fixed cap of six cut "the first national time-use survey put" mid-phrase on
 * one sentence while truncating a perfectly good six-word label on another.
 */
const KICKER_CHARS = 40;
const fitKicker = (words: string[], budget = KICKER_CHARS): string => {
	let line = '';
	for (const w of words) {
		const next = line ? `${line} ${w}` : w;
		if (next.length > budget) break;
		line = next;
	}
	return trimWords((line || words[0] || '').split(' ')).replace(DANGLING, '');
};

const trimWords = (words: string[]): string =>
	words
		.join(' ')
		.replace(/^[,;:—-]+\s*/, '')
		.replace(/[,;:.!?…]+$/, '')
		.trim();

/**
 * Seconds a card needs to be read, not a fixed hold. Returns the wanted length
 * and the floor the planner may squeeze it to when the scene is short.
 */
const readingSeconds = (text: string, min: number, max: number) => {
	const words = text.split(/\s+/).filter(Boolean).length;
	return {seconds: Math.min(max, Math.max(min, 1.3 + words * 0.22)), minSeconds: min};
};

const figureCardFor = (scene: SceneCaption, sceneIndex: number): TextCardSpec | null => {
	const text = clean(scene.narratorText || '');
	if (!text) return null;
	for (const pattern of FIGURE_PATTERNS) {
		const m = pattern.exec(text);
		if (!m) continue;
		const figure = m[1].trim();
		// The sentence the figure lives in, so context never crosses a full stop.
		const sentence =
			text
				.split(/(?<=[.!?…])\s+/)
				.find((s) => s.includes(figure)) ?? text;
		const kicker = contextAround(sentence, figure);
		// A naked number explains nothing. No context, no card.
		if (!kicker) return null;
		return {
			sceneIndex,
			variant: 'figure',
			headline: figure.replace(/\s+/g, ' '),
			kicker,
			...readingSeconds(kicker, 1.7, 2.6),
		};
	}
	return null;
};

const claimCardFor = (
	scene: SceneCaption,
	sceneIndex: number,
	byRef: Map<string, EvidenceClaim>,
): TextCardSpec | null => {
	const ref = scene.evidenceRef;
	if (!ref) return null;
	const claim = byRef.get(ref);
	if (!claim?.claim) return null;
	const headline = clean(claim.claim);
	if (!headline) return null;
	// The attribution is the whole reason this card exists; without a source
	// it is just the narration reprinted, so it falls through to nothing.
	const source = (claim.source || '').trim();
	if (!source) return null;
	const attribution = claim.date ? `${source} · ${String(claim.date).trim()}` : source;
	return {
		sceneIndex,
		variant: 'claim',
		headline,
		attribution,
		...readingSeconds(headline, 2.2, 3.4),
	};
};

export type BuildCardsOptions = {
	scenes: SceneCaption[];
	evidence?: EvidenceClaim[];
	/** Cards written deliberately upstream. These bypass every gate below. */
	explicit?: TextCardSpec[];
	/**
	 * Chapter cards are on, so chapter-start scenes are already owned. A
	 * boundary has exactly one owner — two full-frame cards on the same frame
	 * is the same defect as a flash inside a dip.
	 */
	chapterCardsOn: boolean;
	/** Seconds the hook title occupies, so a card never lands under it. */
	hookSeconds: number;
	/**
	 * False on a silent film, where `narratorText` is an unspoken shot note.
	 * A figure card's whole premise is "a number the narration SPEAKS, set
	 * large because a listener cannot hold it" — with nothing spoken the
	 * premise is gone, and what the pattern would actually catch is a year or
	 * a duration out of a stage direction. Claim cards are unaffected: their
	 * text comes from the Evidence rows, not from the scene.
	 */
	narrationIsSpoken?: boolean;
};

/**
 * The cards this project actually gets, in timeline order. Placement is the
 * planner's job — this decides only what exists and how long it needs.
 */
export const buildTextCards = (o: BuildCardsOptions): TextCardSpec[] => {
	const {
		scenes,
		evidence = [],
		explicit,
		chapterCardsOn,
		hookSeconds,
		narrationIsSpoken = true,
	} = o;
	if (explicit?.length) return [...explicit].sort((a, b) => a.sceneIndex - b.sceneIndex);

	const byRef = new Map<string, EvidenceClaim>();
	for (const e of evidence) if (e.ref) byRef.set(e.ref, e);

	const out: TextCardSpec[] = [];
	scenes.forEach((scene, i) => {
		// Never under the opening title, and never on a chapter's first scene
		// when the impact card already owns that frame.
		if (scene.startSeconds < hookSeconds + 0.5) return;
		const isChapterStart = i > 0 && (scene.chapter ?? 0) !== (scenes[i - 1].chapter ?? 0);
		if (isChapterStart && chapterCardsOn) return;
		// A sourced claim outranks a figure: it carries an attribution, which is
		// information the audience has no other way to get.
		const card =
			claimCardFor(scene, i, byRef) ??
			(narrationIsSpoken ? figureCardFor(scene, i) : null);
		if (card) out.push(card);
	});
	return out;
};

/**
 * The only view of a card the planner is allowed: timing, no content. Lives
 * here rather than inline at each call site because it had already drifted
 * once — the check script hand-rolled the mapping, dropped `minSeconds`, and
 * every claim card came back "rejected for lack of room" when the planner
 * would in fact have placed them. A hand-copied projection is a mirror, and
 * mirrors go stale.
 */
export const toMontageCards = (cards: TextCardSpec[]): MontageCard[] =>
	cards.map((c) => ({sceneIndex: c.sceneIndex, seconds: c.seconds, minSeconds: c.minSeconds}));
