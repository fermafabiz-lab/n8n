import type {SceneCaption} from './types';

/**
 * Montage planner — turns the continuous assembled video into a cut edit.
 *
 * Measured against five reference documentaries (remotion/reference/
 * editing-benchmarks.json), our output had a fatal signature: at the scene
 * threshold every reference registers 43-126 cuts per 4 minutes, ours
 * registered ONE, because consecutive scenes shared subject, location and
 * framing, and the only "cut" was a luminance dip. Reference medians span
 * 1.3s to 9.1s — there is no correct shot length — but every one of them has
 * variability >= 0.58 and a shortest:longest ratio of at least 1:10.
 *
 * So we do not touch the media. The audio timeline is fixed (narration is
 * already muxed per scene), so shots only ever re-frame the same footage:
 * a discontinuous jump in scale/position reads as a genuine cut, exactly the
 * way a documentary editor punches into a single take. Shots therefore tile
 * the timeline contiguously and never reorder or drop time.
 */

export type ShotKind = 'wide' | 'medium' | 'close' | 'detail' | 'black';

export type Shot = {
	startSeconds: number;
	durationSeconds: number;
	kind: ShotKind;
	/** Zoom applied to the footage; 1 = untouched. */
	scale: number;
	/** Framing offset in percent of frame size, applied before scale. */
	offsetXPct: number;
	offsetYPct: number;
	/** Drift direction within the shot, so a held frame still breathes. */
	driftX: number;
	driftY: number;
};

/** Deterministic PRNG so a given project always renders the same edit. */
function mulberry32(seed: number) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function hashString(s: string): number {
	let h = 2166136261;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return h >>> 0;
}

// Framing repertoire. Scale stays <= 1.5 so a punch-in never turns soft on
// 1080p footage; detail inserts sit at the top of the range but are always
// short, where softness does not register.
const FRAMINGS: Record<Exclude<ShotKind, 'black'>, {scale: number; spread: number}> = {
	wide: {scale: 1.02, spread: 2},
	medium: {scale: 1.18, spread: 5},
	close: {scale: 1.34, spread: 7},
	detail: {scale: 1.5, spread: 10},
};

/**
 * Two consecutive shots must not look like the same frame. A scale step of
 * 0.14 moves roughly a seventh of the frame, which reads as a cut both to
 * the eye and to a scene detector.
 */
const MIN_SCALE_STEP = 0.14;

function pickKind(
	rand: () => number,
	previous: ShotKind | null,
	duration: number,
): Exclude<ShotKind, 'black'> {
	// Short shots are inserts; long shots need room to breathe.
	const pool: Exclude<ShotKind, 'black'>[] =
		duration < 1.2
			? ['detail', 'close', 'detail']
			: duration < 2.5
				? ['close', 'medium', 'detail']
				: duration > 6
					? ['wide', 'medium']
					: ['medium', 'wide', 'close'];
	for (let attempt = 0; attempt < 6; attempt++) {
		const k = pool[Math.floor(rand() * pool.length)];
		if (
			!previous ||
			previous === 'black' ||
			Math.abs(FRAMINGS[k].scale - FRAMINGS[previous].scale) >= MIN_SCALE_STEP
		) {
			return k;
		}
	}
	// Fall back to whatever is furthest from the previous framing.
	const prevScale = previous && previous !== 'black' ? FRAMINGS[previous].scale : 1;
	return (Object.keys(FRAMINGS) as Exclude<ShotKind, 'black'>[]).reduce((best, k) =>
		Math.abs(FRAMINGS[k].scale - prevScale) > Math.abs(FRAMINGS[best].scale - prevScale) ? k : best,
	);
}

export type MontageOptions = {
	/** 0 = leave scenes whole, 1 = default cutting, 2 = aggressive. */
	intensity?: 0 | 1 | 2;
	/** Seed source, so two projects do not get an identical rhythm. */
	seed?: string;
	/** Insert short black frames before chapter changes. */
	blackPunctuation?: boolean;
};

/**
 * Splits a span into sub-shot durations with a dominant piece and short
 * companions, reproducing the reference shape (median well below the mean)
 * instead of equal slices.
 */
function weightedSplit(rand: () => number, duration: number, pieces: number): number[] {
	if (pieces <= 1) return [duration];
	const weights = Array.from({length: pieces}, (_, i) =>
		i === Math.floor(rand() * pieces) ? 2.2 + rand() : 0.45 + rand() * 0.6,
	);
	const total = weights.reduce((a, b) => a + b, 0);
	let out = weights.map((w) => Math.max(0.4, (w / total) * duration));
	// No three consecutive equal durations — outside a burst that reads as
	// a metronome, which is exactly the defect being fixed.
	for (let i = 2; i < out.length; i++) {
		if (Math.abs(out[i] - out[i - 1]) < 0.15 && Math.abs(out[i - 1] - out[i - 2]) < 0.15) {
			out[i] += 0.45;
		}
	}
	const scale = duration / out.reduce((a, b) => a + b, 0);
	return out.map((d) => d * scale);
}

export function planMontage(scenes: SceneCaption[], opts: MontageOptions = {}): Shot[] {
	const {intensity = 1, seed = 'video-factory', blackPunctuation = true} = opts;
	if (!scenes.length) return [];
	if (intensity === 0) {
		return scenes.map((s) => ({
			startSeconds: s.startSeconds,
			durationSeconds: s.durationSeconds,
			kind: 'medium' as ShotKind,
			scale: FRAMINGS.medium.scale,
			offsetXPct: 0,
			offsetYPct: 0,
			driftX: 1,
			driftY: 0.5,
		}));
	}

	const rand = mulberry32(hashString(seed) ^ scenes.length);
	const shots: Shot[] = [];
	let previous: ShotKind | null = null;

	// Rhythm is planned across the whole timeline, not per scene. A single
	// scene is far too short to contain both a burst and a hold, so the
	// planner walks the scene list in modes: a HOLD may swallow several
	// scenes whole (the framing simply does not change at the boundary,
	// which is what produces shots longer than any one scene), a BURST
	// chops one scene into rapid inserts, and NORMAL does light cutting.
	const BURST_EVERY = intensity === 2 ? 35 : 50; // seconds
	const HOLD_EVERY = 55;
	// The references hold shots past 10s, but that target comes from 4-minute
	// windows: on a 30s short a 10s shot would be a third of the film. Scale
	// it, capped at the reference figure.
	const totalDuration =
		scenes[scenes.length - 1].startSeconds + scenes[scenes.length - 1].durationSeconds;
	const HOLD_TARGET = Math.min(11, Math.max(4, totalDuration * 0.25));
	let sinceBurst = BURST_EVERY * 0.55; // don't open on a burst
	let sinceHold = HOLD_EVERY * 0.7;

	const push = (start: number, duration: number, forceKind?: Exclude<ShotKind, 'black'>) => {
		const kind = forceKind ?? pickKind(rand, previous, duration);
		const {scale, spread} = FRAMINGS[kind];
		const prevX = shots.length ? shots[shots.length - 1].offsetXPct : 0;
		const dirX = prevX > 0 ? -1 : prevX < 0 ? 1 : rand() < 0.5 ? -1 : 1;
		shots.push({
			startSeconds: start,
			durationSeconds: duration,
			kind,
			scale,
			offsetXPct: dirX * spread * (0.55 + rand() * 0.45),
			offsetYPct: (rand() < 0.5 ? -1 : 1) * spread * 0.45 * (0.4 + rand() * 0.6),
			driftX: (rand() < 0.5 ? -1 : 1) * (0.6 + rand() * 0.9),
			driftY: (rand() < 0.5 ? -1 : 1) * (0.4 + rand() * 0.7),
		});
		previous = kind;
	};

	let i = 0;
	while (i < scenes.length) {
		const scene = scenes[i];
		const isChapterStart = i > 0 && (scene.chapter ?? 0) !== (scenes[i - 1].chapter ?? 0);
		let cursor = scene.startSeconds;
		let remaining = scene.durationSeconds;

		// Black punctuation before a chapter turn — the reference uses a
		// 1.47s black frame exactly this way. Taken from the head of the
		// scene, so the narration timeline never shifts.
		if (blackPunctuation && isChapterStart && remaining > 1.6) {
			const blackLen = 0.32 + rand() * 0.4;
			shots.push({
				startSeconds: cursor,
				durationSeconds: blackLen,
				kind: 'black',
				scale: 1,
				offsetXPct: 0,
				offsetYPct: 0,
				driftX: 0,
				driftY: 0,
			});
			cursor += blackLen;
			remaining -= blackLen;
			previous = 'black';
		}

		// HOLD — let one framing run across scene boundaries. This is the
		// only way to reach the 10s+ shots every reference has, since our
		// scenes are one narration beat each (~7-9s).
		if (sinceHold >= HOLD_EVERY && remaining > 2) {
			let end = cursor + remaining;
			let j = i;
			// Absorb following scenes until the hold is long enough, but stop
			// at a chapter change — a chapter turn always deserves a cut.
			while (
				end - cursor < HOLD_TARGET &&
				j + 1 < scenes.length &&
				(scenes[j + 1].chapter ?? 0) === (scene.chapter ?? 0)
			) {
				j++;
				end = scenes[j].startSeconds + scenes[j].durationSeconds;
			}
			push(cursor, end - cursor, remaining > 6 ? 'wide' : 'medium');
			sinceHold = 0;
			sinceBurst += end - cursor;
			i = j + 1;
			continue;
		}

		// BURST — 4-8 rapid inserts, near-equal by design. Reference 3 runs
		// eight consecutive 0.50s shots: inside a burst, equal duration IS
		// the effect, so the no-three-equal rule is suspended here.
		if (sinceBurst >= BURST_EVERY && remaining >= 2.4) {
			const n = 4 + Math.floor(rand() * 5);
			const each = Math.min(0.9, Math.max(0.4, (remaining * 0.65) / n));
			for (let k = 0; k < n; k++) {
				push(cursor, each, 'detail');
				cursor += each;
			}
			const rest = scene.startSeconds + scene.durationSeconds - cursor;
			if (rest > 0.4) push(cursor, rest);
			sinceBurst = 0;
			sinceHold += scene.durationSeconds;
			i++;
			continue;
		}

		// NORMAL — light cutting, most scenes stay one or two shots.
		const pieces =
			remaining < 2.4 ? 1 : remaining < 6 ? (rand() < 0.45 ? 1 : 2) : rand() < 0.35 ? 2 : 3;
		for (const d of weightedSplit(rand, remaining, pieces)) {
			push(cursor, d);
			cursor += d;
		}
		sinceBurst += scene.durationSeconds;
		sinceHold += scene.durationSeconds;
		i++;
	}

	return shots;
}

/** The shot covering `seconds` (binary search — called every frame). */
export function shotAt(shots: Shot[], seconds: number): Shot | null {
	let lo = 0;
	let hi = shots.length - 1;
	while (lo <= hi) {
		const mid = (lo + hi) >> 1;
		const s = shots[mid];
		if (seconds < s.startSeconds) hi = mid - 1;
		else if (seconds >= s.startSeconds + s.durationSeconds) lo = mid + 1;
		else return s;
	}
	return shots.length ? shots[Math.min(shots.length - 1, Math.max(0, lo))] : null;
}

/**
 * CSS transform for a shot at a given time. The jump between shots is
 * deliberately instantaneous — that discontinuity is the cut. Within a shot
 * the frame drifts slowly so it never looks frozen.
 */
export function shotTransform(shot: Shot, seconds: number): string {
	const p = Math.min(1, Math.max(0, (seconds - shot.startSeconds) / Math.max(0.1, shot.durationSeconds)));
	// Held shots earn a slow push; short inserts stay still (a zoom inside a
	// half-second insert only reads as a wobble).
	const push = shot.durationSeconds > 2 ? 0.03 * p : 0.004 * p;
	const scale = shot.scale + push;
	const tx = shot.offsetXPct + shot.driftX * p;
	const ty = shot.offsetYPct + shot.driftY * p;
	return `scale(${scale.toFixed(4)}) translate(${tx.toFixed(2)}%, ${ty.toFixed(2)}%)`;
}

/** Rhythm statistics, so a render can be checked against the benchmark file. */
export function montageStats(shots: Shot[]) {
	const ds = shots.map((s) => s.durationSeconds).sort((a, b) => a - b);
	if (!ds.length) return null;
	const mean = ds.reduce((a, b) => a + b, 0) / ds.length;
	const sd = Math.sqrt(ds.reduce((a, d) => a + (d - mean) ** 2, 0) / ds.length);
	const pct = (p: number) => ds[Math.min(ds.length - 1, Math.floor((p / 100) * ds.length))];
	return {
		count: ds.length,
		medianSeconds: +pct(50).toFixed(2),
		meanSeconds: +mean.toFixed(2),
		shortestSeconds: +ds[0].toFixed(2),
		longestSeconds: +ds[ds.length - 1].toFixed(2),
		variability: +(sd / mean).toFixed(2),
		under2sPct: Math.round((ds.filter((d) => d < 2).length / ds.length) * 100),
		over6sPct: Math.round((ds.filter((d) => d > 6).length / ds.length) * 100),
	};
}
