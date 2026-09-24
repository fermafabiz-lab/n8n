// The graphics pass drawn by Hyperframes instead of Remotion.
//
// Same input (FinalVideoProps + the montage), same output (one h264 mp4 at
// the canvas's size or 1.5x it), same components: the page is src/hf/entry.tsx,
// which runs FinalVideo through a Remotion-compatible shim. What differs is
// only who drives Chrome and who encodes — which is also the whole reason for
// the switch: Hyperframes is Apache 2.0, and Remotion needs a company licence
// once a team is more than three people.
//
// It will not be faster. Both engines seek headless Chrome one frame at a
// time and pipe screenshots to ffmpeg; the per-frame cost is the composition's.
//
// Four decisions worth knowing before changing anything here:
//
// 1. THE MONTAGE IS DECLARED IN HTML, NOT BY REACT. Hyperframes reads which
//    videos to decode from the page's HTML before any script runs, then
//    injects the decoded frame for each capture. So the page carries one
//    `<video id="hov-montage">` timed like FinalVideo's footage Sequence, and
//    the shim's OffthreadVideo moves that element into place.
//
// 2. THE MONTAGE IS READ FROM DISK when it is one of our own outputs — which
//    in production it always is (`finalVideoUrl` is this server's
//    /output/<id>.mp4). Anything else is downloaded first, once.
//
// 3. THE SOUND IS COPIED, NOT RE-MIXED. The page's video is muted and the
//    film's audio track is the montage's, muxed back with `-c:a copy`. The
//    montage's mix (ducking, loudness to -20 LUFS) was done by /assemble and
//    must reach the viewer untouched; handing it to another engine's mixer
//    is a second place for loudness to change.
//
// 4. 1080p IS A CSS SCALE, NOT A DEVICE SCALE. Hyperframes only supersamples
//    by whole numbers, and 720p → 1080p is 1.5x. So the page is 1.5x the
//    canvas and the composition inside it is scaled by a transform — the
//    same thing Remotion's `scale: 1.5` does: the layout stays 1280x720, type
//    stays vector, and the footage is sampled from its own resolution.

import fs from 'fs';
import os from 'os';
import path from 'path';
import {randomUUID} from 'crypto';
import {execFile} from 'child_process';
import {createRenderJob, executeRenderJob} from '@hyperframes/producer';
import {bundleHfPage} from './hf-bundle.mjs';

const FPS = 24;
const BUNDLE_DIR = path.join(os.tmpdir(), 'hov-hf-bundle');

// Bundled once per process, like Remotion's serveUrl: every render reuses it.
let bundlePromise = null;
function getBundle() {
	if (!bundlePromise) {
		bundlePromise = (async () => {
			fs.rmSync(BUNDLE_DIR, {recursive: true, force: true});
			fs.mkdirSync(BUNDLE_DIR, {recursive: true});
			return bundleHfPage(BUNDLE_DIR);
		})().catch((err) => {
			bundlePromise = null;
			throw err;
		});
	}
	return bundlePromise;
}

/** The same canvas and length hf/entry.tsx computes; see src/metadata.ts. */
function metadata(props) {
	const scenes = Array.isArray(props.scenes) ? props.scenes : [];
	const last = scenes[scenes.length - 1];
	const videoSeconds = last ? last.startSeconds + last.durationSeconds : 0;
	const intro = props.introDurationInSeconds ?? 0;
	const outro = props.showEndScreen === false ? 0 : (props.outroDurationInSeconds ?? 4);
	const portrait = props.aspectRatio === '9:16';
	return {
		durationInFrames: Math.max(1, Math.round((intro + videoSeconds + outro) * FPS)),
		width: portrait ? 720 : 1280,
		height: portrait ? 1280 : 720,
		montageSeconds: Math.round(videoSeconds * FPS) / FPS,
	};
}
// scripts/check-shim.mjs holds this to src/metadata.ts on every fixture.
export {metadata as metadataForTest};

/** `</script>` inside a caption must not end the props block. */
const inlineJson = (value) => JSON.stringify(value).replace(/</g, '\\u003c');

function pageHtml({props, meta, scale, bundle}) {
	const W = meta.width;
	const H = meta.height;
	const PW = Math.round(W * scale);
	const PH = Math.round(H * scale);
	return `<!doctype html>
<html lang="ro"><head><meta charset="UTF-8"/>
<meta name="viewport" content="width=${PW}, height=${PH}"/>
<meta data-composition-id="main" data-width="${PW}" data-height="${PH}"/>
<link rel="stylesheet" href="${bundle.stylesheet}"/>
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:${PW}px;height:${PH}px;overflow:hidden;background:#000}
#stage{position:relative;width:${PW}px;height:${PH}px;overflow:hidden}
#hov-root{position:absolute;left:0;top:0;width:${W}px;height:${H}px;transform:scale(${scale});transform-origin:0 0}
#hov-park{position:absolute;width:0;height:0;overflow:hidden}
.clip{position:absolute;top:0;left:0;width:100%;height:100%;visibility:hidden;object-fit:contain}
</style></head>
<body><div id="stage" data-composition-id="main" data-start="0" data-duration="${meta.durationInFrames / FPS}" data-width="${PW}" data-height="${PH}">
<div id="hov-park"><video id="hov-montage" class="clip" src="montage.mp4" data-start="0" data-duration="${meta.montageSeconds}" data-track-index="0" muted playsinline></video></div>
<div id="hov-root"></div>
</div>
<script id="hov-props" type="application/json">${inlineJson(props)}</script>
<script src="${bundle.script}"></script>
</body></html>
`;
}

function linkOrCopy(src, dest) {
	try {
		fs.linkSync(src, dest);
	} catch {
		fs.copyFileSync(src, dest);
	}
}

async function placeMontage(url, dest, outputDir) {
	if (!url) throw new Error('montage: finalVideoUrl is empty');
	// A local path — scripts/render-local.mjs, never production.
	if (path.isAbsolute(url) && fs.existsSync(url)) return linkOrCopy(url, dest);
	// Our own output: link the file rather than fetch ourselves over HTTP.
	const own = /\/output\/([\w.-]+\.mp4)(?:[?#].*)?$/.exec(url);
	if (own && outputDir) {
		const local = path.join(outputDir, own[1]);
		if (fs.existsSync(local)) return linkOrCopy(local, dest);
	}
	const r = await fetch(url);
	if (!r.ok) throw new Error(`montage: HTTP ${r.status} from ${url}`);
	const type = r.headers.get('content-type') || '';
	if (/^text\/html/i.test(type)) throw new Error(`montage: ${url} served a web page, not a video`);
	fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
}

const run = (cmd, args) =>
	new Promise((resolve, reject) =>
		execFile(cmd, args, {maxBuffer: 16 * 1024 * 1024}, (err, stdout, stderr) =>
			err ? reject(new Error(`${cmd} failed: ${String(stderr).slice(-2000)}`)) : resolve(stdout),
		),
	);

async function hasAudio(file) {
	const out = await run('ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', file]);
	return String(out).trim().length > 0;
}

/**
 * Draw the film. `inputProps` are exactly what Remotion would have received;
 * `scale` is 1 or 1.5. Resolves once `outputLocation` holds the finished mp4.
 */
export async function renderWithHyperframes({inputProps, scale = 1, outputLocation, outputDir, workers, onProgress}) {
	const bundle = await getBundle();
	const meta = metadata(inputProps);
	const jobDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hov-hf-job-'));
	try {
		fs.cpSync(BUNDLE_DIR, jobDir, {recursive: true});
		const montage = path.join(jobDir, 'montage.mp4');
		await placeMontage(inputProps.finalVideoUrl, montage, outputDir);
		fs.writeFileSync(path.join(jobDir, 'index.html'), pageHtml({props: inputProps, meta, scale, bundle}));

		const silent = path.join(jobDir, `graphics-${randomUUID()}.mp4`);
		// `standard` is x264 medium at CRF 18 — Remotion's h264 defaults, so the
		// switch does not quietly change the film's bitrate. SDR forced: the
		// montage is SDR and HDR probing is a pass for nothing.
		const job = createRenderJob({
			fps: FPS,
			quality: 'standard',
			hdrMode: 'force-sdr',
			...(workers ? {workers} : {}),
		});
		await executeRenderJob(job, jobDir, silent, (j) => {
			const p = Number(j.progress) || 0;
			onProgress?.(p > 1 ? p / 100 : p);
		});

		// Sound: the montage's own track, byte for byte (see note 3).
		if (await hasAudio(montage)) {
			await run('ffmpeg', [
				'-y', '-loglevel', 'error',
				'-i', silent, '-i', montage,
				'-map', '0:v:0', '-map', '1:a:0',
				'-c:v', 'copy', '-c:a', 'copy',
				'-movflags', '+faststart',
				outputLocation,
			]);
		} else {
			fs.copyFileSync(silent, outputLocation);
		}
		return {frames: meta.durationInFrames};
	} finally {
		fs.rmSync(jobDir, {recursive: true, force: true});
	}
}
