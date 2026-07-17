// Visual inspection endpoint: lets the automation (and Claude, whose sandbox
// cannot reach media hosts directly) SEE a rendered video. Downloads the
// media here (this box can reach Drive/fal/etc.), runs ffmpeg, and returns
// an image synchronously:
//   GET /inspect?url=<media>&mode=sheet             -> grid of frames (jpg)
//   GET /inspect?url=<media>&mode=frame&t=2.5       -> single full-res frame
//   GET /inspect?url=<media>&mode=wave              -> audio waveform picture
import path from 'path';
import fs from 'fs';
import os from 'os';
import {execFile} from 'child_process';

function run(cmd, args, timeoutMs = 3 * 60 * 1000) {
	return new Promise((resolve, reject) => {
		execFile(cmd, args, {timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024}, (err, stdout, stderr) => {
			if (err) reject(new Error(`${cmd} failed: ${err.message}\n${String(stderr).slice(-1500)}`));
			else resolve({stdout, stderr});
		});
	});
}

export function registerInspect(app) {
	app.get('/inspect', async (req, res) => {
		const {url, mode = 'sheet', t = '1', interval = '3'} = req.query;
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
