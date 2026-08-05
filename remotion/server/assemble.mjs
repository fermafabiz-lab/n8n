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

function run(cmd, args, timeoutMs = 10 * 60 * 1000) {
	return new Promise((resolve, reject) => {
		execFile(cmd, args, {timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024}, (err, stdout, stderr) => {
			if (err) reject(new Error(`${cmd} failed: ${err.message}\n${String(stderr).slice(-2000)}`));
			else resolve({stdout, stderr});
		});
	});
}

async function download(url, dest) {
	const res = await fetch(url, {redirect: 'follow'});
	if (!res.ok) throw new Error(`download ${url}: HTTP ${res.status}`);
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
				const sfx = await ensureSfx();

				// 1. Download everything and measure each clip's real video length.
				const items = [];
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
					items.push({v, a, dur, voiceDur, eff, stretch, freeze, nativeAudio});
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
					sceneStartsSeconds.push(Number(t.toFixed(3)));
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
					args.push('-i', it.v);
					args.push('-i', it.a ?? it.v); // fallback: reuse clip audio if no voice
				}
				let idx = items.length * 2;
				const musicIdx = music ? idx++ : -1;
				const boomIdx = idx++;
				const whooshIdx = idx++;
				const riserIdx = idx++;
				// concat wants the same stream count from every segment, so scenes
				// without usable clip audio borrow silence from here.
				const nativeOn = items.some((it) => it.nativeAudio);
				const silenceIdx = nativeOn ? idx++ : -1;
				if (music) args.push('-i', music);
				args.push('-i', sfx.boom, '-i', sfx.whoosh, '-i', sfx.riser);
				if (nativeOn) args.push('-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono');

				const parts = [];
				const labels = [];
				items.forEach((it, i) => {
					const d = it.eff.toFixed(3);
					// Cover-fit to the target canvas: scale up to fill, center-crop
					// the overflow. A 16:9 clip on a 9:16 canvas crops the sides.
					const vchain =
						// Elastic retime: setpts stretches/compresses playback to the
						// scene's narration-driven length, fps=24 AFTER it resamples
						// frames evenly, and the final trim pins the exact duration
						// (it also cuts the leftover tail when the speed-up clamped).
						`scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},` +
						`trim=duration=${it.dur.toFixed(3)},setpts=${it.stretch.toFixed(5)}*(PTS-STARTPTS),fps=24` +
						(it.freeze > 0.01 ? `,tpad=stop_mode=clone:stop_duration=${it.freeze.toFixed(3)}` : '') +
						`,trim=duration=${d},setpts=PTS-STARTPTS`;
					parts.push(`[${i * 2}:v]${vchain}[v${i}]`);
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
