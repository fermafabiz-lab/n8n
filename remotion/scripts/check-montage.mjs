// Check the montage planner: every cut must land where the picture changes.
//
// This script used to assert the OPPOSITE thing, and the story is the reason
// it now asserts this one. It compared our cut count and shot-length spread
// against remotion/reference/editing-benchmarks.json and passed the planner as
// soon as the numbers matched. They matched because the planner had learned to
// jump the zoom on a single unbroken clip several times per scene — which the
// scene-change detector behind those benchmarks counts as a cut and a viewer
// reads as a glitch. Every target was green while the edit was visibly broken.
//
// So the count targets are gone. What is asserted instead cannot be gamed by
// re-framing: a cut is only allowed at a second where the footage itself
// changes, and it must clear the scale step so the change is visible. The
// rhythm statistics are still printed, as information — they describe the
// script's pacing, which the planner does not control and must not fake.
//
//   node scripts/check-montage.mjs [props.json] [--intensity 1]
//
// Reads scenes from a Final Assembly props fixture (default the Studio one), so
// it always measures against real scene timings rather than invented ones.
import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const {planMontage, montageStats, auditCuts, pictureChanges, framingOverscan, MIN_SCALE_STEP} =
	await import(join(root, 'src', 'montage.ts'));
// Cards are derived exactly as FinalVideo derives them, so the report measures
// the edit that will actually render rather than a framing-only skeleton.
const {buildTextCards, toMontageCards} = await import(join(root, 'src', 'textCards.ts'));

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
const total = scenes.at(-1).startSeconds + scenes.at(-1).durationSeconds;
const check = (ok) => (ok ? 'OK  ' : 'FAIL');
let failed = false;

console.log(`\nprops: ${propsPath.replace(root + '/', '')}`);
console.log(`${scenes.length} scenes over ${total.toFixed(1)}s`);

const cards = buildTextCards({
	scenes,
	evidence: props.evidence,
	explicit: props.textCards,
	chapterCardsOn: props.showChapterCards !== false,
	hookSeconds: props.showHookTitle === false ? 0 : (props.hookTitleDurationInSeconds ?? 3.5),
});
console.log(
	cards.length
		? `${cards.length} text card(s): ` +
				cards.map((c) => `${c.variant}@scene${c.sceneIndex} "${c.headline}"`).join(', ')
		: 'no text cards derived (no evidence rows, no figures in the narration)',
);
console.log();

for (const intensity of intensities) {
	const shots = planMontage(scenes, {
		intensity,
		seed: props.projectTitle || 'house-of-videos',
		blackPunctuation: !props.showChapterCards,
		cards: toMontageCards(cards),
	});
	const st = montageStats(shots);
	const cuts = auditCuts(shots);
	const weak = cuts.filter((c) => c.belowThreshold);

	// THE assertion: no cut may sit anywhere but a change of PICTURE — a scene
	// boundary, or a card's in/out, where the frame is replaced outright. Derived
	// per plan rather than once up front, because where the cards landed is a
	// property of the plan.
	const changes = pictureChanges(scenes, shots);
	const isPictureChange = (t) => changes.some((c) => Math.abs(c - t) < 0.75);
	const invented = cuts.filter((c) => !isPictureChange(c.atSeconds));

	console.log(`--- intensity ${intensity} -> ${st.count} shots, ${cuts.length} cuts ---`);
	console.log(`  cuts on a real picture change   ${cuts.length - invented.length}/${cuts.length}   ${check(invented.length === 0)}`);
	console.log(`  weak cuts     ${weak.length}/${cuts.length} below the ${MIN_SCALE_STEP} scale step   ${check(weak.length === 0)}`);
	console.log(`  rhythm (informational — set by the script, not the planner):`);
	console.log(`    cuts/min ${((cuts.length / total) * 60).toFixed(1)}   variability ${st.variability.toFixed(2)}   shortest ${st.shortestSeconds.toFixed(2)}s   longest ${st.longestSeconds.toFixed(2)}s`);

	if (invented.length || weak.length) failed = true;
	for (const c of invented) {
		console.log(`    INVENTED CUT ${String(c.atSeconds).padStart(7)}s  ${c.from} -> ${c.to}  (no footage change here)`);
	}
	for (const c of weak) {
		console.log(`    ${String(c.atSeconds).padStart(7)}s  ${c.from} -> ${c.to}  jump ${c.scaleJump}`);
	}

	// The shot list itself, so a suspicious rhythm can be read at a glance.
	// Upper case marks a shot that is NOT footage — a card or a black — so it
	// cannot be mistaken for a framing ('c' would mean both close and card).
	console.log(
		'  shots: ' +
			shots
				.map((s) => {
					const notFootage = s.kind === 'card' || s.kind === 'black';
					const tag = notFootage ? s.kind[0].toUpperCase() : s.kind[0];
					return `${tag}${s.durationSeconds.toFixed(1)}`;
				})
				.join(' '),
	);
	console.log();
}

// A card is a CUTAWAY, and a cutaway returns to the shot it left. The planner
// used to cross the framing across a card on the reasoning that the two
// footage shots never touch on screen — but they are the same clip two or
// three seconds apart, and the eye holds a picture that long. Reported from a
// finished film as a zoom jump at the card, which is the same defect this
// whole checker exists to catch, arriving through the one door left open.
//
// Probed with a synthetic card rather than a derived one, so the assertion
// runs on every fixture including the ones that happen to have no cards.
for (const intensity of intensities) {
	const probe = planMontage(scenes, {
		intensity,
		seed: props.projectTitle ?? 'house-of-videos',
		cards: [{sceneIndex: Math.min(1, scenes.length - 1), seconds: 2.6, minSeconds: 2.4}],
	});
	const ci = probe.findIndex((sh) => sh.kind === 'card');
	if (ci <= 0 || ci + 1 >= probe.length) {
		console.log(`cutaway resume (i${intensity})   no card placed in this fixture — not checked`);
		continue;
	}
	const head = probe[ci - 1];
	const tail = probe[ci + 1];
	// Where the head actually left the frame, which is what the card covered.
	const at = {
		scale: head.scale + head.push,
		x: head.offsetXPct + head.driftX,
		y: head.offsetYPct + head.driftY,
	};
	const near = (a, b) => Math.abs(a - b) < 1e-6;
	const resumed = near(tail.scale, at.scale) && near(tail.offsetXPct, at.x) && near(tail.offsetYPct, at.y);
	console.log(`cutaway resume (i${intensity})   the frame the card uncovers is the frame it covered   ${check(resumed)}`);
	if (!resumed) {
		failed = true;
		console.log(
			`    covered  scale ${at.scale.toFixed(4)} at ${at.x.toFixed(2)}%, ${at.y.toFixed(2)}%\n` +
				`    uncovered scale ${tail.scale.toFixed(4)} at ${tail.offsetXPct.toFixed(2)}%, ${tail.offsetYPct.toFixed(2)}%`,
		);
	}
}
console.log();

// Independent of any props: a framing whose offsets outrun its overscan drags
// the picture off its own edge and shows a black band.
const overscan = framingOverscan();
const torn = overscan.filter((f) => f.short > 0);
console.log(`framing overscan   ${overscan.length - torn.length}/${overscan.length} cover their own offsets   ${check(torn.length === 0)}`);
for (const f of torn) {
	console.log(`    ${f.kind} scale ${f.scale} needs ${f.needs} — short by ${f.short}, edge can show`);
}
if (torn.length) failed = true;
console.log();

console.log(
	`${pictureChanges(scenes).length} real picture changes available in this footage — one per scene.\n` +
		`Cutting more often than that needs more footage, not a bolder planner:\n` +
		`the Faza 2 plan in README.md, where Remotion receives the scene clips\n` +
		`separately and can cut between them.\n`,
);
process.exit(failed ? 1 : 0);
