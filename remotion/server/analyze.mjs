// POST /analyze {url, maxSeconds, threshold} — measures HOW a reference video
// is edited, so the pipeline can be tuned against real numbers instead of
// impressions. Downloads a low-res copy (this box can reach YouTube; the
// sandbox cannot), then reports:
//   - every cut, with each shot's duration → the edit's rhythm
//   - contact sheets, one labelled frame per shot → what the shots actually are
//   - a loudness envelope → music dynamics, ducking under narration, SFX hits
//   - cut-vs-speech alignment → whether cuts land on narration beats
// Sheets are written into the public /output dir so they can be fetched and
// looked at afterwards.
import {execFile} from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {randomUUID} from 'crypto';
import {cookieArgs, parseSrt, dedupeCues, fetchSubtitles} from './transcript.mjs';

const YTDLP = process.env.YTDLP_PATH || 'yt-dlp';
const FONT = '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf';

function run(cmd, args, timeoutMs = 10 * 60 * 1000) {
	return new Promise((resolve, reject) => {
		execFile(cmd, args, {timeout: timeoutMs, maxBuffer: 256 * 1024 * 1024, encoding: 'buffer'}, (err, stdout, stderr) => {
			// ffmpeg writes its analysis to stderr and exits non-zero on some
			// filters even when the work succeeded, so callers decide.
			resolve({err, stdout, stderr: String(stderr || '')});
		});
	});
}

async function mustRun(cmd, args, timeoutMs) {
	const r = await run(cmd, args, timeoutMs);
	if (r.err) throw new Error(`${cmd} failed: ${r.err.message}\n${r.stderr.slice(-1500)}`);
	return r;
}

const pct = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : 0);
const round = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

// ---------- acquisition ----------

// YouTube blocks datacenter IPs, and exported cookies get rotated by the
// browser within days — so no single approach stays working. Try the cheap
// ones in order and keep whichever gets through: alternative player clients
// often pass the bot check with no cookies at all.
const DOWNLOAD_STRATEGIES = [
	{name: 'cookies', extra: () => cookieArgs()},
	{name: 'no-cookies', extra: () => []},
	{name: 'alt-client', extra: () => ['--extractor-args', 'youtube:player_client=tv,mweb,ios']},
	{
		name: 'cookies+alt-client',
		extra: () => [...cookieArgs(), '--extractor-args', 'youtube:player_client=tv,mweb,ios'],
	},
];

async function downloadVideo(url, dir, maxSeconds) {
	const out = path.join(dir, 'video.mp4');
	const base = [
		// 480p is plenty to read framing and cuts, and keeps this fast.
		'-f', 'bv*[height<=480]+ba/b[height<=480]/b',
		'--merge-output-format', 'mp4',
		'-o', out,
	];
	if (maxSeconds > 0) {
		// Only the opening stretch — style is established early and this
		// bounds download + processing time on 30-minute videos.
		// No --force-keyframes-at-cuts: the section starts at 0, which is already
		// a keyframe, so skipping it avoids a full re-encode.
		base.push('--download-sections', `*0-${maxSeconds}`);
	}

	const failures = [];
	for (const s of DOWNLOAD_STRATEGIES) {
		const extra = s.extra();
		// Skip the cookie-bearing strategies when no cookies are configured.
		if (s.name.startsWith('cookies') && !extra.includes('--cookies')) continue;
		const r = await run(YTDLP, [...extra, ...base, url], 8 * 60 * 1000);
		if (!r.err && fs.existsSync(out) && fs.statSync(out).size > 0) {
			return {file: out, strategy: s.name};
		}
		fs.rmSync(out, {force: true});
		const why = (r.stderr.match(/ERROR:.*/g) || []).slice(-1)[0] || (r.err && r.err.message) || 'unknown';
		failures.push(`${s.name} → ${why.slice(0, 200)}`);
	}
	throw new Error(`yt-dlp could not download this video.\n${failures.join('\n')}`);
}

// Google Drive links/ids, or any plain media URL — the escape hatch for when
// YouTube blocks this host's IP. Drive's large-file interstitial needs the
// confirm flag, otherwise it answers with an HTML page instead of the file.
async function downloadDirect(url, dir) {
	const out = path.join(dir, 'video.mp4');
	const drive = String(url).match(/(?:drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?[^]*id=))([\w-]{10,})/);
	const candidates = drive
		? [
				`https://drive.google.com/uc?export=download&id=${drive[1]}&confirm=t`,
				`https://drive.usercontent.google.com/download?id=${drive[1]}&export=download&confirm=t`,
			]
		: [url];

	let lastErr = 'unknown';
	for (const target of candidates) {
		try {
			const r = await fetch(target, {redirect: 'follow'});
			if (!r.ok) {
				lastErr = `HTTP ${r.status}`;
				continue;
			}
			const buf = Buffer.from(await r.arrayBuffer());
			if (buf.slice(0, 200).toString('utf8').toLowerCase().includes('<!doctype html')) {
				lastErr = 'the link answered with an HTML page, not a video file';
				continue;
			}
			fs.writeFileSync(out, buf);
			return {file: out, strategy: drive ? 'drive' : 'direct-url'};
		} catch (e) {
			lastErr = String((e && e.message) || e);
		}
	}
	throw new Error(`Could not download the file: ${lastErr}`);
}

// Direct downloads arrive whole; trim to the requested opening stretch so the
// rest of the pipeline behaves the same as for a yt-dlp section download.
async function trimTo(file, dir, maxSeconds) {
	if (!(maxSeconds > 0)) return file;
	const trimmed = path.join(dir, 'trimmed.mp4');
	const r = await run('ffmpeg', ['-y', '-i', file, '-t', String(maxSeconds), '-c', 'copy', trimmed]);
	return !r.err && fs.existsSync(trimmed) && fs.statSync(trimmed).size > 0 ? trimmed : file;
}

async function acquire(url, dir, maxSeconds) {
	if (/(?:youtube\.com|youtu\.be)\//i.test(url)) {
		return downloadVideo(url, dir, maxSeconds);
	}
	const got = await downloadDirect(url, dir);
	return {file: await trimTo(got.file, dir, maxSeconds), strategy: got.strategy};
}

async function probeDuration(file) {
	const r = await mustRun('ffprobe', [
		'-v', 'error', '-show_entries', 'format=duration',
		'-of', 'default=noprint_wrappers=1:nokey=1', file,
	]);
	return Number(String(r.stdout).trim()) || 0;
}

// ---------- cuts ----------

// ffmpeg's scene score is the fraction of the frame that changed. Hard cuts
// score high; a fast camera move can also trip it, so the threshold is a
// tunable and the sheets are the ground truth for verification.
async function detectCuts(file, threshold) {
	const r = await run('ffmpeg', [
		'-i', file, '-an',
		'-filter:v', `select='gt(scene,${threshold})',showinfo`,
		'-f', 'null', '-',
	]);
	const times = [];
	for (const m of r.stderr.matchAll(/pts_time:([\d.]+)/g)) {
		const t = Number(m[1]);
		// Cuts closer than 4 frames apart are the same transition detected twice.
		if (Number.isFinite(t) && (!times.length || t - times[times.length - 1] > 0.15)) times.push(t);
	}
	return times;
}

function buildShots(cuts, duration) {
	const bounds = [0, ...cuts.filter((t) => t > 0.15 && t < duration - 0.15), duration];
	const shots = [];
	for (let i = 0; i < bounds.length - 1; i++) {
		const start = bounds[i];
		const end = bounds[i + 1];
		if (end - start < 0.2) continue; // detection noise
		shots.push({index: shots.length + 1, start: round(start), end: round(end), duration: round(end - start)});
	}
	return shots;
}

// ---------- contact sheets ----------

// One labelled frame per shot ("12 · 2.4s"), tiled 5x4. The label is what
// makes the sheets usable: a cell can be referred back to its exact shot.
async function buildSheets(file, shots, outputDir, tag, maxFrames = 120) {
	const work = fs.mkdtempSync(path.join(os.tmpdir(), 'sheet-'));
	try {
		const step = Math.max(1, Math.ceil(shots.length / maxFrames));
		const picked = shots.filter((_, i) => i % step === 0).slice(0, maxFrames);
		for (let i = 0; i < picked.length; i++) {
			const s = picked[i];
			// A third into the shot: past the transition, before it changes.
			const at = s.start + Math.min(1.5, s.duration / 3);
			const label = `${s.index} · ${s.duration}s`.replace(/:/g, '\\:');
			await run('ffmpeg', [
				'-y', '-ss', String(at), '-i', file, '-frames:v', '1',
				'-vf', `scale=320:-2,drawtext=fontfile=${FONT}:text='${label}':x=6:y=6:fontsize=16:fontcolor=white:box=1:boxcolor=black@0.65:boxborderw=4`,
				'-q:v', '4', path.join(work, `f${String(i).padStart(4, '0')}.jpg`),
			], 60000);
		}
		const frames = fs.readdirSync(work).filter((f) => f.endsWith('.jpg')).sort();
		if (!frames.length) return {sheets: [], sampledShots: []};

		const pattern = path.join(outputDir, `sheet-${tag}-%02d.jpg`);
		await mustRun('ffmpeg', [
			'-y', '-framerate', '1', '-i', path.join(work, 'f%04d.jpg'),
			'-vf', 'tile=5x4:margin=8:padding=8:color=#111111',
			'-q:v', '6', pattern,
		]);
		const sheets = fs.readdirSync(outputDir).filter((f) => f.startsWith(`sheet-${tag}-`)).sort();
		return {sheets, sampledShots: picked.map((s) => s.index)};
	} finally {
		fs.rmSync(work, {recursive: true, force: true});
	}
}

// ---------- audio ----------

// RMS envelope from raw mono PCM — more reliable than parsing ffmpeg's
// astats output, and it gives a curve we can correlate against the cuts.
async function loudnessEnvelope(file, duration, windowSec = 0.25) {
	const r = await mustRun('ffmpeg', ['-i', file, '-ac', '1', '-ar', '8000', '-f', 's16le', '-'], 5 * 60 * 1000);
	const buf = r.stdout;
	const perWindow = Math.round(8000 * windowSec);
	const env = [];
	for (let i = 0; i + perWindow * 2 <= buf.length; i += perWindow * 2) {
		let sum = 0;
		for (let j = 0; j < perWindow; j++) {
			const v = buf.readInt16LE(i + j * 2) / 32768;
			sum += v * v;
		}
		env.push(Math.sqrt(sum / perWindow));
	}
	return {env, windowSec};
}

function loudnessStats(env, windowSec, cuts, speechSpans) {
	if (!env.length) return null;
	const sorted = [...env].sort((a, b) => a - b);
	const median = pct(sorted, 50);
	const at = (t) => env[Math.floor(t / windowSec)] ?? 0;

	// Are there audio accents on the cuts (SFX/impact hits)?
	let hits = 0;
	for (const t of cuts) {
		const before = at(t - 0.3);
		const after = Math.max(at(t), at(t + 0.15), at(t + 0.3));
		if (before > 0 && after > before * 1.6) hits++;
	}

	// Music bed under narration vs in the clear — how hard they duck.
	const inSpeech = (t) => speechSpans.some(([a, b]) => t >= a && t <= b);
	const speech = [];
	const silence = [];
	env.forEach((v, i) => (inSpeech(i * windowSec) ? speech : silence).push(v));
	const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

	return {
		medianRms: round(median, 4),
		dynamicRange: round(pct(sorted, 95) / (pct(sorted, 20) || 1e-6), 2),
		quietMomentsPerMin: round((env.filter((v) => v < median * 0.25).length * windowSec) / 60, 2),
		cutsWithAudioAccentPct: cuts.length ? Math.round((hits / cuts.length) * 100) : 0,
		underNarrationRms: round(mean(speech), 4),
		inTheClearRms: round(mean(silence), 4),
		duckingRatio: mean(speech) ? round(mean(silence) / mean(speech), 2) : null,
	};
}

// ---------- endpoint ----------

export function registerAnalyze(app, {outputDir}) {
	app.post('/analyze', async (req, res) => {
		const {url, maxSeconds = 300, threshold = 0.25} = req.body || {};
		if (!url || !/^https?:\/\//.test(url)) {
			return res.status(400).json({error: 'body must be {url: "https://..."}'});
		}
		const tag = randomUUID().slice(0, 8);
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), `an-${tag}-`));
		try {
			const {file, strategy} = await acquire(url, dir, Number(maxSeconds) || 0);
			const duration = await probeDuration(file);
			const cuts = await detectCuts(file, Number(threshold) || 0.25);
			const shots = buildShots(cuts, duration);

			const durations = shots.map((s) => s.duration).sort((a, b) => a - b);
			const shotStats = {
				count: shots.length,
				cutsPerMinute: duration ? round((shots.length / duration) * 60, 1) : 0,
				medianSeconds: round(pct(durations, 50)),
				meanSeconds: round(durations.reduce((a, b) => a + b, 0) / (durations.length || 1)),
				p10Seconds: round(pct(durations, 10)),
				p90Seconds: round(pct(durations, 90)),
				shortestSeconds: round(durations[0] || 0),
				longestSeconds: round(durations[durations.length - 1] || 0),
				// How irregular the rhythm is. Machine-made edits sit near 0.
				variability: durations.length
					? round(
							Math.sqrt(
								durations.reduce((a, d) => a + (d - durations.reduce((x, y) => x + y, 0) / durations.length) ** 2, 0) /
									durations.length,
							) / (durations.reduce((x, y) => x + y, 0) / durations.length),
						)
					: 0,
				under2sPct: durations.length ? Math.round((durations.filter((d) => d < 2).length / durations.length) * 100) : 0,
				over6sPct: durations.length ? Math.round((durations.filter((d) => d > 6).length / durations.length) * 100) : 0,
			};

			// Speech timing (free when the video has captions) → do cuts land on
			// narration beats, and how fast is the delivery?
			let speech = null;
			let speechSpans = [];
			try {
				const srt = await fetchSubtitles(url, dir);
				if (srt) {
					const cues = dedupeCues(parseSrt(srt)).filter((c) => c.start <= duration + 5);
					speechSpans = cues.map((c) => [c.start, c.end]);
					const words = cues.map((c) => c.text).join(' ').split(/\s+/).filter(Boolean).length;
					const span = cues.length ? cues[cues.length - 1].end - cues[0].start : 0;
					// Distance from each cut to the nearest sentence/cue boundary.
					const bounds = cues.flatMap((c) => [c.start, c.end]).sort((a, b) => a - b);
					const near = cuts.filter((t) => bounds.some((b) => Math.abs(b - t) < 0.4)).length;
					speech = {
						wpm: span ? Math.round((words / span) * 60) : 0,
						talkTimePct: duration ? Math.round((speechSpans.reduce((a, [s, e]) => a + (e - s), 0) / duration) * 100) : 0,
						cutsOnSpeechBoundaryPct: cuts.length ? Math.round((near / cuts.length) * 100) : 0,
					};
				}
			} catch {
				// No captions — the visual half of the analysis still stands.
			}

			let audio = null;
			try {
				const {env, windowSec} = await loudnessEnvelope(file, duration);
				audio = loudnessStats(env, windowSec, cuts, speechSpans);
				// Downsampled curve, for plotting the music's shape.
				const step = Math.max(1, Math.floor(env.length / 200));
				audio.envelope = env.filter((_, i) => i % step === 0).map((v) => round(v, 4));
			} catch {
				// Silent or audio-less source.
			}

			const {sheets, sampledShots} = await buildSheets(file, shots, outputDir, tag);
			const base = `${req.protocol}://${req.get('host')}`;

			res.json({
				url,
				downloadStrategy: strategy,
				analyzedSeconds: round(duration, 1),
				shotStats,
				speech,
				audio,
				shots,
				sampledShots,
				sheetUrls: sheets.map((f) => `${base}/output/${f}`),
			});
		} catch (err) {
			res.status(500).json({error: String((err && err.message) || err)});
		} finally {
			fs.rmSync(dir, {recursive: true, force: true});
		}
	});
}
