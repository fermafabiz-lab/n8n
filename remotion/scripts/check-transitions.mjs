// Pins the film transitions (src/transitions/) and the server's stills
// (server/cut-stills.mjs):
//   - every variant opens with the incoming picture hidden and closes with
//     the outgoing one gone and the incoming one untouched — the glitch once
//     laid its incoming still, opaque, over the whole jolt, and nothing but a
//     render showed it;
//   - the planner is sparse (MIN_GAP), keeps out of the cold open, off owned
//     cuts and off cuts with no stills, and alternates a family's variants;
//   - the server extracts stills for exactly the cuts the planner may use.
//
//   npm run check:transitions

import {build} from 'esbuild';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {fileURLToPath, pathToFileURL} from 'url';
import {candidateCuts} from '../server/cut-stills.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hov-check-transitions-'));
const load = async (file) => {
	const out = path.join(tmp, path.basename(file).replace(/\.ts$/, '.mjs'));
	await build({entryPoints: [path.join(__dirname, '..', 'src', 'transitions', file)], outfile: out, bundle: true, format: 'esm', platform: 'node', logLevel: 'error'});
	return import(pathToFileURL(out).href);
};
const F = await load('families.ts');
const P = await load('plan.ts');

let failed = 0, passed = 0;
const ok = (label, cond, detail) => {
	if (cond) { passed++; console.log('  ok   ' + label); }
	else { failed++; console.log('  FAIL ' + label + (detail ? ' — ' + detail : '')); }
};

const W = 720, H = 1280;
const hidden = (l) => (l.opacity ?? 1) <= 0.001 || Math.abs(l.x ?? 0) >= W - 0.5 || Math.abs(l.y ?? 0) >= H - 0.5;
const identity = (l) => (l.opacity ?? 1) >= 0.999 && Math.abs(l.x ?? 0) < 0.5 && Math.abs(l.y ?? 0) < 0.5 && Math.abs((l.scale ?? 1) - 1) < 0.002 && (l.blur ?? 0) < 0.1 && Math.abs(l.skewX ?? 0) < 0.05;

console.log('Variants');
for (const [id, v] of Object.entries(F.VARIANT)) {
	ok(`${id}: the cut is inside its window`, v.cutAt > 0 && v.cutAt < v.length);
	const start = v.frame(0, W, H), end = v.frame(v.length, W, H);
	if (v.stills) {
		ok(`${id}: opens with the incoming picture hidden`, hidden(start.in), JSON.stringify(start.in));
		ok(`${id}: closes with the outgoing picture gone`, hidden(end.out), JSON.stringify(end.out));
		ok(`${id}: closes on the incoming picture untouched`, identity(end.in), JSON.stringify(end.in));
		// Just after the cut the live footage is the incoming shot: it must be
		// on screen at all, or the frame goes black.
		const after = v.frame(v.cutAt + 1 / 24, W, H);
		ok(`${id}: the outgoing still is not the only picture after the cut`, (after.in.opacity ?? 1) > 0 || !hidden(after.out));
	} else {
		ok(`${id}: open at both ends`, (start.shutter ?? 0) === 0 && (end.shutter ?? 0) < 0.001);
		ok(`${id}: shut at the cut`, v.frame(v.cutAt, W, H).shutter === 1);
	}
}
ok('every family names only real variants', Object.values(F.VARIANTS).flat().every((v) => v in F.VARIANT));
ok('unknown style → none', F.transitionStyleFor('wipe') === 'none' && F.transitionStyleFor(undefined) === 'none' && F.transitionStyleFor('push') === 'push');

console.log('Planner');
const scenes = [
	[0, 1.71, 0], [1.71, 1.92, 0], [3.62, 1.96, 0], [5.58, 2.5, 0], [8.08, 4.33, 1], [12.42, 9.75, 1],
	[22.17, 12.54, 1], [34.71, 10.96, 1], [45.67, 8.71, 1], [54.38, 4.04, 2], [58.42, 11.75, 2],
].map(([startSeconds, durationSeconds, chapter]) => ({startSeconds, durationSeconds, chapter, text: '', words: []}));
const all = candidateCuts(scenes);
ok('server stills: the story cuts only, never the teaser', JSON.stringify(all) === JSON.stringify([5, 6, 7, 8, 9, 10]), JSON.stringify(all));
const plan = P.planTransitions({style: 'push', scenes, blocked: [], stills: all});
ok('none without stills', P.planTransitions({style: 'push', scenes, blocked: [], stills: null}).length === 0);
ok('none for style none', P.planTransitions({style: 'none', scenes, blocked: [], stills: all}).length === 0);
ok('the chapter change comes first', plan.some((p) => p.cut === 9), JSON.stringify(plan));
ok(`at least ${P.MIN_GAP_SECONDS}s apart`, plan.every((p, i) => i === 0 || p.at - plan[i - 1].at >= P.MIN_GAP_SECONDS));
ok('nothing in the cold open or on its last cut', plan.every((p) => (scenes[p.cut - 1].chapter ?? 0) >= 1));
ok('a family alternates its variants', plan.length >= 2 && plan[0].variant === 'pushLeft' && plan[1].variant === 'pushUp', JSON.stringify(plan.map((p) => p.variant)));
ok('the window is placed so the picture cuts where the block swaps', plan.every((p) => Math.abs(p.at - p.from - F.VARIANT[p.variant].cutAt) < 1e-9));
const blocked = P.planTransitions({style: 'crossfade', scenes, blocked: [{from: 54, to: 55}], stills: all});
ok('an owned cut is left alone', !blocked.some((p) => p.cut === 9), JSON.stringify(blocked));
const partial = P.planTransitions({style: 'blur', scenes, blocked: [], stills: [7]});
ok('only cuts with stills', partial.length === 1 && partial[0].cut === 7);

fs.rmSync(tmp, {recursive: true, force: true});
console.log(failed ? `\n${failed} FAILED` : `\nall transition checks passed (${passed})`);
process.exit(failed ? 1 : 0);
