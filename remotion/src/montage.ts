import type {SceneCaption} from './types';

/**
 * Montage planner — chooses a framing for each shot of the assembled video.
 *
 * ## A cut is a change of picture, not a change of zoom
 *
 * This planner used to manufacture cuts. Measured against five reference
 * documentaries (remotion/reference/editing-benchmarks.json), our edit
 * registered ONE cut where they register 43-126 per 4 minutes, so the planner
 * was built to close that gap by jumping the scale and position of the SAME
 * footage several times per scene — "exactly the way a documentary editor
 * punches into a single take".
 *
 * That was wrong, and the way it was wrong is worth remembering. The cut count
 * came from a scene-change DETECTOR, and a detector cannot tell a new shot from
 * a hard zoom on the old one. Optimising against it produced an edit that
 * scored 18.6 cuts/min, passed every acceptance target, and read to a human as
 * a rendering fault: on a 42s film with 6 scenes it planned 13 cuts where the
 * picture only changed 5 times, including four rapid zoom jumps inside one
 * unbroken clip. What the references actually have at those timestamps is a
 * different SHOT — new subject, new angle — not the previous one enlarged.
 *
 * So the rule is now the honest one: **a cut may only land where the footage
 * itself changes.** With one clip per scene that means scene boundaries, and
 * the planner's job is not to invent more of them but to make each one read —
 * consecutive scenes get deliberately contrasting framings, so a real change of
 * picture is reinforced by a real change of frame. Within a shot the framing
 * moves continuously and never jumps.
 *
 * The consequence is fewer cuts than the references, and that is not a defect
 * to be engineered away: it is the material telling the truth. One clip per
 * scene can only ever yield one shot per scene. More cutting needs more
 * footage — the Faza 2 plan in README.md, where Remotion receives the scene
 * clips separately and can cut between them.
 */

/**
 * `detail` used to sit at the tight end of this list, for the sub-second
 * inserts a burst was made of. Every shot is now a whole scene, and a "detail"
 * framing held for ten seconds is not an insert — it is the picture zoomed too
 * far. Dropping it also lets the three that remain be spaced far enough apart
 * that any two of them cut; see FRAMINGS.
 */
export type ShotKind = 'wide' | 'medium' | 'close' | 'black';

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

// Framing repertoire. Three rungs, spaced 0.18 apart, and the spacing is the
// load-bearing part: a shot pushes 0.03 inward while it plays (HELD_PUSH), so
// two framings only cut if their BASE gap exceeds MIN_SCALE_STEP plus that
// push. The old four-rung ladder was spaced 0.10-0.16, which meant NO pair of
// neighbours cleared the step — `medium` was a dead end you could enter and
// not leave, and the planner silently fell back to a 0.13 cut nobody sees.
// Any two rungs here cut, so there is no dead end to fall out of.
//
// Every scale must also be large enough to HIDE its own framing offset. The
// frame is moved by up to `spread` percent plus 1.5 of drift, and an offset
// that exceeds the overscan drags the picture off its own edge and shows a
// black band down one side. `wide` used to sit at 1.02 — barely 1% of overscan
// per side against offsets reaching 3.5% — so the calmest framing in the
// repertoire was the one that could tear. Required: scale >= 1 + 2 * (spread +
// 1.5) / 100, asserted by scripts/check-montage.mjs.
//
// The tightest rung stays under 1.5 so a punch-in never turns soft.
const FRAMINGS: Record<Exclude<ShotKind, 'black'>, {scale: number; spread: number}> = {
	wide: {scale: 1.08, spread: 2},
	medium: {scale: 1.26, spread: 5},
	close: {scale: 1.44, spread: 7},
};

/**
 * Two consecutive shots must not look like the same frame. A scale step of
 * 0.14 moves roughly a seventh of the frame, which reads as a cut both to
 * the eye and to a scene detector.
 */
export const MIN_SCALE_STEP = 0.14;

/**
 * Slow push applied *within* a shot by `shotTransform`. It matters to the
 * planner because the cut happens between the END of one shot and the START
 * of the next: a shot that drifted 0.03 upward leaves a smaller gap than its
 * base framing suggests. Comparing base scales instead of end scales made
 * planned 14% cuts land at 3% in practice — a cut the detector cannot see is
 * not a cut. One function owns the number so the two can never disagree.
 */
const HELD_PUSH = 0.03;
const INSERT_PUSH = 0.004;

const pushFor = (durationSeconds: number) => (durationSeconds > 2 ? HELD_PUSH : INSERT_PUSH);

/** The scale the footage has actually reached by the time a shot ends. */
const endScaleOf = (shot: {scale: number; durationSeconds: number; kind: ShotKind}): number | null =>
	shot.kind === 'black' ? null : shot.scale + pushFor(shot.durationSeconds);

type Framing = Exclude<ShotKind, 'black'>;

function furthest(prevEndScale: number, candidates: Framing[]): Framing {
	return candidates.reduce((best, k) =>
		Math.abs(FRAMINGS[k].scale - prevEndScale) > Math.abs(FRAMINGS[best].scale - prevEndScale)
			? k
			: best,
	);
}

/**
 * Framings that suit a shot of this length. A long shot needs room to breathe;
 * a brief one can afford to sit close, where there is less frame to read.
 */
function poolFor(duration: number): Framing[] {
	// Every pool keeps at least two rungs that cut against each other, so the
	// planner can never be cornered into a framing it cannot leave.
	if (duration >= 7) return ['wide', 'medium', 'close'];
	if (duration <= 3) return ['close', 'medium'];
	return ['medium', 'close', 'wide'];
}

/**
 * The framing for the next real shot, chosen to CROSS the previous one.
 *
 * Merely clearing `MIN_SCALE_STEP` is not enough to make a change of picture
 * land: stepping 1.18 -> 1.34 -> 1.50 clears the threshold three times while
 * moving steadily in one direction, which the eye reads as one long push
 * rather than three shots. Alternating sides — out after in, in after out — is
 * what makes each new scene announce itself as new.
 */
function crossing(
	rand: () => number,
	prevEndScale: number,
	candidates: Framing[],
): Framing | null {
	const wentTight = candidates.filter(
		(k) => FRAMINGS[k].scale > prevEndScale + MIN_SCALE_STEP,
	);
	const wentWide = candidates.filter(
		(k) => FRAMINGS[k].scale < prevEndScale - MIN_SCALE_STEP,
	);
	// Prefer the side we are NOT already on. Above the middle of the repertoire
	// the only way to cross is outward, and vice versa.
	const mid = (FRAMINGS.wide.scale + FRAMINGS.close.scale) / 2;
	const first = prevEndScale >= mid ? wentWide : wentTight;
	const second = prevEndScale >= mid ? wentTight : wentWide;
	const side = first.length ? first : second;
	if (!side.length) return null;
	// Usually the boldest available crossing, sometimes the mildest one that
	// still clears the step. Always taking the furthest made the edit ping-pong
	// between the two extremes of the pool — legible on six scenes, a metronome
	// on twenty. Every option here is already a visible cut; which one is a
	// matter of variety, not of whether the cut lands.
	if (side.length === 1 || rand() < 0.65) return furthest(prevEndScale, side);
	return side.reduce((best, k) =>
		Math.abs(FRAMINGS[k].scale - prevEndScale) < Math.abs(FRAMINGS[best].scale - prevEndScale)
			? k
			: best,
	);
}

export type MontageOptions = {
	/**
	 * How hard each real cut is reinforced by the framing: 0 leaves the footage
	 * alone, 1 contrasts within what the shot length suits, 2 always takes the
	 * furthest framing available.
	 *
	 * It deliberately cannot add cuts. How often the picture changes is a
	 * property of the footage, not a dial — the previous version treated it as
	 * one, and manufactured the zoom jumps this planner exists to avoid.
	 */
	intensity?: 0 | 1 | 2;
	/** Seed source, so two projects do not get an identical rhythm. */
	seed?: string;
	/** Insert short black frames before chapter changes. */
	blackPunctuation?: boolean;
};

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
	// Where the previous shot left the footage, not which framing it started
	// from. `null` means "anything cuts from here" — the opening frame, and
	// after a black, where the cut is total whatever follows it.
	let prevEndScale: number | null = null;

	// One shot per scene, because one clip per scene is what the footage gives
	// us. There is no rhythm to plan across the timeline: the rhythm IS the
	// scene list, which the script already paced to the narration. What the
	// planner controls is how each real change of picture is framed.
	for (let i = 0; i < scenes.length; i++) {
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
			prevEndScale = null;
		}

		// Intensity 2 picks from the whole repertoire rather than the framings
		// that suit the length: a stronger contrast at the cost of sitting
		// closer than a long shot really wants.
		const pool = intensity === 2 ? (Object.keys(FRAMINGS) as Framing[]) : poolFor(remaining);
		const kind =
			prevEndScale === null
				? pool[0]
				: (crossing(rand, prevEndScale, pool) ?? furthest(prevEndScale, pool));
		const {scale, spread} = FRAMINGS[kind];
		// Offsets alternate sides, so successive scenes are not all framed off
		// the same edge — another way the change reads as deliberate.
		const prevX = shots.length ? shots[shots.length - 1].offsetXPct : 0;
		const dirX = prevX > 0 ? -1 : prevX < 0 ? 1 : rand() < 0.5 ? -1 : 1;
		const shot: Shot = {
			startSeconds: cursor,
			durationSeconds: remaining,
			kind,
			scale,
			offsetXPct: dirX * spread * (0.55 + rand() * 0.45),
			offsetYPct: (rand() < 0.5 ? -1 : 1) * spread * 0.45 * (0.4 + rand() * 0.6),
			driftX: (rand() < 0.5 ? -1 : 1) * (0.6 + rand() * 0.9),
			driftY: (rand() < 0.5 ? -1 : 1) * (0.4 + rand() * 0.7),
		};
		shots.push(shot);
		prevEndScale = endScaleOf(shot);
	}

	return shots;
}

/**
 * Seconds at which the FOOTAGE changes — scene starts, which is the only place
 * a cut is honest. Exported so the checker can assert that every planned cut
 * lands on one instead of measuring cut COUNT, the metric that produced the
 * zoom-jump edit in the first place.
 */
export function pictureChanges(scenes: SceneCaption[]): number[] {
	return scenes.map((s) => s.startSeconds);
}

/**
 * Per framing: the scale it has, and the least it needs so its own offset and
 * drift stay inside the picture. `short` is how much it is missing — anything
 * above zero can show a black band down one edge.
 */
export function framingOverscan(): {kind: string; scale: number; needs: number; short: number}[] {
	// The largest excursion `planMontage` can produce: offsetXPct peaks at the
	// full spread, and driftX adds up to 1.5 more over the shot.
	const MAX_DRIFT = 1.5;
	return (Object.keys(FRAMINGS) as Framing[]).map((kind) => {
		const {scale, spread} = FRAMINGS[kind];
		const needs = 1 + (2 * (spread + MAX_DRIFT)) / 100;
		return {kind, scale, needs: +needs.toFixed(3), short: +Math.max(0, needs - scale).toFixed(3)};
	});
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
	// half-second insert only reads as a wobble). The amount comes from the
	// same `pushFor` the planner uses to size its cuts.
	const scale = shot.scale + pushFor(shot.durationSeconds) * p;
	const tx = shot.offsetXPct + shot.driftX * p;
	const ty = shot.offsetYPct + shot.driftY * p;
	return `scale(${scale.toFixed(4)}) translate(${tx.toFixed(2)}%, ${ty.toFixed(2)}%)`;
}

export type CutAudit = {
	atSeconds: number;
	from: ShotKind;
	to: ShotKind;
	/**
	 * Absolute scale difference across the cut, measured from where the
	 * outgoing shot ACTUALLY ended (base framing plus its within-shot push),
	 * which is what a detector sees.
	 */
	scaleJump: number;
	/** Black on either side: the cut is total and framing does not matter. */
	hardCut: boolean;
	belowThreshold: boolean;
};

/**
 * Every planned cut and how big a jump it really is. Rhythm statistics alone
 * cannot tell you whether the edit is visible: a shot list with perfect
 * variability still reads as one continuous take if consecutive framings
 * happen to match. Run this after any change to the planner —
 * `npm run check:montage` does exactly that.
 */
export function auditCuts(shots: Shot[]): CutAudit[] {
	const out: CutAudit[] = [];
	for (let i = 1; i < shots.length; i++) {
		const a = shots[i - 1];
		const b = shots[i];
		const hardCut = a.kind === 'black' || b.kind === 'black';
		const from = endScaleOf(a);
		const scaleJump = hardCut || from === null ? Infinity : Math.abs(b.scale - from);
		out.push({
			atSeconds: +b.startSeconds.toFixed(2),
			from: a.kind,
			to: b.kind,
			scaleJump: hardCut ? 0 : +scaleJump.toFixed(3),
			hardCut,
			belowThreshold: scaleJump < MIN_SCALE_STEP,
		});
	}
	return out;
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
