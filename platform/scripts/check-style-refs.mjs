// The library selection and the SRT cleaning, pinned without a database.
//
//   node --experimental-strip-types scripts/check-style-refs.mjs
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const {pickStyleRefs, cleanTranscript, normalizeStyleRefs, toneFamily, sentenceCount} =
	await import(join(root, 'lib', 'style-refs.ts'));

const results = [];
const check = (name, got, want) => {
	const ok = JSON.stringify(got) === JSON.stringify(want);
	results.push(ok);
	console.log(`${ok ? 'OK  ' : 'FAIL'} ${name} -> ${JSON.stringify(got)}${ok ? '' : ` (want ${JSON.stringify(want)})`}`);
};

// --- cleaning -------------------------------------------------------------
const srt = `1\n00:00:04,310 --> 00:00:04,320\nIt stands on nothing, no land, no\n\n2\n00:00:04,320 --> 00:00:07,270\nbedrock, just sea emptied and rebuilt\n\n3\n00:00:07,280 --> 00:00:09,070\naround it.\n\n8\n00:00:22,270 --> 00:00:22,430\n>> [music]\n\n9\n00:00:22,440 --> 00:00:25,990\n>> not a grain of dry land.\n`;
check('srt cues stripped', cleanTranscript(srt), 'It stands on nothing, no land, no bedrock, just sea emptied and rebuilt around it. not a grain of dry land.');
check('flattened srt stripped', cleanTranscript('67 00:02:39,360 --> 00:02:41,670 Marrakesh. And today we come here at 68 00:02:41,680 --> 00:02:43,830 McDonald\'s.'), 'Marrakesh. And today we come here at McDonald\'s.');
check('vtt header + \\h', cleanTranscript('WEBVTT\n\n00:00:00.000 --> 00:00:03.120\nBefore the Roman Empire,\\h there'), 'Before the Roman Empire, there');
check('prose untouched', cleanTranscript('  Two   sentences. Here.  '), 'Two sentences. Here.');
check('a year is not a cue', cleanTranscript('In 1994 the site was open water. 230 piles.'), 'In 1994 the site was open water. 230 piles.');
check('sentence count', sentenceCount('One. Two! Three? Four… five'), 5);

// --- tone families --------------------------------------------------------
check('Educativ = Educational', toneFamily('Educativ') === toneFamily('Educational'), true);
check('Funny = Fun', toneFamily('Funny') === toneFamily('Fun'), true);
check('Motivațional folds', toneFamily('Motivațional'), 'motivational');
check('unknown passes through', toneFamily('Western'), 'western');

// --- normalize ------------------------------------------------------------
check('json list', normalizeStyleRefs('["recH6fHwjDFva1wzv","bad","recH6fHwjDFva1wzv"]'), ['recH6fHwjDFva1wzv']);
check('array + cap', normalizeStyleRefs(['rec00000000000001', 'rec00000000000002', 'rec00000000000003', 'rec00000000000004']), ['rec00000000000001', 'rec00000000000002', 'rec00000000000003']);
check('garbage', normalizeStyleRefs('{'), []);

// --- picking --------------------------------------------------------------
const long = Array.from({length: 25}, (_, i) => `Sentence number ${i} of the transcript.`).join(' ');
const row = (id, tone, category, extra = {}) => ({id, title: id, tone, category, active: true, transcript: long, styleCard: 'card', pacingWpm: 150, hookWpm: null, createdAt: '2026-08-01', ...extra});
const rows = [
	row('recMcDonalds000001', 'Educativ', 'Documentary', {createdAt: '2026-07-21'}),
	row('recShortsFreeze001', 'Educativ', 'Tutorial', {createdAt: '2026-07-22'}),
	row('recQuantum00000001', 'Educativ', 'Educational', {createdAt: '2026-07-26', transcript: 'Too short. To sample.'}),
	row('recBurjAlArab00001', 'Corporate', 'Educational', {createdAt: '2026-08-01'}),
	row('recNetherlands0001', 'Educativ', 'Educational', {createdAt: '2026-08-01'}),
	row('recSaddam000000001', 'Dark', 'Documentary'),
	row('recRetired00000001', 'Educativ', 'Educational', {active: false}),
];
const ids = (xs) => xs.map((r) => r.id);
check('pinned first, then tone, newest and excerptable first',
	ids(pickStyleRefs(rows, {pinned: ['recBurjAlArab00001'], tone: 'Educativ'})),
	['recBurjAlArab00001', 'recNetherlands0001', 'recShortsFreeze001']);
check('no pin: tone rows, long before short',
	ids(pickStyleRefs(rows, {pinned: [], tone: 'Educativ'})),
	['recNetherlands0001', 'recShortsFreeze001', 'recMcDonalds000001']);
check('category family reaches Educational rows when tone has none',
	ids(pickStyleRefs(rows.filter((r) => r.tone !== 'Educativ'), {pinned: [], tone: 'Educational'})),
	['recBurjAlArab00001']);
check('look adds a third tier',
	ids(pickStyleRefs(rows, {pinned: [], tone: 'Epic', look: 'Documentary'})),
	['recSaddam000000001', 'recMcDonalds000001']);
check('inactive pin is refused',
	ids(pickStyleRefs(rows, {pinned: ['recRetired00000001'], tone: 'Western'})),
	[]);
check('pins keep their order and cap at three',
	ids(pickStyleRefs(rows, {pinned: ['recSaddam000000001', 'recBurjAlArab00001', 'recMcDonalds000001', 'recNetherlands0001'], tone: 'Educativ'})),
	['recSaddam000000001', 'recBurjAlArab00001', 'recMcDonalds000001']);

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
