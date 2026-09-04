// The `A` key's whole behaviour, checked without a browser.
//
// Approving advances to the next scene that still owes a decision, and the
// rule has two edges that are easy to break by accident and invisible when
// broken: it must never re-select the scene just approved (which would make
// the key look dead), and running out must END the pass rather than loop on
// the last scene. Both live in one pure function so they can be checked here
// instead of by clicking through a 71-scene film.
//
//   node --experimental-strip-types scripts/check-review.mjs
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const {pickNextOwing} = await import(join(root, 'components', 'useReviewKeys.ts'));

const S = (id, owed) => ({id, owed});
const owes = (s) => s.owed;
const results = [];
const check = (name, got, want) => {
	const ok = (got?.id ?? null) === want;
	results.push(ok);
	console.log(`${ok ? 'OK  ' : 'FAIL'} ${name} -> ${got?.id ?? 'null'} (want ${want})`);
};

const film = [S('s1', false), S('s2', true), S('s3', false), S('s4', true), S('s5', true)];
check('advances to the next scene that owes one', pickNextOwing(film, 0, owes), 's2');
check('skips scenes that owe nothing', pickNextOwing(film, 1, owes), 's4');
check('walks the film in order', pickNextOwing(film, 3, owes), 's5');

const wrap = [S('a', true), S('b', false), S('c', true)];
check('wraps to what it skipped earlier', pickNextOwing(wrap, 2, owes), 'a');
check('never re-selects the scene just approved', pickNextOwing([S('only', true)], 0, owes), null);

check('nothing left ends the pass', pickNextOwing([S('x', false), S('y', false)], 0, owes), null);
check('index outside the list', pickNextOwing(film, 99, owes), null);
check('empty list', pickNextOwing([], 0, owes), null);

console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
