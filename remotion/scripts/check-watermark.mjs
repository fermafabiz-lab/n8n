// The source watermark, checked without a render.
//
// Two things are worth pinning here and cannot be seen in a still: that the
// label bands MERGE across consecutive scenes carrying the same badge (a
// documentary that runs six archive shots together must not blink the same
// words apart and back at every cut) and that switching the label off leaves
// the licence credit standing — which is a legal obligation, not a style.
//
// The label table itself is mirrored from platform/lib/provenance.ts; the two
// packages share no module, so the copies are compared here against a literal.
//
//   node --experimental-strip-types scripts/check-watermark.mjs
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const {
	ORIGIN_LABELS,
	WATERMARK_LAYOUT,
	WATERMARK_STYLE,
	attributionFor,
	formatSourceWatermark,
	getSourceLabel,
	labelInkDrop,
	labelTrailingSpace,
	markChipPadX,
	normalizeWatermarkScale,
	scaleWatermark,
	WATERMARK_SCALE,
	markPillWidth,
	planWatermarkBands,
	providerLabel,
} = await import(join(root, 'src', 'provenance.ts'));
const {ORIGIN_GLYPHS} = await import(join(root, 'src', 'provenanceGlyphs.ts'));

const results = [];
const check = (name, got, want) => {
	const ok = JSON.stringify(got) === JSON.stringify(want);
	results.push(ok);
	console.log(`${ok ? 'OK  ' : 'FAIL'} ${name} -> ${JSON.stringify(got)} (want ${JSON.stringify(want)})`);
};

// The table, verbatim. If the site's copy is edited and this one is not, the
// film says something different from the screen the producer approved.
check('the label table', ORIGIN_LABELS, {
	ai_generated: 'AI GENERATED',
	ai_reconstruction: 'AI RECONSTRUCTION',
	actual_footage: 'ACTUAL FOOTAGE',
	illustrative_footage: 'ILLUSTRATIVE FOOTAGE',
	archival_footage: 'ARCHIVAL FOOTAGE',
	archival_photo: 'ARCHIVAL PHOTO',
	real_stock: 'REAL FOOTAGE',
	unknown: 'SOURCE UNVERIFIED',
});
check('an absent record is never silent', getSourceLabel(undefined), 'SOURCE UNVERIFIED');
check('nor is an origin we do not know', getSourceLabel({visualOrigin: 'real_ish'}), 'SOURCE UNVERIFIED');
check('a known provider keeps its real name', providerLabel('internet_archive'), 'Internet Archive');
check('a new one is title-cased rather than dropped', providerLabel('eu_audiovisual'), 'EU Audiovisual');
check(
	'a source line only when somebody stated something',
	formatSourceWatermark({visualOrigin: 'archival_photo'}).source,
	null,
);

const scene = (start, dur, provenance) => ({startSeconds: start, durationSeconds: dur, provenance});
const ai = {visualOrigin: 'ai_generated'};
const arch = {visualOrigin: 'archival_footage', provider: 'wikimedia', sourceCreator: 'NASA'};
const archCredited = {...arch, attributionRequired: true, licenseName: 'CC BY-SA 3.0'};

// --- bands ---------------------------------------------------------------

check(
	'three identical scenes are one band',
	planWatermarkBands([scene(0, 8, ai), scene(8, 8, ai), scene(16, 8, ai)], {showLabel: true}).length,
	1,
);
check(
	'and it spans the whole run',
	planWatermarkBands([scene(0, 8, ai), scene(8, 8, ai), scene(16, 8, ai)], {showLabel: true})[0].endSeconds,
	24,
);
check(
	'a change of origin is a new band',
	planWatermarkBands([scene(0, 8, ai), scene(8, 8, arch), scene(16, 8, ai)], {showLabel: true}).map((b) => b.label),
	['AI GENERATED', 'ARCHIVAL FOOTAGE', 'AI GENERATED'],
);
check(
	'a gap in the timeline breaks a band even with the same label',
	planWatermarkBands([scene(0, 8, ai), scene(9, 8, ai)], {showLabel: true}).length,
	2,
);
check(
	'a scene with no provenance draws nothing',
	planWatermarkBands([scene(0, 8, undefined)], {showLabel: true}).length,
	0,
);
check(
	'and does not join the scenes either side',
	planWatermarkBands([scene(0, 8, ai), scene(8, 8, undefined), scene(16, 8, ai)], {showLabel: true}).length,
	2,
);
check(
	'the source line rides on the band',
	planWatermarkBands([scene(0, 8, arch)], {showLabel: true})[0].source,
	'Source: NASA',
);

// --- the switch, and what it may not reach -------------------------------

check(
	'the label is gone when it is switched off',
	planWatermarkBands([scene(0, 8, arch)], {showLabel: false}).length,
	0,
);
check(
	'but a required credit is not',
	planWatermarkBands([scene(0, 8, archCredited)], {showLabel: false}).map((b) => [b.label, b.credit]),
	[['', 'NASA · Wikimedia Commons · CC BY-SA 3.0']],
);
check(
	'and it is there with the label on too',
	planWatermarkBands([scene(0, 8, archCredited)], {showLabel: true})[0].credit,
	'NASA · Wikimedia Commons · CC BY-SA 3.0',
);
check(
	'an AI scene owes no credit, so it disappears entirely when switched off',
	planWatermarkBands([scene(0, 8, ai)], {showLabel: false}).length,
	0,
);
check('a licence that asks for nothing gets nothing', attributionFor(arch), null);

// Commons answers the author field with the wiki TEMPLATE that renders it, and
// a CC BY-SA row is exactly the case where the credit has to be right.
check(
	'the Commons Template: prefix never reaches the screen',
	attributionFor({
		visualOrigin: 'archival_photo',
		attributionRequired: true,
		provider: 'wikimedia',
		sourceCreator: 'Template:Helmut Laux',
		licenseName: 'CC BY-SA 3.0 de',
	}),
	'Helmut Laux · Wikimedia Commons · CC BY-SA 3.0 de',
);
check(
	'nor the source line',
	formatSourceWatermark({visualOrigin: 'archival_photo', sourceCreator: 'Template:Helmut Laux'}).source,
	'Source: Helmut Laux',
);

// --- geometry ------------------------------------------------------------
// These numbers left SourceWatermark.tsx when the site grew a preview of this
// overlay (platform/components/WatermarkPreview.tsx), which draws the badge at
// these exact sizes in a real-sized frame and scales the frame. The site keeps
// its own copy, pinned against the same literals by `npm run check:footage`
// there — so a nudge here that is not mirrored fails on both sides rather than
// silently making the preview a liar.
check('the landscape geometry', WATERMARK_LAYOUT.landscape, {
	frame: {width: 1280, height: 720},
	left: 90,
	bottom: 30,
	maxWidth: 700,
	gap: 3,
	label: {fontSize: 16, padding: '5px 12px'},
	source: {fontSize: 13},
	credit: {fontSize: 12},
	mark: {height: 30, glyph: 15, gap: 8, padX: 10},
});
check('the portrait geometry, lifted clear of the platform chrome', WATERMARK_LAYOUT.portrait, {
	frame: {width: 720, height: 1280},
	left: 44,
	bottom: 232,
	maxWidth: 560,
	gap: 3,
	label: {fontSize: 17, padding: '5px 11px'},
	source: {fontSize: 14},
	credit: {fontSize: 13},
	mark: {height: 32, glyph: 16, gap: 8, padX: 10},
});
// The frame is the render's real size and not 1080p (Root.tsx), which is the
// one thing a preview cannot guess: at 1080p the badge would be drawn half
// again too small relative to the picture.
check(
	'the frame is the render size',
	[WATERMARK_LAYOUT.landscape.frame, WATERMARK_LAYOUT.portrait.frame],
	[{width: 1280, height: 720}, {width: 720, height: 1280}],
);
check('the badge never reaches full opacity', WATERMARK_STYLE.peakOpacity, 0.88);

// --- the pill's own arithmetic ---------------------------------------------
// Every number below was MEASURED in a real Chromium, from the real component,
// before it was pinned — see db/port/watermark-open-once/README.md. They are here
// because all three were wrong at once and each failure looks identical on
// screen: the label sitting off-centre inside its capsule.
const LAND = WATERMARK_LAYOUT.landscape;
// CSS letter-spacing is added after the LAST character too. 16 × 0.14em.
check('the trailing letter-space', labelTrailingSpace(LAND.label.fontSize), 2.24);
// "AI GENERATED" laid out at 16px in the render's mono kicker measured 142.11
// wide; 2 borders + 10 + 15 glyph + 8 gap + ceil(142.11 - 2.24) + 10.
check('the capsule is padded equally on both sides', markPillWidth(LAND.mark, 16, 142.11), 185);
check('and grows with the label', markPillWidth(LAND.mark, 16, 236.84), 280);
// A label that has not been measured yet must not leave a pill wider than the
// chip it opens from — the render holds the frame until it has, but the width
// still has to be sane in between.
check('an unmeasured label is just the two paddings', markPillWidth(LAND.mark, 16, 0), 45);
// The border is INSIDE the box: (30 - 2 - 15) / 2, not (30 - 15) / 2.
check('the chip centres its glyph inside the border', markChipPadX(LAND.mark), 6.5);
check('and in portrait too', markChipPadX(WATERMARK_LAYOUT.portrait.mark), 7);
// DejaVu Sans Mono at 16px, as Chromium resolved `ui-monospace` on the render
// box: ink from the baseline to the cap at 11, nothing below it, against a
// font box of 13 up and 5 down. The line box therefore centres 1.5px high.
const MONO16 = {
	width: 115.22,
	actualBoundingBoxAscent: 11,
	actualBoundingBoxDescent: 0,
	fontBoundingBoxAscent: 13,
	fontBoundingBoxDescent: 5,
};
check('all-caps ink rides high in its line box', labelInkDrop(MONO16, 'AI GENERATED', 16, 142.11), 1.5);
// The refusals. A canvas draws no letter-spacing, so its width must come out
// exactly one space per character under the span's; anything else is a
// different typeface and its ink box would push the text the wrong way.
check(
	'a canvas measuring another face is not believed',
	labelInkDrop(MONO16, 'AI GENERATED', 16, 210),
	0,
);
check(
	'nor is a TextMetrics without an ink box',
	labelInkDrop({...MONO16, actualBoundingBoxAscent: undefined}, 'AI GENERATED', 16, 142.11),
	0,
);
check('nor a label with no width at all', labelInkDrop(MONO16, 'AI GENERATED', 16, 0), 0);

// --- the badge's SIZE --------------------------------------------------------
// The multiplier the producer sets, and what it does to the geometry. Four
// copies of the range exist (here, platform/lib/provenance.ts, the
// orchestrator's Normalize node, Final Assembly's Source Watermark node) and
// `node db/port/watermark-open-once/check.mjs` asserts all four agree.
check('the size range and its default', WATERMARK_SCALE, {min: 0.7, max: 1.6, step: 0.05, default: 1});
// REFUSES rather than clamps, exactly as normalizeSpeed does: a stored 4 is a
// mistake, not "as big as possible", and a badge silently drawn at the maximum
// would be a worse answer than the standard one.
check('an oversized value is refused, not clamped', normalizeWatermarkScale(4), 1);
check('and an undersized one too', normalizeWatermarkScale(0.2), 1);
check('a word is not a size', normalizeWatermarkScale('big'), 1);
check('nor is nothing at all', normalizeWatermarkScale(undefined), 1);
check('the ends themselves are allowed', [normalizeWatermarkScale(0.7), normalizeWatermarkScale(1.6)], [0.7, 1.6]);
check('and anything between them', normalizeWatermarkScale(1.35), 1.35);
// 1x must be the object itself, not a rebuilt copy: every film rendered before
// this existed goes through here, and a rounding that moved one pixel would
// change all of them.
check('1x is the base geometry untouched', scaleWatermark(LAND, 1), LAND);
check('and so is a refused value', scaleWatermark(LAND, 99), LAND);
check(
	'the mark at the smallest size',
	scaleWatermark(LAND, 0.7).mark,
	{height: 21, glyph: 11, gap: 6, padX: 7},
);
check(
	'and at the largest',
	scaleWatermark(LAND, 1.6).mark,
	{height: 48, glyph: 24, gap: 13, padX: 16},
);
check(
	'the three font sizes scale with it',
	[scaleWatermark(LAND, 1.6).label.fontSize, scaleWatermark(LAND, 1.6).source.fontSize, scaleWatermark(LAND, 1.6).credit.fontSize],
	[26, 21, 19],
);
// Where the badge SITS is not part of the mark. A badge that walked towards
// the corner as it grew would be two decisions wearing one control.
check(
	'but its place on the frame does not',
	[scaleWatermark(LAND, 1.6).left, scaleWatermark(LAND, 1.6).bottom, scaleWatermark(LAND, 1.6).maxWidth],
	[LAND.left, LAND.bottom, LAND.maxWidth],
);
check('portrait scales from its own base', scaleWatermark(WATERMARK_LAYOUT.portrait, 1.6).mark, {height: 51, glyph: 26, gap: 13, padX: 16});
// The capsule the widest label needs at the largest size, which is what the
// top of the range was chosen against: it has to stay inside maxWidth.
check(
	'the widest capsule still fits the budget',
	markPillWidth(scaleWatermark(LAND, 1.6).mark, 26, 236.84 * 1.6) <= LAND.maxWidth,
	true,
);

// --- "announce each source once" -------------------------------------------
// MIRRORED with platform/scripts/check-footage.mjs. The switch collapses
// REPEATS of a kind, never a kind's first appearance and never a credit.
const arch2 = {visualOrigin: 'archival_footage', provider: 'loc'};
check(
	'every band expands unless asked otherwise',
	planWatermarkBands([scene(0, 8, arch), scene(8, 8, ai), scene(16, 8, arch2)], {showLabel: true}).map((b) => b.expand),
	[true, true, true],
);
check(
	'open once: the first band of each origin opens, later ones stay chips',
	planWatermarkBands([scene(0, 8, arch), scene(8, 8, ai), scene(16, 8, arch2)], {
		showLabel: true,
		openOncePerOrigin: true,
	}).map((b) => b.expand),
	[true, true, false],
);
check(
	'open once: a different ARCHIVE is still the same kind of source',
	planWatermarkBands([scene(0, 8, arch), scene(8, 8, arch2)], {showLabel: true, openOncePerOrigin: true}).map(
		(b) => [b.origin, b.expand],
	),
	[['archival_footage', true], ['archival_footage', false]],
);
check(
	'open once: merged consecutive scenes are ONE band and consume one opening',
	planWatermarkBands([scene(0, 8, arch), scene(8, 8, arch)], {showLabel: true, openOncePerOrigin: true}).map(
		(b) => b.expand,
	),
	[true],
);
check(
	'open once never reaches the licence credit',
	planWatermarkBands([scene(0, 8, archCredited), scene(8, 8, arch2)], {
		showLabel: true,
		openOncePerOrigin: true,
	}).map((b) => [b.expand, Boolean(b.credit)]),
	[[true, true], [false, false]],
);
check(
	'every origin has a glyph',
	Object.keys(ORIGIN_LABELS).filter((o) => !(ORIGIN_GLYPHS[o] || []).length),
	[],
);

// Last line of the file on purpose. The summary used to sit halfway up, which
// left the six checks below it unreachable and still reporting a cheerful
// "24/24 passed" — a pass over the checks that ran, which is not the same
// thing as a pass. Add new cases ABOVE this.
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
