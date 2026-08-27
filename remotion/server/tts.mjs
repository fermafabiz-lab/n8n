// Multi-voice TTS: synthesizes a list of tagged segments — each with its own
// voice — through ElevenLabs and concatenates them into ONE mp3, with a
// natural breath between speaker turns. This is what makes "characters speak"
// mode possible: one voice per request, so a dialogue scene needs N requests
// stitched together, and stitching lives here where ffmpeg is.
//
// POST /tts-multi { segments: [{text, voice_id}], gapMs? } -> { jobId }
// GET  /tts-multi/:jobId/status -> { status, outputUrl } (same job store as
//   /render and /assemble).
//
// The key comes from THIS server's environment, not from the request body.
// It used to travel in the body, which meant it also sat in plaintext inside
// an n8n node's JSON expression — visible to anyone who opened the node, and
// carried into every export of that workflow. `apiKey` in the body is still
// accepted so an older caller does not break mid-migration, but nothing sends
// it any more and the fallback should go once nothing does.
import path from 'path';
import fs from 'fs';
import os from 'os';
import {randomUUID} from 'crypto';
import {execFile} from 'child_process';

const ELEVEN = 'https://api.elevenlabs.io/v1';
/**
 * The model ai33 never let us choose. `eleven_multilingual_v2` is the closest
 * equivalent to what it was doing on our behalf, and it is what the n8n nodes
 * ask for too — the two must agree, or a regenerated line comes back in a
 * different voice character from the batch that made its neighbours.
 */
const MODEL = 'eleven_multilingual_v2';

function run(cmd, args, timeoutMs = 5 * 60 * 1000) {
	return new Promise((resolve, reject) => {
		execFile(cmd, args, {timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024}, (err, stdout, stderr) => {
			if (err) reject(new Error(`${cmd} failed: ${err.message}\n${String(stderr).slice(-1500)}`));
			else resolve({stdout, stderr});
		});
	});
}

/**
 * One line, one voice, one request.
 *
 * ai33 worked on tasks — submit, then poll every three seconds until an audio
 * URL appeared, then download it. ElevenLabs answers with the mp3, so the
 * whole loop and its runaway-guard are gone. Measured on a real line: 2.7s
 * for one call against a 3s minimum for a single poll cycle.
 *
 * The stored ids carry an `elevenlabs_` prefix from the ai33 era. It is
 * stripped here rather than migrated in the database, because that prefix is
 * also the validity test in five places (`voice_id.includes('_')`) — remove it
 * from storage and an empty id becomes indistinguishable from a missing one.
 */
async function synthesize(text, voiceId, apiKey) {
	const id = String(voiceId).replace(/^elevenlabs_/, '');
	const res = await fetch(`${ELEVEN}/text-to-speech/${encodeURIComponent(id)}`, {
		method: 'POST',
		headers: {'xi-api-key': apiKey, 'Content-Type': 'application/json'},
		body: JSON.stringify({text, model_id: MODEL}),
	});
	if (!res.ok) {
		// The body carries ElevenLabs' own reason — a dead voice id, an
		// exhausted quota — and losing it would turn every failure into "HTTP
		// 400" with nothing to act on.
		throw new Error(`ElevenLabs TTS: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
	}
	return Buffer.from(await res.arrayBuffer());
}

export function registerTts(app, {jobs, outputDir}) {
	app.post('/tts-multi', (req, res) => {
		const {segments, apiKey: bodyKey, gapMs} = req.body || {};
		const apiKey = process.env.ELEVENLABS_API_KEY || bodyKey;
		if (!Array.isArray(segments) || segments.length === 0) {
			return res.status(400).json({error: 'segments: [{text, voice_id}] is required'});
		}
		if (!apiKey) {
			return res
				.status(500)
				.json({error: 'ELEVENLABS_API_KEY is not set on the render server'});
		}
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
				// Sequential on purpose. The account allows five concurrent
				// requests, so this could be parallel — but it was sequential
				// under ai33's per-key rate limit and a scene rarely has more
				// than a handful of turns. One change at a time.
				const files = [];
				for (let i = 0; i < segments.length; i++) {
					const buf = await synthesize(
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
