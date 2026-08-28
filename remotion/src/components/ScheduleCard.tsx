import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import type {StylePreset} from '../style';
import type {TextCardSpec} from '../types';
import {CURVES, curveAt, eased} from '../easing';

/**
 * The schedule card: a departure board that flaps its times into place.
 *
 * ## What earns it the frame
 *
 * Same test as every card. The narration says "ferry at five twenty, the
 * flight at eight" — spoken, in words, once, in the middle of an argument.
 * A listener cannot hold two times and subtract them, and the whole tension of
 * the scene is the SIZE of the gap between them. So the card does not reprint
 * the sentence: it sets the two times against each other and states the margin,
 * which is the one thing neither the voice nor the footage ever says.
 *
 * ## Why a split-flap
 *
 * It is diegetic. These two are catching a ferry and a plane; a flap board is
 * the object that would be hanging over them in both places, so the motion has
 * a reason to exist beyond decoration — which is the difference between a
 * motif and an effect. It also lands the times one digit at a time, so the
 * eye reads them instead of receiving them.
 *
 * The flaps are DETERMINISTIC (`(target + FLIPS - k) % 10`) — a render must be
 * reproducible, and `Math.random()` in a component would give a different
 * board on every re-render of the same film.
 */

/** Shared with the other cards: one family, one fade. */
const IN = 0.22;
const OUT = 0.2;
const INK = '#0B0A08';

/** The board itself, then each row's label, then its time flapping in. */
const BOARD: readonly [number, number] = [0.08, 0.42];
const ROW_STEP = 0.4;
const ROW_AT = 0.3;
const FLAP_LEAD = 0.12;
const FLAP: number = 0.5;
/** How many digits go past before the right one lands. */
const FLIPS = 3;
/** The rule, then the margin — the payload, last and alone. */
const RULE: readonly [number, number] = [1.5, 1.82];
const NOTE: readonly [number, number] = [1.8, 2.1];

/**
 * One character of a time, mid-flap.
 *
 * A real flap board pinches: the leaf falls edge-on through the horizontal, so
 * the glyph squashes to nothing and the next one grows out of it. Modelling
 * that as scaleY through zero is what makes it read as paper rather than as a
 * crossfade between two numbers — and the swap happens exactly at the pinch,
 * the same trick the chapter card plays with its light leak.
 */
const flapCell = (target: string, p: number): {char: string; scaleY: number} => {
	if (p >= 1) return {char: target, scaleY: 1};
	if (p <= 0) return {char: target, scaleY: 0};
	if (!/\d/.test(target)) return {char: target, scaleY: curveAt(p, CURVES.outQuart)};
	const digit = Number(target);
	// Which leaf is showing: the last one IS the target, so it always settles.
	const step = Math.min(FLIPS, Math.floor(p * (FLIPS + 1)));
	const within = p * (FLIPS + 1) - step;
	const char = String((digit + FLIPS - step + 10) % 10);
	// Each leaf falls on its own eased pinch; the seam between leaves is where
	// the character changes, which is the only frame the swap can hide in.
	const pinch = step >= FLIPS ? curveAt(within, CURVES.outQuart) : Math.abs(Math.cos(Math.PI * within));
	return {char, scaleY: Math.max(0.04, pinch)};
};

export const ScheduleCard: React.FC<{
	card: TextCardSpec;
	/** Actual on-screen window — from the planned SHOT, never from the spec. */
	seconds: number;
	preset: StylePreset;
}> = ({card, seconds, preset}) => {
	const frame = useCurrentFrame();
	const {fps, width, height} = useVideoConfig();
	const px = (n: number) => n * (width / 1280);
	const t = frame / fps;
	if (t > seconds) return null;

	const rows = card.rows ?? [];
	if (!rows.length) return null;

	const inP = Math.min(1, t / IN);
	const outP = Math.max(0, (t - (seconds - OUT)) / OUT);
	const opacity =
		curveAt(inP, CURVES.outQuart) * (1 - curveAt(Math.min(1, outP), CURVES.inOutCubic));

	const board = eased(t, BOARD, [0, 1], CURVES.outQuart);
	const noteIn = eased(t, NOTE, [0, 1], CURVES.outQuart);
	const rule = eased(t, RULE, [0, 1], CURVES.outQuart);

	const blockWidth = width * (height > width ? 0.86 : 0.68);
	const labelSize = px(22);
	// Mono for the times, and not only for the tone: a proportional face
	// re-widths the whole row as the digits flap past, so the board would
	// visibly breathe while it settles.
	const timeSize = px(72);
	const accent = preset.cardInk;

	return (
		<AbsoluteFill
			style={{background: INK, opacity, justifyContent: 'center', alignItems: 'center'}}
		>
			<div style={{width: blockWidth}}>
				{card.label && (
					<div
						style={{
							opacity: board,
							marginBottom: px(26),
							fontFamily: preset.kickerFont,
							fontWeight: 500,
							fontSize: px(16),
							letterSpacing: px(16) * 0.24,
							textTransform: 'uppercase',
							color: 'rgba(237, 231, 218, 0.55)',
						}}
					>
						{card.label}
					</div>
				)}

				{rows.map((row, i) => {
					const at = ROW_AT + i * ROW_STEP;
					const rowIn = curveAt((t - at) / 0.3, CURVES.outQuart);
					if (rowIn <= 0) return null;
					const flapP = (t - (at + FLAP_LEAD)) / FLAP;
					return (
						<div
							key={`r${i}`}
							style={{
								display: 'flex',
								alignItems: 'baseline',
								gap: px(20),
								opacity: rowIn,
								transform: `translateY(${((1 - rowIn) * px(14)).toFixed(2)}px)`,
								marginBottom: px(14),
							}}
						>
							<div
								style={{
									fontFamily: preset.kickerFont,
									fontWeight: 500,
									fontSize: labelSize,
									letterSpacing: labelSize * 0.18,
									textTransform: 'uppercase',
									color: '#EDE7DA',
									whiteSpace: 'nowrap',
								}}
							>
								{row.label}
							</div>
							{/* The leader is what makes this a timetable and not two words
							    on a line — the eye is carried across the gap instead of
							    jumping it. */}
							<div
								style={{
									flex: 1,
									height: 0,
									borderBottom: `${Math.max(1, px(2))}px dotted rgba(237, 231, 218, 0.28)`,
									transform: `translateY(-${px(8)}px)`,
								}}
							/>
							<div
								style={{
									display: 'flex',
									fontFamily: preset.kickerFont,
									fontWeight: 500,
									fontSize: timeSize,
									lineHeight: 1,
									color: accent,
								}}
							>
								{row.value.split('').map((ch, k) => {
									// Each cell starts a beat after the one to its left, so the
									// time lands left to right the way a board actually turns.
									const cell = flapCell(ch, flapP - k * 0.06);
									return (
										<span
											key={`c${k}`}
											style={{
												display: 'inline-block',
												transform: `scaleY(${cell.scaleY.toFixed(3)})`,
												// Every leaf turns about the seam, which on a real
												// board is the middle of the glyph.
												transformOrigin: '50% 50%',
											}}
										>
											{cell.char}
										</span>
									);
								})}
							</div>
						</div>
					);
				})}

				{card.note && (
					<div style={{marginTop: px(22), display: 'flex', justifyContent: 'flex-end'}}>
						<div style={{textAlign: 'right'}}>
							<div
								style={{
									height: Math.max(1, px(2)),
									width: rule * px(320),
									marginLeft: 'auto',
									marginBottom: px(14),
									background: accent,
								}}
							/>
							<div
								style={{
									opacity: noteIn,
									transform: `translateY(${((1 - noteIn) * px(8)).toFixed(2)}px)`,
									fontFamily: preset.kickerFont,
									fontWeight: 500,
									fontSize: px(24),
									letterSpacing: px(24) * 0.18,
									textTransform: 'uppercase',
									color: accent,
								}}
							>
								{card.note}
							</div>
						</div>
					</div>
				)}
			</div>
		</AbsoluteFill>
	);
};
