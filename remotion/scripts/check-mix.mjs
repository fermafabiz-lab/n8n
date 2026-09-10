// Check the audio mix bus: every pad produced, every pad consumed.
//
// This box has no ffmpeg, and the failure this graph produces is total — a pad
// left dangling, an `amix` whose declared input count does not match what is
// wired into it, and ffmpeg refuses the job after the caller has already spent
// minutes downloading and concatenating. So the graph is built as DATA and the
// wiring is checked here, across every combination of the switches, without an
// encoder anywhere near it.
//
// What it cannot check is how any of it SOUNDS. The levels, the crossover
// points and the release times are judgements, and the only judge is the ear
// on a real film. What it can check is that the graph runs at all, and that
// the speech band really is ducked harder than the body and the air — which is
// the whole claim the music mix makes.
//
//   node scripts/check-mix.mjs
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const {buildMixGraph} = await import(join(root, 'server', 'assemble.mjs'));

let failed = false;
const check = (ok, label, detail = '') => {
	console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${label}${detail ? `   ${detail}` : ''}`);
	if (!ok) failed = true;
};

/** `[a][b]filter,filter[c]` -> {ins, body, outs}. */
const parsePart = (part) => {
	const inm = part.match(/^((?:\[[^\]]+\])+)/);
	const outm = part.match(/((?:\[[^\]]+\])+)$/);
	const pads = (s) => (s ? s.slice(1, -1).split('][') : []);
	const ins = pads(inm && inm[1]);
	// A part that is nothing but pads would count them twice; none exists, and
	// this is the assertion that says so rather than a comment claiming it.
	const outs = inm && outm && inm.index === 0 && inm[1] === outm[1] ? [] : pads(outm && outm[1]);
	const body = part.slice(inm ? inm[1].length : 0, outm ? part.length - outm[1].length : undefined);
	return {ins, outs, body};
};

const isSource = (pad) => /^\d+:[av]$/.test(pad);

function audit(parts, {external, inputCount}) {
	const produced = new Map(external.map((p) => [p, 0]));
	const consumed = new Map();
	const problems = [];

	for (const part of parts) {
		const {ins, outs, body} = parsePart(part);
		if (!body.trim()) problems.push(`a part with no filter: ${part}`);
		for (const pad of ins) {
			if (isSource(pad)) {
				const idx = Number(pad.split(':')[0]);
				if (idx >= inputCount) problems.push(`input ${pad} past the ${inputCount} declared inputs`);
				continue;
			}
			consumed.set(pad, (consumed.get(pad) ?? 0) + 1);
		}
		for (const pad of outs) {
			if (produced.has(pad) && pad !== '__') problems.push(`pad [${pad}] produced twice`);
			produced.set(pad, (produced.get(pad) ?? 0) + 1);
		}
		// An `amix` must be fed exactly the number of inputs it declares, and an
		// `asplit` must hand out exactly as many as it says. Both are silent
		// mismatches in the source and hard errors in ffmpeg.
		const amix = body.match(/amix=inputs=(\d+)/);
		if (amix && Number(amix[1]) !== ins.length) {
			problems.push(`amix declares ${amix[1]} inputs, wired ${ins.length}: ${part}`);
		}
		const asplit = body.match(/asplit=(\d+)/);
		if (asplit && Number(asplit[1]) !== outs.length) {
			problems.push(`asplit declares ${asplit[1]} outputs, wired ${outs.length}: ${part}`);
		}
	}

	for (const [pad] of consumed) {
		if (!produced.has(pad)) problems.push(`pad [${pad}] is consumed but nothing produces it`);
	}
	for (const [pad] of produced) {
		const uses = consumed.get(pad) ?? 0;
		if (pad === 'outa') {
			if (uses !== 0) problems.push('[outa] is consumed — it is the output, ffmpeg maps it');
			continue;
		}
		// An unconsumed pad does not error at parse time; it stalls the graph,
		// which is the bug the old fixed `asplit=3` needed two `anullsink`s for.
		if (uses === 0) problems.push(`pad [${pad}] is produced and never used`);
		if (uses > 1) problems.push(`pad [${pad}] is used ${uses} times — a pad feeds one filter`);
	}
	if (!produced.has('outa')) problems.push('nothing produces [outa]');
	return problems;
}

const CASES = [];
for (const nativeOn of [true, false]) {
	for (const musicDuck of [null, 'bands', 'flat']) {
		for (const stingers of [true, false]) {
			for (const chapters of [[], [12.5, 40.25]]) {
				CASES.push({nativeOn, musicDuck, stingers, chapterBoundaries: chapters});
			}
		}
	}
}

console.log(`\n--- wiring, ${CASES.length} combinations ---`);
let worstDetail = '';
let broken = 0;
for (const c of CASES) {
	const music = c.musicDuck !== null;
	// The input list the caller builds: two per scene, then music, then the
	// three stingers, then the silence source. Only the count matters here.
	let idx = 6;
	const musicIdx = music ? idx++ : -1;
	const boomIdx = c.stingers ? idx++ : -1;
	const whooshIdx = c.stingers ? idx++ : -1;
	const riserIdx = c.stingers ? idx++ : -1;
	const parts = buildMixGraph({
		nativeOn: c.nativeOn,
		nativeVolume: 0.35,
		music,
		musicDuck: c.musicDuck,
		musicGainDb: -6.4,
		musicVolume: 0.22,
		musicIdx,
		totalDur: 64.5,
		stingers: c.stingers,
		boomIdx,
		whooshIdx,
		riserIdx,
		chapterBoundaries: c.chapterBoundaries,
	});
	const problems = audit(parts, {
		external: c.nativeOn ? ['voiceraw', 'natraw'] : ['voiceraw'],
		inputCount: idx,
	});
	if (problems.length) {
		broken++;
		if (!worstDetail) {
			worstDetail =
				`native=${c.nativeOn} music=${c.musicDuck} stingers=${c.stingers} ` +
				`chapters=${c.chapterBoundaries.length}\n      ` +
				problems.join('\n      ');
		}
	}
}
check(broken === 0, 'every graph is fully wired', broken ? `\n      ${worstDetail}` : `${CASES.length}/${CASES.length}`);

// ---- the claims the music chain makes ----
console.log('\n--- the music chain ---');
const g = (over = {}) =>
	buildMixGraph({
		nativeOn: true,
		nativeVolume: 0.35,
		music: true,
		musicDuck: 'bands',
		musicGainDb: -6.4,
		musicVolume: 0.22,
		musicIdx: 6,
		totalDur: 64.5,
		stingers: false,
		boomIdx: -1,
		whooshIdx: -1,
		riserIdx: -1,
		chapterBoundaries: [],
		...over,
	}).join(';');

{
	const bands = g();
	const ratio = (pad) => {
		const m = bands.match(new RegExp(`\\[${pad}\\]\\[\\w+\\]sidechaincompress=[^\\[]*ratio=(\\d+)`));
		return m ? Number(m[1]) : null;
	};
	check(ratio('mmid') !== null, 'the speech band has its own compressor');
	check(
		ratio('mmid') > ratio('mlo') && ratio('mmid') > ratio('mhi'),
		'the speech band ducks harder than body and air',
		`mid ${ratio('mmid')} vs low ${ratio('mlo')} / high ${ratio('mhi')}`,
	);
	const release = (pad) => {
		const m = bands.match(new RegExp(`\\[${pad}\\]\\[\\w+\\]sidechaincompress=[^\\[]*release=(\\d+)`));
		return m ? Number(m[1]) : null;
	};
	// A 0.35s gap between scenes is the shortest thing the bed must NOT surge
	// through; anything under it and the music pumps once per scene.
	check(release('mmid') >= 700, 'the speech band recovers slower than a scene gap', `${release('mmid')}ms`);

	// The measured correction must land before the producer's slider, or the
	// slider means a different thing on every track — which is the whole
	// complaint the measurement answers.
	const chain = bands.match(/\[6:a\][^;]*/)[0];
	check(
		chain.indexOf('volume=-6.40dB') > -1 &&
			chain.indexOf('volume=-6.40dB') < chain.indexOf('volume=0.22'),
		'the loudness correction is applied before the slider',
	);
	check(
		g({musicGainDb: 0}).includes('volume=0.22') && !g({musicGainDb: 0}).includes('dB'),
		'an unmeasurable track carries no correction at all',
	);
}
{
	// The fallback build: a static carve in the speech band, one duck.
	const flat = g({musicDuck: 'flat'});
	check(/equalizer=f=\d+/.test(flat), 'without a crossover the speech band is carved statically');
	check(!flat.includes('acrossover'), 'and the crossover is not named at all');
}
{
	const none = g({music: false, musicDuck: null});
	check(!none.includes('[mduck]') && !none.includes('acrossover'), 'no music means no music chain');
	check(none.includes('asplit=2[vmain]'), 'and the voice is split only as far as it is needed');
}

console.log(
	`\nWhat this cannot tell you is whether it sounds right. The crossover points,\n` +
		`the ratios and the target loudness are judgements — check them on a real\n` +
		`film, and read verify.musicLufs / musicGainDb / musicDuck in the job result\n` +
		`when one sounds wrong.\n`,
);
process.exit(failed ? 1 : 0);
