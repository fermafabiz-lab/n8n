// Pins the Hyperframes shim (src/hf/remotion-shim.tsx) to Remotion's own
// behaviour, while Remotion is still installed to measure against.
//
//   interpolate, Easing.bezier, spring — every call shape FinalVideo uses,
//     sampled densely, against the real package;
//   filmMetadata (src/metadata.ts) against server/render-hf.mjs's copy of it,
//     on every props fixture in the repo — the page and the HTML around it
//     must agree on the film's length to the frame, or the end screen is cut;
//   the page bundle builds, and fails on an unknown @remotion/* import.
//
// No Chrome, no ffmpeg, no network. `npm run check:shim`.

import {build} from 'esbuild';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {fileURLToPath, pathToFileURL} from 'url';
import * as real from 'remotion';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

let failures = 0;
let checks = 0;
const ok = (cond, what) => {
	checks++;
	if (!cond) {
		failures++;
		console.log(`FAIL ${what}`);
	}
};
const close = (a, b, eps) => Math.abs(a - b) <= eps;

// The shim is TSX; bundle it (React included) to a module we can import.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hov-check-shim-'));
const load = async (entry) => {
	const out = path.join(tmp, path.basename(entry).replace(/\.tsx?$/, '.mjs'));
	await build({
		entryPoints: [entry],
		outfile: out,
		bundle: true,
		platform: 'node',
		format: 'esm',
		jsx: 'automatic',
		logLevel: 'error',
	});
	return import(pathToFileURL(out).href);
};

const shim = await load(path.join(ROOT, 'src', 'hf', 'remotion-shim.tsx'));
const meta = await load(path.join(ROOT, 'src', 'metadata.ts'));

// ── interpolate ────────────────────────────────────────────────────────────
const inputs = [];
for (let x = -2; x <= 3; x += 0.01) inputs.push(Number(x.toFixed(4)));
const ranges = [
	[[0, 1], [0, 1]],
	[[0, 1], [10, 42]],
	[[0.2, 0.8], [1, 0]],
	[[0, 9.6], [0, 1]],
	[[0, 0.5, 2], [0, 1, 0.25]],
];
const extrapolations = [undefined, 'clamp', 'extend', 'identity'];
for (const [inR, outR] of ranges) {
	for (const left of extrapolations) {
		for (const right of extrapolations) {
			const opts = {extrapolateLeft: left, extrapolateRight: right};
			for (const easing of [undefined, real.Easing.bezier(0.16, 1, 0.3, 1)]) {
				let worst = 0;
				for (const x of inputs) {
					const a = shim.interpolate(x, inR, outR, {...opts, easing: easing && shim.Easing.bezier(0.16, 1, 0.3, 1)});
					const b = real.interpolate(x, inR, outR, {...opts, easing});
					worst = Math.max(worst, Math.abs(a - b));
				}
				ok(worst < 1e-5, `interpolate ${JSON.stringify(inR)}→${JSON.stringify(outR)} ${left}/${right}${easing ? ' eased' : ''}: off by ${worst}`);
			}
		}
	}
}

// ── Easing.bezier: the three curves of src/easing.ts ───────────────────────
for (const args of [
	[0.16, 1, 0.3, 1],
	[0.25, 1, 0.5, 1],
	[0.65, 0, 0.35, 1],
]) {
	const a = shim.Easing.bezier(...args);
	const b = real.Easing.bezier(...args);
	let worst = 0;
	for (let i = 0; i <= 1000; i++) worst = Math.max(worst, Math.abs(a(i / 1000) - b(i / 1000)));
	ok(worst < 1e-5, `Easing.bezier(${args}): off by ${worst}`);
	ok(a(0) === 0 && a(1) === 1, `Easing.bezier(${args}) must land exactly on 0 and 1`);
}

// ── spring: OutroCard's and IntroCard's configs, at 24 fps ─────────────────
for (const config of [{damping: 14, stiffness: 160}, {damping: 200, stiffness: 120}, {}]) {
	let worst = 0;
	for (let frame = -10; frame <= 200; frame += 0.5) {
		const a = shim.spring({frame, fps: 24, config});
		const b = real.spring({frame, fps: 24, config});
		worst = Math.max(worst, Math.abs(a - b));
	}
	ok(worst < 1e-9, `spring ${JSON.stringify(config)}: off by ${worst}`);
}

// ── film metadata: src/metadata.ts vs server/render-hf.mjs ─────────────────
const {metadataForTest} = await import('../server/render-hf.mjs');
const {defaultFinalVideoProps} = await load(path.join(ROOT, 'src', 'types.ts'));
const fixtures = ['trigger/studio-props.json', 'trigger/example-props.json', 'motif/boyd-props.json'];
for (const f of fixtures) {
	const raw = JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
	for (const variant of [{}, {showEndScreen: false}, {aspectRatio: '9:16'}, {introDurationInSeconds: 1.5}]) {
		const props = {...defaultFinalVideoProps, ...raw, ...variant};
		const page = meta.filmMetadata(props);
		const html = metadataForTest(props);
		ok(
			JSON.stringify(page) === JSON.stringify(html),
			`${f} ${JSON.stringify(variant)}: page ${JSON.stringify(page)} vs server ${JSON.stringify(html)}`,
		);
	}
}

// ── the page bundle ────────────────────────────────────────────────────────
const {bundleHfPage} = await import('../server/hf-bundle.mjs');
const outdir = path.join(tmp, 'page');
try {
	await bundleHfPage(outdir);
	ok(fs.existsSync(path.join(outdir, 'app.js')) && fs.existsSync(path.join(outdir, 'app.css')), 'page bundle wrote app.js + app.css');
	const css = fs.readFileSync(path.join(outdir, 'app.css'), 'utf8');
	for (const family of ['Outfit', 'Bodoni Moda', 'Inter Tight', 'IBM Plex Mono', 'Poppins']) {
		ok(css.includes(`font-family:${family}`) || css.includes(`font-family: ${family}`) || css.includes(`'${family}'`), `page bundle carries ${family}`);
	}
	ok(/U\+0218-021B|U\+0100-02BA/i.test(css), 'page bundle carries latin-ext (ș ț)');
} catch (err) {
	ok(false, `page bundle: ${err.message}`);
}

fs.rmSync(tmp, {recursive: true, force: true});
console.log(`${checks - failures}/${checks} shim checks passed`);
if (failures) process.exit(1);
