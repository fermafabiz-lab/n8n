// GENERATED from remotion/motif/validate.mjs — do not edit here.
// Edit that file, run db/port/motif-cards/add-motif-nodes.mjs, re-apply.
// The comments (and the reasoning) live in the source.

const MAX_CARDS = 3;

const VARIANTS = ['route', 'schedule'];

const norm = (s) =>
	String(s ?? '')
		.normalize('NFD')
		.replace(/\p{M}/gu, '')
		.toLowerCase()
		.replace(/[^a-z0-9\s]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();

const words = (s) => norm(s).split(' ').filter(Boolean);

const NUMBERS = {
	zero: 0, un: 1, unu: 1, una: 1, doi: 2, doua: 2, trei: 3, patru: 4, cinci: 5,
	sase: 6, sapte: 7, opt: 8, noua: 9, zece: 10, unsprezece: 11, unspe: 11,
	doisprezece: 12, douasprezece: 12, doispe: 12, treisprezece: 13, treispe: 13,
	paisprezece: 14, paispe: 14, cincisprezece: 15, cincispe: 15,
	saisprezece: 16, saispe: 16, saptesprezece: 17, saptespe: 17,
	optsprezece: 18, optspe: 18, nouasprezece: 19, nouaspe: 19,
	douazeci: 20, treizeci: 30, patruzeci: 40, cincizeci: 50,
};

const numbersIn = (text) => {
	const out = [];
	for (const token of words(text)) {
		if (/^\d+$/.test(token)) {
			out.push(Number(token));
			continue;
		}
		const n = NUMBERS[token];
		if (n === undefined) continue;
		const prev = out[out.length - 1];

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

const quoteStatesTime = (quote, value) => {
	const target = asMinutes(value);
	if (target === null) return false;
	const ns = numbersIn(quote);
	for (let i = 0; i < ns.length; i++) {
		if (ns[i] * 60 === target) return true;
		if (i + 1 < ns.length && ns[i] * 60 + ns[i + 1] === target) return true;
	}
	return false;
};

const sceneTextOf = (scene) =>
	scene?.narratorText ?? scene?.text ?? scene?.narration ?? scene?.fields?.['Script Scenă'] ?? '';

const sceneOrderOf = (scene) =>
	scene?.sceneOrder ?? scene?.scene_order ?? scene?.fields?.['Ordine Scenă'] ?? null;

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

const durationFor = (card) => {
	const n = card.variant === 'route' ? (card.stops?.length ?? 0) : (card.rows?.length ?? 0);
	const wanted = card.variant === 'route' ? 2.5 + 0.3 * n : 2.6 + 0.4 * n;
	const seconds = Math.min(4, Math.round(wanted * 10) / 10);
	return {seconds, minSeconds: Math.min(seconds, card.variant === 'route' ? 2.6 : 2.8)};
};

function validateMotifCards(o) {
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

				failed = `${key} quotes scene ${si}, which the film has not reached at scene ${i}`;
				break;
			}
			if (!scenes[si] || !norm(sceneTextOf(scenes[si])).includes(norm(from))) {
				failed = `${key} quotes "${from}", which is not in scene ${si}`;
				break;
			}

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

// ---------------------------------------------------------------------------
// Glue. Everything above is remotion/motif/validate.mjs verbatim; everything
// below is what this node does with it.
//
// The agent is onError:continueRegularOutput — a model that refuses, times out
// or answers rubbish must never kill a scripting run, so a missing or unusable
// answer simply means this film has no cards.
let proposed = [];
try {
  const out = $json.output ?? $json;
  proposed = Array.isArray(out) ? out : (out.cards ?? []);
} catch (e) {}

const scenes = $('Prep Motif Input').first().json.scenes.map((s) => ({
  narratorText: s.narration,
  chapter: s.chapter,
  sceneOrder: s.order,
}));

let evidence = [];
try {
  evidence = $('Extract Claims').first().json.claims || [];
} catch (e) {}

const { accepted, report } = validateMotifCards({ cards: proposed, scenes, evidence });

// The report is the only record of WHY a card did not make it, and a dropped
// card is invisible on screen by definition. Log it or the next person debugs
// an absence.
for (const r of report) {
  console.log(`MOTIF ${r.verdict.toUpperCase()} ${r.variant ?? '?'} @ ${r.at}: ${r.why || ''}`);
  for (const n of r.notes || []) console.log(`  · ${n}`);
}
// A film that got nothing must say why. Otherwise "no cards" and "the node is
// broken" look identical in the logs, and the reason a film offered no motif
// is the single most useful input we have for deciding which motif to build
// next.
if (!accepted.length) {
  let why = '';
  try { why = String(($json.output || {}).none_because || ''); } catch (e) {}
  console.log(`MOTIF NONE: ${why || 'the model returned nothing and gave no reason'}`);
}

return [{ json: { motifCards: accepted, motifReport: report } }];