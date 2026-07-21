// POST /transcript {url} — turns a YouTube link into a clean transcript for
// the Script Library. Strategy: existing subtitles via yt-dlp first (free,
// seconds), Whisper on the extracted audio as fallback (needs
// OPENAI_API_KEY on the host). Returns the cleaned SRT, plain text and
// pacing stats (WPM, duration) so n8n can fill the Airtable row directly.
import {execFile} from 'child_process';
import {promisify} from 'util';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {randomUUID} from 'crypto';

const run = promisify(execFile);
const YTDLP = process.env.YTDLP_PATH || 'yt-dlp';

// ---------- SRT helpers ----------

function parseSrt(srt) {
	// -> [{start, end, text}] in seconds. Tolerates VTT-ish timestamps too.
	const cues = [];
	const blocks = srt.replace(/\r/g, '').split(/\n\n+/);
	const ts = /(\d{1,2}):(\d{2}):(\d{2})[.,](\d{3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[.,](\d{3})/;
	for (const b of blocks) {
		const m = b.match(ts);
		if (!m) continue;
		const start = +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 1000;
		const end = +m[5] * 3600 + +m[6] * 60 + +m[7] + +m[8] / 1000;
		const text = b
			.slice(b.indexOf(m[0]) + m[0].length)
			.replace(/<[^>]+>/g, '') // strip styling/karaoke tags
			.replace(/\n+/g, ' ')
			.replace(/\s+/g, ' ')
			.trim();
		if (text) cues.push({start, end, text});
	}
	return cues;
}

// YouTube auto-captions repeat text across rolling cues ("hello world" /
// "hello world how are you"). Keep a cue only for the part it adds.
function dedupeCues(cues) {
	const out = [];
	let prevText = '';
	for (const c of cues) {
		let text = c.text;
		if (prevText && text.startsWith(prevText)) {
			text = text.slice(prevText.length).trim();
		} else if (prevText && prevText.endsWith(text)) {
			text = '';
		}
		prevText = c.text;
		if (text) out.push({...c, text});
	}
	return out;
}

function fmtTime(s) {
	const h = String(Math.floor(s / 3600)).padStart(2, '0');
	const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
	const sec = String(Math.floor(s % 60)).padStart(2, '0');
	const ms = String(Math.round((s % 1) * 1000)).padStart(3, '0');
	return `${h}:${m}:${sec},${ms}`;
}

function cuesToSrt(cues) {
	return cues
		.map((c, i) => `${i + 1}\n${fmtTime(c.start)} --> ${fmtTime(c.end)}\n${c.text}`)
		.join('\n\n');
}

function stats(cues) {
	if (!cues.length) return {words: 0, durationSeconds: 0, wpm: 0, hookWpm: 0};
	const text = cues.map((c) => c.text).join(' ');
	const words = text.split(/\s+/).filter(Boolean).length;
	const durationSeconds = Math.round(cues[cues.length - 1].end - cues[0].start);
	const wpm = durationSeconds ? Math.round((words / durationSeconds) * 60) : 0;
	// First 30s = the hook; its pace is usually hotter than the body.
	const hookCues = cues.filter((c) => c.start - cues[0].start < 30);
	const hookWords = hookCues.map((c) => c.text).join(' ').split(/\s+/).filter(Boolean).length;
	const hookSpan = hookCues.length ? Math.min(30, hookCues[hookCues.length - 1].end - cues[0].start) : 0;
	const hookWpm = hookSpan ? Math.round((hookWords / hookSpan) * 60) : 0;
	return {words, durationSeconds, wpm, hookWpm};
}

// ---------- acquisition ----------

async function fetchSubtitles(url, dir) {
	// Manual subs first, auto-captions second; English/Romanian preferred.
	await run(
		YTDLP,
		[
			'--skip-download',
			'--write-subs',
			'--write-auto-subs',
			'--sub-langs', 'en.*,ro.*',
			'--convert-subs', 'srt',
			'-o', path.join(dir, 'subs.%(ext)s'),
			url,
		],
		{timeout: 120000},
	);
	const srtFile = fs.readdirSync(dir).find((f) => f.endsWith('.srt'));
	if (!srtFile) return null;
	return fs.readFileSync(path.join(dir, srtFile), 'utf8');
}

async function whisperTranscribe(url, dir) {
	const key = process.env.OPENAI_API_KEY;
	if (!key) {
		throw new Error(
			'No subtitles on this video and OPENAI_API_KEY is not set on the render server, so the Whisper fallback is unavailable.',
		);
	}
	const audioPath = path.join(dir, 'audio.mp3');
	await run(
		YTDLP,
		['-f', 'bestaudio', '-x', '--audio-format', 'mp3', '--audio-quality', '64K', '-o', audioPath, url],
		{timeout: 300000},
	);
	const size = fs.statSync(audioPath).size;
	if (size > 24 * 1024 * 1024) {
		throw new Error(`Audio is ${(size / 1e6).toFixed(0)}MB — over Whisper's 25MB limit. Use a shorter video.`);
	}
	const form = new FormData();
	form.append('file', new Blob([fs.readFileSync(audioPath)], {type: 'audio/mpeg'}), 'audio.mp3');
	form.append('model', 'whisper-1');
	form.append('response_format', 'srt');
	const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
		method: 'POST',
		headers: {Authorization: `Bearer ${key}`},
		body: form,
	});
	if (!res.ok) throw new Error(`Whisper API: HTTP ${res.status} — ${(await res.text()).slice(0, 300)}`);
	return res.text();
}

// ---------- endpoint ----------

export function registerTranscript(app) {
	app.post('/transcript', async (req, res) => {
		const url = req.body && req.body.url;
		if (!url || !/^https?:\/\//.test(url)) {
			return res.status(400).json({error: 'body must be {url: "https://..."}'});
		}
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), `tr-${randomUUID().slice(0, 8)}-`));
		try {
			let source = 'subtitles';
			let rawSrt = null;
			try {
				rawSrt = await fetchSubtitles(url, dir);
			} catch (e) {
				// Subtitle fetch itself failed (blocked, private…) — the Whisper
				// path downloads differently, so still try it.
			}
			if (!rawSrt) {
				source = 'whisper';
				rawSrt = await whisperTranscribe(url, dir);
			}
			const cues = dedupeCues(parseSrt(rawSrt));
			if (!cues.length) throw new Error('Transcript came back empty after cleaning.');
			res.json({
				source,
				srt: cuesToSrt(cues),
				text: cues.map((c) => c.text).join(' '),
				stats: stats(cues),
			});
		} catch (err) {
			res.status(500).json({error: String((err && err.message) || err)});
		} finally {
			fs.rmSync(dir, {recursive: true, force: true});
		}
	});
}
