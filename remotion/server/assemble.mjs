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
// POST /assemble { scenes: [{videoUrl, audioUrl}], musicUrl?, sceneChapters? }
//   -> { jobId }
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
					items.push({v, a, dur, voiceDur});
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
					t += it.dur;
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
				if (music) args.push('-i', music);
				args.push('-i', sfx.boom, '-i', sfx.whoosh, '-i', sfx.riser);

				const parts = [];
				const labels = [];
				items.forEach((it, i) => {
					const d = it.dur.toFixed(3);
					parts.push(`[${i * 2}:v]scale=1280:720,fps=24,trim=duration=${d},setpts=PTS-STARTPTS[v${i}]`);
					parts.push(`[${i * 2 + 1}:a]${MONO},atrim=duration=${d},asetpts=PTS-STARTPTS,apad=whole_dur=${d}[a${i}]`);
					labels.push(`[v${i}][a${i}]`);
				});
				parts.push(`${labels.join('')}concat=n=${items.length}:v=1:a=1[outv][voiceraw]`);

				// Mix bus: narration first (defines length), then ducked music, then SFX.
				const mixInputs = [];
				parts.push(`[voiceraw]asplit=2[vmain][vside]`);
				mixInputs.push('[vmain]');
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
							it.voiceDur ? Number(Math.min(it.voiceDur, it.dur).toFixed(3)) : null,
						),
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
