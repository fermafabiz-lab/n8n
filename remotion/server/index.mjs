// Self-hosted render server (Railway/Render/any Node host). Renders the
// FinalVideo composition on demand and serves the output file over HTTP —
// no AWS account needed. n8n calls this the same way it already calls
// fal/useapi: POST to start, poll a status URL, download the result.
import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import {fileURLToPath} from 'url';
import {randomUUID} from 'crypto';
import {bundle} from '@remotion/bundler';
import {renderMedia, selectComposition} from '@remotion/renderer';
import {registerAssemble} from './assemble.mjs';
import {registerInspect} from './inspect.mjs';
import {registerTranscript} from './transcript.mjs';
import {registerAnalyze} from './analyze.mjs';
import {registerTts} from './tts.mjs';
import {registerCaptionColor} from './captionColor.mjs';
import {normalizeSpeed, applySpeed} from './speed.mjs';

// Which engine draws the graphics pass when a request does not say. Anything
// but the two names falls back to Remotion rather than failing a film over a
// typo in a variable.
const ENGINES = new Set(['remotion', 'hyperframes']);
const DEFAULT_ENGINE = ENGINES.has(String(process.env.RENDER_ENGINE || '').toLowerCase())
	? String(process.env.RENDER_ENGINE).toLowerCase()
	: 'remotion';
const resolveEngine = (raw) => {
	const e = String(raw || '').toLowerCase();
	return ENGINES.has(e) ? e : DEFAULT_ENGINE;
};
// Hyperframes runs one Chrome per worker. Four measured ~3 GB peak together
// with ffmpeg on the 41 s fixture, which leaves room on the 8 GB container
// for an /assemble running beside it. Raise with HF_WORKERS once measured on
// Railway itself.
const HF_WORKERS = Math.max(1, Math.min(8, Number(process.env.HF_WORKERS) || 4));

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, 'output');
fs.mkdirSync(OUTPUT_DIR, {recursive: true});

const app = express();
app.use(cors());
app.use(express.json({limit: '5mb'}));

// Shared-secret auth, same pattern as the FAL/useapi header auth already used
// throughout the n8n pipeline. Set RENDER_API_KEY on the host; leave unset
// only for local testing.
const API_KEY = process.env.RENDER_API_KEY;
app.use((req, res, next) => {
	if (!API_KEY) return next();
	// /output stays key-free: Remotion's OffthreadVideo re-fetches the
	// assembled video from our own /output URL and cannot send headers, and
	// Airtable/browsers need to fetch results too. Filenames are UUIDs and
	// files are ephemeral, so unauthenticated reads are acceptable.
	if (
		req.method === 'GET' &&
		(req.path.startsWith('/output/') || req.path === '/health' || req.path === '/media')
	) {
		return next();
	}
	if (req.headers['x-api-key'] !== API_KEY) {
		return res.status(401).json({error: 'unauthorized'});
	}
	next();
});

// Bundle once (on first request) and reuse for every render — bundling is
// the slow part, actual renders reuse this serveUrl.
let bundleLocationPromise = null;
function getBundleLocation() {
	if (!bundleLocationPromise) {
		bundleLocationPromise = bundle({
			entryPoint: path.join(__dirname, '..', 'src', 'index.ts'),
			onProgress: () => {},
		});
	}
	return bundleLocationPromise;
}

const jobs = new Map(); // jobId -> {status, progress, outputFile, error}

app.post('/render', async (req, res) => {
	// `speed` is OURS, not Remotion's: it is stripped out here so the props the
	// composition receives stay byte-identical to what they were before this
	// existed. The film is re-timed after it is drawn — see speed.mjs for why
	// that is the only place it can happen without three surfaces drifting
	// apart. An unrecognised value normalizes to 1, i.e. leaves the film alone.
	const {speed: rawSpeed, resolution: rawResolution, engine: rawEngine, ...inputProps} = req.body ?? {};
	// `engine` is ours as well, stripped like the two above: which renderer
	// draws the graphics pass. The request can name one (for comparing them on
	// one film); otherwise RENDER_ENGINE on the host decides, and Remotion
	// until that is set — so switching, and switching back, is one variable on
	// Railway and never a deploy. See render-hf.mjs.
	const engine = resolveEngine(rawEngine);
	const speed = normalizeSpeed(rawSpeed);
	// `resolution` is ours too, and stripped for the same reason: the props the
	// composition receives must stay byte-identical to what they were before it
	// existed. It is not a prop, it is a SCALE — the composition stays
	// 1280x720 and Remotion draws it at 1.5x device pixels, so type stays
	// vector-crisp and the footage is read at its own resolution rather than
	// being upscaled from a 720p raster. Which is why upscaling the clips and
	// rendering at 1080p belong together: at 1.5x over 720p clips there is no
	// extra detail to draw.
	//
	// It costs 2.09x the render time per frame — measured on this composition,
	// 0.107s at 720p against 0.224s at 1080p, which is the pixel ratio almost
	// exactly. Memory is unchanged (+5%), because the OffthreadVideo cache is
	// capped in bytes and simply holds fewer frames.
	const scale = String(rawResolution || '720p').toLowerCase() === '1080p' ? 1.5 : 1;
	if (!inputProps || !inputProps.finalVideoUrl) {
		return res.status(400).json({error: 'finalVideoUrl is required in the request body'});
	}

	const jobId = randomUUID();
	jobs.set(jobId, {status: 'rendering', progress: 0, outputFile: null, error: null, engine});
	res.json({jobId});

	(async () => {
		try {
			const outputLocation = path.join(OUTPUT_DIR, `${jobId}.mp4`);
			if (engine === 'hyperframes') {
				// Loaded on first use, not at boot: this server also runs
				// /assemble, TTS and /inspect, and a Hyperframes install that
				// fails to load must cost the Hyperframes renders, not the box.
				const {renderWithHyperframes} = await import('./render-hf.mjs');
				await renderWithHyperframes({
					inputProps,
					scale,
					outputLocation,
					outputDir: OUTPUT_DIR,
					workers: HF_WORKERS,
					onProgress: (progress) => {
						const job = jobs.get(jobId);
						if (job) job.progress = progress;
					},
				});
			} else {
				const serveUrl = await getBundleLocation();
				const composition = await selectComposition({serveUrl, id: 'FinalVideo', inputProps});

				await renderMedia({
					composition,
					serveUrl,
					codec: 'h264',
					// 1 or 1.5 — see the note where it is computed. The composition
					// dimensions are untouched; this multiplies the output.
					scale,
					outputLocation,
					inputProps,
					// The container has 8GB. Parallel Chrome tabs (Remotion's default
					// concurrency) blow past it and hang mid-frame, so rendering is
					// serialized and each frame gets longer to land on a shared vCPU.
					concurrency: 1,
					timeoutInMilliseconds: 120000,
					// THE cause of two dead renders on the 15-scene Tahiti film
					// (2026-08-13). Remotion's OffthreadVideo frame cache defaults to
					// null, which means HALF THE SYSTEM MEMORY at render start — 4GB
					// here — on top of Chrome under swangle and the ffmpeg encode.
					// Peak hit 7.91GB against an 8GB limit and the kernel killed the
					// compositor. n8n reports that as "Compositor exited with signal
					// SIGKILL / Remotion render failed", which names neither memory
					// nor the cache, and it only bites once a film is long enough:
					// every earlier render here finished in 2-4 minutes and fitted.
					// A cap costs cache hits, not correctness — at concurrency 1 the
					// frames are read in order and barely reused.
					offthreadVideoCacheSizeInBytes: 1024 * 1024 * 1024,
					chromiumOptions: {
						// No GPU in this container; disabling it avoids Chrome trying
						// (and failing) to init hardware acceleration, which otherwise
						// burns memory/time before every render.
						gl: 'swangle',
						disableWebSecurity: false,
					},
					onProgress: ({progress}) => {
						const job = jobs.get(jobId);
						if (job) job.progress = progress;
					},
				});
			}

			// The speed pass, if the film is not being left at its natural rate.
			// It replaces the served file rather than adding a second one, so
			// every caller downstream — the status endpoint, n8n's download, the
			// Drive upload — keeps working with no knowledge of it.
			//
			// A FAILURE HERE MUST NOT LOSE THE FILM. The render is the expensive
			// part (minutes of headless Chrome); the re-time is seconds. If
			// ffmpeg refuses, the job completes with the un-retimed film and says
			// so in `speedError`, because shipping the film at the wrong speed is
			// obviously better than shipping nothing and making the producer
			// re-render to find out why.
			let served = `${jobId}.mp4`;
			let speedError = null;
			if (speed !== 1) {
				const job = jobs.get(jobId);
				if (job) job.status = 'retiming';
				const retimed = path.join(OUTPUT_DIR, `${jobId}-x${speed}.mp4`);
				try {
					await applySpeed(outputLocation, retimed, speed);
					served = path.basename(retimed);
				} catch (err) {
					speedError = String((err && err.message) || err);
				}
			}
			jobs.set(jobId, {
				status: 'done',
				progress: 1,
				outputFile: served,
				error: null,
				speed,
				speedError,
				engine,
			});
		} catch (err) {
			jobs.set(jobId, {
				status: 'error',
				progress: 0,
				outputFile: null,
				error: String((err && err.message) || err),
				engine,
			});
		}
	})();
});

registerAssemble(app, {jobs, outputDir: OUTPUT_DIR});
registerInspect(app, {outputDir: OUTPUT_DIR});
registerTranscript(app, {outputDir: OUTPUT_DIR});
registerAnalyze(app, {outputDir: OUTPUT_DIR});
registerTts(app, {jobs, outputDir: OUTPUT_DIR});
registerCaptionColor(app);

// Shared status endpoint for render and assemble jobs.
app.get(['/render/:jobId/status', '/assemble/:jobId/status', '/tts-multi/:jobId/status'], (req, res) => {
	const job = jobs.get(req.params.jobId);
	if (!job) return res.status(404).json({error: 'job not found'});

	const base = `${req.protocol}://${req.get('host')}`;
	res.json({
		...job,
		outputUrl: job.outputFile ? `${base}/output/${job.outputFile}` : null,
	});
});

// Serves finished renders. Files live only as long as this container is
// running — n8n should download/re-host (e.g. to Google Drive) right after
// a render completes, not treat this as permanent storage.
app.use('/output', express.static(OUTPUT_DIR));

app.get('/health', (req, res) => res.json({ok: true}));

// GET /media?id=<driveFileId> — streams a Google Drive file with a proper
// Content-Type so the site's native <audio>/<video> tags can play it (Drive's
// own uc?export=download links answer with redirects/HTML and no usable MIME).
// Drive-only by construction (the id is interpolated into a Drive URL), so
// this is not an open proxy; file ids are unguessable, hence key-free like
// /output.
app.get('/media', async (req, res) => {
	const id = String(req.query.id || '');
	if (!/^[\w-]{10,}$/.test(id)) return res.status(400).json({error: 'invalid id'});
	try {
		const r = await fetch(`https://drive.google.com/uc?export=download&id=${id}`, {
			redirect: 'follow',
		});
		if (!r.ok) return res.status(502).json({error: `drive: HTTP ${r.status}`});
		const buf = Buffer.from(await r.arrayBuffer());
		if (buf.slice(0, 15).toString().toLowerCase().includes('<!doctype html')) {
			return res.status(502).json({error: 'drive returned an HTML page, not media'});
		}
		const ct = r.headers.get('content-type');
		res.set('Content-Type', ct && !ct.includes('html') ? ct : 'application/octet-stream');
		res.set('Cache-Control', 'public, max-age=3600');
		res.send(buf);
	} catch (err) {
		res.status(500).json({error: String((err && err.message) || err)});
	}
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Remotion render server listening on :${PORT}`));
