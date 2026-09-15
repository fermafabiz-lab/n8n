// Visual inspection endpoint: lets the automation (and Claude, whose sandbox
// cannot reach media hosts directly) SEE a rendered video. Downloads the
// media here (this box can reach Drive/fal/etc.), runs ffmpeg, and returns
// an image synchronously:
//   GET /inspect?url=<media>&mode=sheet             -> grid of frames (jpg)
//   GET /inspect?url=<media>&mode=frame&t=2.5       -> single full-res frame
//   GET /inspect?url=<media>&mode=wave              -> audio waveform picture
//   ...&save=1                                      -> {url} under /output instead
//
// `save=1` exists for the MOTION JUDGE in Media Generation. A vision model
// has to be handed the picture somehow, and the two ways of doing that are
// not equal: base64 in the request body means every sheet travels through
// n8n's execution data (hundreds of kB per scene, on a node that runs once
// per clip of an eighty-scene film), whereas a URL costs nothing and is
// exactly how `Consistency Judge` already feeds it the frame it judges. So
// the sheet is written under /output — which is deliberately key-free, with
// unguessable names, for precisely this reason — and only its URL travels.
import path from 'path';
import fs from 'fs';
import os from 'os';
import {randomUUID} from 'crypto';
import {execFile} from 'child_process';

// Sheets are scaffolding: a judge looks at one once, within seconds. Sweep
// anything older than this on the way past, so a long pass cannot fill the
// container's disk with pictures nobody will ever open again. Best-effort —
// a failed sweep must never fail the inspection that triggered it.
const SAVED_TTL_MS = 2 * 60 * 60 * 1000;
function sweepSaved(dir) {
	try {
		const now = Date.now();
		for (const f of fs.readdirSync(dir)) {
			if (!f.startsWith('inspect-') || !f.endsWith('.jpg')) continue;
			const full = path.join(dir, f);
			try {
				if (now - fs.statSync(full).mtimeMs > SAVED_TTL_MS) fs.unlinkSync(full);
			} catch {}
		}
	} catch {}
}

function run(cmd, args, timeoutMs = 3 * 60 * 1000) {
	return new Promise((resolve, reject) => {
		execFile(cmd, args, {timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024}, (err, stdout, stderr) => {
			if (err) reject(new Error(`${cmd} failed: ${err.message}\n${String(stderr).slice(-1500)}`));
			else resolve({stdout, stderr});
		});
	});
}

export function registerInspect(app, {outputDir} = {}) {
	app.get('/inspect', async (req, res) => {
		const {url, mode = 'sheet', t = '1', interval = '3', save} = req.query;
		const wantSave = save === '1' || save === 'true';
		if (wantSave && !outputDir) return res.status(500).json({error: 'save=1 needs an output dir'});
		if (!url) return res.status(400).json({error: 'url query param is required'});

		const work = fs.mkdtempSync(path.join(os.tmpdir(), 'inspect-'));
		const input = path.join(work, 'input.media');
		const output = path.join(work, 'out.jpg');
		try {
			const dl = await fetch(String(url), {redirect: 'follow'});
			if (!dl.ok) throw new Error(`download: HTTP ${dl.status}`);
			fs.writeFileSync(input, Buffer.from(await dl.arrayBuffer()));

			if (mode === 'frame') {
				await run('ffmpeg', ['-y', '-ss', String(t), '-i', input, '-frames:v', '1', '-q:v', '3', output]);
			} else if (mode === 'wave') {
				await run('ffmpeg', ['-y', '-i', input, '-filter_complex',
					'showwavespic=s=1600x360:colors=#F5B841', '-frames:v', '1', output]);
			} else {
				// Contact sheet: one frame every `interval` seconds, 4 per row,
				// small enough to travel as base64 through n8n execution data.
				const iv = Math.max(1, Number(interval) || 3);
				await run('ffmpeg', ['-y', '-i', input, '-vf',
					`fps=1/${iv},scale=400:-1,tile=4x5:margin=4:padding=4`,
					'-frames:v', '1', '-q:v', '5', output]);
			}
			if (wantSave) {
				sweepSaved(outputDir);
				const name = `inspect-${randomUUID()}.jpg`;
				fs.copyFileSync(output, path.join(outputDir, name));
				// Behind Railway's proxy req.protocol is http, and this URL is handed
				// to OpenAI to fetch. It works today, but a plain-http image URL is
				// exactly the kind of thing a fetcher tightens up on later.
				const proto = String(req.headers['x-forwarded-proto'] || req.protocol).split(',')[0].trim();
				const base = `${proto}://${req.get('host')}`;
				return res.json({file: name, url: `${base}/output/${name}`});
			}
			const img = fs.readFileSync(output);
			res.setHeader('Content-Type', 'image/jpeg');
			res.send(img);
		} catch (err) {
			res.status(500).json({error: String((err && err.message) || err)});
		} finally {
			fs.rmSync(work, {recursive: true, force: true});
		}
	});
}
