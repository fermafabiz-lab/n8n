/**
 * Motif-card validator — the code that stands between a model and the screen.
 *
 * `Validate Evidence Refs` is the pattern: it keeps only the refs that exist,
 * in code, so an invented ID cannot survive. It does NOT ask a second model
 * whether the first one was honest, because a second model is not evidence.
 * Same here. What a card puts on screen must be traceable to words the film
 * actually contains, and "traceable" means a substring test, not a judgement.
 *
 * Three verdicts, and the middle one is the point:
 *
 *   ok       every string proved, including any arithmetic
 *   review   provenance exists and belongs to the film, but the code cannot
 *            check the TRANSFORMATION (a phrase rendered as something else)
 *   rejected no provenance, provenance that does not exist, or a shape the
 *            renderer cannot draw — never reaches anyone
 *
 * `review` is not a softer `rejected`. It is the honest report of what a
 * substring test can and cannot know, and it is what the producer should see
 * in Final touches before a render.
 *
 * Dependency-free and self-contained on purpose: this file is pasted verbatim
 * into an n8n Code node, and it lives beside the card components so the two
 * cannot drift — a hand-copied projection is a mirror, and mirrors go stale.
 */

/** No film gets more than this, whatever the model proposes. */
export const MAX_CARDS = 3;
/** The motifs that exist. A variant not on this list cannot be drawn. */
export const VARIANTS = ['route', 'schedule', 'timeline', 'compare', 'steps'];

/**
 * `compare` and `steps` were added on 2026-09-09, from the backlog the empty
 * answers had been writing for weeks. The first three motifs all want a
 * documentary — a journey with named legs, two clock times, dates spoken
 * minutes apart — and most of what this pipeline makes is fiction, which has
 * none of those. So most films got no card at all, which the producer saw as
 * "no animation on any project".
 *
 * `compare` takes the commonest documentary material the other three could not
 * hold: two quantities of the same kind, where the RATIO between them is the
 * fact. `steps` is the one a story can always answer — three to five beats
 * from three to five DIFFERENT scenes, which is a stretch of film compressed
 * into one frame and therefore something no single spoken line does.
 */

/** Scale words, in both languages the producer writes in. Mirrors CompareCard. */
const SCALES = [
	{re: /\b(billion|miliarde|miliard)\b/i, by: 1e9},
	{re: /\b(million|milioane|milion)\b/i, by: 1e6},
	{re: /\b(thousand|mii|mie)\b/i, by: 1e3},
];

/**
 * The number a compare side is drawn at.
 *
 * The DEFINITION lives in `src/components/CompareCard.tsx` (`magnitudeOf`);
 * this is the copy the validator runs, for the same reason `toMontageCards`
 * exists — the card is drawn by one of these and admitted by the other, and a
 * side the validator sizes differently from the renderer is a bar that lies.
 * Change one, change both.
 */
const magnitudeOf = (value) => {
	const s = String(value ?? '');
	// The separators a number can carry — an ordinary space, but also a no-break
	// space (U+00A0) and a narrow no-break space (U+202F), both of which are
	// real thousands separators and both INVISIBLE in a source file.
	//
	// Matched by PROPERTY (`\p{Zs}`, every space separator) rather than by
	// listing them, and that is not tidiness. This class is copied into an n8n
	// Code node, and the README's hardest-won lesson is that an invisible
	// character survives the trip, works, and changes the day an editor
	// normalises the file. It went wrong here twice in one afternoon: first the
	// two copies of this regex held different sets of spaces, and then the
	// escaped form was decoded back into the characters themselves in transit —
	// caught only by the byte diff that every apply is supposed to end with.
	// A property escape is ASCII all the way down and cannot be mangled, which
	// is the same reason `norm` below matches `\p{M}` instead of a range.
	const m = /-?\d[\d.,\p{Zs}]*/u.exec(s);
	if (!m) return null;
	const raw = m[0].trim().replace(/\p{Zs}/gu, '');
	const normalised = /,\d{1,2}$/.test(raw)
		? raw.replace(/\./g, '').replace(',', '.')
		: raw.replace(/[.,](?=\d{3}\b)/g, '');
	const n = Number(normalised);
	if (!Number.isFinite(n)) return null;
	const scale = SCALES.find((x) => x.re.test(s));
	return Math.abs(n) * (scale ? scale.by : 1);
};

/**
 * Case, diacritics and punctuation are noise for a provenance test; words are
 * not. "Digul" must match "digul" inside "Pe digul vechi", and must NOT match
 * because someone wrote "dig".
 *
 * The marks are stripped by CATEGORY (`\p{M}` \u2014 every combining mark) rather
 * than by the `\u0300-\u036f` range this used to name, and the reason is a
 * transcription bug caught in the live node: `\u0300` written with one
 * backslash too few decodes to the combining character ITSELF, so the regex
 * ends up holding two invisible marks where it should hold an escape. It still
 * matches, right up until an editor normalises the file and silently changes
 * the range. A property escape cannot be mangled that way \u2014 it is ASCII all
 * the way down \u2014 and it is also more correct: Romanian only needs U+0300-036F,
 * but a name in another script does not.
 */
const norm = (s) =>
	String(s ?? '')
		.normalize('NFD')
		.replace(/\p{M}/gu, '')
		.toLowerCase()
		.replace(/[^a-z0-9\s]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();

const words = (s) => norm(s).split(' ').filter(Boolean);

/**
 * Number words, enough to read a time or a ratio out of a spoken line.
 *
 * **English was missing until 2026-09-09, and that was a live defect, not a
 * gap in coverage.** This map had only Romanian, while the films this pipeline
 * actually makes are mostly written in English — so `quoteStatesTime` could
 * not read "the ferry at five twenty" and the compare note "six times fewer"
 * proved nothing, in both cases returning "the film does not state that" about
 * a film that states it in as many words. The failure is silent and looks like
 * a truthful card being refused, which is the hardest kind to notice: the
 * validator is supposed to refuse things.
 *
 * Found by running a real compare card through `check-motif.mjs` rather than
 * by reading, which is the whole reason that harness exists.
 */
const NUMBERS = {
	zero: 0, un: 1, unu: 1, una: 1, doi: 2, doua: 2, trei: 3, patru: 4, cinci: 5,
	sase: 6, sapte: 7, opt: 8, noua: 9, zece: 10, unsprezece: 11, unspe: 11,
	doisprezece: 12, douasprezece: 12, doispe: 12, treisprezece: 13, treispe: 13,
	paisprezece: 14, paispe: 14, cincisprezece: 15, cincispe: 15,
	saisprezece: 16, saispe: 16, saptesprezece: 17, saptespe: 17,
	optsprezece: 18, optspe: 18, nouasprezece: 19, nouaspe: 19,
	douazeci: 20, treizeci: 30, patruzeci: 40, cincizeci: 50,
	// English. `one` is deliberately here despite being a common article-like
	// word: this map is only ever consulted to prove that a quote STATES a
	// number the card already shows, so a spurious reading can admit a true
	// card and can never invent a false one.
	one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
	nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14,
	fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
	twenty: 20, thirty: 30, forty: 40, fifty: 50,
};

/**
 * Every number a line states, in order, reading "douăzeci și cinci" as 25 and
 * "5:20" as 5 then 20. Written this way because a time on a card is a
 * TRANSFORMATION of the words — "cinci și douăzeci" is not a substring of
 * "05:20" and never will be — and the transformation is exactly the part worth
 * proving rather than waving through.
 */
export const numbersIn = (text) => {
	const out = [];
	for (const token of words(text)) {
		if (/^\d+$/.test(token)) {
			out.push(Number(token));
			continue;
		}
		const n = NUMBERS[token];
		if (n === undefined) continue;
		const prev = out[out.length - 1];
		// "douăzeci și cinci": a tens word already down, a unit arriving.
		if (prev !== undefined && prev >= 20 && prev % 10 === 0 && n < 10) out[out.length - 1] = prev + n;
		else out.push(n);
	}
	return out;
};

const asMinutes = (hhmm) => {
	const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm).trim());
	if (!m) return null;
	const h = Number(m[1]);
	const min = Number(m[2]);
	if (h > 23 || min > 59) return null;
	return h * 60 + min;
};

/**
 * Does this quoted line state this time? "Feribot la cinci și douăzeci" states
 * 5 and 20, so it states 05:20. "La opt avem zborul" states 8 alone, which is
 * 8:00 — an hour named without minutes is on the hour, the way people speak.
 */
const quoteStatesTime = (quote, value) => {
	const target = asMinutes(value);
	if (target === null) return false;
	const ns = numbersIn(quote);
	for (let i = 0; i < ns.length; i++) {
		if (ns[i] * 60 === target) return true; // "la opt"
		if (i + 1 < ns.length && ns[i] * 60 + ns[i + 1] === target) return true; // "cinci și douăzeci"
	}
	return false;
};

const sceneTextOf = (scene) =>
	scene?.narratorText ?? scene?.text ?? scene?.narration ?? scene?.fields?.['Script Scenă'] ?? '';

/**
 * The scene's own order number, when it has one.
 *
 * A card is anchored on an ARRAY INDEX at authoring time, because that is what
 * the model was shown — and an index is only meaningful next to the list it
 * came from. Scripting's list and the render's `scenes` prop are built by
 * different workflows on different days, so carrying the index across would be
 * betting they always agree; `Ordine Scenă` (chapter*100 + scene) is the one
 * identifier both sides genuinely share. Emit it when it exists and let
 * `Build Remotion Props` turn it back into an index against ITS array.
 */
const sceneOrderOf = (scene) =>
	scene?.sceneOrder ?? scene?.scene_order ?? scene?.fields?.['Ordine Scenă'] ?? null;

/** A stop written either way: "Mannheim", or {name, source}. */
const stopText = (s) => (typeof s === 'string' ? s : (s?.name ?? s?.text ?? s?.value));

/**
 * Every on-screen string a card holds, with the provenance that justifies it.
 *
 * Provenance is read from the ITEM first and from the old `sources` map only
 * as a fallback, and that order is the fix for the way this failed in
 * production. The map was keyed by path — `stops[0]`, `rows[1].value` — and
 * the first real film came back with a route card whose only source sat under
 * `rows[0].value`: a key belonging to a different motif entirely. Every string
 * was true and the card was dropped for having no source, which is the
 * bookkeeping failing, not the model lying. An item that carries its own
 * source cannot be filed under the wrong key, so the class of error is gone
 * rather than warned about.
 *
 * One source per ROW or MARK, not per string: a row's label and its value come
 * out of the same spoken line, and asking for that line twice only creates a
 * second chance to mis-key it.
 */
const fieldsOf = (card) => {
	const map = card.sources ?? {};
	const out = [];
	const at = (key, value, inline) => out.push({key, value, source: inline ?? map[key]});
	if (card.variant === 'route') {
		(card.stops ?? []).forEach((s, i) => at(`stops[${i}]`, stopText(s), s?.source));
	}
	if (card.variant === 'schedule') {
		(card.rows ?? []).forEach((r, i) => {
			at(`rows[${i}].label`, r?.label, r?.source);
			at(`rows[${i}].value`, r?.value, r?.source);
		});
	}
	if (card.variant === 'timeline') {
		(card.marks ?? []).forEach((m, i) => {
			at(`marks[${i}].at`, m?.at, m?.source);
			at(`marks[${i}].label`, m?.label, m?.source);
		});
	}
	if (card.variant === 'compare') {
		(card.sides ?? []).forEach((s, i) => {
			at(`sides[${i}].label`, s?.label, s?.source);
			at(`sides[${i}].value`, s?.value, s?.source);
		});
	}
	if (card.variant === 'steps') {
		(card.steps ?? []).forEach((s, i) => at(`steps[${i}].label`, s?.label, s?.source));
	}
	if (card.note) at('note', card.note, card.noteSource);
	return out;
};

/** The year a timeline mark is pinned at — the same read the card draws with. */
const yearOf = (at) => {
	const m = /-?\d+/.exec(String(at ?? ''));
	if (!m) return null;
	const n = Number(m[0]);
	return Number.isFinite(n) ? n : null;
};

/**
 * Does this quoted line state this number? A year on a card is not a
 * transformation of anything — the film either says 1941 or it does not — so
 * it can be PROVED rather than waved through as unverifiable, which is what
 * the generic "contains a digit" branch would do with it.
 */
const quoteStatesNumber = (quote, value) => {
	const n = Number(String(value).replace(/[^\d-]/g, ''));
	if (!Number.isFinite(n)) return false;
	return numbersIn(quote).includes(n);
};

/**
 * Reading time, owned by the code rather than by the model.
 *
 * A model asked for a duration will give a plausible one, and plausible is not
 * the same as "long enough for the last thing to land before the exit fade".
 * The card components pace their reveals off a fixed timeline; these numbers
 * are what that timeline needs, so they are computed from the content and the
 * model's own `seconds` is discarded.
 */
const durationFor = (card) => {
	const n =
		card.variant === 'route'
			? (card.stops?.length ?? 0)
			: card.variant === 'timeline'
				? (card.marks?.length ?? 0)
				: card.variant === 'compare'
					? (card.sides?.length ?? 0)
					: card.variant === 'steps'
						? (card.steps?.length ?? 0)
						: (card.rows?.length ?? 0);
	const per =
		card.variant === 'route'
			? 0.3
			: card.variant === 'timeline'
				? 0.32
				: card.variant === 'steps'
					? 0.3
					: 0.4;
	const base = card.variant === 'route' ? 2.5 : card.variant === 'steps' ? 2.7 : 2.6;
	const seconds = Math.min(4, Math.round((base + per * n) * 10) / 10);
	// The floor is what the card's own reveal needs, not a preference. `steps`
	// lands its last beat at ~1.9s and its note straight after, so 3s leaves the
	// note a beat on screen before the exit begins; below that the planner is
	// squeezing a card into a scene that cannot hold it.
	const floor =
		card.variant === 'route' ? 2.6 : card.variant === 'steps' ? 3 : 2.8;
	return {seconds, minSeconds: Math.min(seconds, floor)};
};

/**
 * @param {object} o
 * @param {any[]} o.cards      what the model returned
 * @param {any[]} o.scenes     the film's scenes, in order
 * @param {any[]} [o.evidence] research rows, each {ref, claim, source}
 * @param {boolean} [o.chapterCardsOn] a chapter's first scene is already owned
 * @returns {{accepted: any[], report: any[]}}
 */
export function validateMotifCards(o) {
	const {cards = [], scenes = [], evidence = [], chapterCardsOn = true} = o;
	const byRef = new Map(evidence.filter((e) => e?.ref).map((e) => [String(e.ref), e]));
	const report = [];
	const accepted = [];
	const usedScenes = new Set();

	const list = Array.isArray(cards) ? cards : [];
	const ordered = [...list].sort(
		(a, b) => (a?.priority ?? 99) - (b?.priority ?? 99) || (a?.sceneIndex ?? 0) - (b?.sceneIndex ?? 0),
	);

	for (const card of ordered) {
		const at = `scene ${card?.sceneIndex}`;
		const drop = (why) => report.push({verdict: 'rejected', at, variant: card?.variant, why});

		if (!VARIANTS.includes(card?.variant)) {
			drop(`no such motif: ${JSON.stringify(card?.variant)}`);
			continue;
		}
		const i = card.sceneIndex;
		if (!Number.isInteger(i) || i < 0 || i >= scenes.length) {
			drop('sceneIndex is not a scene of this film');
			continue;
		}
		// The opening scene belongs to the hook title, and a chapter's first
		// scene to its impact card. A boundary has exactly one owner.
		if (i === 0) {
			drop('the opening scene is the hook title’s');
			continue;
		}
		if (chapterCardsOn && i > 0 && (scenes[i].chapter ?? 0) !== (scenes[i - 1].chapter ?? 0)) {
			drop('a chapter card already owns this scene');
			continue;
		}
		if (usedScenes.has(i)) {
			drop('a card is already placed on this scene');
			continue;
		}
		if (card.variant === 'route' && !(card.stops?.length >= 2 && card.stops.length <= 4)) {
			drop('a route needs 2 to 4 stops');
			continue;
		}
		if (card.variant === 'timeline') {
			const marks = card.marks ?? [];
			if (marks.length < 3 || marks.length > 5) {
				// Two dates are a gap, and a gap is what a schedule draws. Three is
				// the fewest that has a SHAPE — which is the only thing this motif
				// shows that the narration cannot say.
				drop('a timeline needs 3 to 5 marks');
				continue;
			}
			const years = marks.map((m) => yearOf(m?.at));
			if (years.some((y) => y === null)) {
				drop('every timeline mark needs a year in its `at`');
				continue;
			}
			if (years.some((y, k) => k > 0 && y <= years[k - 1])) {
				// The card places marks by their real distance apart. Out of order,
				// that drawing is a lie about the film.
				drop('timeline marks must run forwards in time, each year after the last');
				continue;
			}
			const wordy = marks.find((m) => String(m?.label ?? '').trim().split(/\s+/).length > 4);
			if (wordy) {
				drop(`a timeline label is at most 4 words: "${wordy.label}"`);
				continue;
			}
		}
		if (card.variant === 'schedule') {
			const rows = card.rows ?? [];
			if (rows.length < 2 || rows.length > 3) {
				drop('a schedule needs 2 or 3 rows');
				continue;
			}
			if (rows.some((r) => asMinutes(r?.value) === null)) {
				drop('every schedule row needs a HH:MM value');
				continue;
			}
		}
		if (card.variant === 'compare') {
			const sides = card.sides ?? [];
			if (sides.length !== 2) {
				// Three bars is a chart and a chart is a document. Refused here
				// rather than truncated in the drawing: a card that silently drops
				// the third quantity is a card that lies about the film.
				drop('a compare card is exactly 2 sides');
				continue;
			}
			const mags = sides.map((s) => magnitudeOf(s?.value));
			if (mags.some((m) => m === null || !(m > 0))) {
				// The bars ARE the numbers. With nothing to size them by there is no
				// comparison, only two labels with rules under them.
				drop('every compare side needs a number in its `value`');
				continue;
			}
			const wordy = sides.find((s) => String(s?.label ?? '').trim().split(/\s+/).length > 6);
			if (wordy) {
				drop(`a compare label is at most 6 words: "${wordy.label}"`);
				continue;
			}
		}
		if (card.variant === 'steps') {
			const list = card.steps ?? [];
			if (list.length < 3 || list.length > 5) {
				// Two beats are a before and an after, which is a comparison. Three
				// is the fewest that has a SHAPE, which is all this motif shows.
				drop('a steps card needs 3 to 5 steps');
				continue;
			}
			const wordy = list.find((s) => String(s?.label ?? '').trim().split(/\s+/).length > 6);
			if (wordy) {
				drop(`a step is at most 6 words: "${wordy.label}"`);
				continue;
			}
			// The whole claim of this motif is COMPRESSION — a stretch of film seen
			// whole. Beats quoted from one scene would be that scene's sentences
			// typeset, which is the script again and the thing every card here is
			// written to avoid. Distinct scenes is that claim, made checkable.
			const from = list.map((s) => (Number.isInteger(s?.source?.sceneIndex) ? s.source.sceneIndex : i));
			if (new Set(from).size < list.length) {
				drop('every step must be quoted from a DIFFERENT scene — one scene’s sentences are the script, not a card');
				continue;
			}
			if (from.some((k, idx) => idx > 0 && k < from[idx - 1])) {
				// The card draws an order. Quoted out of order, the drawing is a lie
				// about the film even when every individual step is true.
				drop('steps must be quoted in the order they happen, each scene at or after the last');
				continue;
			}
		}
		// The label is furniture — the word that names the graphic — so it is
		// bounded rather than sourced. A digit in it would be a claim wearing
		// furniture's clothes.
		if (card.label && (/\d/.test(card.label) || String(card.label).length > 12)) {
			drop('label must be a short word with no digits');
			continue;
		}

		const notes = [];
		let verdict = 'ok';
		let failed = null;

		for (const {key, value, source: src} of fieldsOf(card)) {
			if (!value || !String(value).trim()) {
				failed = `${key} is empty`;
				break;
			}
			if (!src?.kind) {
				failed = `${key} has no source`;
				break;
			}

			if (src.kind === 'evidence') {
				// The ref is read under `ref` OR `from`. The prompt asks for `ref`
				// and every worked example in it shows a `quote`, whose text lives
				// in `from` — so a model with no evidence example to copy files the
				// ref where it has seen one go, and a card whose every string was
				// true got dropped for citing `undefined`. Measured on the Peking to
				// Paris film (execution 9952): a four-stop route, three stops quoted
				// from real scenes and the fourth carrying `{"kind":"evidence",
				// "from":"E3"}`, refused whole. Same shape as the 2026-09-03 fix that
				// kept reading the old provenance map as a fallback: the example is
				// what a model follows, and prose that contradicts it loses.
				const ref = String(src.ref ?? src.from ?? '');
				const row = byRef.get(ref);
				if (!row) {
					failed = `${key} cites ${ref || 'nothing'}, which is not in the research pack`;
					break;
				}
				if (!String(row.source ?? '').trim()) {
					failed = `${key} cites ${ref}, which carries no source`;
					break;
				}
				// The pack is sourced, but whether this phrasing follows from that
				// claim is not a substring question.
				verdict = 'review';
				notes.push(`${key}: from ${ref} (${row.source})`);
				continue;
			}

			if (src.kind === 'arithmetic') {
				const CAN_COMPUTE = ['schedule', 'timeline', 'compare'];
				if (key !== 'note' || !CAN_COMPUTE.includes(card.variant)) {
					failed = `${key} claims arithmetic, which only a schedule, timeline or compare note may do`;
					break;
				}
				const stated = numbersIn(value);
				if (card.variant === 'compare') {
					// The ratio between the two sides is the one number on this card
					// that nobody in the film says, and the reason the note exists at
					// all. Every reasonable rendering of it is accepted — "six times",
					// "6.3x", "32 points fewer" — but the numbers in the sentence have
					// to be numbers the division or the subtraction actually produces.
					const ms = card.sides.map((s) => magnitudeOf(s.value));
					const hi = Math.max(...ms);
					const lo = Math.min(...ms);
					const ratio = lo > 0 ? hi / lo : null;
					const allowed = new Set([Math.round(Math.abs(hi - lo))]);
					if (ratio !== null) {
						// Whole numbers only, because `numbersIn` reads the sentence in
						// words and digits and a decimal point is punctuation to it:
						// "6.3x" arrives as 6 and 3. Rounding either way is what a
						// person writing "six times" or "seven times" would mean.
						allowed.add(Math.round(ratio));
						allowed.add(Math.floor(ratio));
						allowed.add(Math.ceil(ratio));
					}
					if (!stated.some((n) => allowed.has(n))) {
						failed = `${key} says "${value}", but ${hi} against ${lo} is ${
							ratio === null ? '' : `${Math.round(ratio * 10) / 10}× and `
						}a difference of ${Math.round(Math.abs(hi - lo))}`;
						break;
					}
					notes.push(
						`${key}: recomputed, ${ratio === null ? '' : `${Math.round(ratio * 10) / 10}× / `}${Math.round(Math.abs(hi - lo))} apart`,
					);
					continue;
				}
				if (card.variant === 'timeline') {
					// The span, in years: the one number on the card that nobody in
					// the film ever says, and the reason the note is allowed at all.
					const ys = card.marks.map((m) => yearOf(m.at));
					const span = Math.max(...ys) - Math.min(...ys);
					if (!stated.includes(span)) {
						failed = `${key} says "${value}", but ${Math.min(...ys)}–${Math.max(...ys)} is ${span} years`;
						break;
					}
					notes.push(`${key}: recomputed, ${span} years`);
					continue;
				}
				const mins = card.rows.map((r) => asMinutes(r.value));
				const gap = Math.abs(Math.max(...mins) - Math.min(...mins));
				const h = Math.floor(gap / 60);
				const m = gap % 60;
				// The note may phrase it however it likes, but the numbers in it
				// have to be the ones the subtraction produces.
				const ok = (h === 0 || stated.includes(h)) && (m === 0 || stated.includes(m));
				if (!ok) {
					failed = `${key} says "${value}", but ${card.rows[0].value}–${card.rows[1].value} is ${h}h${String(m).padStart(2, '0')}`;
					break;
				}
				notes.push(`${key}: recomputed, ${h}h${String(m).padStart(2, '0')}`);
				continue;
			}

			if (src.kind !== 'quote') {
				failed = `${key} has an unknown source kind: ${src.kind}`;
				break;
			}
			const from = String(src.from ?? '');
			if (norm(from).length < 3) {
				failed = `${key} quotes nothing`;
				break;
			}
			const si = Number.isInteger(src.sceneIndex) ? src.sceneIndex : i;
			// A card may not print a word the film has not spoken yet — EXCEPT a
			// route, which is a map of the whole journey and whose stops are by
			// nature places the film reaches later. Anchored anywhere before its
			// destination it cites forward; anchored after it, it is a summary of a
			// trip the viewer has just watched, which is not what a map is for. So
			// the rule made `route` unsatisfiable in practice: measured on Peking to
			// Paris (execution 9952), whose four-stop route quoted "rolls into
			// Paris" from scene 47 while sitting on scene 7, the departure. Naming
			// the destination on a map is not a spoiler — the film's own title is
			// "Peking to Paris". Provenance is NOT relaxed with it: every stop must
			// still be a verbatim line of a real scene, checked immediately below.
			// Only the ordering is lifted, and only here.
			if (si > i && card.variant !== 'route') {
				failed = `${key} quotes scene ${si}, which the film has not reached at scene ${i}`;
				break;
			}
			if (!scenes[si] || !norm(sceneTextOf(scenes[si])).includes(norm(from))) {
				failed = `${key} quotes "${from}", which is not in scene ${si}`;
				break;
			}
			// The quote is real. Is the VALUE actually in it?
			if (/\d/.test(String(value))) {
				if (asMinutes(value) !== null && quoteStatesTime(from, value)) {
					notes.push(`${key}: ${value} read out of "${from}"`);
				} else if (quoteStatesNumber(from, value)) {
					// A number the quote actually states is not a rendering of
					// anything: it is proved, not reviewed.
					notes.push(`${key}: ${value} stated in "${from}"`);
				} else if (key.endsWith('.at')) {
					// A timeline mark is a bare year by construction, so `review`
					// would be a euphemism here: either the film says it or the card
					// is about to put a date on screen that the film never spoke.
					failed = `${key} is ${value}, which its own quote does not state: "${from}"`;
					break;
				} else {
					verdict = 'review';
					notes.push(`${key}: "${value}" is a rendering of "${from}" the code cannot check`);
				}
			} else if (!norm(from).includes(norm(value))) {
				failed = `${key} is "${value}", which does not appear in its own quote "${from}"`;
				break;
			}
		}

		if (failed) {
			drop(failed);
			continue;
		}
		if (accepted.length >= MAX_CARDS) {
			drop(`over the ${MAX_CARDS}-card limit for one film`);
			continue;
		}

		usedScenes.add(i);
		const {seconds, minSeconds} = durationFor(card);
		const order = sceneOrderOf(scenes[i]);
		accepted.push({
			sceneIndex: i,
			// Carried onto the card itself, not just into the report, because the
			// report is a log line and the person who needs this is looking at a
			// panel three days later. `review` means the provenance is real and
			// the transformation is not checkable — the set that wants an eye.
			verdict,
			...(card.why ? {why: String(card.why)} : {}),
			...(order === null ? {} : {sceneOrder: order}),
			variant: card.variant,
			headline: '',
			...(card.label ? {label: card.label} : {}),
			// The RENDER shape, not the authoring shape: whatever provenance the
			// model attached to a stop, a row or a mark stays in the report and
			// never reaches the card components, which draw strings.
			...(card.variant === 'route' ? {stops: card.stops.map(stopText)} : {}),
			...(card.variant === 'schedule'
				? {rows: card.rows.map((r) => ({label: r.label, value: r.value}))}
				: {}),
			...(card.variant === 'timeline'
				? {marks: card.marks.map((m) => ({at: m.at, label: m.label}))}
				: {}),
			...(card.variant === 'compare'
				? {sides: card.sides.map((s) => ({label: s.label, value: s.value}))}
				: {}),
			...(card.variant === 'steps' ? {steps: card.steps.map((s) => ({label: s.label}))} : {}),
			...(card.note ? {note: card.note} : {}),
			seconds,
			minSeconds,
		});
		report.push({verdict, at, variant: card.variant, why: card.why ?? '', notes});
	}

	return {accepted, report};
}
