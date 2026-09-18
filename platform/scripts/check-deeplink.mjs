// A notification has to LAND somewhere, and this pins the two joints where
// that quietly stops being true.
//
// Clicking a chime used to do nothing at all; it now carries a destination
// built by lib/deep-link.ts. The failure that replaces "nothing happens" is
// worse, because it looks like success: a gate name with no entry in
// GATE_STEP, or an entry naming a step the page does not serve, still
// produces a link, still navigates, and still lands on a page that selects
// nothing. Nobody would read that as a bug in a map.
//
// So: every gate name the two pages can produce must be a key here, and
// every step the map names must be a step the page can show. Both halves are
// read out of the real sources rather than restated, because a copy of the
// vocabulary is the thing being guarded against.
//
//   node --experimental-strip-types --no-warnings scripts/check-deeplink.mjs
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readFileSync} from 'node:fs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const D = await import(join(root, 'lib', 'deep-link.ts'));
const {GATE_STEP, STAGE_KEYS, matchesScene, projectHref, withScene} = D;

const results = [];
const check = (name, got, want) => {
	const ok = JSON.stringify(got) === JSON.stringify(want);
	results.push(ok);
	console.log(`${ok ? 'OK  ' : 'FAIL'} ${name} -> ${JSON.stringify(got)} (want ${JSON.stringify(want)})`);
};

/**
 * The gate names a page can hand the chime.
 *
 * Both pages compute them the same way — one `const stage =` ternary whose
 * arms are string literals — so the literals in that expression ARE the
 * vocabulary. Reading them out of the file is the only version of this test
 * that keeps working when somebody adds an eighth gate.
 */
function gatesIn(file) {
	const src = readFileSync(join(root, file), 'utf8');
	const at = src.indexOf('const stage =');
	if (at === -1) throw new Error(`no "const stage =" in ${file}`);
	const end = src.indexOf(';', at);
	// `statusKind === "err" ? "error" : …` — the compared literal is not a
	// gate name, so the comparisons come out before the arms are read.
	const arms = src.slice(at, end).replace(/===\s*"[^"]*"/g, '');
	return [...arms.matchAll(/"([a-z-]+)"/g)].map((m) => m[1]);
}

const projectGates = gatesIn('app/projects/[id]/page.tsx');
const listGates = gatesIn('app/projects/page.tsx');

check('the project page names its gates', projectGates.length > 0, true);
check('the library names its buckets', listGates.length > 0, true);
check(
	'every gate the project page can produce has a destination',
	projectGates.filter((g) => !(g in GATE_STEP)),
	[],
);
check(
	'every bucket the library can produce has a destination',
	listGates.filter((g) => !(g in GATE_STEP)),
	[],
);
check(
	'every step the map names is a step the page can show',
	Object.entries(GATE_STEP).filter(([, v]) => v !== null && !STAGE_KEYS.includes(v)).map(([k]) => k),
	[],
);

// --- the URLs themselves --------------------------------------------------

check('a bare project link has no query at all', projectHref('rec1'), '/projects/rec1');
check('a null step means the bare page — the live step', projectHref('rec1', null), '/projects/rec1');
check('a step becomes ?stage=', projectHref('rec1', 'images'), '/projects/rec1?stage=images');
check(
	'a step and a scene ride together',
	projectHref('rec1', 'images', 'S10'),
	'/projects/rec1?stage=images&scene=S10',
);
check('withScene joins an existing query', withScene('/projects/rec1?stage=audio', 'S7'), '/projects/rec1?stage=audio&scene=S7');
check('withScene starts one when there is none', withScene('/projects/rec1', 'S7'), '/projects/rec1?scene=S7');
check('withScene is a no-op without a scene', withScene('/projects/rec1?stage=video', null), '/projects/rec1?stage=video');
// An item with no destination must stay unclickable. "?scene=S3" is truthy,
// so it would survive a `|| undefined` fallback and then navigate to the
// current path — the one failure here that looks like it worked.
check('a scene with nowhere to go builds no link', withScene('', 'S3'), '');
check('and the caller can still test it', Boolean(withScene('', 'S3')), false);

// --- reading one back -----------------------------------------------------

const url = new URL(`https://x${projectHref('rec1', 'images', 'S10')}`);
check('the scene survives the round trip', url.searchParams.get('scene'), 'S10');
check('and so does the step', url.searchParams.get('stage'), 'images');
check(
	'a label with a space is escaped, not lost',
	new URL(`https://x${projectHref('rec1', 'images', 'S 10')}`).searchParams.get('scene'),
	'S 10',
);

// --- matching it to a scene ----------------------------------------------

const scene = {id: 'recABC', label: 'S10'};
check('a link built from the label matches', matchesScene(scene, 'S10'), true);
check('case does not decide it', matchesScene(scene, 's10'), true);
check('an id still matches, so older links keep working', matchesScene(scene, 'recABC'), true);
check('S1 does not answer for S10', matchesScene({id: 'x', label: 'S1'}, 'S10'), false);

console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
