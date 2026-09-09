import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import type {StylePreset} from '../style';
import type {TextCardSpec} from '../types';
import {CURVES, curveAt, eased} from '../easing';
import {fitTitleSize} from '../fitType';

/**
 * The full-frame text card the montage cuts to.
 *
 * It deliberately does NOT look like the chapter card. Two full-frame light
 * cards in one film are confusable, and worse, they would compete for the same
 * meaning — the chapter card is a division, this is evidence. So the chapter
 * card keeps the preset's light ground and the light-leak reveal, and this one
 * is ink with the accent colour, revealed by a fast settle.
 *
 * No light leak here on purpose: the leak is the chapter boundary's own
 * treatment, and reusing it would blur which element owns a frame. Being a
 * change of source, this card already reads as a hard cut without any help.
 *
 * ## Why the figure MOVES, since 2026-09-09
 *
 * This is the card almost every film actually gets. The motifs are authored by
 * a model and only three of them exist, so most films get none — while the
 * figure card is derived in code from a number the narration speaks and
 * therefore turns up nearly everywhere. It used to fade in and settle 3% of
 * scale, and that is the whole reason the producer's report was "the same
 * card, not really animated, on every project": the one card that always
 * ships was the one card with nothing to watch.
 *
 * So the number now ARRIVES rather than appearing. Its digits roll home one
 * after another, a rule draws under them, and the kicker that says what the
 * number means rises in last — the payload arriving after the thing it
 * explains, the same order the schedule and timeline cards already use.
 *
 * The roll is a different mechanism from the schedule board's flap on
 * purpose. A flap PINCHES: the leaf falls edge-on through the horizontal and
 * the glyph squashes to nothing, which is what makes it read as paper. A
 * counter SLIDES: the digits travel vertically past a window, which is what
 * makes it read as a dial. Two motifs sharing one mechanism would look like
 * one motif used twice.
 */

/** Ground and reveal timings. Short: the card is a beat, not a stop. */
const IN = 0.22;
const OUT = 0.2;

/**
 * The figure's reveal, in seconds from the card's own start.
 *
 * `ROLL` is the FIRST digit's window; each later digit starts `ROLL_STEP`
 * after its neighbour, so the number lands left to right and the eye reads it
 * instead of receiving it. Every value here is scaled by `fitReveal` below
 * when the planner squeezes the card, so the last thing to arrive always
 * lands before the exit begins.
 */
const ROLL: readonly [number, number] = [0.08, 0.6];
const ROLL_STEP = 0.07;
/** How many digits go past before the right one lands. */
const ROLL_TURNS = 3;
/** The rule, then the words that say what the number is. */
const RULE: readonly [number, number] = [0.58, 0.86];
const KICKER: readonly [number, number] = [0.8, 1.1];
/** A claim's words arrive in order, on the same curve as everything else. */
const CLAIM_WORD_STEP = 0.045;
const CLAIM_WORD_IN = 0.34;
/** Space the last arrival must leave before the exit fade starts. */
const LANDED_BEFORE_EXIT = 0.3;

/**
 * One digit of the figure, mid-roll.
 *
 * A counter shows the digits it passes on the way, which is what tells the eye
 * this is a dial landing on a value rather than a number that faded in. The
 * sequence is ARITHMETIC — `(d - ROLL_TURNS + k) % 10` — for the reason the
 * split-flap's is: a render must be reproducible, and `Math.random()` in a
 * component gives a different number on every re-render of the same film.
 *
 * Returns the two glyphs visible in the window and how far the pair has
 * travelled, 0 (the first fully shown) to 1 (the second fully shown).
 */
export const rollCell = (target: string, p: number): {from: string; to: string; shift: number} => {
	const d = Number(target);
	if (!Number.isFinite(d)) return {from: target, to: target, shift: 0};
	const travel = ROLL_TURNS * Math.min(1, Math.max(0, p));
	const k = Math.floor(travel);
	const shift = travel - k;
	// +20 keeps the modulus positive for any target and any turn count.
	const from = (d - ROLL_TURNS + k + 20) % 10;
	return {from: String(from), to: String((from + 1) % 10), shift};
};

export const TextCard: React.FC<{
	card: TextCardSpec;
	/**
	 * Actual on-screen window. Comes from the planned SHOT, not from the spec:
	 * a card may be squeezed to fit a short scene, and timing the exit off the
	 * spec would cut the fade off mid-burn.
	 */
	seconds: number;
	preset: StylePreset;
}> = ({card, seconds, preset}) => {
	const frame = useCurrentFrame();
	const {fps, width, height} = useVideoConfig();
	const px = (n: number) => n * (width / 1280);
	const t = frame / fps;
	if (t > seconds) return null;

	// Fade with a scale settle. Both on eased curves — a linear ramp on either
	// is the clearest tell that a graphic was generated rather than designed.
	const inP = Math.min(1, t / IN);
	const outP = Math.max(0, (t - (seconds - OUT)) / OUT);
	const opacity = curveAt(inP, CURVES.outQuart) * (1 - curveAt(Math.min(1, outP), CURVES.inOutCubic));
	const settle = 1.03 - 0.03 * curveAt(inP, CURVES.outExpo);

	const isFigure = card.variant === 'figure';
	const blockWidth = width * 0.78;
	const headlineWords = card.headline.split(/\s+/).filter(Boolean);

	// A figure is one short token, so it gets the whole frame and a hard
	// ceiling; a claim is a sentence and has to be fitted like any other title.
	// Both go through the same fitter as the hook and the chapter card — one
	// owner, or the three surfaces drift apart.
	const LINE_HEIGHT = isFigure ? 1.0 : 1.22;
	const fontSize = fitTitleSize({
		words: headlineWords,
		advance: preset.titleAdvance,
		wrapWidth: blockWidth * 0.94,
		maxSize: isFigure ? width * 0.3 : width * 0.085,
		minSize: width * 0.026,
		maxLines: isFigure ? 1 : 4,
		lineHeight: LINE_HEIGHT,
		maxHeight: isFigure ? height * 0.42 : height * 0.5,
	});

	const smallSize = Math.max(px(14), fontSize * (isFigure ? 0.14 : 0.24));
	// The accent draws the eye to the figure; a claim is read as text, so it
	// stays in the light ink and the accent is spent on the attribution.
	const accent = preset.cardInk;

	/**
	 * Everything above is written for a card that gets the length its spec
	 * asked for. The planner may squeeze one to fit a short scene, and a reveal
	 * that runs past the exit is a card that leaves before it can be read — the
	 * rule the chapter card already learned. So the whole schedule is scaled by
	 * whatever it takes for the LAST arrival to land before the fade starts,
	 * and never stretched past 1: a card with room to spare keeps its pace.
	 */
	const digits = isFigure ? card.headline.split('').filter((c) => /\d/.test(c)).length : 0;
	const lastLanding = isFigure
		? Math.max(KICKER[1], ROLL[1] + Math.max(0, digits - 1) * ROLL_STEP)
		: CLAIM_WORD_STEP * Math.max(0, headlineWords.length - 1) + CLAIM_WORD_IN;
	const room = Math.max(0.1, seconds - OUT - LANDED_BEFORE_EXIT);
	const fit = Math.min(1, room / Math.max(lastLanding, 0.001));
	/** A reveal time in spec seconds, moved onto this card's actual clock. */
	const at = (s: number) => s * fit;

	/** The figure, as cells: digits roll, everything else simply sits there. */
	const figureCells = () => {
		// The window each digit rolls behind, and it has to be TIGHT.
		//
		// The first version made it 1.34em, on the reasoning that a taller
		// window cannot clip a cap-height glyph. What that actually produced was
		// a window half a digit taller than the digit itself: mid-roll the
		// outgoing and incoming glyphs sat a third of the frame apart with
		// nothing between them, and the sliver of the one leaving read as a
		// stray mark two hundred pixels above the number rather than as part of
		// it. Verified on stills — the clip was working the whole time; the
		// window was simply the wrong size for a dial.
		//
		// At 1.06em the pair is adjacent, so what crosses the window is one
		// continuous strip of digits, which is what an odometer looks like. The
		// row keeps the height it had before anything moved (`alignItems:
		// center` against a 1em line box), so the layout below is untouched.
		const cellH = fontSize * 1.06;
		let digitIndex = -1;
		return (
			<div
				style={{
					display: 'flex',
					justifyContent: 'center',
					alignItems: 'center',
					height: fontSize * LINE_HEIGHT,
					// Tabular figures where the face has them: a number whose digits
					// change width while it rolls shimmers, and the eye reads that as
					// the type moving rather than the dial.
					fontVariantNumeric: 'tabular-nums',
					fontFeatureSettings: '"tnum" 1',
				}}
			>
				{card.headline.split('').map((ch, i) => {
					if (!/\d/.test(ch)) {
						return (
							<span key={i} style={{whiteSpace: 'pre'}}>
								{ch}
							</span>
						);
					}
					digitIndex += 1;
					const startedAt = at(ROLL[0] + digitIndex * ROLL_STEP);
					const p = curveAt((t - startedAt) / Math.max(0.001, at(ROLL[1] - ROLL[0])), CURVES.outQuart);
					const {from, to, shift} = rollCell(ch, p);
					return (
						<span
							key={i}
							style={{
								display: 'inline-block',
								// `ch` is the advance of "0" in this very face at this very
								// size, so the cell is measured by the browser rather than
								// guessed here — and a fraction over it tracks the number
								// evenly instead of letting one digit crowd its neighbour.
								width: '1.04ch',
								height: cellH,
								overflow: 'hidden',
								position: 'relative',
							}}
						>
							<span
								style={{
									position: 'absolute',
									left: 0,
									right: 0,
									top: 0,
									transform: `translateY(${(-shift * cellH).toFixed(2)}px)`,
								}}
							>
								<span style={{display: 'block', height: cellH, lineHeight: `${cellH}px`}}>{from}</span>
								<span style={{display: 'block', height: cellH, lineHeight: `${cellH}px`}}>{to}</span>
							</span>
						</span>
					);
				})}
			</div>
		);
	};

	/** A claim, word by word: rise plus opacity on one curve, and no mask. */
	const claimWords = () => (
		<>
			{headlineWords.map((w, i) => {
				const p = curveAt(
					(t - at(i * CLAIM_WORD_STEP)) / Math.max(0.001, at(CLAIM_WORD_IN)),
					CURVES.outQuart,
				);
				return (
					<span
						key={i}
						style={{
							display: 'inline-block',
							whiteSpace: 'pre',
							opacity: p,
							// Short travel: the fade is what reveals, and a long slide only
							// makes the word look late. Same rule the hook title follows.
							transform: `translateY(${((1 - p) * fontSize * 0.16).toFixed(2)}px)`,
						}}
					>
						{w}
						{i < headlineWords.length - 1 ? ' ' : ''}
					</span>
				);
			})}
		</>
	);

	return (
		<AbsoluteFill style={{background: preset.cardGround, opacity, justifyContent: 'center', alignItems: 'center'}}>
			<div
				style={{
					width: blockWidth,
					textAlign: isFigure ? 'center' : 'left',
					transform: `scale(${settle.toFixed(4)})`,
				}}
			>
				<div
					style={{
						fontFamily: preset.displayFont,
						fontWeight: preset.displayWeight,
						fontSize,
						lineHeight: LINE_HEIGHT,
						color: isFigure ? accent : '#F5F2EA',
						// A long claim must wrap rather than run off the frame, and a
						// percentage token has no space to break at — both need the
						// explicit row, because a shrink-to-fit flex item ignores width.
						overflowWrap: 'anywhere',
					}}
				>
					{isFigure ? figureCells() : claimWords()}
				</div>

				{isFigure && (
					/* The rule is drawn from the middle out, under a centred number:
					   growing it from one end would point somewhere, and the figure is
					   the only thing on this card worth pointing at. */
					<div
						style={{
							height: Math.max(1, px(3)),
							width: eased(t, [at(RULE[0]), at(RULE[1])], [0, fontSize * 1.1], CURVES.outExpo),
							background: accent,
							margin: `${fontSize * 0.1}px auto 0`,
						}}
					/>
				)}

				{isFigure && card.kicker && (
					<div
						style={{
							fontFamily: preset.captionFont,
							fontWeight: 500,
							fontSize: smallSize,
							lineHeight: 1.35,
							letterSpacing: smallSize * 0.01,
							color: '#E8E4DA',
							marginTop: fontSize * 0.1,
							opacity: curveAt((t - at(KICKER[0])) / Math.max(0.001, at(KICKER[1] - KICKER[0])), CURVES.outQuart),
							transform: `translateY(${(
								(1 -
									curveAt(
										(t - at(KICKER[0])) / Math.max(0.001, at(KICKER[1] - KICKER[0])),
										CURVES.outQuart,
									)) *
								smallSize *
								0.5
							).toFixed(2)}px)`,
						}}
					>
						{card.kicker}
					</div>
				)}

				{!isFigure && card.attribution && (
					<div style={{marginTop: fontSize * 0.55}}>
						{/* The rule grows in — the attribution is the payload, and giving
						    it its own small entrance is what makes it read as a citation
						    rather than as a second line of the claim. */}
						<div
							style={{
								height: Math.max(1, px(2)),
								width: eased(t, [IN * 0.6, IN + 0.4], [0, fontSize * 1.5], CURVES.outExpo),
								background: accent,
								marginBottom: smallSize * 0.7,
							}}
						/>
						<div
							style={{
								fontFamily: preset.kickerFont,
								fontWeight: 500,
								fontSize: smallSize * 0.82,
								letterSpacing: smallSize * 0.2,
								textTransform: 'uppercase',
								color: accent,
							}}
						>
							{card.attribution}
						</div>
					</div>
				)}
			</div>
		</AbsoluteFill>
	);
};
