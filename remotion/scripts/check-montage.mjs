// Measure the montage planner against remotion/reference/editing-benchmarks.json.
//
// Rhythm statistics alone are not enough. The baseline failure recorded in that
// file was not a bad shot-length distribution — it was that consecutive shots
// looked identical, so the whole film registered as ONE take at the reference
// detector threshold. A cut nobody can see is not a cut. So this reports both:
// the rhythm, and the size of the actual framing jump at every planned cut.
//
//   node scripts/check-montage.mjs [props.json] [--intensity 1]
//
// Reads scenes from a Final Assembly props fixture (default the Studio one), so
// it always measures against real scene timings rather than invented ones.
import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const {planMontage, montageStats, auditCuts, MIN_SCALE_STEP} = await import(
	join(root, 'src', 'montage.ts')
);

const args = process.argv.slice(2);
const iFlag = args.indexOf('--intensity');
const intensities = iFlag === -1 ? [1, 2] : [Number(args[iFlag + 1])];
const propsPath = args.find((a) => a.endsWith('.json')) ?? join(root, 'trigger', 'studio-props.json');

const props = JSON.parse(readFileSync(propsPath, 'utf8'));
const scenes = props.scenes ?? [];
if (!scenes.length) {
	console.error('no scenes in ' + propsPath);
	process.exit(1);
}
const targets = JSON.parse(
	readFileSync(join(root, 'reference', 'editing-benchmarks.json'), 'utf8'),
).acceptanceTargets;

const total = scenes.at(-1).startSeconds + scenes.at(-1).durationSeconds;
const check = (ok) => (ok ? 'OK  ' : 'FAIL');
let failed = false;

console.log(`\nprops: ${propsPath.replace(root + '/', '')}`);
console.log(`${scenes.length} scenes over ${total.toFixed(1)}s\n`);

for (const intensity of intensities) {
	const shots = planMontage(scenes, {
		intensity,
		seed: props.projectTitle || 'house-of-videos',
		blackPunctuation: !props.showChapterCards,
	});
	const st = montageStats(shots);
	const cuts = auditCuts(shots);
	const weak = cuts.filter((c) => c.belowThreshold);

	console.log(`--- intensity ${intensity} -> ${st.count} shots, ${cuts.length} cuts ---`);
	console.log(`  cuts/min      ${((cuts.length / total) * 60).toFixed(1)}   (references 4.7-31.5, our baseline 2.6)`);
	console.log(`  variability   ${st.variability.toFixed(2)}   target ${targets.variability}   ${check(st.variability >= 0.6)}`);
	console.log(`  shortest      ${st.shortestSeconds.toFixed(2)}s  target ${targets.shortestShotSeconds}  ${check(st.shortestSeconds <= 1.5)}`);
	console.log(`  longest       ${st.longestSeconds.toFixed(2)}s  target ${targets.longestShotSeconds}  ${check(st.longestSeconds >= 10)}`);
	console.log(`  weak cuts     ${weak.length}/${cuts.length} below the ${MIN_SCALE_STEP} scale step   ${check(weak.length === 0)}`);

	if (st.variability < 0.6 || st.shortestSeconds > 1.5 || st.longestSeconds < 10 || weak.length) {
		failed = true;
	}
	for (const c of weak) {
		console.log(`    ${String(c.atSeconds).padStart(7)}s  ${c.from} -> ${c.to}  jump ${c.scaleJump}`);
	}

	// The shot list itself, so a suspicious rhythm can be read at a glance.
	console.log(
		'  shots: ' +
			shots
				.map((s) => `${s.kind[0]}${s.durationSeconds.toFixed(1)}`)
				.join(' '),
	);
	console.log();
}

// The one target this cannot check is cutsWithAudioAccentPct (>= 40): it needs
// the rendered file and the SFX pass, which lives on the render server.
console.log(`not checked here: cutsWithAudioAccentPct ${targets.cutsWithAudioAccentPct} (needs a rendered file)\n`);
process.exit(failed ? 1 : 0);
