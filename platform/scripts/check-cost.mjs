// What a film consumed, checked without a database.
//
// The numbers here decide whether a film was affordable, so the arithmetic is
// worth pinning: the hook is priced on the expensive model and the body on the
// free one, a re-roll costs the same as a first take, and a scene with no clip
// costs nothing at all however many drafts sit beside it.
//
//   node --experimental-strip-types scripts/check-cost.mjs
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const {filmCost, MONTHLY_CREDITS} = await import(join(root, 'lib', 'cost.ts'));

const results = [];
const check = (name, got, want) => {
	const ok = JSON.stringify(got) === JSON.stringify(want);
	results.push(ok);
	console.log(`${ok ? 'OK  ' : 'FAIL'} ${name} -> ${JSON.stringify(got)} (want ${JSON.stringify(want)})`);
};

const scene = (o = {}) => ({
	id: o.id ?? 's', order: o.order ?? 101, narration: o.narration ?? '',
	videoUrl: o.videoUrl ?? null, imageUrl: o.imageUrl ?? null, voiceUrl: o.voiceUrl ?? null,
	versions: o.versions ?? [],
});
const v = (kind, n) => Array.from({length: n}, (_, i) => ({id: `${kind}${i}`, kind}));

// A plain film on the free model: the hook is the only clip that costs.
const film = [
	scene({id: 'hook', order: 1, videoUrl: 'x'}),
	scene({id: 'a', order: 101, videoUrl: 'x'}),
	scene({id: 'b', order: 102, videoUrl: 'x'}),
];
check('hook on quality, body free', filmCost(film).credits, 100);
check('every clip counted', filmCost(film).clips, 3);

// Re-rolls cost the same as a first take, and are reported separately.
const retried = [scene({id: 'hook', order: 1, videoUrl: 'x', versions: v('video', 2)})];
check('two re-rolls of the hook', filmCost(retried).credits, 300);
check('re-rolls reported on their own', filmCost(retried).clipRetries, 2);

// A scene with drafts but no clip was never generated — it costs nothing.
check('drafts without a clip cost nothing',
	filmCost([scene({order: 1, versions: v('video', 3)})]).credits, 0);

// Paying model applies to the body, never silently to the hook.
check('paid model on the body',
	filmCost(film, {videoModel: 'veo-3.1-fast'}).credits, 100 + 10 + 10);
check('unknown model falls back to the free default',
	filmCost(film, {videoModel: 'veo-9-imaginary'}).credits, 100);

// Characters count only lines that were actually spoken.
check('characters need a take on file',
	filmCost([
		scene({narration: 'douăzeci', voiceUrl: 'v'}),
		scene({narration: 'nothing recorded'}),
	]).characters, 'douăzeci'.length);

// Images, and the render estimate the site already shows.
check('images include re-rolls',
	filmCost([scene({imageUrl: 'i', versions: v('image', 2)})]).images, 3);
check('render estimate for a 64s film', filmCost([], {lengthSeconds: 64}).renderMinutes, 15);
check('no length, no estimate', filmCost([]).renderMinutes, 0);

console.log(`\nmonthly allowance: ${MONTHLY_CREDITS} credits`);
console.log(`${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
