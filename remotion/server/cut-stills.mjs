// The two frozen frames either side of every cut a transition could land on
// (src/transitions/): the last frame of the outgoing shot and the first of
// the incoming one, as JPEGs next to the page. A transition needs both
// pictures at once, and the montage is one video that can only show one.
//
// Only cuts inside the story (chapter >= 1 on both sides, both scenes at
// least two seconds) — the same pre-filter src/transitions/plan.ts applies —
// so a long film asks for a few dozen frames, not two hundred. The page picks
// which of them it actually uses.
//
// One ffmpeg pass: `select` by frame number over the whole montage. The
// montage is encoded on the composition's 24 fps grid and /assemble snaps
// every scene start to it, so the picture changes on frame round(start * 24)
// — the same rule FinalVideo's framing lead is built on.

import fs from 'fs';
import path from 'path';
import {execFile} from 'child_process';

const STYLES = ['push', 'crossfade', 'blur', 'shutter', 'glitch'];
const MIN_SCENE_SECONDS = 2;

const run = (args) =>
	new Promise((resolve, reject) =>
		execFile('ffmpeg', args, {maxBuffer: 16 * 1024 * 1024}, (err, _out, stderr) =>
			err ? reject(new Error(`ffmpeg failed: ${String(stderr).slice(-1500)}`)) : resolve(),
		),
	);

/** The cut indices worth a still, by the planner's own cheap rules. */
export function candidateCuts(scenes) {
	const out = [];
	for (let i = 1; i < scenes.length; i++) {
		const a = scenes[i - 1];
		const b = scenes[i];
		if ((a.chapter ?? 0) < 1 || (b.chapter ?? 0) < 1) continue;
		if (a.durationSeconds < MIN_SCENE_SECONDS || b.durationSeconds < MIN_SCENE_SECONDS) continue;
		out.push(i);
	}
	return out;
}

/**
 * Write `cuts/c<i>-out.jpg` and `cuts/c<i>-in.jpg` into `jobDir` and return
 * the prop the page reads, or null when the film has no transitions. Never
 * throws: a film whose stills failed renders with hard cuts, as before.
 */
export async function extractCutStills({props, montage, jobDir, fps}) {
	if (!STYLES.includes(props.transitionStyle)) return null;
	const scenes = Array.isArray(props.scenes) ? props.scenes : [];
	const cuts = candidateCuts(scenes);
	if (!cuts.length) return null;
	const dir = path.join(jobDir, 'cuts');
	try {
		fs.mkdirSync(dir, {recursive: true});
		const wanted = new Map(); // frame number → file names
		for (const i of cuts) {
			const n = Math.round(scenes[i].startSeconds * fps);
			if (n < 1) continue;
			for (const [frame, name] of [[n - 1, `c${i}-out.jpg`], [n, `c${i}-in.jpg`]]) {
				wanted.set(frame, [...(wanted.get(frame) ?? []), name]);
			}
		}
		const frames = [...wanted.keys()].sort((a, b) => a - b);
		const expr = frames.map((f) => `eq(n\\,${f})`).join('+');
		await run([
			'-y', '-loglevel', 'error', '-i', montage,
			'-vf', `select=${expr}`, '-fps_mode', 'passthrough', '-q:v', '3',
			path.join(dir, 'f%05d.jpg'),
		]);
		// Written in frame order, one file per selected frame.
		frames.forEach((frame, k) => {
			const src = path.join(dir, `f${String(k + 1).padStart(5, '0')}.jpg`);
			if (!fs.existsSync(src)) return;
			for (const name of wanted.get(frame)) fs.copyFileSync(src, path.join(dir, name));
			fs.rmSync(src);
		});
		const have = cuts.filter((i) => fs.existsSync(path.join(dir, `c${i}-out.jpg`)) && fs.existsSync(path.join(dir, `c${i}-in.jpg`)));
		return have.length ? {base: 'cuts/', cuts: have} : null;
	} catch (err) {
		console.warn(`cut stills: ${err.message} — rendering with hard cuts`);
		return null;
	}
}
