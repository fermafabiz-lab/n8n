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
export type ShotKind = 'wide' | 'medium' | 'close' | 'black' | 'card';

export type Shot = {
	startSeconds: number;
	durationSeconds: number;
	kind: ShotKind;
	/**
	 * Index into `MontageOptions.cards`, set only when kind is 'card'. The
	 * planner never sees what a card holds — it places TIME and the caller
	 * renders. Rhythm has no business knowing about Airtable.
	 */
	cardIndex?: number;
	/** Zoom applied to the footage; 1 = untouched. */
	scale: number;
	/** Framing offset in percent of frame size, applied before scale. */
	offsetXPct: number;
	offsetYPct: number;
	/** Drift direction within the shot, so a held frame still breathes. */
	driftX: number;
	driftY: number;
	/**
	 * How much this shot creeps inward while it plays, as a scale delta.
	 *
	 * Carried on the shot rather than recomputed from its duration, because
	 * intensity 0 has to be able to say ZERO. It could not before: the push was
	 * derived from length alone, so "no montage" still reset the frame by 1.5%
	 * at every cut — every scene drifted from 1.110 to 1.125 and the next one
	 * snapped back. Small, but it is a zoom on a cut, which is the one thing
	 * intensity 0 exists to not do.
	 */
	push: number;
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
// The tightest rung stays modest so a punch-in never turns soft.
//
// The ladder used to run 1.08 / 1.26 / 1.44, spaced 0.18, because the framing
// step was expected to MAKE the cut — big enough to register on a scene
// detector. That premise died when the planner went to one shot per scene: the
// footage already cuts at every scene boundary, so there is no cut left to
// manufacture. What the wide spacing did instead was fight the picture, and it
// could only ever fight it, because the planner never sees a frame of footage.
// Measured on a real film: Veo had generated scene 1 as a wide two-shot of the
// whole room and scene 2 as a close-up of one face; the planner punched the
// wide one to 1.44 and left the close-up at 1.08 — the opposite of the footage's
// own intent, so at the cut the picture went wide→close while the framing went
// close→wide. Two changes pulling against each other on one frame is exactly
// what the producer reported as "looks like a zoom error", twice.
//
// Narrow rungs cannot invert anything meaningfully: at 1.17 the frame still
// shows 85% of the picture rather than 69%, which also stops the resampling
// from softening 720-wide AI footage. Framing is now composition and breathing,
// not a cut. Spacing is 0.06, comfortably above MIN_SCALE_STEP plus HELD_PUSH,
// so no rung is a dead end.
const FRAMINGS: Record<Framing, {scale: number; spread: number}> = {
	wide: {scale: 1.05, spread: 0.5},
	medium: {scale: 1.11, spread: 2},
	close: {scale: 1.17, spread: 3},
};

/**
 * Two consecutive shots must not be an EXACT match — that is all this asserts
 * now. It used to demand 0.14, a seventh of the frame, so that a scene detector
 * would register the change as a cut; see the note on FRAMINGS for why that
 * requirement is gone. The picture change is the cut; the framing only has to
 * avoid looking like a continuation of the same shot.
 */
export const MIN_SCALE_STEP = 0.04;

/**
 * Slow push applied *within* a shot by `shotTransform`. It matters to the
 * planner because the cut happens between the END of one shot and the START
 * of the next: a shot that drifted 0.03 upward leaves a smaller gap than its
 * base framing suggests. Comparing base scales instead of end scales made
 * planned 14% cuts land at 3% in practice — a cut the detector cannot see is
 * not a cut. One function owns the number so the two can never disagree.
 */
// Halved along with the ladder. At 0.03 a ten-second scene visibly crept
// inward for its whole length — the second half of the "some kind of zoom"
// complaint, and the half that is present even when no cut is near.
const HELD_PUSH = 0.015;
const INSERT_PUSH = 0.004;

const pushFor = (durationSeconds: number) => (durationSeconds > 2 ? HELD_PUSH : INSERT_PUSH);

/**
 * The scale the footage has actually reached by the time a shot ends, or null
 * for a shot that is not footage at all.
 */
const endScaleOf = (shot: {scale: number; push: number; kind: ShotKind}): number | null =>
	shot.kind === 'black' || shot.kind === 'card' ? null : shot.scale + shot.push;

/**
 * `black` and `card` are not framings — they are what the frame HOLDS, a
 * different axis from how tightly the footage is cropped. The union carries
 * both because a shot is only ever one of them, but every framing lookup has
 * to exclude them.
 */
type Framing = Exclude<ShotKind, 'black' | 'card'>;

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
	/**
	 * Text cards available to cut to, in the caller's own order.
	 *
	 * These are the one legitimate way to add a cut that the footage does not
	 * give us, and they pass the rule above rather than dodging it: a card
	 * replaces the picture entirely. Nothing about the two frames either side
	 * matches — it is a change of material, not a change of zoom, which is
	 * exactly what a scene boundary is and exactly what a punch-in is not.
	 *
	 * They are also why more cutting no longer has to wait for Faza 2. The
	 * material is already bought: the Evidence pack and the figures the
	 * narration speaks (see src/textCards.ts).
	 */
	cards?: MontageCard[];
};

export type MontageCard = {
	/** The scene whose narration this card belongs with. */
	sceneIndex: number;
	/** How long it wants on screen; the caller knows how much text it holds. */
	seconds: number;
	/**
	 * Shortest it may be squeezed to and still be readable. Without a floor to
	 * shrink to, a claim card — long by nature, since it carries a whole sourced
	 * sentence — never fitted a 4-5s scene and every one was silently dropped.
	 */
	minSeconds?: number;
};

/**
 * A card is content, so its placement obeys the edit rather than a fixed slot
 * like "always at the chapter start" — dropped at fixed points cards land NEXT
 * TO the rhythm instead of in it.
 */
/** Minimum quiet time between two cards. */
const CARD_MIN_GAP = 9;
/** No more than this share of the runtime may be card. */
const CARD_MAX_SHARE = 0.16;
/**
 * Footage that runs before the card inside the same scene. A claim card supers
 * a sentence that has already begun; cutting to it on the scene's first frame
 * would land before the narration gives it a reason to exist.
 */
const CARD_LEAD = 1.1;

export function planMontage(scenes: SceneCaption[], opts: MontageOptions = {}): Shot[] {
	const {intensity = 1, seed = 'video-factory', blackPunctuation = true, cards = []} = opts;
	if (!scenes.length) return [];

	const totalRuntime =
		scenes[scenes.length - 1].startSeconds + scenes[scenes.length - 1].durationSeconds;
	const cardBudget = totalRuntime * CARD_MAX_SHARE;
	// One card per scene at most; the caller's order decides which wins.
	const cardForScene = new Map<number, number>();
	cards.forEach((c, i) => {
		if (!cardForScene.has(c.sceneIndex)) cardForScene.set(c.sceneIndex, i);
	});
	let cardSecondsUsed = 0;
	let lastCardEnd = -Infinity;

	/**
	 * Room for this scene's card? Checked identically at every intensity,
	 * because a card is material rather than framing: turning the montage off
	 * must not throw away a sourced claim.
	 */
	const cardRoom = (sceneIndex: number, cursor: number, remaining: number) => {
		const ci = cardForScene.get(sceneIndex);
		if (ci === undefined) return null;
		const card = cards[ci];
		const floor = Math.min(card.seconds, card.minSeconds ?? card.seconds);
		// A card may run to the end of its scene — the next scene is a real cut
		// regardless — but it may never start before the lead.
		const available = remaining - CARD_LEAD;
		if (available < floor) return null;
		if (cursor - lastCardEnd < CARD_MIN_GAP) return null;
		const secs = Math.min(card.seconds, available);
		if (cardSecondsUsed + secs > cardBudget) return null;
		return {ci, secs};
	};

	const cardShot = (start: number, cardIndex: number, seconds: number): Shot => ({
		startSeconds: start,
		durationSeconds: seconds,
		kind: 'card',
		cardIndex,
		scale: 1,
		offsetXPct: 0,
		offsetYPct: 0,
		driftX: 0,
		driftY: 0,
		push: 0,
	});

	if (intensity === 0) {
		const out: Shot[] = [];
		//
		// `after` is the shot this one picks up from, set only for the footage on
		// the far side of a card. Even here, where the framing never changes, the
		// pan has to carry on: the head drifts a percent across its lead and a
		// tail starting at zero snaps it back the moment the card lifts. Small,
		// and on the same frame as a cut the viewer is already watching closely.
		const plain = (startSeconds: number, durationSeconds: number, after?: Shot): Shot => ({
			startSeconds,
			durationSeconds,
			kind: 'medium',
			scale: FRAMINGS.medium.scale,
			offsetXPct: after ? after.offsetXPct + after.driftX : 0,
			offsetYPct: after ? after.offsetYPct + after.driftY : 0,
			// Drift stays: it is a pan of one percent, which keeps a held frame
			// from looking frozen and is not what anyone means by a zoom.
			driftX: 1,
			driftY: 0.5,
			push: 0,
		});
		scenes.forEach((s, i) => {
			const room = cardRoom(i, s.startSeconds, s.durationSeconds);
			if (!room) {
				out.push(plain(s.startSeconds, s.durationSeconds));
				return;
			}
			const head = plain(s.startSeconds, CARD_LEAD);
			out.push(head);
			out.push(cardShot(s.startSeconds + CARD_LEAD, room.ci, room.secs));
			const tail = s.durationSeconds - CARD_LEAD - room.secs;
			if (tail > 0.35) out.push(plain(s.startSeconds + CARD_LEAD + room.secs, tail, head));
			cardSecondsUsed += room.secs;
			lastCardEnd = s.startSeconds + CARD_LEAD + room.secs;
		});
		return out;
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
				push: 0,
			});
			cursor += blackLen;
			remaining -= blackLen;
			prevEndScale = null;
		}

		/**
		 * One footage shot, from `cursor` for `length`. Framing crosses whatever
		 * the previous footage shot ended on, so a real change of picture is
		 * reinforced by a real change of frame.
		 */
		const footage = (length: number) => {
			// Intensity 2 picks from the whole repertoire rather than the framings
			// that suit the length: a stronger contrast at the cost of sitting
			// closer than a long shot really wants.
			const pool = intensity === 2 ? (Object.keys(FRAMINGS) as Framing[]) : poolFor(length);
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
				durationSeconds: length,
				kind,
				scale,
				offsetXPct: dirX * spread * (0.55 + rand() * 0.45),
				offsetYPct: (rand() < 0.5 ? -1 : 1) * spread * 0.45 * (0.4 + rand() * 0.6),
				driftX: (rand() < 0.5 ? -1 : 1) * (0.6 + rand() * 0.9),
				driftY: (rand() < 0.5 ? -1 : 1) * (0.4 + rand() * 0.7),
				push: pushFor(length),
			};
			shots.push(shot);
			cursor += length;
			remaining -= length;
			prevEndScale = endScaleOf(shot);
		};

		/**
		 * The footage AFTER a mid-scene card: the same clip the card
		 * interrupted, picked up where it was put down.
		 *
		 * Not `footage()` with the previous framing forced in — the head's push
		 * and drift have moved the frame by the time the card takes over, so
		 * re-entering on the head's BASE framing would step back by that much.
		 * Starting from where the head actually ended is what makes the return
		 * invisible; the drift direction carries on for the same reason.
		 */
		const resume = (head: Shot, length: number) => {
			const shot: Shot = {
				startSeconds: cursor,
				durationSeconds: length,
				kind: head.kind,
				scale: head.scale + head.push,
				offsetXPct: head.offsetXPct + head.driftX,
				offsetYPct: head.offsetYPct + head.driftY,
				driftX: head.driftX,
				driftY: head.driftY,
				push: pushFor(length),
			};
			shots.push(shot);
			cursor += length;
			remaining -= length;
			prevEndScale = endScaleOf(shot);
		};

		// A card splits the scene into footage / card / footage. This is the one
		// mid-scene cut the planner is allowed to invent, and it does not break
		// the rule above: the picture is genuinely replaced, so nothing about the
		// frames either side matches.
		//
		// The framing used to CROSS the card, on the reasoning that the two
		// footage shots never touch on screen so there is no jump to see. That
		// reasoning is wrong, and it was reported from a finished film: the two
		// shots are the SAME CLIP, three seconds apart. The eye holds a picture
		// across a two-second cutaway and measures the return against it — which
		// is precisely the zoom-jump complaint this planner exists to prevent,
		// arriving through the one door left open to it. A real cutaway returns
		// to the shot it left; that is what makes it a cutaway rather than two
		// shots with a graphic between them.
		//
		// So the tail RESUMES the head: same framing, and starting exactly where
		// the head's push and drift had carried it, so the frame the card
		// uncovers is the frame it covered.
		const room = cardRoom(i, cursor, remaining);
		if (room) {
			footage(CARD_LEAD);
			const head = shots[shots.length - 1];
			shots.push(cardShot(cursor, room.ci, room.secs));
			cursor += room.secs;
			remaining -= room.secs;
			cardSecondsUsed += room.secs;
			lastCardEnd = cursor;
			// A card that runs to the scene boundary leaves no tail, and a
			// sub-frame orphan shot would be worse than none.
			if (remaining > 0.35) resume(head, remaining);
			continue;
		}

		footage(remaining);
	}

	return shots;
}

/**
 * Seconds at which the PICTURE genuinely changes, which is the only place a cut
 * is honest. Exported so the checker can assert that every planned cut lands on
 * one, instead of measuring cut COUNT — the metric that produced the zoom-jump
 * edit in the first place.
 *
 * Scene starts, because one clip per scene is what the footage gives us, plus
 * each placed card's in and out. A card qualifies on the same terms as a scene
 * boundary rather than by exemption: the frame is replaced outright, so nothing
 * about the two pictures either side matches. Pass the plan to include them; a
 * bare call still answers for the footage alone.
 */
export function pictureChanges(scenes: SceneCaption[], shots: Shot[] = []): number[] {
	const out = scenes.map((s) => s.startSeconds);
	for (const shot of shots) {
		if (shot.kind !== 'card') continue;
		out.push(shot.startSeconds, shot.startSeconds + shot.durationSeconds);
	}
	return out.sort((a, b) => a - b);
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
	const scale = shot.scale + shot.push * p;
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
	/**
	 * Black or a card on either side: the picture is replaced outright, so
	 * framing does not matter — nothing about the two frames matches.
	 */
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
		const notFootage = (k: ShotKind) => k === 'black' || k === 'card';
		const hardCut = notFootage(a.kind) || notFootage(b.kind);
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
