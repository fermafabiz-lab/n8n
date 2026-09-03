// Final-assembly endpoint: concatenates per-scene clips with each scene's
// voiceover pinned to the START of its own scene, padded with silence to the
// scene's exact length. This exists because fal's ffmpeg compose ignores
// keyframe timestamps (measured: a 42.49s timeline came back 40.25s with the
// audio butt-joined), so timeline alignment must be done where we control
// ffmpeg directly.
//
// Sound design (all optional, degrades gracefully):
//   - musicUrl: background music, looped to length, volume-ducked under the
//     narration via sidechain compression, faded out at the end.
//   - sceneChapters: [0,1,1,2,...] per scene — a synthesized whoosh plays at
//     every chapter boundary, a low boom under the hook title, and a riser
//     into the final seconds. SFX are generated locally with ffmpeg at first
//     use (no asset files needed).
//
// POST /assemble { scenes: [{videoUrl, audioUrl}], musicUrl?, sceneChapters?,
//   nativeAudio? } -> { jobId }
//   nativeAudio controls the clips' own tracks (Veo's generated ambience):
//   false/0 silences them (narration + music only), a number sets their
//   level (ducked under the narration), absent defaults to 0.22. The site's
//   "Sound effects" toggle maps to this via n8n's Build Timeline.
//   stingers (default OFF) adds the synthesized boom/whoosh/riser accents;
//   musicUrl adds the background track. Both are "music" from the
//   producer's point of view and ride the site's one music toggle.
// GET  /assemble/:jobId/status -> { status, outputUrl, verify: {videoSeconds,
//   audioSeconds, sceneStartsSeconds} } — verify comes from ffprobe on the
//   result, so callers can confirm alignment numerically.
import path from 'path';
import fs from 'fs';
import os from 'os';
import {fileURLToPath} from 'url';
import {randomUUID} from 'crypto';
import {execFile} from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SFX_DIR = path.join(__dirname, 'sfx');

/**
 * Output frame rate of the montage. Named because three things must agree on
 * it: the fps filter in the video chain, the frame snapping that pins each
 * scene to a whole frame, and the scene start times reported back to the
 * graphics pass. When it was only a literal inside the filter string, the
 * reported times were free to disagree with the encode, and they did.
 */
const OUT_FPS = 24;

function run(cmd, args, timeoutMs = 10 * 60 * 1000) {
	return new Promise((resolve, reject) => {
		execFile(cmd, args, {timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024}, (err, stdout, stderr) => {
			if (err) reject(new Error(`${cmd} failed: ${err.message}\n${String(stderr).slice(-2000)}`));
			else resolve({stdout, stderr});
		});
	});
}

async function download(url, dest) {
	// Drive answers 503/429 when it is asked for many files at once — a
	// 71-scene film is 142 downloads in a row, and two renders of the same
	// film once did it together. A short back-off is all it wants.
	const waits = [2000, 6000, 15000];
	let res;
	for (let attempt = 0; ; attempt++) {
		res = await fetch(url, {redirect: 'follow'});
		if (res.ok) break;
		const transient = res.status === 503 || res.status === 429 || res.status === 500 || res.status === 502;
		if (!transient || attempt >= waits.length) throw new Error(`download ${url}: HTTP ${res.status}`);
		console.warn(`download ${url}: HTTP ${res.status}, retrying in ${waits[attempt] / 1000}s`);
		await new Promise((r) => setTimeout(r, waits[attempt]));
	}
	const buf = Buffer.from(await res.arrayBuffer());
	// Google Drive sometimes serves an HTML interstitial instead of the file;
	// catch that early instead of feeding HTML to ffmpeg.
	if (buf.slice(0, 15).toString().toLowerCase().includes('<!doctype html') || buf.slice(0, 6).toString() === '<html>') {
		throw new Error(`download ${url}: got an HTML page, not media`);
	}
	fs.writeFileSync(dest, buf);
}

async function probeDuration(file, stream) {
	const {stdout} = await run('ffprobe', [
		'-v', 'error',
		'-select_streams', stream,
		'-show_entries', 'stream=duration',
		'-of', 'csv=p=0',
		file,
	]);
	const n = parseFloat(String(stdout).trim().split('\n')[0]);
	if (isNaN(n) || n <= 0) throw new Error(`ffprobe: no ${stream} duration in ${file}`);
	return n;
}

/**
 * The breath at the ends of a take.
 *
 * ElevenLabs pads what it generates: a take opens with a beat of near-silence
 * and closes with another. Inside one line that is natural. Laid end to end
 * down a film it is not — the scene length is `voiceDur + 0.35`, so every
 * padded tail is added to a gap that already exists, and the narration comes
 * out slower and more recited than the take sounds on its own.
 *
 * -45dB rather than a rounder number: the generated audio is clean, so the
 * floor only has to clear encoder noise, and a threshold set too high eats the
 * quiet end of a real word. 180ms is the shortest run treated as padding —
 * below that it is phrasing, and cutting it is what makes speech sound
 * clipped rather than tight.
 */
const BREATH_NOISE_DB = -45;
const BREATH_MIN = 0.18;
/** Kept either side, so no consonant is ever shaved off its own word. */
const BREATH_GUARD = 0.05;

/**
 * Where the speech starts and ends, read out of silencedetect's report.
 *
 * Pure and exported so it can be tested without ffmpeg — this parser is the
 * part with the edge cases, and the box a Claude Code session runs on has no
 * ffmpeg to rehearse the filter against.
 *
 * The one that bites: silencedetect never emits a closing `silence_end` for a
 * run that reaches the end of the file — the file just stops — so an unclosed
 * run has to be closed by hand or a padded tail reads as no tail at all.
 */
export function parseSpeechBounds(stderr, total) {
	const runs = [];
	let open = null;
	for (const m of String(stderr).matchAll(/silence_(start|end):\s*(-?[\d.]+)/g)) {
		const at = parseFloat(m[2]);
		if (!Number.isFinite(at)) continue;
		if (m[1] === 'start') open = at;
		else if (open !== null) {
			runs.push([open, at]);
			open = null;
		}
	}
	if (open !== null) runs.push([open, total]);

	let head = 0;
	let tail = total;
	// Only runs that TOUCH an end are padding. A pause in the middle of a
	// sentence is the performance, and cutting it would be rewriting the read.
	if (runs.length && runs[0][0] <= 0.05) head = runs[0][1];
	const last = runs[runs.length - 1];
	if (last && last[1] >= total - 0.05) tail = last[0];

	head = Math.max(0, head - BREATH_GUARD);
	tail = Math.min(total, tail + BREATH_GUARD);
	// A detector that found silence everywhere would otherwise invert these.
	if (tail <= head) return {head: 0, tail: total};
	return {head, tail};
}

/** Where the speech actually starts and ends, in seconds. */
async function speechBounds(file, total) {
	const {stderr} = await run('ffmpeg', [
		'-hide_banner', '-nostats',
		'-i', file,
		'-af', `silencedetect=noise=${BREATH_NOISE_DB}dB:d=${BREATH_MIN}`,
		'-f', 'null', '-',
	]);
	return parseSpeechBounds(stderr, total);
}

/**
 * Cut the padding off a take, keeping the opening beat when the scene starts a
 * chapter.
 *
 * That exception is the point of the feature rather than a detail of it: with
 * every take tightened the film runs on without a seam, and a chapter needs
 * one. Keeping the natural lead-in on the scene that opens it puts the pause
 * exactly where a reader would take one, and costs nothing to compute — it is
 * simply the silence ElevenLabs already generated, left alone.
 *
 * Writes WAV, not mp3. Re-encoding to mp3 would hand back the encoder delay
 * and padding this exists to remove — the same gapless-header problem that
 * makes a pure-frame mp3 concat gain ~36ms per join.
 */
async function tightenTake(file, work, i, total, keepLeadIn) {
	const {head, tail} = await speechBounds(file, total);
	const start = keepLeadIn ? 0 : head;
	// Nothing worth a re-encode, or the detector found almost no speech — a
	// very quiet take would otherwise be cut down to nothing. Leaving the file
	// alone is always safe; over-trimming is not.
	if (tail - start < 0.3 || total - (tail - start) < 0.05) return null;
	const out = path.join(work, `a${i}.trim.wav`);
	await run('ffmpeg', [
		'-y', '-i', file,
		'-af', `atrim=start=${start.toFixed(3)}:end=${tail.toFixed(3)},asetpts=N/SR/TB`,
		'-c:a', 'pcm_s16le',
		out,
	]);
	const duration = await probeDuration(out, 'a:0');
	return {file: out, duration, cut: total - duration, keptLeadIn: keepLeadIn && head > 0.05};
}

/**
 * Does this file carry an audio stream at all? Veo clips do, but a clip that
 * came back through a re-mux or a still-image fallback may not — and concat
 * needs every segment to expose the same streams, so a missing one has to be
 * substituted with silence rather than discovered mid-render.
 */
async function hasAudioStream(file) {
	try {
		const {stdout} = await run('ffprobe', [
			'-v', 'error',
			'-select_streams', 'a:0',
			'-show_entries', 'stream=codec_type',
			'-of', 'csv=p=0',
			file,
		]);
		return String(stdout).trim().startsWith('audio');
	} catch {
		return false;
	}
}

// Synthesize the SFX bank once. Pure ffmpeg — no downloaded assets.
let sfxReady = null;
function ensureSfx() {
	if (!sfxReady) {
		sfxReady = (async () => {
			fs.mkdirSync(SFX_DIR, {recursive: true});
			const whoosh = path.join(SFX_DIR, 'whoosh.wav');
			const boom = path.join(SFX_DIR, 'boom.wav');
			const riser = path.join(SFX_DIR, 'riser.wav');
			if (!fs.existsSync(whoosh)) {
				await run('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'anoisesrc=color=pink:duration=0.9:amplitude=0.7',
					'-af', 'highpass=f=350,lowpass=f=5200,afade=t=in:d=0.4,afade=t=out:st=0.4:d=0.5,aformat=sample_rates=44100:channel_layouts=mono', whoosh]);
			}
			if (!fs.existsSync(boom)) {
				await run('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'sine=frequency=52:duration=1.4',
					'-af', 'lowpass=f=130,afade=t=in:d=0.02,afade=t=out:st=0.1:d=1.25,aformat=sample_rates=44100:channel_layouts=mono', boom]);
			}
			if (!fs.existsSync(riser)) {
				await run('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'anoisesrc=color=brown:duration=2.2:amplitude=0.8',
					'-af', 'highpass=f=200,afade=t=in:d=1.9,afade=t=out:st=1.9:d=0.3,aformat=sample_rates=44100:channel_layouts=mono', riser]);
			}
			return {whoosh, boom, riser};
		})();
	}
	return sfxReady;
}

const MONO = 'aformat=sample_rates=44100:channel_layouts=mono';

export function registerAssemble(app, {jobs, outputDir}) {
	app.post('/assemble', (req, res) => {
		const scenes = req.body && req.body.scenes;
		const musicUrl = req.body && req.body.musicUrl;
		const sceneChapters = (req.body && req.body.sceneChapters) || [];
		// "16:9" (default) or "9:16" — decides the output canvas.
		const portrait = (req.body && req.body.aspect) === '9:16';
		// The clips arrive from Veo with their own ambience on board. It used
		// to be dropped on the floor: the per-scene audio chain only ever read
		// the voiceover input, so the montage carried narration and nothing
		// else. Mixed back in under the narration by default; pass
		// nativeAudio: false (or 0) to go back to voice-only.
		// Editorial stingers — the boom under the hook, a whoosh at every
		// chapter boundary, a riser into the end screen. They are SYNTHESIZED
		// here and bear no relation to what is on screen, so they are music,
		// not the footage's own sound. They used to play on every render
		// unconditionally, which is exactly what "music that has nothing to do
		// with the clip" was. Opt-in now, alongside the background track.
		const stingers = Boolean(req.body && req.body.stingers);
		const rawNative = req.body ? req.body.nativeAudio : undefined;
		const nativeVolume =
			rawNative === false || rawNative === 0
				? 0
				: typeof rawNative === 'number' && rawNative > 0
					? Math.min(1, rawNative)
					: 0.22;
		const W = portrait ? 720 : 1280;
		const H = portrait ? 1280 : 720;
		if (!Array.isArray(scenes) || scenes.length === 0) {
			return res.status(400).json({error: 'scenes: [{videoUrl, audioUrl}] is required'});
		}
		for (const s of scenes) {
			if (!s.videoUrl) return res.status(400).json({error: 'every scene needs videoUrl'});
		}

		const jobId = randomUUID();
		jobs.set(jobId, {status: 'rendering', progress: 0, outputFile: null, error: null});
		res.json({jobId});

		(async () => {
			const work = fs.mkdtempSync(path.join(os.tmpdir(), 'assemble-'));
			try {
				const sfx = stingers ? await ensureSfx() : null;

				// 1. Download everything and measure each clip's real video length.
				const items = [];
				/** How much generated padding came out of the narration, for the log
				 *  and the job result — the one number that says whether this did
				 *  anything on a given film. */
				let trimmedTotal = 0;
				for (let i = 0; i < scenes.length; i++) {
					const v = path.join(work, `v${i}.mp4`);
					await download(scenes[i].videoUrl, v);
					const dur = await probeDuration(v, 'v:0');
					let a = null;
					let voiceDur = null;
					if (scenes[i].audioUrl) {
						a = path.join(work, `a${i}.mp3`);
						await download(scenes[i].audioUrl, a);
						// Real narration length — the graphics pass paces captions on
						// this, not on the (silence-padded) scene length.
						voiceDur = await probeDuration(a, 'a:0').catch(() => null);
						// Cut the generated breath off the ends, EXCEPT the lead-in of
						// a scene that opens a chapter — that pause is what a listener
						// hears as the break between chapters.
						//
						// Done here, before anything reads `voiceDur`, so the whole
						// pipeline follows on its own: the scene length, the stretch
						// factor, the reported scene starts and every graphic placed
						// off them all derive from this number. Trimming later would
						// have meant rescaling each of them in lockstep.
						//
						// Failing is always survivable and never fatal: a take that
						// cannot be analysed or re-encoded keeps its original file and
						// its original length, which is exactly today's behaviour.
						if (voiceDur) {
							const opensChapter =
								i === 0 || (sceneChapters[i] ?? 0) !== (sceneChapters[i - 1] ?? 0);
							const tight = await tightenTake(a, work, i, voiceDur, opensChapter).catch(
								(e) => {
									console.warn(`scene ${i}: breath trim skipped — ${e.message}`);
									return null;
								},
							);
							if (tight) {
								trimmedTotal += tight.cut;
								console.log(
									`scene ${i}: trimmed ${tight.cut.toFixed(2)}s of padding` +
										(tight.keptLeadIn ? ' (kept the chapter lead-in)' : ''),
								);
								a = tight.file;
								voiceDur = tight.duration;
							}
						}
					}
					// Elastic timing: every scene lasts exactly as long as its own
					// narration (+ a small breath), and the clip is TIME-STRETCHED to
					// that length so all frames stay in motion — no freeze-frames when
					// the voice runs long, no dead air when it runs short. The stretch
					// factor is clamped to a range that stays visually invisible on
					// ambient footage; only extreme mismatches fall back to trimming
					// (very short voice) or a residual freeze (very long voice).
					const STRETCH_MIN = 0.65; // fastest allowed playback (voice much shorter)
					const STRETCH_MAX = 1.5;  // slowest allowed playback (voice much longer)
					let eff = dur;
					let stretch = 1;
					let freeze = 0;
					if (voiceDur) {
						eff = voiceDur + 0.35;
						stretch = eff / dur;
						if (stretch > STRETCH_MAX) {
							// Even at max slow-motion the clip can't cover the voice —
							// freeze only the uncoverable remainder.
							stretch = STRETCH_MAX;
							freeze = eff - dur * STRETCH_MAX;
						} else if (stretch < STRETCH_MIN) {
							// Voice is far shorter than the clip — play at max speed-up
							// and cut the leftover tail.
							stretch = STRETCH_MIN;
						}
					}
					// Only worth carrying the clip's own track when there is a
					// separate narration to sit under: with no voiceover the clip
					// audio is already the scene's main track (see the `it.a ?? it.v`
					// fallback below), and mixing it twice would just double it.
					const nativeAudio =
						nativeVolume > 0 && a !== null && (await hasAudioStream(v));
					// Snap the scene to a whole number of OUTPUT frames, and keep the
					// frame count rather than re-deriving it later.
					//
					// This is the difference between what the montage INTENDS and what
					// it ENCODES. `eff` is a float driven by the narration, but the
					// video chain below ends in fps=24, so every segment necessarily
					// lands on a 24fps frame line — and the leftover fraction does not
					// vanish, it accumulates down the concat. Measured on the tahiti
					// montage before this: the reported scene starts drifted from the
					// real picture cuts by -0.021s at the first boundary to +0.084s at
					// the last, which at 30fps is up to three frames.
					//
					// Graphics are placed off those reported times, so the drift showed
					// up as the montage framing changing one to three frames after the
					// picture did — the producer's "a frame with zoom that looks wrong"
					// at every scene change. Snapping here makes the two agree by
					// construction: there is no longer an intended time that the
					// encoder can round away from.
					const effFrames = Math.max(1, Math.round(eff * OUT_FPS));
					eff = effFrames / OUT_FPS;
					items.push({v, a, dur, voiceDur, eff, effFrames, stretch, freeze, nativeAudio});
					const job = jobs.get(jobId);
					if (job) job.progress = 0.35 * ((i + 1) / scenes.length);
				}
				let music = null;
				if (musicUrl) {
					music = path.join(work, 'music.audio');
					await download(musicUrl, music);
				}

				// Scene timing + chapter boundary times (for whooshes).
				let t = 0;
				const sceneStartsSeconds = [];
				items.forEach((it) => {
					// Six decimals, not three: these are now exact multiples of
					// 1/OUT_FPS, and 6.833333 rounded to 6.833 would put a rounding
					// error back into the very number that exists to be exact.
					sceneStartsSeconds.push(Number(t.toFixed(6)));
					t += it.eff;
				});
				const totalDur = t;
				const chapterBoundaries = [];
				for (let i = 1; i < items.length; i++) {
					if ((sceneChapters[i] ?? 0) !== (sceneChapters[i - 1] ?? 0)) {
						chapterBoundaries.push(sceneStartsSeconds[i]);
					}
				}

				// 2. One ffmpeg pass: normalize video, trim+silence-pad each voice
				// to its scene's exact duration, concat, then layer music + SFX.
				const args = ['-y'];
				for (const it of items) {
					// `-threads 1` is an INPUT option here: one decoder thread per
					// clip. ffmpeg opens every decoder at start, and the default
					// (auto = one thread per core, per decoder) put 71 h264 decoders
					// times 8 threads on an 8-core box — the 60th failed to open with
					// "Resource temporarily unavailable" (EAGAIN from pthread_create)
					// and the whole 71-scene Vegas assemble died, four times in a
					// row. Decoding 8-second clips single-threaded costs nothing the
					// encoder does not dwarf; libx264 keeps its own thread pool.
					args.push('-threads', '1', '-i', it.v);
					args.push('-threads', '1', '-i', it.a ?? it.v); // fallback: reuse clip audio if no voice
				}
				let idx = items.length * 2;
				const musicIdx = music ? idx++ : -1;
				const boomIdx = stingers ? idx++ : -1;
				const whooshIdx = stingers ? idx++ : -1;
				const riserIdx = stingers ? idx++ : -1;
				// concat wants the same stream count from every segment, so scenes
				// without usable clip audio borrow silence from here.
				const nativeOn = items.some((it) => it.nativeAudio);
				const silenceIdx = nativeOn ? idx++ : -1;
				if (music) args.push('-i', music);
				if (stingers) args.push('-i', sfx.boom, '-i', sfx.whoosh, '-i', sfx.riser);
				if (nativeOn) args.push('-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono');

				const parts = [];
				const labels = [];
				items.forEach((it, i) => {
					const d = it.eff.toFixed(6);
					// Cover-fit to the target canvas: scale up to fill, center-crop
					// the overflow. A 16:9 clip on a 9:16 canvas crops the sides.
					const vchain =
						// Elastic retime: setpts stretches/compresses playback to the
						// scene's narration-driven length, fps=${OUT_FPS} AFTER it resamples
						// frames evenly, and the final trim pins the exact duration
						// (it also cuts the leftover tail when the speed-up clamped).
						`scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},` +
						`trim=duration=${it.dur.toFixed(3)},setpts=${it.stretch.toFixed(5)}*(PTS-STARTPTS),fps=${OUT_FPS}`;
					// What the clip covers once it is stretched as far as it may be.
					const covered = it.dur * it.stretch;
					// The tail the clip cannot reach, PLAYED BACKWARDS rather than
					// frozen.
					//
					// A scene lasts as long as its narration, and when the voice runs
					// past what 1.5x slow motion can cover the remainder used to be
					// `tpad=stop_mode=clone` — the last frame held still. On the
					// 71-scene Boyd film one scene carried 16.7s of narration over an
					// 8s clip: twelve seconds of slow motion and then FIVE SECONDS OF
					// A FROZEN FRAME, under a voice that keeps talking. Reported as
					// the picture stopping.
					//
					// Reversing the tail keeps every frame moving, and on ambient
					// footage a bounce reads as continuous motion rather than as a
					// loop: nothing jumps, because the seam is the same frame twice.
					// It is bounded because `reverse` buffers every frame it receives:
					// six seconds at 1280x720 is about 200 MB, and this box has
					// already lost renders to memory once. Six is not arbitrary — the
					// worst scene of the Boyd film needed 5.04s, so the bound covers
					// the worst case anyone has actually shipped and leaves a margin.
					// Anything past it still clones, which is the old behaviour for
					// the part no reasonable scene should reach.
					const REVERSE_MAX = 6;
					const bounce = Math.min(it.freeze, REVERSE_MAX, covered);
					// end_frame, not duration: after fps=${OUT_FPS} the segment is a
					// COUNT of frames, and saying so leaves ffmpeg no rounding to do.
					// `trim=duration=6.833333` sits a hair either side of frame 164
					// depending on float luck; end_frame=164 is exactly 164 frames.
					if (bounce > 0.04) {
						parts.push(`[${i * 2}:v]${vchain},split=2[vf${i}][vb${i}]`);
						parts.push(
							`[vb${i}]trim=start=${(covered - bounce).toFixed(3)},setpts=PTS-STARTPTS,reverse[vr${i}]`,
						);
						parts.push(
							`[vf${i}][vr${i}]concat=n=2:v=1` +
								// Still clamped by the trim below; this only catches the
								// case the bounce could not cover on its own.
								(it.freeze > bounce + 0.04
									? `,tpad=stop_mode=clone:stop_duration=${(it.freeze - bounce).toFixed(3)}`
									: '') +
								`,trim=end_frame=${it.effFrames},setpts=PTS-STARTPTS[v${i}]`,
						);
					} else {
						parts.push(
							`[${i * 2}:v]${vchain}` +
								(it.freeze > 0.01
									? `,tpad=stop_mode=clone:stop_duration=${it.freeze.toFixed(3)}`
									: '') +
								`,trim=end_frame=${it.effFrames},setpts=PTS-STARTPTS[v${i}]`,
						);
					}
					parts.push(`[${i * 2 + 1}:a]${MONO},atrim=duration=${d},asetpts=PTS-STARTPTS,apad=whole_dur=${d}[a${i}]`);
					if (nativeOn) {
						// The clip's own ambience has to follow the same elastic retime
						// as its picture or it drifts out of sync: setpts stretches the
						// video by `stretch`, so the audio needs the reciprocal tempo.
						// The clamp upstream keeps 1/stretch inside atempo's range.
						if (it.nativeAudio) {
							parts.push(
								`[${i * 2}:a]${MONO},atrim=duration=${it.dur.toFixed(3)},asetpts=PTS-STARTPTS,` +
									`atempo=${(1 / it.stretch).toFixed(5)},atrim=duration=${d},asetpts=PTS-STARTPTS,` +
									`apad=whole_dur=${d}[n${i}]`,
							);
						} else {
							parts.push(`[${silenceIdx}:a]${MONO},atrim=duration=${d},asetpts=PTS-STARTPTS[n${i}]`);
						}
					}
					labels.push(nativeOn ? `[v${i}][a${i}][n${i}]` : `[v${i}][a${i}]`);
				});
				parts.push(
					nativeOn
						? `${labels.join('')}concat=n=${items.length}:v=1:a=2[outv][voiceraw][natraw]`
						: `${labels.join('')}concat=n=${items.length}:v=1:a=1[outv][voiceraw]`,
				);

				// Mix bus: narration first (defines length), then ducked music, then SFX.
				const mixInputs = [];
				parts.push(`[voiceraw]asplit=3[vmain][vside][vsidenat]`);
				mixInputs.push('[vmain]');
				if (nativeOn) {
					// Ambience sits under the narration the same way the music does:
					// ducked by the voice so it never competes with a spoken line,
					// but audible in the gaps between them.
					parts.push(`[natraw]${MONO},volume=${nativeVolume}[natlvl]`);
					parts.push(
						`[natlvl][vsidenat]sidechaincompress=threshold=0.05:ratio=8:attack=10:release=350:makeup=1[natduck]`,
					);
					mixInputs.push('[natduck]');
				} else {
					parts.push(`[vsidenat]anullsink`);
				}
				if (music) {
					const fadeStart = Math.max(0, totalDur - 2.5).toFixed(3);
					parts.push(
						`[${musicIdx}:a]${MONO},aloop=loop=-1:size=2000000000,atrim=duration=${totalDur.toFixed(3)},volume=0.22,afade=t=out:st=${fadeStart}:d=2.5[mus]`,
					);
					parts.push(
						`[mus][vside]sidechaincompress=threshold=0.03:ratio=10:attack=8:release=450:makeup=1[mduck]`,
					);
					mixInputs.push('[mduck]');
				} else {
					parts.push(`[vside]anullsink`);
				}
				if (stingers) {
					// Boom under the hook title.
					parts.push(`[${boomIdx}:a]adelay=150|150,volume=0.45[sfxboom]`);
					mixInputs.push('[sfxboom]');
					// Whoosh at every chapter boundary (one input, split as needed).
					if (chapterBoundaries.length) {
						const n = chapterBoundaries.length;
						parts.push(`[${whooshIdx}:a]asplit=${n}${chapterBoundaries.map((_, i) => `[w${i}]`).join('')}`);
						chapterBoundaries.forEach((b, i) => {
							const ms = Math.max(0, Math.round((b - 0.45) * 1000));
							parts.push(`[w${i}]adelay=${ms}|${ms},volume=0.4[sw${i}]`);
							mixInputs.push(`[sw${i}]`);
						});
					}
					// Riser into the last two seconds (leads into the end screen).
					const riserMs = Math.max(0, Math.round((totalDur - 2.4) * 1000));
					parts.push(`[${riserIdx}:a]adelay=${riserMs}|${riserMs},volume=0.35[sfxriser]`);
					mixInputs.push('[sfxriser]');
				}

				parts.push(
					`${mixInputs.join('')}amix=inputs=${mixInputs.length}:duration=first:normalize=0,alimiter=limit=0.95[outa]`,
				);

				const outputFile = `${jobId}.mp4`;
				const outputPath = path.join(outputDir, outputFile);
				args.push(
					'-filter_complex', parts.join(';'),
					'-map', '[outv]', '-map', '[outa]',
					'-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
					'-c:a', 'aac', '-b:a', '160k',
					'-movflags', '+faststart',
					outputPath,
				);
				const job = jobs.get(jobId);
				if (job) job.progress = 0.5;
				await run('ffmpeg', args);

				// 3. Self-verify: probe the result so the caller can check
				// alignment numerically instead of by ear.
				const videoSeconds = await probeDuration(outputPath, 'v:0');
				const audioSeconds = await probeDuration(outputPath, 'a:0');
				jobs.set(jobId, {
					status: 'done',
					progress: 1,
					outputFile,
					error: null,
					verify: {
						videoSeconds,
						audioSeconds,
						sceneStartsSeconds,
						voiceDurationsSeconds: items.map((it) =>
							it.voiceDur ? Number(Math.min(it.voiceDur, it.eff).toFixed(3)) : null,
						),
						// Per-scene playback retime applied (1 = untouched) — lets the
						// QC pass confirm the elastic timing stayed in the subtle range.
						stretchFactors: items.map((it) => Number(it.stretch.toFixed(3))),
						// Generated padding removed from the narration, in total. Zero
						// means the trim ran and found nothing, or every take failed
						// analysis and kept its original — the log line says which.
						breathTrimmedSeconds: Number(trimmedTotal.toFixed(2)),
					},
				});
			} catch (err) {
				jobs.set(jobId, {
					status: 'error',
					progress: 0,
					outputFile: null,
					error: String((err && err.message) || err),
				});
			} finally {
				fs.rmSync(work, {recursive: true, force: true});
			}
		})();
	});
}
