// Render one film with both engines and say where they differ.
//
//   node scripts/compare-engines.mjs --props trigger/studio-props.json \
//        --montage film.mp4 --out /tmp/cmp [--scale 1.5] [--every 24]
//
// Writes remotion.mp4 and hyperframes.mp4 into --out, then for every Nth
// frame reports the mean absolute RGB difference, the worst frames first,
// and a side-by-side sheet of the five worst (`worst.png`: Hyperframes on
// top, Remotion below).
//
// Two traps this avoids, both of which produced false alarms while the
// engines were first compared (2026-09-24):
//
// 1. RANGE. Remotion writes full-range yuvj420p tagged bt470bg; Hyperframes
//    writes limited-range yuv420p tagged bt709. Stacking or blending the two
//    inside ONE ffmpeg filter graph converts them to a common format and
//    misreads one of the ranges, which shows as a contrast difference that is
//    not in either film. So every frame is decoded to PNG from its own file
//    first, and only PNGs are compared.
//
// 2. WHAT "SAME" MEANS. The two are not bit-identical and should not be:
//    Remotion captures frames as JPEG and desaturates strong colours (the
//    subscribe button's #E62117 comes out 211,39,27; Hyperframes gives
//    230,35,21). A uniform difference of a few levels is that, not a bug.
//    Look at the worst frames: a card in the wrong place, a caption on the
//    wrong frame or a missing overlay shows up as a spike far above the rest.

import {execFileSync} from 'child_process';
import fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(
	process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const out = path.resolve(args.out || 'compare-out');
const every = Number(args.every || 24);
fs.mkdirSync(out, {recursive: true});

const render = (engine) => {
	const file = path.join(out, `${engine}.mp4`);
	execFileSync(
		'node',
		[
			path.join(__dirname, 'render-local.mjs'),
			'--engine', engine,
			'--props', args.props,
			'--montage', args.montage,
			'--out', file,
			'--scale', String(args.scale || 1),
			...(engine === 'remotion' ? ['--concurrency', String(args.concurrency || 4)] : []),
		],
		{stdio: ['ignore', 'inherit', 'inherit']},
	);
	return file;
};

const ff = (a) => execFileSync('ffmpeg', ['-loglevel', 'error', '-y', ...a]);
const frames = (file) =>
	parseInt(
		execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v', '-count_packets', '-show_entries', 'stream=nb_read_packets', '-of', 'csv=p=0', file])
			.toString()
			.trim(),
		10,
	);

const hf = args['skip-render'] ? path.join(out, 'hyperframes.mp4') : render('hyperframes');
const rm = args['skip-render'] ? path.join(out, 'remotion.mp4') : render('remotion');

const nHf = frames(hf);
const nRm = frames(rm);
console.log(`frames: hyperframes ${nHf}, remotion ${nRm}${nHf === nRm ? '' : '   ← LENGTHS DIFFER'}`);

const dir = (engine) => path.join(out, `png-${engine}`);
for (const [engine, file] of [['hyperframes', hf], ['remotion', rm]]) {
	fs.rmSync(dir(engine), {recursive: true, force: true});
	fs.mkdirSync(dir(engine));
	ff(['-i', file, '-vf', `select=not(mod(n\\,${every})),format=rgb24`, '-fps_mode', 'passthrough', path.join(dir(engine), '%05d.png')]);
}

const scores = [];
const pngs = fs.readdirSync(dir('hyperframes')).sort();
for (const [i, name] of pngs.entries()) {
	const a = path.join(dir('hyperframes'), name);
	const b = path.join(dir('remotion'), name);
	if (!fs.existsSync(b)) break;
	const stats = execFileSync(
		'ffmpeg',
		['-loglevel', 'error', '-i', a, '-i', b, '-lavfi', '[0][1]blend=all_mode=difference,format=gray,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-', '-f', 'null', '-'],
	).toString();
	const m = /YAVG=([\d.]+)/.exec(stats);
	scores.push({frame: i * every, diff: m ? Number(m[1]) : NaN, a, b});
}

const sorted = [...scores].sort((x, y) => y.diff - x.diff);
const mean = scores.reduce((s, x) => s + x.diff, 0) / scores.length;
console.log(`checked ${scores.length} frames (every ${every}); mean |Δ| ${mean.toFixed(2)} / 255`);
console.log('worst:', sorted.slice(0, 10).map((s) => `${s.frame}:${s.diff.toFixed(2)}`).join('  '));

const worst = sorted.slice(0, 5);
const inputs = worst.flatMap((s) => ['-i', s.a, '-i', s.b]);
const pairs = worst.map((_, i) => `[${2 * i}]scale=480:-2[a${i}];[${2 * i + 1}]scale=480:-2[b${i}];[a${i}][b${i}]vstack[p${i}]`).join(';');
ff([...inputs, '-filter_complex', `${pairs};${worst.map((_, i) => `[p${i}]`).join('')}hstack=${worst.length}`, path.join(out, 'worst.png')]);
console.log(`side by side (Hyperframes above, Remotion below): ${path.join(out, 'worst.png')}`);
