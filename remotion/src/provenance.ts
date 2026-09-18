/**
 * What the source watermark prints — the render's half of visual provenance.
 *
 * Deliberately a LOOKUP and nothing else. The classification is made once, on
 * the site (platform/lib/provenance.ts), stored on the scene, and handed to the
 * render in the props; nothing here decides what a picture is. That separation
 * is the whole reason the label can be trusted: a renderer that re-derived
 * provenance could disagree with the record the producer approved.
 *
 * The labels, `providerLabel`, `formatSourceWatermark` and `attributionFor` are
 * mirrored from platform/lib/provenance.ts — two packages, no shared module,
 * the same rule `normalizeSpeed` lives under. Change one, change both, and
 * `npm run check:watermark` in each pins the table.
 */

export type VisualOrigin =
	| 'ai_generated'
	| 'ai_reconstruction'
	| 'actual_footage'
	| 'illustrative_footage'
	| 'archival_footage'
	| 'archival_photo'
	| 'real_stock'
	| 'unknown';

/**
 * Everything the badge can be built from, exactly as `hov.at_scene` emits it
 * (db/009) and `Source Watermark` in Final Assembly copies it.
 */
export type VisualProvenance = {
	visualOrigin: VisualOrigin;
	/** Free string: "wikimedia", "internet_archive", "reuters", "producer_upload"… */
	provider?: string;
	sourceTitle?: string;
	sourceUrl?: string;
	sourceCreator?: string;
	/** The date of the ORIGINAL as a person stated it — never a catalogue's. */
	originalDate?: string;
	originalLocation?: string;
	eventName?: string;
	isExactEventMatch?: boolean;
	rightsStatus?: string;
	licenseName?: string;
	/** The licence demands a credit — see `attributionFor`. */
	attributionRequired?: boolean;
	attributionText?: string;
	provenanceConfidence?: number;
	manuallyVerified?: boolean;
};

export const ORIGIN_LABELS: Record<VisualOrigin, string> = {
	ai_generated: 'AI GENERATED',
	ai_reconstruction: 'AI RECONSTRUCTION',
	actual_footage: 'ACTUAL FOOTAGE',
	illustrative_footage: 'ILLUSTRATIVE FOOTAGE',
	archival_footage: 'ARCHIVAL FOOTAGE',
	archival_photo: 'ARCHIVAL PHOTO',
	real_stock: 'REAL FOOTAGE',
	// Never "ACTUAL FOOTAGE", and never nothing: on a documentary, saying
	// nothing about a picture's origin reads as a claim that it is real.
	unknown: 'SOURCE UNVERIFIED',
};

// In lockstep with platform/lib/provenance.ts — the site's chips and the
// film's watermark must name a source the same way.
const PROVIDER_LABELS: Record<string, string> = {
	wikimedia: 'Wikimedia Commons',
	eu_av: 'EU Audiovisual Service',
	dvids: 'DVIDS',
	nasa: 'NASA',
	internet_archive: 'Internet Archive',
	europeana: 'Europeana',
	loc: 'Library of Congress',
	wellcome: 'Wellcome Collection',
	flickr: 'Flickr',
	openverse: 'Openverse',
	pexels: 'Pexels',
	pixabay: 'Pixabay',
	unsplash: 'Unsplash',
	destockd: 'Destockd',
	url_import: 'URL import',
	user_upload: 'Manual upload',
};

/**
 * A provider's display name. Unknown providers are title-cased rather than
 * dropped, so a new archive reads correctly the day it appears with no code
 * change here.
 */
export const providerLabel = (provider?: string | null): string | null => {
	const raw = String(provider ?? '').trim();
	if (!raw) return null;
	const known = PROVIDER_LABELS[raw.toLowerCase()];
	if (known) return known;
	return raw
		.replace(/[_-]+/g, ' ')
		.split(/\s+/)
		.filter(Boolean)
		.map((w) => (w.length <= 3 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)))
		.join(' ');
};

/**
 * A creator string fit to print.
 *
 * Wikimedia Commons answers the author field with the wiki TEMPLATE that
 * renders it, so a real photographer arrives as "Template:Helmut Laux" —
 * measured on the Bundesarchiv photo of Stalin and Ribbentrop, which is CC BY-SA
 * and therefore one whose credit we are obliged to print correctly.
 */
const cleanCreator = (v?: string | null): string => String(v ?? '').trim().replace(/^Template:\s*/i, '');

export const getSourceLabel = (p?: VisualProvenance | null): string => {
	const o = p?.visualOrigin;
	return (o && ORIGIN_LABELS[o]) || ORIGIN_LABELS.unknown;
};

/**
 * The badge: a label, and the smaller line under it when — and only when —
 * somebody actually stated who, where or when.
 *
 * The archive's own date is not a source for this. It is the upload date often
 * enough (Commons dates a 1969 NASA reel 2015-06-12) that printing it would be
 * publishing a guess as a fact, on the one overlay whose entire job is telling
 * the truth about the picture.
 */
export const formatSourceWatermark = (
	p?: VisualProvenance | null,
): {label: string; source: string | null} => {
	const label = getSourceLabel(p);
	if (!p) return {label, source: null};
	const who = cleanCreator(p.sourceCreator) || providerLabel(p.provider);
	const parts = [who, String(p.originalLocation ?? '').trim(), String(p.originalDate ?? '').trim()].filter(
		(v): v is string => Boolean(v),
	);
	return {label, source: parts.length ? `Source: ${parts.join(' · ')}` : null};
};

/**
 * The credit a licence OBLIGES us to print, or null.
 *
 * Drawn whether or not the watermark is switched on — that is the point of it
 * being a separate function and a separate element. See
 * docs/source-watermark-license-separation.md.
 */
export const attributionFor = (p?: VisualProvenance | null): string | null => {
	if (!p) return null;
	const ready = String(p.attributionText ?? '').trim();
	if (ready) return ready;
	if (!p.attributionRequired) return null;
	const parts = [
		cleanCreator(p.sourceCreator),
		providerLabel(p.provider),
		String(p.licenseName ?? '').trim(),
	].filter((v): v is string => Boolean(v));
	return parts.length ? parts.join(' · ') : null;
};

/**
 * Where the badge sits and how big it is — the one owner of those numbers.
 *
 * They lived inline in `SourceWatermark.tsx` until the site grew a PREVIEW of
 * this overlay (`platform/components/WatermarkPreview.tsx`). A preview whose
 * geometry is copied out of JSX is a preview that silently stops matching the
 * film the first time someone nudges a padding, and the whole point of it is
 * to be trusted. So the numbers are named here, consumed by the component,
 * and mirrored once in `platform/lib/provenance.ts` — pinned on both sides by
 * `npm run check:watermark` here and `npm run check:footage` there.
 *
 * Every value is in FRAME pixels, and the frame is 1280×720 (or 720×1280
 * portrait) — the render's real size, not 1080p; see Root.tsx on why. A
 * preview therefore draws the badge at these exact sizes inside a frame of
 * `frame`, and scales the whole frame down, rather than scaling each number.
 */
export type WatermarkGeometry = {
	frame: {width: number; height: number};
	/** Distance from the frame's left edge and bottom edge to the stack. */
	left: number;
	bottom: number;
	maxWidth: number;
	/** Between the label, the source line and the credit. */
	gap: number;
	label: {fontSize: number; padding: string};
	source: {fontSize: number};
	credit: {fontSize: number};
	/**
	 * The mark itself — the chip that opens into the pill.
	 *
	 * Sized here rather than derived in the component for the same reason
	 * everything else on this object is: the site's `WatermarkPreview` draws
	 * the badge from these numbers, and a preview whose geometry is read out
	 * of JSX stops matching the film the first time someone nudges a padding.
	 * `height` is the chip's side AND the pill's height, so the shape is
	 * square when closed and a capsule when open.
	 */
	mark: {height: number; glyph: number; gap: number; padX: number};
};

/** Just the mark's own numbers, so the arithmetic below can be handed them. */
export type WatermarkMark = WatermarkGeometry['mark'];

export const WATERMARK_LAYOUT: {
	landscape: WatermarkGeometry;
	portrait: WatermarkGeometry;
} = {
	landscape: {
		frame: {width: 1280, height: 720},
		left: 90,
		bottom: 30,
		maxWidth: 700,
		gap: 3,
		label: {fontSize: 16, padding: '5px 12px'},
		source: {fontSize: 13},
		credit: {fontSize: 12},
		mark: {height: 30, glyph: 15, gap: 8, padX: 10},
	},
	portrait: {
		frame: {width: 720, height: 1280},
		// Lifted clear of the platform's own bottom chrome, and of the captions
		// that are bottom-anchored at 280.
		left: 44,
		bottom: 232,
		maxWidth: 560,
		gap: 3,
		label: {fontSize: 17, padding: '5px 11px'},
		source: {fontSize: 14},
		credit: {fontSize: 13},
		mark: {height: 32, glyph: 16, gap: 8, padX: 10},
	},
};

/** The colours and weights, shared by both orientations. Mirrored with the above. */
export const WATERMARK_STYLE = {
	/** The badge never reaches full opacity — it is a claim, not a headline. */
	peakOpacity: 0.88,
	labelWeight: 600,
	labelLetterSpacing: '0.14em',
	/**
	 * The same value as a NUMBER, because the pill has to do arithmetic with it.
	 *
	 * CSS letter-spacing is added after EVERY character including the last, so
	 * a measured label carries one trailing space of dead air that is not ink.
	 * Sizing the capsule to the measured width therefore leaves the right side
	 * wider than the left — which is what "the text is not centred" looks like.
	 */
	labelLetterSpacingEm: 0.14,
	labelColor: '#FFFFFF',
	labelBackground: 'rgba(0,0,0,0.42)',
	labelBorder: '1px solid rgba(255,255,255,0.16)',
	labelRadius: 6,
	labelLineHeight: 1.2,
	sourceLetterSpacing: '0.05em',
	sourceColor: 'rgba(255,255,255,0.9)',
	creditLetterSpacing: '0.04em',
	creditColor: 'rgba(255,255,255,0.82)',
	lineBackground: 'rgba(0,0,0,0.34)',
	lineRadius: 5,
	linePadding: '3px 9px',
	lineLineHeight: 1.25,
	textShadow: '0 2px 8px rgba(0,0,0,0.75)',
	/** The chip's corner, as a fraction of its side. The pill's is always a
	 *  half-height capsule, so only the closed end needs naming. */
	chipRadiusRatio: 0.3,
	/** Stroke width of the mark's border, and of the dashed variant. */
	markBorderWidth: 1,
	markBorderColor: 'rgba(255,255,255,0.55)',
	/** How long the chip takes to open into the pill, in seconds, and how long
	 *  it waits after the band's fade-in before starting. Short and
	 *  un-bouncy on purpose: this is a label becoming legible, not an arrival
	 *  — the same reasoning as the fade's `inOutCubic`. */
	openDelaySeconds: 0.18,
	openSeconds: 0.42,
} as const;

/**
 * The dead air CSS letter-spacing leaves AFTER the last character.
 *
 * Spacing is added following every character, the final one included, so a
 * laid-out label is one whole letter-space wider than its own ink. Size a
 * capsule to that width with equal padding on both sides and the right side
 * comes out a letter-space wider than the left — measured at 1.6px on a 30px
 * pill, which is the 5% that reads as "the text is not centred".
 *
 * Both drawings of this badge take it off: the render subtracts it from the
 * measured advance, the site's preview cancels it with a negative right
 * margin. One function so they cannot disagree about how much it is.
 */
export const labelTrailingSpace = (fontSize: number): number =>
	fontSize * WATERMARK_STYLE.labelLetterSpacingEm;

/**
 * The open capsule's width, in border-box pixels, from a MEASURED label.
 *
 * Two things here are easy to get wrong and were both wrong at once:
 *
 * - `box-sizing: border-box` means the border is INSIDE this number, so the
 *   two 1px edges have to be added or the padding silently loses them.
 * - the padding is `padX` on both sides. It used to be `padX * 1.15` on the
 *   right, a fudge that was compensating for the trailing letter-space above
 *   — two wrongs that did not quite make a right.
 *
 * The caller passes the label span's own laid-out width, letter-spacing and
 * all; measuring is the component's job, because only it knows which font
 * actually resolved. Rounded UP so a fractional advance can never clip the
 * last letter against `overflow: hidden`.
 */
export const markPillWidth = (mark: WatermarkMark, fontSize: number, labelAdvance: number): number =>
	2 * WATERMARK_STYLE.markBorderWidth +
	mark.padX +
	mark.glyph +
	mark.gap +
	Math.max(0, Math.ceil(labelAdvance - labelTrailingSpace(fontSize))) +
	mark.padX;

/**
 * The closed chip's left padding — what centres the glyph in the square.
 *
 * The borders are inside the box, so they come off the space the glyph has to
 * sit in. Forgetting them is how the chip ended up half a pixel left of
 * centre: visible on nothing, wrong on everything.
 */
export const markChipPadX = (mark: WatermarkMark): number =>
	(mark.height - 2 * WATERMARK_STYLE.markBorderWidth - mark.glyph) / 2;

/** The fields of a canvas `TextMetrics` this needs, and nothing else. */
export type LabelMetrics = {
	width: number;
	actualBoundingBoxAscent: number;
	actualBoundingBoxDescent: number;
	fontBoundingBoxAscent: number;
	fontBoundingBoxDescent: number;
};

/**
 * How far an all-caps label has to be nudged DOWN to sit on the pill's
 * midline. Positive means the ink is riding high, which it always is.
 *
 * `align-items: center` centres the LINE BOX, and a line box is built around
 * the font's own ascent and descent — room for accents above and descenders
 * below that an all-caps label never uses. "ARCHIVAL FOOTAGE" runs from the
 * baseline up to the cap height with nothing hanging beneath it, so a box
 * centred on the font leaves the letters high: measured at 1.5px in a 30px
 * pill, a twentieth of its height, and obvious once seen.
 *
 * How high depends entirely on the typeface — the render's kicker font is a
 * Google font chosen per preset, the site's preview falls back to whatever
 * monospace the producer has — so this is computed from the REAL ink box
 * rather than from a cap-height ratio. Canvas is the only API that reports
 * it; getting the metrics is each drawing's own job, because only it knows
 * which face actually resolved.
 *
 * Note what does NOT appear here: `labelLineHeight`. The line box's own
 * half-leading is distributed evenly above and below, so it falls out of the
 * subtraction — which is also why changing the line height moves nothing.
 *
 * Returns 0 — the behaviour this badge had before the correction existed —
 * whenever the answer cannot be trusted:
 *
 * - a `TextMetrics` without the actual-bounding-box fields (they are optional
 *   in the spec and were missing from Firefox for years);
 * - a canvas that resolved a DIFFERENT face than the DOM laid the label out
 *   in. A canvas draws no letter-spacing, so its width must come out exactly
 *   one space per character narrower than the span's; anything else means the
 *   two are not measuring the same typeface, and an ink box from the wrong
 *   font would push the text the wrong way by a font's worth of error.
 */
export const labelInkDrop = (
	m: LabelMetrics,
	label: string,
	fontSize: number,
	/** The label span's own laid-out width, letter-spacing and all. */
	advance: number,
): number => {
	const all = [
		m.width,
		m.actualBoundingBoxAscent,
		m.actualBoundingBoxDescent,
		m.fontBoundingBoxAscent,
		m.fontBoundingBoxDescent,
	];
	if (!all.every((n) => typeof n === 'number' && Number.isFinite(n))) return 0;
	const bare = advance - label.length * labelTrailingSpace(fontSize);
	if (bare <= 0 || Math.abs(m.width - bare) > Math.max(2, bare * 0.08)) return 0;
	// Both centres measured from the baseline, downward positive.
	return (
		(m.fontBoundingBoxDescent - m.fontBoundingBoxAscent) / 2 -
		(m.actualBoundingBoxDescent - m.actualBoundingBoxAscent) / 2
	);
};

/**
 * The scene bands the watermark is drawn over.
 *
 * Consecutive scenes carrying the SAME badge are merged into one band, so a
 * documentary that runs six archive scenes together shows one steady label
 * instead of six identical ones blinking apart and back at every cut — while a
 * change from ARCHIVAL FOOTAGE to AI GENERATED still fades, which is the one
 * moment the viewer needs to notice it.
 */
export type WatermarkBand = {
	startSeconds: number;
	endSeconds: number;
	/** Which mark to draw. Carried on the band because two bands can share a
	 *  label and differ in origin is impossible, but the reverse is not: a
	 *  second archival band from another archive has the same origin and its
	 *  own source line. The "open once" rule keys on THIS, not on the label. */
	origin: VisualOrigin;
	label: string;
	source: string | null;
	credit: string | null;
	/**
	 * Whether the badge opens into the full pill, or stays the small chip.
	 *
	 * Always true unless the producer asked for `openOncePerOrigin`, in which
	 * case only the FIRST band of each origin opens and later ones are the
	 * glyph alone — the film says "this is archival footage" once and then
	 * just keeps a quiet mark in the corner.
	 */
	expand: boolean;
};

export const planWatermarkBands = (
	scenes: {startSeconds: number; durationSeconds: number; provenance?: VisualProvenance}[],
	opts: {showLabel: boolean; openOncePerOrigin?: boolean},
): WatermarkBand[] => {
	const bands: WatermarkBand[] = [];
	// Which origins have already had their say. Order of first appearance is
	// what decides, so this is filled as the film runs, not precomputed.
	const opened = new Set<VisualOrigin>();
	for (const s of scenes) {
		const p = s.provenance;
		if (!p) continue;
		const {label, source} = formatSourceWatermark(p);
		const credit = attributionFor(p);
		// With the label switched off only the licence obligation remains, so a
		// scene that owes nothing draws nothing at all.
		if (!opts.showLabel && !credit) continue;
		const origin: VisualOrigin = p.visualOrigin ?? 'unknown';
		const band: WatermarkBand = {
			startSeconds: s.startSeconds,
			endSeconds: s.startSeconds + s.durationSeconds,
			origin,
			label: opts.showLabel ? label : '',
			source: opts.showLabel ? source : null,
			credit,
			// Decided AFTER the merge check below, so a band that merges into
			// its predecessor cannot consume an origin's one opening.
			expand: true,
		};
		const prev = bands[bands.length - 1];
		if (
			prev &&
			Math.abs(prev.endSeconds - band.startSeconds) < 1e-6 &&
			prev.origin === band.origin &&
			prev.label === band.label &&
			prev.source === band.source &&
			prev.credit === band.credit
		) {
			prev.endSeconds = band.endSeconds;
			continue;
		}
		if (opts.openOncePerOrigin) {
			band.expand = !opened.has(origin);
		}
		opened.add(origin);
		bands.push(band);
	}
	return bands;
};
