// Derive a caption accent colour from the footage it will sit on.
//
// The caption colour used to be a constant (#E8B84B) that no project ever
// overrode, which is most of why the graphics read as generated. The fix has
// two halves: white by default (src/captionColor.ts), and this — a colour a
// project can opt into that is actually about ITS pictures.
//
// The measurement deliberately looks at the caption BAND, not the whole frame.
// An accent has one job, which is to be legible and deliberate over the strip
// of picture directly behind the words; the sky at the top of the frame has no
// vote. On the tahiti montage the difference is large: the full frame averages
// a dark teal because most of it is night water, while the band behind the
// captions carries the dock lights and is markedly warmer.
import {execFile} from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const FRAMES = 24;
/** Captions sit in the bottom sixth or so; sample a band around them. */
const BAND_TOP = 0.68;
const BAND_HEIGHT = 0.24;

function run(cmd, args, timeoutMs = 3 * 60 * 1000) {
	return new Promise((resolve, reject) => {
		execFile(
			cmd,
			args,
			{timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, encoding: 'buffer'},
			(err, stdout, stderr) => {
				if (err) reject(new Error(`${cmd} failed: ${err.message}\n${String(stderr).slice(-2000)}`));
				else resolve(stdout);
			},
		);
	});
}

async function download(url, dest) {
	const res = await fetch(url, {redirect: 'follow'});
	if (!res.ok) throw new Error(`download ${url}: HTTP ${res.status}`);
	const buf = Buffer.from(await res.arrayBuffer());
	if (
		buf.slice(0, 15).toString().toLowerCase().includes('<!doctype html') ||
		buf.slice(0, 6).toString() === '<html>'
	) {
		throw new Error(`download ${url}: got an HTML page, not media`);
	}
	fs.writeFileSync(dest, buf);
}

/**
 * One averaged RGB triplet per sampled frame, taken from the caption band.
 * `scale=1:1` makes ffmpeg do the averaging, which is both faster and more
 * accurate than decoding pixels into JS.
 */
async function sampleBand(file) {
	const vf = [
		`crop=iw:ih*${BAND_HEIGHT}:0:ih*${BAND_TOP}`,
		'scale=1:1',
	].join(',');
	const out = await run('ffmpeg', [
		'-v', 'error',
		'-i', file,
		'-vf', vf,
		'-frames:v', String(FRAMES),
		'-vsync', 'passthrough',
		'-f', 'rawvideo',
		'-pix_fmt', 'rgb24',
		'-',
	]);
	const samples = [];
	for (let i = 0; i + 2 < out.length; i += 3) {
		samples.push({r: out[i], g: out[i + 1], b: out[i + 2]});
	}
	return samples;
}

/**
 * Sample evenly across the film rather than taking the first N frames, which
 * on a montage means "all of scene one".
 */
async function sampleEvenly(file, durationSeconds) {
	const step = durationSeconds / (FRAMES + 1);
	const out = [];
	for (let i = 1; i <= FRAMES; i++) {
		const t = (step * i).toFixed(3);
		const buf = await run('ffmpeg', [
			'-v', 'error',
			'-ss', t,
			'-i', file,
			'-vf', `crop=iw:ih*${BAND_HEIGHT}:0:ih*${BAND_TOP},scale=1:1`,
			'-frames:v', '1',
			'-f', 'rawvideo',
			'-pix_fmt', 'rgb24',
			'-',
		]);
		if (buf.length >= 3) out.push({r: buf[0], g: buf[1], b: buf[2]});
	}
	return out;
}

async function probeDuration(file) {
	const out = await run('ffprobe', [
		'-v', 'error',
		'-show_entries', 'format=duration',
		'-of', 'default=nw=1:nk=1',
		file,
	]);
	const d = parseFloat(String(out).trim());
	return Number.isFinite(d) && d > 0 ? d : null;
}

// --- colour maths -----------------------------------------------------------

const lin = (c) => {
	const s = c / 255;
	return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const luminance = ({r, g, b}) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const contrast = (a, b) => {
	const la = luminance(a);
	const lb = luminance(b);
	return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};

const rgbToHsl = ({r, g, b}) => {
	const R = r / 255, G = g / 255, B = b / 255;
	const max = Math.max(R, G, B), min = Math.min(R, G, B);
	const l = (max + min) / 2;
	if (max === min) return {h: 0, s: 0, l};
	const d = max - min;
	const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
	let h;
	if (max === R) h = ((G - B) / d + (G < B ? 6 : 0)) / 6;
	else if (max === G) h = ((B - R) / d + 2) / 6;
	else h = ((R - G) / d + 4) / 6;
	return {h, s, l};
};

const hslToRgb = ({h, s, l}) => {
	if (s === 0) {
		const v = Math.round(l * 255);
		return {r: v, g: v, b: v};
	}
	const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
	const p = 2 * l - q;
	const f = (t) => {
		if (t < 0) t += 1;
		if (t > 1) t -= 1;
		if (t < 1 / 6) return p + (q - p) * 6 * t;
		if (t < 1 / 2) return q;
		if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
		return p;
	};
	return {
		r: Math.round(f(h + 1 / 3) * 255),
		g: Math.round(f(h) * 255),
		b: Math.round(f(h - 1 / 3) * 255),
	};
};

const toHex = ({r, g, b}) =>
	'#' + [r, g, b].map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, '0')).join('').toUpperCase();

/**
 * The amber band the whole exercise exists to get away from. A derived accent
 * that lands here is pushed out of it rather than accepted: warm footage
 * (sodium dock lights, sunsets, firelight) is common, and letting the
 * measurement hand back the generated-video yellow would make this endpoint an
 * elaborate way to keep it.
 */
const AI_YELLOW = {from: 0.09, to: 0.19}; // ~32°-68°, amber through yellow
const escapeAmber = (h) => {
	if (h < AI_YELLOW.from || h > AI_YELLOW.to) return h;
	// Push to whichever edge is nearer, plus a margin, so it reads as a choice.
	const mid = (AI_YELLOW.from + AI_YELLOW.to) / 2;
	return h < mid ? (AI_YELLOW.from - 0.04 + 1) % 1 : (AI_YELLOW.to + 0.04) % 1;
};

/**
 * Background → accent. The hue is rotated away from the background so the
 * words separate from the picture, saturation is held in a band that is
 * neither pastel nor neon, and lightness is raised until the accent clears
 * 4.5:1 against the measured background.
 */
function deriveAccent(bg) {
	const {h, s} = rgbToHsl(bg);
	// A near-grey background gives no usable hue to rotate away from, so pick a
	// cool accent outright: it is the safest against the warm cast most footage
	// has, and never collides with skin tones.
	const baseHue = s < 0.08 ? 0.55 : (h + 0.5) % 1;
	const hue = escapeAmber(baseHue);
	const sat = Math.min(0.78, Math.max(0.45, s * 1.25 + 0.28));
	let best = null;
	for (let l = 0.5; l <= 0.92; l += 0.02) {
		const cand = hslToRgb({h: hue, s: sat, l});
		const ratio = contrast(cand, bg);
		if (!best || ratio > best.ratio) best = {rgb: cand, ratio, l};
		if (ratio >= 4.5) return {rgb: cand, ratio, hue, sat, l};
	}
	return {rgb: best.rgb, ratio: best.ratio, hue, sat, l: best.l};
}

export function registerCaptionColor(app) {
	app.post('/caption-color', async (req, res) => {
		const videoUrl = req.body && req.body.videoUrl;
		if (!videoUrl) return res.status(400).json({error: 'videoUrl is required'});

		const work = fs.mkdtempSync(path.join(os.tmpdir(), 'capcolor-'));
		try {
			const file = path.join(work, 'in.mp4');
			if (/^https?:\/\//i.test(videoUrl)) await download(videoUrl, file);
			else fs.copyFileSync(videoUrl, file);

			const duration = await probeDuration(file);
			// Spread the samples over the whole film when we know how long it is;
			// fall back to the first frames when ffprobe cannot say.
			const samples = duration ? await sampleEvenly(file, duration) : await sampleBand(file);
			if (!samples.length) throw new Error('could not sample any frames');

			const bg = samples.reduce(
				(acc, s) => ({r: acc.r + s.r / samples.length, g: acc.g + s.g / samples.length, b: acc.b + s.b / samples.length}),
				{r: 0, g: 0, b: 0},
			);
			const accent = deriveAccent(bg);

			res.json({
				captionColor: toHex(accent.rgb),
				contrastRatio: Math.round(accent.ratio * 100) / 100,
				background: toHex(bg),
				samples: samples.length,
				band: {top: BAND_TOP, height: BAND_HEIGHT},
			});
		} catch (err) {
			res.status(500).json({error: String(err.message || err)});
		} finally {
			fs.rmSync(work, {recursive: true, force: true});
		}
	});
}
