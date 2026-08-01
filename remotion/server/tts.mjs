// Multi-voice TTS: synthesizes a list of tagged segments — each with its own
// voice — through ai33 and concatenates them into ONE mp3, with a natural
// breath between speaker turns. This is what makes "characters speak" mode
// possible: ai33 renders one voice per request, so a dialogue scene needs
// N requests stitched together, and stitching lives here where ffmpeg is.
//
// POST /tts-multi { segments: [{text, voice_id}], apiKey, gapMs? } -> { jobId }
//   apiKey is the ai33 key, passed per-request so this server stores no
//   TTS credentials.
// GET  /tts-multi/:jobId/status -> { status, outputUrl } (same job store as
//   /render and /assemble).
import path from 'path';
import fs from 'fs';
import os from 'os';
import {randomUUID} from 'crypto';
import {execFile} from 'child_process';

const AI33 = 'https://api.ai33.pro/v3';

function run(cmd, args, timeoutMs = 5 * 60 * 1000) {
	return new Promise((resolve, reject) => {
		execFile(cmd, args, {timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024}, (err, stdout, stderr) => {
			if (err) reject(new Error(`${cmd} failed: ${err.message}\n${String(stderr).slice(-1500)}`));
			else resolve({stdout, stderr});
		});
	});
}

async function ai33Synthesize(text, voiceId, apiKey) {
	const form = new FormData();
	form.set('text', text);
	form.set('voice_id', voiceId);
	form.set('speed', '1');
	const submit = await fetch(`${AI33}/text-to-speech`, {
		method: 'POST',
		headers: {'xi-api-key': apiKey},
		body: form,
	});
	if (!submit.ok) throw new Error(`ai33 submit: HTTP ${submit.status} ${(await submit.text()).slice(0, 200)}`);
	const {task_id: taskId} = await submit.json();
	if (!taskId) throw new Error('ai33 submit: no task_id in response');

	// ai33 tasks normally finish in 5-30s; 3s polling for ~4 minutes.
	for (let i = 0; i < 80; i++) {
		await new Promise((r) => setTimeout(r, 3000));
		const poll = await fetch(`${AI33}/task/${taskId}`, {headers: {'xi-api-key': apiKey}});
		if (!poll.ok) continue;
		const j = await poll.json();
		const d = (j && j.data) || j || {};
		const st = String(d.status || '').toLowerCase();
		if (['failed', 'error', 'cancelled'].includes(st)) {
			throw new Error(`ai33 task failed: ${JSON.stringify(d).slice(0, 300)}`);
		}
		const audioUrl = (d.metadata && d.metadata.audio_url) || d.audio_url || j.audio_url;
		if (st === 'done' && audioUrl) {
			const dl = await fetch(audioUrl, {redirect: 'follow'});
			if (!dl.ok) throw new Error(`ai33 audio download: HTTP ${dl.status}`);
			return Buffer.from(await dl.arrayBuffer());
		}
	}
	throw new Error('ai33 task timed out');
}

export function registerTts(app, {jobs, outputDir}) {
	app.post('/tts-multi', (req, res) => {
		const {segments, apiKey, gapMs} = req.body || {};
		if (!Array.isArray(segments) || segments.length === 0) {
			return res.status(400).json({error: 'segments: [{text, voice_id}] is required'});
		}
		if (!apiKey) return res.status(400).json({error: 'apiKey (ai33) is required'});
		for (const s of segments) {
			if (!s || !String(s.text || '').trim() || !s.voice_id) {
				return res.status(400).json({error: 'every segment needs text and voice_id'});
			}
		}

		const jobId = randomUUID();
		jobs.set(jobId, {status: 'rendering', progress: 0, outputFile: null, error: null});
		res.json({jobId});

		(async () => {
			const work = fs.mkdtempSync(path.join(os.tmpdir(), 'ttsmulti-'));
			try {
				// Sequential on purpose: ai33 rate-limits per key, and a scene
				// rarely has more than a handful of turns.
				const files = [];
				for (let i = 0; i < segments.length; i++) {
					const buf = await ai33Synthesize(
						String(segments[i].text).trim(),
						String(segments[i].voice_id),
						String(apiKey),
					);
					const f = path.join(work, `seg${i}.mp3`);
					fs.writeFileSync(f, buf);
					files.push(f);
					const job = jobs.get(jobId);
					if (job) job.progress = 0.9 * ((i + 1) / segments.length);
				}

				// Concat with a short silence between speaker turns so cuts
				// between voices don't butt-join unnaturally.
				const gap = Math.min(2000, Math.max(0, Number(gapMs) || 350)) / 1000;
				const out = path.join(outputDir, `${jobId}.mp3`);
				const args = ['-y'];
				for (const f of files) args.push('-i', f);
				const parts = [];
				const labels = [];
				files.forEach((_, i) => {
					const pad = i < files.length - 1 ? `,apad=pad_dur=${gap.toFixed(3)}` : '';
					parts.push(`[${i}:a]aformat=sample_rates=44100:channel_layouts=mono${pad}[s${i}]`);
					labels.push(`[s${i}]`);
				});
				parts.push(`${labels.join('')}concat=n=${files.length}:v=0:a=1[out]`);
				args.push('-filter_complex', parts.join(';'), '-map', '[out]', '-b:a', '128k', out);
				await run('ffmpeg', args);

				jobs.set(jobId, {status: 'done', progress: 1, outputFile: `${jobId}.mp3`, error: null});
			} catch (err) {
				jobs.set(jobId, {
					status: 'error',
					progress: 0,
					outputFile: null,
					error: String((err && err.message) || err),
				});
			} finally {
				try {
					fs.rmSync(work, {recursive: true, force: true});
				} catch {}
			}
		})();
	});
}
