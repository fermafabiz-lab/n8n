import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import type {StylePreset} from '../style';
import type {TextCardSpec} from '../types';
import {CURVES, curveAt, eased} from '../easing';

/**
 * The steps card: a sequence, ruled down the frame, arriving a beat at a time.
 *
 * ## Why this motif exists
 *
 * The three motifs before it — route, schedule, timeline — all want a
 * documentary: a journey with named legs, two clock times, three or more dates
 * spoken minutes apart. Most of what this pipeline actually makes is not that.
 * A fable about a snail and a turtle offers no dates, no timetable and no
 * geography, so every model asked to choose a motif for it correctly returned
 * nothing, film after film, and the producer's report was the honest summary:
 * "no animation at all, just the same card with a year on it".
 *
 * That is the failure the backlog was designed to surface (CLAUDE.md: "an
 * animation on every film is answered by MORE MOTIFS, not a looser rule"), and
 * this is the motif it asked for. What a story has, when it has nothing else,
 * is a SHAPE: it goes through stages, and there are a certain number of them,
 * and the turn comes somewhere along the way.
 *
 * ## What earns it the frame
 *
 * The test is unchanged, and this card passes it in a way the others do not:
 * by COMPRESSION. Every other card draws something from one moment of the
 * film. This one quotes three to five beats from three to five DIFFERENT
 * scenes and puts them on one frame — a stretch of film the audience has been
 * living through a sentence at a time, seen whole. No single line of narration
 * does that, and no shot can, because a shot is one moment by definition.
 *
 * That is also why the validator requires the beats to come from distinct
 * scenes and places the card at or after the last of them. A steps card built
 * from one scene's sentences would be the script, typeset — the exact failure
 * every card here is written to avoid.
 *
 * ## Why a ladder and not a path
 *
 * The route card already traces a line across a chart, and two motifs sharing
 * one drawing look like one motif used twice. A sequence with no geography has
 * no business pretending to a map: it is a list that happens in an order, and
 * the settled convention for that is a ruled spine with the beats stepping
 * down it. It also reads identically in portrait and landscape, which the
 * route's wide bow does not.
 *
 * ## Why the ticks land as the spine passes them
 *
 * Same causal chain as the route card's pen and the timeline's marks: the rule
 * reaching a beat is what puts that beat on screen, so there is one thing to
 * follow rather than several animations that happen to overlap.
 * `timeAtProgress` inverts the eased draw to find the moment the spine
 * arrives — and inverting is required rather than tidy, because the LAST beat
 * sits at a progress of exactly 1, which a "reveal once the draw has passed
 * it" test can never satisfy. That bug shipped once already, on the route
 * card, and hid the destination of a card whose whole subject was the
 * destination.
 */

/** Shared with the other cards: one family, one fade. */
const IN = 0.22;
const OUT = 0.2;

/** The eyebrow, then the spine drawing down through the beats. */
const LABEL: readonly [number, number] = [0.08, 0.38];
const DRAW: readonly [number, number] = [0.24, 1.5];
/** How long a beat takes to arrive once the spine has reached it. */
const STEP_REVEAL = 0.36;
/** The note lands after the last beat. */
const NOTE: readonly [number, number] = [1.52, 1.86];

/**
 * The moment the spine reaches a given fraction of its own length.
 *
 * Bisection rather than an inverse in closed form: the draw is a bezier, and
 * twenty-four halvings put the answer inside a thousandth of a second, which
 * is a fortieth of a frame.
 */
const timeAtProgress = (u: number): number => {
	if (u <= 0) return DRAW[0];
	let lo = DRAW[0];
	let hi = DRAW[1];
	for (let i = 0; i < 24; i++) {
		const mid = (lo + hi) / 2;
		if (eased(mid, DRAW, [0, 1], CURVES.inOutCubic) < u) lo = mid;
		else hi = mid;
	}
	return hi;
};

export const StepsCard: React.FC<{
	card: TextCardSpec;
	/** Actual on-screen window — from the planned SHOT, never from the spec. */
	seconds: number;
	preset: StylePreset;
}> = ({card, seconds, preset}) => {
	const frame = useCurrentFrame();
	const {fps, width, height} = useVideoConfig();
	const t = frame / fps;
	if (t > seconds) return null;

	const steps = (card.steps ?? []).slice(0, 5);
	if (steps.length < 3) return null;

	const inP = Math.min(1, t / IN);
	const outP = Math.max(0, (t - (seconds - OUT)) / OUT);
	const opacity = curveAt(inP, CURVES.outQuart) * (1 - curveAt(Math.min(1, outP), CURVES.inOutCubic));

	// Sized against the frame's SHORT side, for the reason the timeline card
	// states: a card that fills the frame should not shrink because the frame is
	// narrow.
	const portrait = height > width;
	const short = Math.min(width, height);
	const blockW = width * (portrait ? 0.84 : 0.62);
	const rowH = short * (portrait ? 0.105 : 0.115);
	const spineH = rowH * (steps.length - 1);
	const labelSize = short * (portrait ? 0.05 : 0.042);
	const ordSize = labelSize * 0.6;
	/**
	 * Weights and the tick, in the same unit as the type.
	 *
	 * NOT `px()`, which scales by `width / 1280` and therefore collapses every
	 * drawn weight to 56% on a 9:16 frame — the first portrait still showed a
	 * seven-pixel tick on a two-pixel spine beside 27px labels, which reads as a
	 * card rendered at half size rather than as a card designed for a phone.
	 * The short side is the one both orientations share, so sizing against it is
	 * what makes this the same drawing rotated rather than a shrunken one. In
	 * landscape `unit` is exactly 1 at 720p, so nothing there moves.
	 */
	const unit = short / 720;
	const dot = 13 * unit;

	const stroke = preset.cardInk;
	const drawn = eased(t, DRAW, [0, 1], CURVES.inOutCubic);

	return (
		<AbsoluteFill
			style={{background: preset.cardGround, opacity, justifyContent: 'center', alignItems: 'center'}}
		>
			<div style={{width: blockW}}>
				{card.label && (
					<div
						style={{
							fontFamily: preset.kickerFont,
							fontWeight: 500,
							fontSize: ordSize,
							letterSpacing: ordSize * 0.24,
							textTransform: 'uppercase',
							color: stroke,
							opacity: eased(t, LABEL, [0, 1], CURVES.outQuart),
							marginBottom: rowH * 0.42,
							marginLeft: dot * 2.6,
						}}
					>
						{card.label}
					</div>
				)}

				<div style={{position: 'relative', height: spineH + dot * 2}}>
					{/* The spine, drawn top to bottom. It starts and ends ON the first
					    and last beats rather than running past them: a rule that
					    overshoots its own last stop says the sequence continues, and
					    this card is drawing a stretch that ended. */}
					<div
						style={{
							position: 'absolute',
							left: dot / 2 - 1.5 * unit,
							top: dot,
							width: Math.max(1, 3 * unit),
							height: spineH * drawn,
							background: stroke,
							opacity: 0.9,
						}}
					/>

					{steps.map((step, i) => {
						// Named for what it is, and never `u`: an earlier draft called it
						// that and shadowed the scale unit above, so the tick's own
						// outline was drawn at the step's FRACTION — 1px on the first
						// beat, 3px on the last, and no error anywhere.
						const along = steps.length === 1 ? 1 : i / (steps.length - 1);
						const arrived = timeAtProgress(along);
						const p = curveAt((t - arrived) / STEP_REVEAL, CURVES.outQuart);
						// The last beat is where the sequence got to, so it is the one
						// filled solid. The rest are stations passed through.
						const last = i === steps.length - 1;
						return (
							<div
								key={i}
								style={{
									position: 'absolute',
									left: 0,
									top: dot + i * rowH - dot,
									display: 'flex',
									alignItems: 'center',
									width: '100%',
								}}
							>
								<div
									style={{
										width: dot,
										height: dot,
										borderRadius: dot,
										border: `${Math.max(1, 3 * unit)}px solid ${stroke}`,
										background: last ? stroke : preset.cardGround,
										transform: `scale(${(0.4 + 0.6 * p).toFixed(3)})`,
										opacity: p,
										flex: '0 0 auto',
									}}
								/>
								<div
									style={{
										marginLeft: dot * 1.6,
										opacity: p,
										// Short travel, because the fade is what reveals — the
										// hook title's rule, and the reason no mask is needed.
										transform: `translateX(${((1 - p) * labelSize * 0.5).toFixed(2)}px)`,
										display: 'flex',
										alignItems: 'baseline',
										gap: labelSize * 0.5,
									}}
								>
									<span
										style={{
											fontFamily: preset.kickerFont,
											fontWeight: 500,
											fontSize: ordSize,
											letterSpacing: ordSize * 0.1,
											color: stroke,
											opacity: 0.75,
										}}
									>
										{String(i + 1).padStart(2, '0')}
									</span>
									<span
										style={{
											fontFamily: preset.captionFont,
											fontWeight: last ? 700 : 600,
											fontSize: labelSize,
											lineHeight: 1.2,
											color: last ? '#F5F2EA' : '#E8E4DA',
										}}
									>
										{step.label}
									</span>
								</div>
							</div>
						);
					})}
				</div>

				{/* The note sits clear of the last beat rather than tucked under it: it
				    is a statement ABOUT the sequence, and a rule drawn tight against
				    the final label reads as that label's underline instead. */}
				{card.note && (
					<div style={{marginLeft: dot * 2.6, marginTop: rowH * 0.55}}>
						<div
							style={{
								height: Math.max(1, 2 * unit),
								width: eased(t, NOTE, [0, blockW * 0.3], CURVES.outExpo),
								background: stroke,
								marginBottom: labelSize * 0.45,
							}}
						/>
						<div
							style={{
								fontFamily: preset.captionFont,
								fontWeight: 600,
								fontSize: labelSize * 0.92,
								color: '#F5F2EA',
								opacity: eased(t, NOTE, [0, 1], CURVES.outQuart),
							}}
						>
							{card.note}
						</div>
					</div>
				)}
			</div>
		</AbsoluteFill>
	);
};
