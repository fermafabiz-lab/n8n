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
export const VARIANTS = ['route', 'schedule'];

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

/** Romanian number words, enough to read a time out of a spoken line. */
const NUMBERS = {
	zero: 0, un: 1, unu: 1, una: 1, doi: 2, doua: 2, trei: 3, patru: 4, cinci: 5,
	sase: 6, sapte: 7, opt: 8, noua: 9, zece: 10, unsprezece: 11, unspe: 11,
	doisprezece: 12, douasprezece: 12, doispe: 12, treisprezece: 13, treispe: 13,
	paisprezece: 14, paispe: 14, cincisprezece: 15, cincispe: 15,
	saisprezece: 16, saispe: 16, saptesprezece: 17, saptespe: 17,
	optsprezece: 18, optspe: 18, nouasprezece: 19, nouaspe: 19,
	douazeci: 20, treizeci: 30, patruzeci: 40, cincizeci: 50,
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

/** Every on-screen string a card holds, keyed exactly as `sources` keys it. */
const stringsOf = (card) => {
	const out = [];
	if (card.variant === 'route') {
		(card.stops ?? []).forEach((s, i) => out.push([`stops[${i}]`, s]));
	}
	if (card.variant === 'schedule') {
		(card.rows ?? []).forEach((r, i) => {
			out.push([`rows[${i}].label`, r?.label]);
			out.push([`rows[${i}].value`, r?.value]);
		});
	}
	if (card.note) out.push(['note', card.note]);
	return out;
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
	const n = card.variant === 'route' ? (card.stops?.length ?? 0) : (card.rows?.length ?? 0);
	const wanted = card.variant === 'route' ? 2.5 + 0.3 * n : 2.6 + 0.4 * n;
	const seconds = Math.min(4, Math.round(wanted * 10) / 10);
	return {seconds, minSeconds: Math.min(seconds, card.variant === 'route' ? 2.6 : 2.8)};
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
		// The label is furniture — the word that names the graphic — so it is
		// bounded rather than sourced. A digit in it would be a claim wearing
		// furniture's clothes.
		if (card.label && (/\d/.test(card.label) || String(card.label).length > 12)) {
			drop('label must be a short word with no digits');
			continue;
		}

		const sources = card.sources ?? {};
		const notes = [];
		let verdict = 'ok';
		let failed = null;

		for (const [key, value] of stringsOf(card)) {
			if (!value || !String(value).trim()) {
				failed = `${key} is empty`;
				break;
			}
			const src = sources[key];
			if (!src?.kind) {
				failed = `${key} has no source`;
				break;
			}

			if (src.kind === 'evidence') {
				const row = byRef.get(String(src.ref));
				if (!row) {
					failed = `${key} cites ${src.ref}, which is not in the research pack`;
					break;
				}
				if (!String(row.source ?? '').trim()) {
					failed = `${key} cites ${src.ref}, which carries no source`;
					break;
				}
				// The pack is sourced, but whether this phrasing follows from that
				// claim is not a substring question.
				verdict = 'review';
				notes.push(`${key}: from ${src.ref} (${row.source})`);
				continue;
			}

			if (src.kind === 'arithmetic') {
				if (card.variant !== 'schedule' || key !== 'note') {
					failed = `${key} claims arithmetic, which only a schedule note may do`;
					break;
				}
				const mins = card.rows.map((r) => asMinutes(r.value));
				const gap = Math.abs(Math.max(...mins) - Math.min(...mins));
				const stated = numbersIn(value);
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
			if (si > i) {
				// A card may not print a word the film has not spoken yet.
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
			...(card.variant === 'route' ? {stops: card.stops} : {}),
			...(card.variant === 'schedule' ? {rows: card.rows} : {}),
			...(card.note ? {note: card.note} : {}),
			seconds,
			minSeconds,
		});
		report.push({verdict, at, variant: card.variant, why: card.why ?? '', notes});
	}

	return {accepted, report};
}
