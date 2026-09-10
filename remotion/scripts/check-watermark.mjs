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
const {ORIGIN_LABELS, attributionFor, formatSourceWatermark, getSourceLabel, planWatermarkBands, providerLabel} =
	await import(join(root, 'src', 'provenance.ts'));

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

console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
