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
	/** The fade at each END of a band. Long enough to be soft, short enough to
	 *  be up on the scene's first frames — the spec's 150-250ms window. It
	 *  lived in SourceWatermark.tsx until the site grew an ANIMATED preview and
	 *  needed the same number. */
	fadeSeconds: 0.2,
} as const;

/**
 * The badge's easing, as a function of 0..1.
 *
 * `CURVES.inOutCubic` is `Easing.bezier(0.65, 0, 0.35, 1)`, and this is the
 * same curve solved by hand rather than through Remotion — because the site's
 * preview has to animate on the identical curve and cannot import Remotion.
 * Verified against `Easing.bezier(0.65, 0, 0.35, 1)` over 101 samples: the
 * largest disagreement is 3.9e-16, which is float noise. `check:watermark`
 * pins four points of it so a rewrite here cannot quietly change the feel.
 *
 * Newton-Raphson first because it converges in a few steps on a well-behaved
 * curve, then bisection to finish — the fallback matters at the flat ends,
 * where the derivative approaches zero and Newton stops making progress.
 */
const solveBezier = (x1: number, y1: number, x2: number, y2: number) => {
	const A = (a: number, b: number) => 1 - 3 * b + 3 * a;
	const B = (a: number, b: number) => 3 * b - 6 * a;
	const C = (a: number) => 3 * a;
	const calc = (t: number, a: number, b: number) => ((A(a, b) * t + B(a, b)) * t + C(a)) * t;
	const slope = (t: number, a: number, b: number) => 3 * A(a, b) * t * t + 2 * B(a, b) * t + C(a);
	return (x: number): number => {
		if (x <= 0) return 0;
		if (x >= 1) return 1;
		let t = x;
		for (let i = 0; i < 8; i++) {
			const s = slope(t, x1, x2);
			if (s === 0) break;
			t -= (calc(t, x1, x2) - x) / s;
		}
		let lo = 0;
		let hi = 1;
		for (let i = 0; i < 24 && (t < 0 || t > 1); i++) t = (lo + hi) / 2;
		for (let i = 0; i < 24; i++) {
			const cx = calc(t, x1, x2);
			if (Math.abs(cx - x) < 1e-7) break;
			if (cx < x) lo = t;
			else hi = t;
			t = (lo + hi) / 2;
		}
		return calc(t, y1, y2);
	};
};

export const WATERMARK_EASE = solveBezier(0.65, 0, 0.35, 1);

/** A clamped, eased 0..1 ramp — the shape `eased()` produces in the render. */
const ramp = (input: number, span: number): number =>
	span <= 0 ? (input >= 0 ? 1 : 0) : WATERMARK_EASE(Math.min(1, Math.max(0, input / span)));

/**
 * How long the opening takes on a band of `bandLength` seconds.
 *
 * A band shorter than the animation would otherwise be caught mid-open at its
 * own fade-out, so the opening is COMPRESSED to fit rather than truncated:
 * better a quick open than a pill frozen half-drawn. On any real film this is
 * simply `openSeconds` — the shortest band is one scene, and a scene is
 * eight seconds.
 */
export const markOpenSpan = (bandLength: number): number =>
	Math.min(
		WATERMARK_STYLE.openSeconds,
		Math.max(0.12, bandLength - WATERMARK_STYLE.openDelaySeconds - WATERMARK_STYLE.fadeSeconds),
	);

/**
 * How open the mark is, 0 (chip) to 1 (pill), `t` seconds into its band.
 *
 * It opens once, just after the fade has brought it up, and STAYS open for the
 * rest of the band — it does not breathe shut and open again at every cut,
 * which is the same reason consecutive scenes are merged into one band in the
 * first place. A band that does not `expand` never opens at all: that is what
 * "announce each source once" looks like from the second band on.
 */
export const markOpenAt = (t: number, bandLength: number, expand: boolean): number =>
	expand ? ramp(t - WATERMARK_STYLE.openDelaySeconds, markOpenSpan(bandLength)) : 0;

/**
 * How far the label has uncovered, 0..1, from how open the mark is.
 *
 * A sub-range of the opening rather than its own clock: the text appears while
 * the capsule is still widening, clipped by it, so it reads as the mark
 * OPENING rather than as a second element arriving on top.
 */
export const markRevealAt = (open: number): number =>
	Math.min(1, Math.max(0, (open - 0.25) / (0.85 - 0.25)));

/** The whole badge's opacity `t` seconds into a band. Symmetric in and out —
 *  not an arrival, a label becoming legible and then stopping. */
export const bandOpacityAt = (t: number, bandLength: number): number =>
	Math.min(ramp(t, WATERMARK_STYLE.fadeSeconds), ramp(bandLength - t, WATERMARK_STYLE.fadeSeconds)) *
	WATERMARK_STYLE.peakOpacity;

/** How long one band's animation takes to settle — what a preview that plays
 *  it ONCE has to wait before it can stop the clock. */
export const markSettleSeconds = (bandLength: number): number =>
	WATERMARK_STYLE.openDelaySeconds + markOpenSpan(bandLength) + 0.05;

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

/**
 * How much bigger or smaller the whole badge is drawn.
 *
 * The badge is deliberately the least decorative element in the render — a
 * claim about truthfulness that draws attention to itself stops being read as
 * one — but "quiet" is a judgement about a particular film on a particular
 * screen, not a constant. A documentary watched on a phone needs it larger
 * than a 16:9 essay does, and the producer is the one looking at it.
 *
 * The ends are chosen rather than arbitrary. Below 0.7 the 15px glyph falls
 * under 11px and the artwork's thin strokes start dropping out at 1080p;
 * above 1.6 the capsule for the longest label ("ILLUSTRATIVE FOOTAGE", 280px
 * at 1×) passes 448px and begins to read as a banner rather than a mark.
 * `step` is the slider's grid and nothing else enforces it — an arbitrary
 * value inside the range is honoured, because refusing one would be refusing
 * a film that was rendered before the grid existed.
 */
export const WATERMARK_SCALE = {
	min: 0.7,
	max: 1.6,
	step: 0.05,
	default: 1,
} as const;

/**
 * The stored size, or the default — refuse-then-clamp, like every other
 * Editing Options number.
 *
 * REFUSES rather than clamps, exactly as `normalizeSpeed` does: a value
 * outside the range falls back to 1 instead of being pulled to the nearest
 * end. A stored 4 is not "as big as possible", it is a mistake, and a badge
 * silently drawn at the maximum would be a worse answer than the default one.
 *
 * MIRRORED in `platform/lib/provenance.ts` and in Final Assembly's
 * `Source Watermark` node — three copies in three languages, and the rule
 * this project keeps for such a number is that they move together or a film
 * is drawn at a size the control never offered. Pinned on both repo sides.
 */
export const normalizeWatermarkScale = (value: unknown): number => {
	const n = Number(value);
	if (!Number.isFinite(n)) return WATERMARK_SCALE.default;
	if (n < WATERMARK_SCALE.min || n > WATERMARK_SCALE.max) return WATERMARK_SCALE.default;
	return n;
};

/**
 * The badge's geometry at a given size.
 *
 * Everything that is part of the MARK scales — its height, its glyph, the two
 * paddings, the three font sizes and the gap between the stacked lines. What
 * does NOT scale is where the badge sits: `left`, `bottom` and `frame` are
 * about the composition, not about the mark, and a badge that walked towards
 * the corner as it grew would be two decisions wearing one control.
 *
 * `maxWidth` is left alone for the same reason — it is a budget measured
 * against the frame, and the widest capsule at the largest size is still well
 * inside it.
 *
 * Rounded to whole pixels because half a pixel of border is a grey smear
 * rather than a hairline, and because `markChipPadX` centres the glyph inside
 * the border by halving what is left: on whole numbers that lands on a clean
 * .0 or .5, which the browser draws the same way every frame.
 *
 * The border itself stays 1px at every size, deliberately. A hairline is a
 * hairline — scaling it would make the largest badge look heavy-handed, which
 * is the opposite of what this overlay is for.
 */
export const scaleWatermark = (g: WatermarkGeometry, scale: unknown): WatermarkGeometry => {
	const k = normalizeWatermarkScale(scale);
	if (k === WATERMARK_SCALE.default) return g;
	const px = (n: number) => Math.max(1, Math.round(n * k));
	return {
		...g,
		gap: px(g.gap),
		label: {...g.label, fontSize: px(g.label.fontSize)},
		source: {fontSize: px(g.source.fontSize)},
		credit: {fontSize: px(g.credit.fontSize)},
		mark: {
			height: px(g.mark.height),
			glyph: px(g.mark.glyph),
			gap: px(g.mark.gap),
			padX: px(g.mark.padX),
		},
	};
};

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
