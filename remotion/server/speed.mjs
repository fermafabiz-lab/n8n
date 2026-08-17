// Playback speed for the finished film — the thing the creation form's PACE
// control has always promised and never did.
//
// PACE (Slow / Normal / Fast) used to reach exactly two places: a bare
// `Pace: Slow` line interpolated into the Generate Outline and Write Chapter
// Narration prompts in Claude Scripting. A hint to a model with no rule
// attached, and nothing anywhere else read the field — which is why the
// producer's report was simply "it doesn't change anything". It didn't.
//
// WHY THIS RUNS LAST, ON THE ALREADY-RENDERED FILM.
//
// The obvious place looks like the elastic retime in assemble.mjs: every scene
// lasts as long as its own narration (`eff = voiceDur + 0.35`) and the clip is
// time-stretched to fill it. Slowing the narration would therefore stretch the
// picture too, for free. It is the wrong place, for three reasons:
//
//   1. That stretch is CLAMPED to [0.65, 1.5], and past the top the remainder
//      becomes a frozen tail. A scene already sitting near 1.5 would answer a
//      10% slower narration with a freeze-frame, so "slow" would mean "slower
//      in some scenes and stuttering in others" — not a speed.
//   2. It is not a uniform speed change. Only the picture moves; the pauses
//      between takes, the music bed and every graphic keep their old timing.
//   3. Scene start times computed there flow on to the graphics pass, so the
//      captions, chapter cards and end screen would all have to be rescaled in
//      lockstep. Three places to keep in agreement instead of one.
//
// Applied to the finished file, the same 10% lands on the picture, the
// narration, the music and every baked-in graphic at once — nothing can drift
// out of sync with anything else, because there is only one stream of each
// left. `atempo` resamples the audio WITHOUT shifting pitch, so a slowed
// narrator sounds like a slower narrator rather than a deeper one.
//
// The cost is one extra encode. It is small next to what precedes it: the
// Remotion pass runs at roughly 2 fps on this box (headless Chrome on software
// GL, concurrency 1), so a film that took ~12 minutes to draw pays seconds per
// minute of footage here. At speed 1 nothing runs at all — no re-encode, no
// second generation of compression on the normal path.
import fs from 'fs';
import {execFile} from 'child_process';

/** Slow / Normal / Fast, as the form's three PACE values mean them. */
export const SPEED_BY_PACE = {slow: 0.9, normal: 1, fast: 1.1};

// Bounds, not preferences. atempo itself accepts [0.5, 100], but past roughly
// half or double speed a narration-driven film stops being the film that was
// approved — and a runaway value arriving from a webhook should be refused
// here rather than turned into a 40-minute encode.
const SPEED_MIN = 0.5;
const SPEED_MAX = 2;

/**
 * Coerce whatever arrived in the request into a usable rate.
 *
 * Returns exactly 1 for anything absent, unparseable or out of range, because
 * 1 is the "do nothing" path: an unrecognised speed must leave the film
 * untouched, never guess. A bad value is reported by the caller, not applied.
 */
export function normalizeSpeed(value) {
	if (typeof value === 'string') {
		const byName = SPEED_BY_PACE[value.trim().toLowerCase()];
		if (byName !== undefined) return byName;
	}
	const n = Number(value);
	if (!Number.isFinite(n) || n <= 0) return 1;
	if (n < SPEED_MIN || n > SPEED_MAX) return 1;
	// Anything within a frame's worth of 1 is not a speed change, it is a
	// rounding artefact — and it would still cost a full re-encode.
	if (Math.abs(n - 1) < 0.01) return 1;
	return n;
}

function run(cmd, args, timeoutMs = 20 * 60 * 1000) {
	return new Promise((resolve, reject) => {
		execFile(cmd, args, {timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024}, (err, stdout, stderr) => {
			if (err) reject(new Error(`${cmd} failed: ${err.message}\n${String(stderr).slice(-2000)}`));
			else resolve({stdout, stderr});
		});
	});
}

/** Does this file carry an audio stream at all? A silent film's montage may not. */
async function hasAudio(file) {
	try {
		const {stdout} = await run('ffprobe', [
			'-v', 'error',
			'-select_streams', 'a:0',
			'-show_entries', 'stream=codec_type',
			'-of', 'default=nw=1:nk=1',
			file,
		], 60_000);
		return String(stdout).trim().startsWith('audio');
	} catch {
		return false;
	}
}

/**
 * Re-time `inFile` to `rate` and write `outFile`. Caller guarantees rate !== 1.
 *
 * setpts divides the timestamps, so PTS/0.9 spaces them further apart and the
 * film plays slower; `fps=24` then resamples onto the pipeline's own grid
 * rather than leaving stretched timestamps for a player to interpret — the
 * same pairing assemble.mjs uses for its per-scene retime, kept identical on
 * purpose so both places behave the same way.
 */
export async function applySpeed(inFile, outFile, rate) {
	const withAudio = await hasAudio(inFile);
	const args = [
		'-y',
		'-i', inFile,
		'-filter:v', `setpts=PTS/${rate.toFixed(5)},fps=24`,
	];
	if (withAudio) {
		args.push('-filter:a', `atempo=${rate.toFixed(5)}`);
	} else {
		args.push('-an');
	}
	args.push(
		'-c:v', 'libx264',
		'-preset', 'veryfast',
		'-crf', '19',
		'-pix_fmt', 'yuv420p',
		'-movflags', '+faststart',
	);
	if (withAudio) args.push('-c:a', 'aac', '-b:a', '192k');
	args.push(outFile);
	await run('ffmpeg', args);
	if (!fs.existsSync(outFile) || fs.statSync(outFile).size === 0) {
		throw new Error('speed pass produced no output');
	}
}
