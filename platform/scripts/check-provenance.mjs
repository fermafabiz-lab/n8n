// Visual provenance, checked without a database.
//
// Everything here is a claim the film makes on screen about whether what the
// viewer is looking at is real, so the rules are worth pinning: the classifier
// can never reach ACTUAL FOOTAGE on its own, an AI picture can never be
// relabelled as real of any kind, no date or place is printed unless somebody
// stated it, and an unknown origin says SOURCE UNVERIFIED rather than nothing.
//
//   node --experimental-strip-types scripts/check-provenance.mjs
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const P = await import(join(root, 'lib', 'provenance.ts'));
const {
	ACTUAL_FOOTAGE_MIN_CONFIDENCE,
	AI_TO_ACTUAL_WARNING,
	ORIGIN_LABELS,
	VISUAL_ORIGINS,
	attributionFor,
	classifyVisualOrigin,
	detectAiReconstruction,
	formatSourceWatermark,
	getSourceLabel,
	normalizeConfidence,
	normalizeVisualOrigin,
	providerLabel,
	refuseFootageType,
} = P;

const results = [];
const check = (name, got, want) => {
	const ok = JSON.stringify(got) === JSON.stringify(want);
	results.push(ok);
	console.log(`${ok ? 'OK  ' : 'FAIL'} ${name} -> ${JSON.stringify(got)} (want ${JSON.stringify(want)})`);
};
const truthy = (name, got) => {
	results.push(Boolean(got));
	console.log(`${got ? 'OK  ' : 'FAIL'} ${name} -> ${JSON.stringify(got)}`);
};

// --- the vocabulary -------------------------------------------------------

check('eight origins', VISUAL_ORIGINS.length, 8);
check('every origin has a label', VISUAL_ORIGINS.filter((o) => !ORIGIN_LABELS[o]).length, 0);
check('unknown is never silent', ORIGIN_LABELS.unknown, 'SOURCE UNVERIFIED');
check('normalize accepts a stored value', normalizeVisualOrigin('archival_photo'), 'archival_photo');
check('normalize refuses a made-up one', normalizeVisualOrigin('definitely_real'), null);
check('normalize refuses a non-string', normalizeVisualOrigin(3), null);
check('confidence out of range is refused', normalizeConfidence(140), undefined);
check('confidence rounds', normalizeConfidence(87.4), 87);

// --- classification -------------------------------------------------------

check('a generated scene is AI', classifyVisualOrigin({visualSource: 'ai'}).origin, 'ai_generated');
check('and we are certain of it', classifyVisualOrigin({visualSource: 'ai'}).confidence, 100);

check(
	'a stock video is archival footage',
	classifyVisualOrigin({visualSource: 'stock_video'}).origin,
	'archival_footage',
);
check(
	'a stock still is an archival photo',
	classifyVisualOrigin({visualSource: 'stock_image'}).origin,
	'archival_photo',
);
check(
	'a complete library row scores higher than a bare one',
	classifyVisualOrigin({
		visualSource: 'stock_video',
		stock: {
			provider: 'wikimedia',
			creator: 'NASA',
			sourceUrl: 'https://commons.wikimedia.org/x',
			rightsStatus: 'public_domain',
			license: 'Public domain',
		},
	}).confidence >
		classifyVisualOrigin({visualSource: 'stock_video'}).confidence,
	true,
);
check(
	'and never claims certainty about an archive item',
	classifyVisualOrigin({
		visualSource: 'stock_video',
		stock: {provider: 'w', creator: 'c', sourceUrl: 'u', rightsStatus: 'cc_by', license: 'CC BY 4.0'},
	}).confidence < ACTUAL_FOOTAGE_MIN_CONFIDENCE,
	true,
);

// THE rule: nothing automatic ever reaches actual_footage, whatever it is given.
const everyAutomatic = [
	classifyVisualOrigin({visualSource: 'ai'}),
	classifyVisualOrigin({visualSource: 'stock_video', stock: {provider: 'internet_archive', creator: 'US Army', sourceUrl: 'u', rightsStatus: 'public_domain', license: 'PD'}}),
	classifyVisualOrigin({visualSource: 'stock_image', stock: {provider: 'internet_archive', creator: 'US Army', sourceUrl: 'u', rightsStatus: 'public_domain', license: 'PD'}}),
	classifyVisualOrigin({visualSource: 'nonsense'}),
];
check('the classifier never says ACTUAL FOOTAGE', everyAutomatic.filter((r) => r.origin === 'actual_footage').length, 0);
// Nothing automatic may produce a number that reads as authority about the
// world. `ai_generated` is the one exception and is not one: it is a fact
// about OUR pipeline — we made the picture — not a claim about an event.
check(
	'and never scores past the actual-footage threshold except on its own work',
	everyAutomatic.filter((r) => r.origin !== 'ai_generated' && r.confidence >= ACTUAL_FOOTAGE_MIN_CONFIDENCE).length,
	0,
);
check('an unrecognised source is unknown', classifyVisualOrigin({visualSource: 'somewhere'}).origin, 'unknown');
check('and carries no confidence', classifyVisualOrigin({visualSource: 'somewhere'}).confidence, 0);

// --- reconstruction detection --------------------------------------------

truthy('a reenactment is a reconstruction', detectAiReconstruction('Historical reenactment of the landing'));
truthy('so is a reconstruction', detectAiReconstruction('A reconstruction of the signing room'));
truthy('so is a dramatisation', detectAiReconstruction('Dramatisation, wide shot'));
truthy('so is a historical recreation', detectAiReconstruction('historical recreation of the market square'));
truthy('so is recreating the event', detectAiReconstruction('Recreate the signing, from behind'));
truthy('Romanian counts too', detectAiReconstruction('Reconstituire a scenei de pe pod'));
truthy('either field is read', detectAiReconstruction(null, 'slow push in, historical reconstruction'));
check('a recreation ground is not', detectAiReconstruction('children on the recreation ground'), false);
check('an ordinary shot is not', detectAiReconstruction('A man walks along a night road, from behind'), false);
check('nothing at all is not', detectAiReconstruction(null, undefined), false);
check(
	'a reconstruction prompt classifies as one',
	classifyVisualOrigin({visualSource: 'ai', imagePrompt: 'Historical reenactment of the march'}).origin,
	'ai_reconstruction',
);
check(
	'but an archive scene is not re-read from its prompt',
	classifyVisualOrigin({visualSource: 'stock_video', imagePrompt: 'a reconstruction'}).origin,
	'archival_footage',
);

// --- what may be set by hand ---------------------------------------------

truthy(
	'an AI picture may not be called actual footage',
	refuseFootageType('actual_footage', {visualSource: 'ai'})?.startsWith(AI_TO_ACTUAL_WARNING),
);
for (const o of ['actual_footage', 'illustrative_footage', 'archival_footage', 'archival_photo', 'real_stock']) {
	truthy(`an AI picture may not be called ${o}`, refuseFootageType(o, {visualSource: 'ai'}) !== null);
}
check('an AI picture may be called a reconstruction', refuseFootageType('ai_reconstruction', {visualSource: 'ai'}), null);
check('an AI picture may be marked unknown', refuseFootageType('unknown', {visualSource: 'ai'}), null);
check(
	'an archive picture may be promoted to actual footage',
	refuseFootageType('actual_footage', {visualSource: 'stock_video'}),
	null,
);
truthy(
	'an archive picture may not be called AI',
	refuseFootageType('ai_generated', {visualSource: 'stock_image'}) !== null,
);

// --- what reaches the screen ---------------------------------------------

check('the label for a missing record', getSourceLabel(null), 'SOURCE UNVERIFIED');
check('the label for a broken record', getSourceLabel({visualOrigin: 'sort_of_real'}), 'SOURCE UNVERIFIED');
check('the label for an AI scene', getSourceLabel({visualOrigin: 'ai_generated'}), 'AI GENERATED');

check(
	'no source line when nobody stated anything',
	formatSourceWatermark({visualOrigin: 'archival_footage'}),
	{label: 'ARCHIVAL FOOTAGE', source: null},
);
check(
	'the creator alone is enough for one',
	formatSourceWatermark({visualOrigin: 'archival_footage', sourceCreator: 'NASA'}),
	{label: 'ARCHIVAL FOOTAGE', source: 'Source: NASA'},
);
check(
	'the provider stands in when there is no creator',
	formatSourceWatermark({visualOrigin: 'archival_photo', provider: 'wikimedia'}),
	{label: 'ARCHIVAL PHOTO', source: 'Source: Wikimedia Commons'},
);
check(
	'place and date join it only when stated',
	formatSourceWatermark({
		visualOrigin: 'actual_footage',
		sourceCreator: 'Reuters',
		originalLocation: 'Ceuta',
		originalDate: '31 Jul 2026',
	}),
	{label: 'ACTUAL FOOTAGE', source: 'Source: Reuters · Ceuta · 31 Jul 2026'},
);
check(
	'an AI scene with no source says only what it is',
	formatSourceWatermark({visualOrigin: 'ai_generated'}),
	{label: 'AI GENERATED', source: null},
);

check('a known provider gets its real name', providerLabel('internet_archive'), 'Internet Archive');
check('an unknown one is title-cased, not dropped', providerLabel('eu_audiovisual'), 'EU Audiovisual');
check('a plain new provider works untouched', providerLabel('Reuters'), 'Reuters');
check('and nothing is still nothing', providerLabel(''), null);

// --- the licence credit, which the watermark switch must not reach --------

check('no credit when none is required', attributionFor({visualOrigin: 'archival_footage', provider: 'wikimedia'}), null);
check(
	'a required credit is composed from what is known',
	attributionFor({
		visualOrigin: 'archival_footage',
		attributionRequired: true,
		provider: 'wikimedia',
		sourceCreator: 'Bundesarchiv',
		licenseName: 'CC BY-SA 3.0',
	}),
	'Bundesarchiv · Wikimedia Commons · CC BY-SA 3.0',
);
check(
	'a pre-composed credit wins',
	attributionFor({visualOrigin: 'archival_photo', attributionText: 'Photo: X, CC BY 4.0'}),
	'Photo: X, CC BY 4.0',
);
check('and nothing at all is null', attributionFor(null), null);

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

console.log(`\nactual footage needs ${ACTUAL_FOOTAGE_MIN_CONFIDENCE}% confidence, which only a person can supply`);
console.log(`${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
