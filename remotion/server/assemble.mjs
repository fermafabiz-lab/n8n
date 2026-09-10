// Final-assembly endpoint: concatenates per-scene clips with each scene's
// voiceover pinned to the START of its own scene, padded with silence to the
// scene's exact length. This exists because fal's ffmpeg compose ignores
// keyframe timestamps (measured: a 42.49s timeline came back 40.25s with the
// audio butt-joined), so timeline alignment must be done where we control
// ffmpeg directly.
//
// Sound design (all optional, degrades gracefully):
//   - musicUrl: background music, looped to length, volume-ducked under the
//     narration via sidechain compression, faded out at the end.
//   - sceneChapters: [0,1,1,2,...] per scene — a synthesized whoosh plays at
//     every chapter boundary, a low boom under the hook title, and a riser
//     into the final seconds. SFX are generated locally with ffmpeg at first
//     use (no asset files needed).
//
// POST /assemble { scenes: [{videoUrl, audioUrl}], musicUrl?, sceneChapters?,
//   nativeAudio? } -> { jobId }
//   nativeAudio controls the clips' own tracks (Veo's generated ambience):
//   false/0 silences them (narration + music only), a number sets their
//   level (ducked under the narration), absent defaults to 0.22. The site's
//   "Sound effects" toggle maps to this via n8n's Build Timeline.
//   stingers (default OFF) adds the synthesized boom/whoosh/riser accents;
//   musicUrl adds the background track. Both are "music" from the
//   producer's point of view and ride the site's one music toggle.
//   musicVolume (0.05..1, default 0.22) is the background track's gain
//   before the sidechain duck — the site's "Music volume" slider. The
//   accents keep their own fixed levels. The track is loudness-MEASURED
//   and corrected to MUSIC_TARGET_LUFS first, so that one slider position
//   means one level whichever track the folder handed over, and the bed
//   ducks by BAND: the speech range steps aside for every spoken syllable
//   while the bass and the air only lean back. See buildMixGraph.
// GET  /assemble/:jobId/status -> { status, outputUrl, verify: {videoSeconds,
//   audioSeconds, sceneStartsSeconds} } — verify comes from ffprobe on the
//   result, so callers can confirm alignment numerically.
import path from 'path';
import fs from 'fs';
import os from 'os';
import {fileURLToPath} from 'url';
import {randomUUID} from 'crypto';
import {execFile} from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SFX_DIR = path.join(__dirname, 'sfx');

/**
 * Output frame rate of the montage. Named because three things must agree on
 * it: the fps filter in the video chain, the frame snapping that pins each
 * scene to a whole frame, and the scene start times reported back to the
 * graphics pass. When it was only a literal inside the filter string, the
 * reported times were free to disagree with the encode, and they did.
 */
const OUT_FPS = 24;

function run(cmd, args, timeoutMs = 10 * 60 * 1000) {
	return new Promise((resolve, reject) => {
		execFile(cmd, args, {timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024}, (err, stdout, stderr) => {
			if (err) reject(new Error(`${cmd} failed: ${err.message}\n${String(stderr).slice(-2000)}`));
			else resolve({stdout, stderr});
		});
	});
}

async function download(url, dest) {
	// Drive answers 503/429 when it is asked for many files at once — a
	// 71-scene film is 142 downloads in a row, and two renders of the same
	// film once did it together. A short back-off is all it wants.
	const waits = [2000, 6000, 15000];
	let res;
	for (let attempt = 0; ; attempt++) {
		res = await fetch(url, {redirect: 'follow'});
		if (res.ok) break;
		const transient = res.status === 503 || res.status === 429 || res.status === 500 || res.status === 502;
		if (!transient || attempt >= waits.length) throw new Error(`download ${url}: HTTP ${res.status}`);
		console.warn(`download ${url}: HTTP ${res.status}, retrying in ${waits[attempt] / 1000}s`);
		await new Promise((r) => setTimeout(r, waits[attempt]));
	}
	const buf = Buffer.from(await res.arrayBuffer());
	// Google Drive sometimes serves an HTML interstitial instead of the file;
	// catch that early instead of feeding HTML to ffmpeg.
	if (buf.slice(0, 15).toString().toLowerCase().includes('<!doctype html') || buf.slice(0, 6).toString() === '<html>') {
		throw new Error(`download ${url}: got an HTML page, not media`);
	}
	fs.writeFileSync(dest, buf);
}

async function probeDuration(file, stream) {
	const {stdout} = await run('ffprobe', [
		'-v', 'error',
		'-select_streams', stream,
		'-show_entries', 'stream=duration',
		'-of', 'csv=p=0',
		file,
	]);
	const n = parseFloat(String(stdout).trim().split('\n')[0]);
	if (isNaN(n) || n <= 0) throw new Error(`ffprobe: no ${stream} duration in ${file}`);
	return n;
}

/**
 * The breath at the ends of a take.
 *
 * ElevenLabs pads what it generates: a take opens with a beat of near-silence
 * and closes with another. Inside one line that is natural. Laid end to end
 * down a film it is not — the scene length is `voiceDur + sceneGap` (0.35s
 * unless the request says otherwise), so every padded tail is added to a gap
 * that already exists, and the narration comes out slower and more recited
 * than the take sounds on its own.
 *
 * -45dB rather than a rounder number: the generated audio is clean, so the
 * floor only has to clear encoder noise, and a threshold set too high eats the
 * quiet end of a real word. 180ms is the shortest run treated as padding —
 * below that it is phrasing, and cutting it is what makes speech sound
 * clipped rather than tight.
 */
const BREATH_NOISE_DB = -45;
const BREATH_MIN = 0.18;
/** Kept either side, so no consonant is ever shaved off its own word. */
const BREATH_GUARD = 0.05;

/**
 * Where the speech starts and ends, read out of silencedetect's report.
 *
 * Pure and exported so it can be tested without ffmpeg — this parser is the
 * part with the edge cases, and the box a Claude Code session runs on has no
 * ffmpeg to rehearse the filter against.
 *
 * The one that bites: silencedetect never emits a closing `silence_end` for a
 * run that reaches the end of the file — the file just stops — so an unclosed
 * run has to be closed by hand or a padded tail reads as no tail at all.
 */
export function parseSpeechBounds(stderr, total) {
	const runs = [];
	let open = null;
	for (const m of String(stderr).matchAll(/silence_(start|end):\s*(-?[\d.]+)/g)) {
		const at = parseFloat(m[2]);
		if (!Number.isFinite(at)) continue;
		if (m[1] === 'start') open = at;
		else if (open !== null) {
			runs.push([open, at]);
			open = null;
		}
	}
	if (open !== null) runs.push([open, total]);

	let head = 0;
	let tail = total;
	// Only runs that TOUCH an end are padding. A pause in the middle of a
	// sentence is the performance, and cutting it would be rewriting the read.
	if (runs.length && runs[0][0] <= 0.05) head = runs[0][1];
	const last = runs[runs.length - 1];
	if (last && last[1] >= total - 0.05) tail = last[0];

	head = Math.max(0, head - BREATH_GUARD);
	tail = Math.min(total, tail + BREATH_GUARD);
	// A detector that found silence everywhere would otherwise invert these.
	if (tail <= head) return {head: 0, tail: total};
	return {head, tail};
}

/** Where the speech actually starts and ends, in seconds. */
async function speechBounds(file, total) {
	const {stderr} = await run('ffmpeg', [
		'-hide_banner', '-nostats',
		'-i', file,
		'-af', `silencedetect=noise=${BREATH_NOISE_DB}dB:d=${BREATH_MIN}`,
		'-f', 'null', '-',
	]);
	return parseSpeechBounds(stderr, total);
}

/**
 * Cut the padding off a take, keeping the opening beat when the scene starts a
 * chapter.
 *
 * That exception is the point of the feature rather than a detail of it: with
 * every take tightened the film runs on without a seam, and a chapter needs
 * one. Keeping the natural lead-in on the scene that opens it puts the pause
 * exactly where a reader would take one, and costs nothing to compute — it is
 * simply the silence ElevenLabs already generated, left alone.
 *
 * Writes WAV, not mp3. Re-encoding to mp3 would hand back the encoder delay
 * and padding this exists to remove — the same gapless-header problem that
 * makes a pure-frame mp3 concat gain ~36ms per join.
 */
async function tightenTake(file, work, i, total, keepLeadIn) {
	const {head, tail} = await speechBounds(file, total);
	const start = keepLeadIn ? 0 : head;
	// Nothing worth a re-encode, or the detector found almost no speech — a
	// very quiet take would otherwise be cut down to nothing. Leaving the file
	// alone is always safe; over-trimming is not.
	if (tail - start < 0.3 || total - (tail - start) < 0.05) return null;
	const out = path.join(work, `a${i}.trim.wav`);
	await run('ffmpeg', [
		'-y', '-i', file,
		'-af', `atrim=start=${start.toFixed(3)}:end=${tail.toFixed(3)},asetpts=N/SR/TB`,
		'-c:a', 'pcm_s16le',
		out,
	]);
	const duration = await probeDuration(out, 'a:0');
	return {file: out, duration, cut: total - duration, keptLeadIn: keepLeadIn && head > 0.05};
}

/**
 * Does this file carry an audio stream at all? Veo clips do, but a clip that
 * came back through a re-mux or a still-image fallback may not — and concat
 * needs every segment to expose the same streams, so a missing one has to be
 * substituted with silence rather than discovered mid-render.
 */
async function hasAudioStream(file) {
	try {
		const {stdout} = await run('ffprobe', [
			'-v', 'error',
			'-select_streams', 'a:0',
			'-show_entries', 'stream=codec_type',
			'-of', 'csv=p=0',
			file,
		]);
		return String(stdout).trim().startsWith('audio');
	} catch {
		return false;
	}
}

// Synthesize the SFX bank once. Pure ffmpeg — no downloaded assets.
let sfxReady = null;
function ensureSfx() {
	if (!sfxReady) {
		sfxReady = (async () => {
			fs.mkdirSync(SFX_DIR, {recursive: true});
			const whoosh = path.join(SFX_DIR, 'whoosh.wav');
			const boom = path.join(SFX_DIR, 'boom.wav');
			const riser = path.join(SFX_DIR, 'riser.wav');
			if (!fs.existsSync(whoosh)) {
				await run('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'anoisesrc=color=pink:duration=0.9:amplitude=0.7',
					'-af', 'highpass=f=350,lowpass=f=5200,afade=t=in:d=0.4,afade=t=out:st=0.4:d=0.5,aformat=sample_rates=44100:channel_layouts=mono', whoosh]);
			}
			if (!fs.existsSync(boom)) {
				await run('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'sine=frequency=52:duration=1.4',
					'-af', 'lowpass=f=130,afade=t=in:d=0.02,afade=t=out:st=0.1:d=1.25,aformat=sample_rates=44100:channel_layouts=mono', boom]);
			}
			if (!fs.existsSync(riser)) {
				await run('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'anoisesrc=color=brown:duration=2.2:amplitude=0.8',
					'-af', 'highpass=f=200,afade=t=in:d=1.9,afade=t=out:st=1.9:d=0.3,aformat=sample_rates=44100:channel_layouts=mono', riser]);
			}
			return {whoosh, boom, riser};
		})();
	}
	return sfxReady;
}

const MONO = 'aformat=sample_rates=44100:channel_layouts=mono';

/**
 * Where a voice lives.
 *
 * Speech carries almost all of its intelligibility between roughly 300 Hz and
 * 4 kHz; below that is body, above it is air. A music bed that keeps its bass
 * and its sparkle but steps out of THAT window is the "simple parametric EQ"
 * move an editor makes by hand — the music stays full and the words stay
 * clear, instead of the whole track pumping up and down.
 */
const SPEECH_BAND_LOW = 300;
const SPEECH_BAND_HIGH = 3800;

/**
 * The loudness every music bed is brought to before the producer's slider is
 * applied.
 *
 * Without this the slider means a different thing on every track: the `Muzica`
 * folder holds everything from a quiet ambient bed to a commercially mastered
 * cue, and those differ by more than 10 dB. At a fixed gain of 0.22 the first
 * is inaudible and the second is blaring — which is exactly the complaint the
 * measurement fixes. Normalized first, 0.22 is one level on every film.
 *
 * -20 LUFS is below typical library music (-14 to -16), so the bed also sits
 * QUIETER than it used to on an average track. That is deliberate and it is
 * the number to change if the balance still is not right — one constant, not
 * a slider default in four places.
 */
const MUSIC_TARGET_LUFS = -20;
/** Never trust a measurement enough to swing the bed further than this. */
const MUSIC_GAIN_LIMIT_DB = 12;

/**
 * Is this ffmpeg build carrying a given filter?
 *
 * The band-split duck below needs `acrossover`, which every ffmpeg since 4.3
 * has (the image is bookworm, so 5.1) — but a filtergraph naming a filter that
 * is not there fails the WHOLE render, and a render is minutes of work. So it
 * is asked rather than assumed, once per process, and the flat fallback keeps
 * films rendering on a build that lacks it.
 */
const filterCache = new Map();
async function hasFilter(name) {
	if (filterCache.has(name)) return filterCache.get(name);
	let present = false;
	try {
		const {stdout} = await run('ffmpeg', ['-hide_banner', '-filters']);
		present = new RegExp(`^\\s*\\S+\\s+${name}\\s`, 'm').test(String(stdout));
	} catch (e) {
		console.warn(`ffmpeg -filters failed (${e.message}) — assuming no ${name}`);
	}
	filterCache.set(name, present);
	return present;
}

/**
 * A track's integrated loudness in LUFS, or null when it cannot be measured.
 *
 * `loudnorm` in analysis mode rather than in its normalizing mode on purpose:
 * what comes back is a NUMBER, which is then applied as one constant `volume`.
 * Loudnorm's own dynamic mode rides the gain as it goes, which would fight the
 * sidechain duck underneath it and pump the bed — the one thing this whole
 * section exists to stop.
 */
async function measureLoudness(file) {
	const {stderr} = await run('ffmpeg', [
		'-hide_banner', '-nostats',
		'-i', file,
		'-af', 'loudnorm=print_format=json',
		'-f', 'null', '-',
	]);
	const m = String(stderr).match(/"input_i"\s*:\s*"(-?[\d.]+)"/);
	const lufs = m ? parseFloat(m[1]) : NaN;
	// Digital silence measures -inf and parses as a huge negative number; a
	// correction derived from it would be a 100 dB boost of nothing.
	if (!Number.isFinite(lufs) || lufs < -70) return null;
	return lufs;
}

/**
 * The audio mix bus, as a list of filtergraph parts.
 *
 * Pure and exported for the same reason `parseSpeechBounds` is: this box has
 * no ffmpeg to rehearse a graph against, and the failure this shape produces
 * is total — a pad produced and never consumed, or consumed and never
 * produced, and ffmpeg refuses the whole render minutes into the job. Built
 * as data it can at least be checked for that (`npm run check:mix`), across
 * every combination of switches, without an encoder.
 *
 * Returns the parts; the caller owns `parts` and the input indices.
 */
export function buildMixGraph({
	nativeOn,
	nativeVolume,
	music,
	musicDuck,
	musicGainDb,
	musicVolume,
	musicIdx,
	totalDur,
	stingers,
	boomIdx,
	whooshIdx,
	riserIdx,
	chapterBoundaries,
}) {
	const out = [];
	// Mix bus: narration first (defines length), then ducked music, then SFX.
	//
	// The voice is split into one copy for the mix plus one KEY per thing
	// that ducks against it. The count is derived rather than fixed at
	// three: an unused branch has to be sunk explicitly or the graph
	// stalls, and the band-split music below needs three keys of its own.
	const mixInputs = [];
	const sideCount = (nativeOn ? 1 : 0) + (music ? (musicDuck === 'bands' ? 3 : 1) : 0);
	const keys = Array.from({length: sideCount}, (_, i) => `[vk${i}]`);
	// Nothing ducks against the voice (no music, no ambience), so there is no
	// split to make. `asplit=1` is legal and this is one filter fewer to be
	// wrong about; the format filter is a no-op the graph already uses.
	out.push(
		sideCount === 0
			? `[voiceraw]${MONO}[vmain]`
			: `[voiceraw]asplit=${1 + sideCount}[vmain]${keys.join('')}`,
	);
	mixInputs.push('[vmain]');
	let nextKey = 0;
	if (nativeOn) {
		// Ambience sits under the narration the same way the music does:
		// ducked by the voice so it never competes with a spoken line,
		// but audible in the gaps between them.
		out.push(`[natraw]${MONO},volume=${nativeVolume}[natlvl]`);
		out.push(
			`[natlvl]${keys[nextKey++]}sidechaincompress=threshold=0.05:ratio=8:attack=10:release=350:makeup=1[natduck]`,
		);
		mixInputs.push('[natduck]');
	}
	if (music) {
		const fadeStart = Math.max(0, totalDur - 2.5).toFixed(3);
		// The measured correction comes FIRST, so the producer's slider
		// rides on a bed that is already the same loudness on every film.
		const level = musicGainDb ? `volume=${musicGainDb.toFixed(2)}dB,` : '';
		out.push(
			`[${musicIdx}:a]${MONO},aloop=loop=-1:size=2000000000,atrim=duration=${totalDur.toFixed(3)},` +
				`${level}volume=${musicVolume},afade=t=out:st=${fadeStart}:d=2.5[mus]`,
		);
		if (musicDuck === 'bands') {
			// Two crossovers rather than one with a two-value `split`: each
			// takes a single frequency, so there is no list syntax to get
			// wrong, and Linkwitz-Riley bands sum back flat either way.
			out.push(`[mus]acrossover=split=${SPEECH_BAND_LOW}[mlo][mrest]`);
			out.push(`[mrest]acrossover=split=${SPEECH_BAND_HIGH}[mmid][mhi]`);
			// The speech band gets out of the way properly — a low
			// threshold so any spoken syllable triggers it, a hard ratio,
			// and a slow release so it does NOT surge back in the 0.35s
			// between two scenes. It recovers over a chapter gap, which is
			// long enough to be heard as a breath rather than a pump.
			out.push(
				`[mmid]${keys[nextKey++]}sidechaincompress=threshold=0.02:ratio=20:attack=5:release=900:makeup=1[mmidd]`,
			);
			// Body and air only lean back. This is the whole point: the bed
			// keeps sounding like music while the words are being said.
			out.push(
				`[mlo]${keys[nextKey++]}sidechaincompress=threshold=0.05:ratio=4:attack=20:release=700:makeup=1[mlod]`,
			);
			out.push(
				`[mhi]${keys[nextKey++]}sidechaincompress=threshold=0.05:ratio=4:attack=20:release=700:makeup=1[mhid]`,
			);
			out.push(`[mlod][mmidd][mhid]amix=inputs=3:duration=longest:normalize=0[mduck]`);
		} else {
			// No crossover in this build: carve the speech band out
			// statically — the plain parametric-EQ cut — and duck the rest
			// broadband. Costs the bed some presence even in the pauses,
			// which is why it is the fallback and not the design.
			out.push(`[mus]equalizer=f=1600:t=q:w=1.1:g=-7[muscut]`);
			out.push(
				`[muscut]${keys[nextKey++]}sidechaincompress=threshold=0.03:ratio=10:attack=8:release=700:makeup=1[mduck]`,
			);
		}
		mixInputs.push('[mduck]');
	}
	if (stingers) {
		// Boom under the hook title.
		out.push(`[${boomIdx}:a]adelay=150|150,volume=0.45[sfxboom]`);
		mixInputs.push('[sfxboom]');
		// Whoosh at every chapter boundary (one input, split as needed).
		if (chapterBoundaries.length) {
			const n = chapterBoundaries.length;
			out.push(`[${whooshIdx}:a]asplit=${n}${chapterBoundaries.map((_, i) => `[w${i}]`).join('')}`);
			chapterBoundaries.forEach((b, i) => {
				const ms = Math.max(0, Math.round((b - 0.45) * 1000));
				out.push(`[w${i}]adelay=${ms}|${ms},volume=0.4[sw${i}]`);
				mixInputs.push(`[sw${i}]`);
			});
		}
		// Riser into the last two seconds (leads into the end screen).
		const riserMs = Math.max(0, Math.round((totalDur - 2.4) * 1000));
		out.push(`[${riserIdx}:a]adelay=${riserMs}|${riserMs},volume=0.35[sfxriser]`);
		mixInputs.push('[sfxriser]');
	}

	out.push(
		`${mixInputs.join('')}amix=inputs=${mixInputs.length}:duration=first:normalize=0,alimiter=limit=0.95[outa]`,
	);
	return out;
}

export function registerAssemble(app, {jobs, outputDir}) {
	app.post('/assemble', (req, res) => {
		const scenes = req.body && req.body.scenes;
		const musicUrl = req.body && req.body.musicUrl;
		const sceneChapters = (req.body && req.body.sceneChapters) || [];
		// "16:9" (default) or "9:16" — decides the output canvas.
		const portrait = (req.body && req.body.aspect) === '9:16';
		// The clips arrive from Veo with their own ambience on board. It used
		// to be dropped on the floor: the per-scene audio chain only ever read
		// the voiceover input, so the montage carried narration and nothing
		// else. Mixed back in under the narration by default; pass
		// nativeAudio: false (or 0) to go back to voice-only.
		// Editorial stingers — the boom under the hook, a whoosh at every
		// chapter boundary, a riser into the end screen. They are SYNTHESIZED
		// here and bear no relation to what is on screen, so they are music,
		// not the footage's own sound. They used to play on every render
		// unconditionally, which is exactly what "music that has nothing to do
		// with the clip" was. Opt-in now, alongside the background track.
		const stingers = Boolean(req.body && req.body.stingers);
		// The music bed's gain. 0.22 was the constant in the mix graph for as long
		// as there has been a music bed, so absence keeps every older film's
		// sound; the slider on the site sends a number. Refuses rather than
		// guesses, same rule as the three copies upstream (derive.ts, Normalize
		// Webhook Input, Build Timeline): out of range or unparseable is the
		// default, never a clamp of a bad value.
		const rawMusic = req.body ? req.body.musicVolume : undefined;
		const musicVolume =
			typeof rawMusic === 'number' && Number.isFinite(rawMusic) && rawMusic >= 0.05 && rawMusic <= 1
				? Math.round(rawMusic * 100) / 100
				: 0.22;
		const rawNative = req.body ? req.body.nativeAudio : undefined;
		const nativeVolume =
			rawNative === false || rawNative === 0
				? 0
				: typeof rawNative === 'number' && rawNative > 0
					? Math.min(1, rawNative)
					: 0.22;
		// The canvas. 720p by default and 1080p on request — the request comes
		// from the project, not from here, because the clips have to be worth
		// it: building a 1080p montage out of 720p clips buys nothing but
		// bytes. `/upscale-film` sets both together for exactly that reason.
		//
		// The cost is downstream, not here: ffmpeg scales either way, but the
		// Remotion pass that draws over this montage is 2.09x slower per frame
		// at 1080p (measured, 0.107s against 0.224s), which is what pushes a
		// long film past the graphics poll ceiling.
		// How long the picture breathes past the narration on every scene.
		// 0.35s has always been the montage's fixed gap; a category can ask
		// for more — Kids story sends 0.8/1.2 so young listeners can follow.
		// Clamped like every knob here: a bad value must fall back to the
		// classic gap, never stall the film or crush the cut. Note chapter
		// openers additionally keep their take's own lead-in (breath trim).
		const sceneGap = (() => {
			const n = Number(req.body && req.body.sceneGap);
			return Number.isFinite(n) && n >= 0.2 && n <= 2 ? n : 0.35;
		})();
		const hd = String((req.body && req.body.resolution) || '720p').toLowerCase() === '1080p';
		const W = portrait ? (hd ? 1080 : 720) : (hd ? 1920 : 1280);
		const H = portrait ? (hd ? 1920 : 1280) : (hd ? 1080 : 720);
		if (!Array.isArray(scenes) || scenes.length === 0) {
			return res.status(400).json({error: 'scenes: [{videoUrl, audioUrl}] is required'});
		}
		for (const s of scenes) {
			if (!s.videoUrl) return res.status(400).json({error: 'every scene needs videoUrl'});
		}

		const jobId = randomUUID();
		jobs.set(jobId, {status: 'rendering', progress: 0, outputFile: null, error: null});
		res.json({jobId});

		(async () => {
			const work = fs.mkdtempSync(path.join(os.tmpdir(), 'assemble-'));
			try {
				const sfx = stingers ? await ensureSfx() : null;

				// 1. Download everything and measure each clip's real video length.
				const items = [];
				/** How much generated padding came out of the narration, for the log
				 *  and the job result — the one number that says whether this did
				 *  anything on a given film. */
				let trimmedTotal = 0;
				for (let i = 0; i < scenes.length; i++) {
					const v = path.join(work, `v${i}.mp4`);
					await download(scenes[i].videoUrl, v);
					const dur = await probeDuration(v, 'v:0');
					let a = null;
					let voiceDur = null;
					if (scenes[i].audioUrl) {
						a = path.join(work, `a${i}.mp3`);
						await download(scenes[i].audioUrl, a);
						// Real narration length — the graphics pass paces captions on
						// this, not on the (silence-padded) scene length.
						voiceDur = await probeDuration(a, 'a:0').catch(() => null);
						// Cut the generated breath off the ends, EXCEPT the lead-in of
						// a scene that opens a chapter — that pause is what a listener
						// hears as the break between chapters.
						//
						// Done here, before anything reads `voiceDur`, so the whole
						// pipeline follows on its own: the scene length, the stretch
						// factor, the reported scene starts and every graphic placed
						// off them all derive from this number. Trimming later would
						// have meant rescaling each of them in lockstep.
						//
						// Failing is always survivable and never fatal: a take that
						// cannot be analysed or re-encoded keeps its original file and
						// its original length, which is exactly today's behaviour.
						if (voiceDur) {
							const opensChapter =
								i === 0 || (sceneChapters[i] ?? 0) !== (sceneChapters[i - 1] ?? 0);
							const tight = await tightenTake(a, work, i, voiceDur, opensChapter).catch(
								(e) => {
									console.warn(`scene ${i}: breath trim skipped — ${e.message}`);
									return null;
								},
							);
							if (tight) {
								trimmedTotal += tight.cut;
								console.log(
									`scene ${i}: trimmed ${tight.cut.toFixed(2)}s of padding` +
										(tight.keptLeadIn ? ' (kept the chapter lead-in)' : ''),
								);
								a = tight.file;
								voiceDur = tight.duration;
							}
						}
					}
					// Elastic timing: every scene lasts exactly as long as its own
					// narration (+ a small breath), and the clip is TIME-STRETCHED to
					// that length so all frames stay in motion — no freeze-frames when
					// the voice runs long, no dead air when it runs short. The stretch
					// factor is clamped to a range that stays visually invisible on
					// ambient footage; only extreme mismatches fall back to trimming
					// (very short voice) or a residual freeze (very long voice).
					const STRETCH_MIN = 0.65; // fastest allowed playback (voice much shorter)
					const STRETCH_MAX = 1.5;  // slowest allowed playback (voice much longer)
					let eff = dur;
					let stretch = 1;
					let freeze = 0;
					if (voiceDur) {
						eff = voiceDur + sceneGap;
						stretch = eff / dur;
						if (stretch > STRETCH_MAX) {
							// Even at max slow-motion the clip can't cover the voice —
							// freeze only the uncoverable remainder.
							stretch = STRETCH_MAX;
							freeze = eff - dur * STRETCH_MAX;
						} else if (stretch < STRETCH_MIN) {
							// Voice is far shorter than the clip — play at max speed-up
							// and cut the leftover tail.
							stretch = STRETCH_MIN;
						}
					}
					// Only worth carrying the clip's own track when there is a
					// separate narration to sit under: with no voiceover the clip
					// audio is already the scene's main track (see the `it.a ?? it.v`
					// fallback below), and mixing it twice would just double it.
					const nativeAudio =
						nativeVolume > 0 && a !== null && (await hasAudioStream(v));
					// Snap the scene to a whole number of OUTPUT frames, and keep the
					// frame count rather than re-deriving it later.
					//
					// This is the difference between what the montage INTENDS and what
					// it ENCODES. `eff` is a float driven by the narration, but the
					// video chain below ends in fps=24, so every segment necessarily
					// lands on a 24fps frame line — and the leftover fraction does not
					// vanish, it accumulates down the concat. Measured on the tahiti
					// montage before this: the reported scene starts drifted from the
					// real picture cuts by -0.021s at the first boundary to +0.084s at
					// the last, which at 30fps is up to three frames.
					//
					// Graphics are placed off those reported times, so the drift showed
					// up as the montage framing changing one to three frames after the
					// picture did — the producer's "a frame with zoom that looks wrong"
					// at every scene change. Snapping here makes the two agree by
					// construction: there is no longer an intended time that the
					// encoder can round away from.
					const effFrames = Math.max(1, Math.round(eff * OUT_FPS));
					eff = effFrames / OUT_FPS;
					items.push({v, a, dur, voiceDur, eff, effFrames, stretch, freeze, nativeAudio});
					const job = jobs.get(jobId);
					if (job) job.progress = 0.35 * ((i + 1) / scenes.length);
				}
				let music = null;
				/** The track's own loudness, and the correction applied for it. */
				let musicLufs = null;
				let musicGainDb = 0;
				/** 'bands' = the speech band ducks on its own; 'flat' = the whole bed. */
				let musicDuck = null;
				if (musicUrl) {
					music = path.join(work, 'music.audio');
					await download(musicUrl, music);
					// Measured, never assumed — and never fatal. A track that cannot
					// be analysed plays at its own level, which is exactly the old
					// behaviour, rather than costing the film its render.
					musicLufs = await measureLoudness(music).catch((e) => {
						console.warn(`music: loudness not measured — ${e.message}`);
						return null;
					});
					if (musicLufs !== null) {
						musicGainDb = Math.max(
							-MUSIC_GAIN_LIMIT_DB,
							Math.min(MUSIC_GAIN_LIMIT_DB, MUSIC_TARGET_LUFS - musicLufs),
						);
						console.log(
							`music: ${musicLufs.toFixed(1)} LUFS → ${musicGainDb >= 0 ? '+' : ''}` +
								`${musicGainDb.toFixed(1)} dB to reach ${MUSIC_TARGET_LUFS}`,
						);
					}
					musicDuck = (await hasFilter('acrossover')) ? 'bands' : 'flat';
					console.log(`music: ducking the ${musicDuck === 'bands' ? 'speech band only' : 'whole bed'}`);
				}

				// Scene timing + chapter boundary times (for whooshes).
				let t = 0;
				const sceneStartsSeconds = [];
				items.forEach((it) => {
					// Six decimals, not three: these are now exact multiples of
					// 1/OUT_FPS, and 6.833333 rounded to 6.833 would put a rounding
					// error back into the very number that exists to be exact.
					sceneStartsSeconds.push(Number(t.toFixed(6)));
					t += it.eff;
				});
				const totalDur = t;
				const chapterBoundaries = [];
				for (let i = 1; i < items.length; i++) {
					if ((sceneChapters[i] ?? 0) !== (sceneChapters[i - 1] ?? 0)) {
						chapterBoundaries.push(sceneStartsSeconds[i]);
					}
				}

				// 2. One ffmpeg pass: normalize video, trim+silence-pad each voice
				// to its scene's exact duration, concat, then layer music + SFX.
				const args = ['-y'];
				for (const it of items) {
					// `-threads 1` is an INPUT option here: one decoder thread per
					// clip. ffmpeg opens every decoder at start, and the default
					// (auto = one thread per core, per decoder) put 71 h264 decoders
					// times 8 threads on an 8-core box — the 60th failed to open with
					// "Resource temporarily unavailable" (EAGAIN from pthread_create)
					// and the whole 71-scene Vegas assemble died, four times in a
					// row. Decoding 8-second clips single-threaded costs nothing the
					// encoder does not dwarf; libx264 keeps its own thread pool.
					args.push('-threads', '1', '-i', it.v);
					args.push('-threads', '1', '-i', it.a ?? it.v); // fallback: reuse clip audio if no voice
				}
				let idx = items.length * 2;
				const musicIdx = music ? idx++ : -1;
				const boomIdx = stingers ? idx++ : -1;
				const whooshIdx = stingers ? idx++ : -1;
				const riserIdx = stingers ? idx++ : -1;
				// concat wants the same stream count from every segment, so scenes
				// without usable clip audio borrow silence from here.
				const nativeOn = items.some((it) => it.nativeAudio);
				const silenceIdx = nativeOn ? idx++ : -1;
				if (music) args.push('-i', music);
				if (stingers) args.push('-i', sfx.boom, '-i', sfx.whoosh, '-i', sfx.riser);
				if (nativeOn) args.push('-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono');

				const parts = [];
				const labels = [];
				items.forEach((it, i) => {
					const d = it.eff.toFixed(6);
					// Cover-fit to the target canvas: scale up to fill, center-crop
					// the overflow. A 16:9 clip on a 9:16 canvas crops the sides.
					const vchain =
						// Elastic retime: setpts stretches/compresses playback to the
						// scene's narration-driven length, fps=${OUT_FPS} AFTER it resamples
						// frames evenly, and the final trim pins the exact duration
						// (it also cuts the leftover tail when the speed-up clamped).
						`scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},` +
						`trim=duration=${it.dur.toFixed(3)},setpts=${it.stretch.toFixed(5)}*(PTS-STARTPTS),fps=${OUT_FPS}`;
					// What the clip covers once it is stretched as far as it may be.
					const covered = it.dur * it.stretch;
					// The tail the clip cannot reach, PLAYED BACKWARDS rather than
					// frozen.
					//
					// A scene lasts as long as its narration, and when the voice runs
					// past what 1.5x slow motion can cover the remainder used to be
					// `tpad=stop_mode=clone` — the last frame held still. On the
					// 71-scene Boyd film one scene carried 16.7s of narration over an
					// 8s clip: twelve seconds of slow motion and then FIVE SECONDS OF
					// A FROZEN FRAME, under a voice that keeps talking. Reported as
					// the picture stopping.
					//
					// Reversing the tail keeps every frame moving, and on ambient
					// footage a bounce reads as continuous motion rather than as a
					// loop: nothing jumps, because the seam is the same frame twice.
					// It is bounded because `reverse` buffers every frame it receives:
					// six seconds at 1280x720 is about 200 MB, and this box has
					// already lost renders to memory once. Six is not arbitrary — the
					// worst scene of the Boyd film needed 5.04s, so the bound covers
					// the worst case anyone has actually shipped and leaves a margin.
					// Anything past it still clones, which is the old behaviour for
					// the part no reasonable scene should reach.
					const REVERSE_MAX = 6;
					const bounce = Math.min(it.freeze, REVERSE_MAX, covered);
					// end_frame, not duration: after fps=${OUT_FPS} the segment is a
					// COUNT of frames, and saying so leaves ffmpeg no rounding to do.
					// `trim=duration=6.833333` sits a hair either side of frame 164
					// depending on float luck; end_frame=164 is exactly 164 frames.
					if (bounce > 0.04) {
						parts.push(`[${i * 2}:v]${vchain},split=2[vf${i}][vb${i}]`);
						parts.push(
							`[vb${i}]trim=start=${(covered - bounce).toFixed(3)},setpts=PTS-STARTPTS,reverse[vr${i}]`,
						);
						parts.push(
							`[vf${i}][vr${i}]concat=n=2:v=1` +
								// Still clamped by the trim below; this only catches the
								// case the bounce could not cover on its own.
								(it.freeze > bounce + 0.04
									? `,tpad=stop_mode=clone:stop_duration=${(it.freeze - bounce).toFixed(3)}`
									: '') +
								`,trim=end_frame=${it.effFrames},setpts=PTS-STARTPTS[v${i}]`,
						);
					} else {
						parts.push(
							`[${i * 2}:v]${vchain}` +
								(it.freeze > 0.01
									? `,tpad=stop_mode=clone:stop_duration=${it.freeze.toFixed(3)}`
									: '') +
								`,trim=end_frame=${it.effFrames},setpts=PTS-STARTPTS[v${i}]`,
						);
					}
					parts.push(`[${i * 2 + 1}:a]${MONO},atrim=duration=${d},asetpts=PTS-STARTPTS,apad=whole_dur=${d}[a${i}]`);
					if (nativeOn) {
						// The clip's own ambience has to follow the same elastic retime
						// as its picture or it drifts out of sync: setpts stretches the
						// video by `stretch`, so the audio needs the reciprocal tempo.
						// The clamp upstream keeps 1/stretch inside atempo's range.
						if (it.nativeAudio) {
							parts.push(
								`[${i * 2}:a]${MONO},atrim=duration=${it.dur.toFixed(3)},asetpts=PTS-STARTPTS,` +
									`atempo=${(1 / it.stretch).toFixed(5)},atrim=duration=${d},asetpts=PTS-STARTPTS,` +
									`apad=whole_dur=${d}[n${i}]`,
							);
						} else {
							parts.push(`[${silenceIdx}:a]${MONO},atrim=duration=${d},asetpts=PTS-STARTPTS[n${i}]`);
						}
					}
					labels.push(nativeOn ? `[v${i}][a${i}][n${i}]` : `[v${i}][a${i}]`);
				});
				parts.push(
					nativeOn
						? `${labels.join('')}concat=n=${items.length}:v=1:a=2[outv][voiceraw][natraw]`
						: `${labels.join('')}concat=n=${items.length}:v=1:a=1[outv][voiceraw]`,
				);

				parts.push(
					...buildMixGraph({
						nativeOn,
						nativeVolume,
						music: Boolean(music),
						musicDuck,
						musicGainDb,
						musicVolume,
						musicIdx,
						totalDur,
						stingers,
						boomIdx,
						whooshIdx,
						riserIdx,
						chapterBoundaries,
					}),
				);

				const outputFile = `${jobId}.mp4`;
				const outputPath = path.join(outputDir, outputFile);
				args.push(
					'-filter_complex', parts.join(';'),
					'-map', '[outv]', '-map', '[outa]',
					'-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
					'-c:a', 'aac', '-b:a', '160k',
					'-movflags', '+faststart',
					outputPath,
				);
				const job = jobs.get(jobId);
				if (job) job.progress = 0.5;
				await run('ffmpeg', args);

				// 3. Self-verify: probe the result so the caller can check
				// alignment numerically instead of by ear.
				const videoSeconds = await probeDuration(outputPath, 'v:0');
				const audioSeconds = await probeDuration(outputPath, 'a:0');
				jobs.set(jobId, {
					status: 'done',
					progress: 1,
					outputFile,
					error: null,
					verify: {
						videoSeconds,
						audioSeconds,
						sceneStartsSeconds,
						voiceDurationsSeconds: items.map((it) =>
							it.voiceDur ? Number(Math.min(it.voiceDur, it.eff).toFixed(3)) : null,
						),
						// Per-scene playback retime applied (1 = untouched) — lets the
						// QC pass confirm the elastic timing stayed in the subtle range.
						stretchFactors: items.map((it) => Number(it.stretch.toFixed(3))),
						// Generated padding removed from the narration, in total. Zero
						// means the trim ran and found nothing, or every take failed
						// analysis and kept its original — the log line says which.
						breathTrimmedSeconds: Number(trimmedTotal.toFixed(2)),
						// What the music bed was measured at, what was done about it,
						// and which duck ran. The one place to look when someone says
						// the music is too loud on a particular film.
						musicLufs: musicLufs === null ? null : Number(musicLufs.toFixed(1)),
						musicGainDb: music ? Number(musicGainDb.toFixed(2)) : null,
						musicVolume: music ? musicVolume : null,
						musicDuck,
					},
				});
			} catch (err) {
				jobs.set(jobId, {
					status: 'error',
					progress: 0,
					outputFile: null,
					error: String((err && err.message) || err),
				});
			} finally {
				fs.rmSync(work, {recursive: true, force: true});
			}
		})();
	});
}
