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
	if (req.method === 'GET' && (req.path.startsWith('/output/') || req.path === '/health')) {
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
	const inputProps = req.body;
	if (!inputProps || !inputProps.finalVideoUrl) {
		return res.status(400).json({error: 'finalVideoUrl is required in the request body'});
	}

	const jobId = randomUUID();
	jobs.set(jobId, {status: 'rendering', progress: 0, outputFile: null, error: null});
	res.json({jobId});

	(async () => {
		try {
			const serveUrl = await getBundleLocation();
			const composition = await selectComposition({serveUrl, id: 'FinalVideo', inputProps});
			const outputLocation = path.join(OUTPUT_DIR, `${jobId}.mp4`);

			await renderMedia({
				composition,
				serveUrl,
				codec: 'h264',
				outputLocation,
				inputProps,
				// Railway's plan caps this container at 1GB RAM. Parallel Chrome
				// tabs (Remotion's default concurrency) blow past that and hang
				// mid-frame. Serialize rendering and give each frame more time
				// to land on a slow/shared vCPU instead of timing out.
				concurrency: 1,
				timeoutInMilliseconds: 120000,
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

			jobs.set(jobId, {status: 'done', progress: 1, outputFile: `${jobId}.mp4`, error: null});
		} catch (err) {
			jobs.set(jobId, {
				status: 'error',
				progress: 0,
				outputFile: null,
				error: String((err && err.message) || err),
			});
		}
	})();
});

registerAssemble(app, {jobs, outputDir: OUTPUT_DIR});
registerInspect(app);

// Shared status endpoint for render and assemble jobs.
app.get(['/render/:jobId/status', '/assemble/:jobId/status'], (req, res) => {
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Remotion render server listening on :${PORT}`));
