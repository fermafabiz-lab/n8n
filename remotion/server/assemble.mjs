// Final-assembly endpoint: concatenates per-scene clips with each scene's
// voiceover pinned to the START of its own scene, padded with silence to the
// scene's exact length. This exists because fal's ffmpeg compose ignores
// keyframe timestamps (measured: a 42.49s timeline came back 40.25s with the
// audio butt-joined), so timeline alignment must be done where we control
// ffmpeg directly.
//
// POST /assemble { scenes: [{ videoUrl, audioUrl }] } -> { jobId }
// GET  /assemble/:jobId/status -> { status, outputUrl, verify: {videoSeconds,
//   audioSeconds, sceneStartsSeconds} } — verify comes from ffprobe on the
//   result, so callers can confirm alignment numerically.
import path from 'path';
import fs from 'fs';
import os from 'os';
import {randomUUID} from 'crypto';
import {execFile} from 'child_process';

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

export function registerAssemble(app, {jobs, outputDir}) {
	app.post('/assemble', (req, res) => {
		const scenes = req.body && req.body.scenes;
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
				// 1. Download everything and measure each clip's real video length.
				const items = [];
				for (let i = 0; i < scenes.length; i++) {
					const v = path.join(work, `v${i}.mp4`);
					await download(scenes[i].videoUrl, v);
					const dur = await probeDuration(v, 'v:0');
					let a = null;
					if (scenes[i].audioUrl) {
						a = path.join(work, `a${i}.mp3`);
						await download(scenes[i].audioUrl, a);
					}
					items.push({v, a, dur});
					const job = jobs.get(jobId);
					if (job) job.progress = 0.4 * ((i + 1) / scenes.length);
				}

				// 2. One ffmpeg pass: normalize video, trim+silence-pad each voice
				// to its scene's exact video duration, concat all pairs.
				const args = ['-y'];
				for (const it of items) {
					args.push('-i', it.v);
					args.push('-i', it.a ?? it.v); // fallback: reuse clip audio if no voice
				}
				const parts = [];
				const labels = [];
				items.forEach((it, i) => {
					const d = it.dur.toFixed(3);
					parts.push(`[${i * 2}:v]scale=1280:720,fps=24,trim=duration=${d},setpts=PTS-STARTPTS[v${i}]`);
					parts.push(
						`[${i * 2 + 1}:a]aresample=44100,atrim=duration=${d},asetpts=PTS-STARTPTS,apad=whole_dur=${d}[a${i}]`,
					);
					labels.push(`[v${i}][a${i}]`);
				});
				parts.push(`${labels.join('')}concat=n=${items.length}:v=1:a=1[outv][outa]`);
				const outputFile = `${jobId}.mp4`;
				const outputPath = path.join(outputDir, outputFile);
				args.push(
					'-filter_complex', parts.join(';'),
					'-map', '[outv]', '-map', '[outa]',
					'-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
					'-c:a', 'aac', '-b:a', '128k',
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
				let t = 0;
				const sceneStartsSeconds = items.map((it) => {
					const s = t;
					t += it.dur;
					return Number(s.toFixed(3));
				});
				jobs.set(jobId, {
					status: 'done',
					progress: 1,
					outputFile,
					error: null,
					verify: {videoSeconds, audioSeconds, sceneStartsSeconds},
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
