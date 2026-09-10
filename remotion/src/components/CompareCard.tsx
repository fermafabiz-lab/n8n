import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import type {StylePreset} from '../style';
import type {TextCardSpec} from '../types';
import {CURVES, curveAt, eased} from '../easing';

/**
 * The compare card: two quantities set against each other as bars.
 *
 * ## What earns it the frame
 *
 * The same test as every motif — does it show what neither the voice nor the
 * shot is showing? A film says "thirty-eight percent of the crews were women"
 * and, a sentence later, "six percent of the captains". Both numbers are
 * spoken, both are printed by the captions, and the thing that matters is in
 * NEITHER: that one is six times the other. A listener cannot hold two figures
 * and divide them, and no footage can show a ratio. Two bars from one baseline
 * is that ratio, drawn.
 *
 * ## Why exactly two
 *
 * Three bars is a chart, and a chart is a document — something to be studied,
 * not a beat to cut to for three seconds. Two is a comparison, which is a
 * sentence: this against that. The validator enforces it rather than the
 * drawing quietly truncating, because a card that silently drops the third
 * quantity is a card that lies about the film.
 *
 * ## Why the number rides the end of its bar
 *
 * The bar is the argument and the figure is its label, so the figure arriving
 * separately would be two animations that happen to overlap — the fault the
 * route card's pen and the timeline's ticks were both written to avoid. Riding
 * the head means the growth is what carries the number into place: one thing
 * to follow, and it stops exactly where the comparison is made.
 *
 * ## Why the small bar has a floor
 *
 * True proportion at 1:60 leaves the smaller quantity two pixels wide, which
 * reads as a rule under a label rather than as a bar — the comparison is
 * legible only if both sides are visibly bars. `MIN_BAR` is the least width
 * that still reads as one, and it is applied ONLY when proportion falls below
 * it, so every ratio a viewer could actually judge is drawn true.
 */

/** Shared with the other cards: one family, one fade. */
const IN = 0.22;
const OUT = 0.2;

/** The baseline is ruled first, then each bar grows out of it. */
const AXIS: readonly [number, number] = [0.06, 0.36];
const BAR: readonly [number, number] = [0.3, 1.0];
/** The second bar leaves after the first, so the two are read in order. */
const BAR_STEP = 0.18;
/** The note lands last and alone: it is the payload. */
const NOTE: readonly [number, number] = [1.28, 1.62];
/** The eyebrow that names the graphic, if the card carries one. */
const LABEL: readonly [number, number] = [0.1, 0.4];

/** Scale words, in both languages the producer writes in. */
const SCALES: {re: RegExp; by: number}[] = [
	{re: /\b(billion|miliarde|miliard)\b/i, by: 1e9},
	{re: /\b(million|milioane|milion)\b/i, by: 1e6},
	{re: /\b(thousand|mii|mie)\b/i, by: 1e3},
];

/**
 * The number a side is drawn at.
 *
 * "16 billion" against "800 million" is the case that makes this more than a
 * parse: compared on their leading digits alone the smaller quantity would
 * draw the longer bar. The scale word is part of the number, so it is read as
 * part of the number.
 *
 * Exported because `motif/validate.mjs` has to answer the same question before
 * a card is accepted — a side whose value holds no number cannot be drawn, and
 * the validator is where that is refused. The two implementations must agree;
 * this one is the definition.
 */
export const magnitudeOf = (value: string): number | null => {
	const s = String(value ?? '');
	// European and English decimal marks both appear in this pipeline's scripts.
	// The separators a number can carry — an ordinary space, but also a no-break
	// space (U+00A0) and a narrow no-break space (U+202F), both of which are
	// real thousands separators and both INVISIBLE in a source file.
	//
	// Matched by PROPERTY (`\p{Zs}`, every space separator) rather than by
	// listing them, and that is not tidiness. This class is copied into an n8n
	// Code node, and the README's hardest-won lesson is that an invisible
	// character survives the trip, works, and changes the day an editor
	// normalises the file. It went wrong here twice in one afternoon: first the
	// two copies of this regex held different sets of spaces, and then the
	// escaped form was decoded back into the characters themselves in transit —
	// caught only by the byte diff that every apply is supposed to end with.
	// A property escape is ASCII all the way down and cannot be mangled, which
	// is the same reason `norm` below matches `\p{M}` instead of a range.
	const m = /-?\d[\d.,\p{Zs}]*/u.exec(s);
	if (!m) return null;
	const raw = m[0].trim().replace(/\p{Zs}/gu, '');
	// A comma is a decimal mark when it is followed by 1-2 digits to the end of
	// the token, and a thousands separator otherwise ("1,5" vs "1,500").
	const normalised = /,\d{1,2}$/.test(raw)
		? raw.replace(/\./g, '').replace(',', '.')
		: raw.replace(/[.,](?=\d{3}\b)/g, '');
	const n = Number(normalised);
	if (!Number.isFinite(n)) return null;
	const scale = SCALES.find((x) => x.re.test(s));
	return Math.abs(n) * (scale ? scale.by : 1);
};

/**
 * Bar widths as fractions of the track, longest at 1.
 *
 * Returns even halves when the values cannot be read as numbers — the
 * validator refuses such a card, so this is the drawing refusing to invent a
 * ratio rather than a case that reaches a film.
 */
export const barFractions = (values: string[], minBar: number): number[] => {
	const ns = values.map(magnitudeOf);
	const top = Math.max(...ns.map((n) => n ?? 0));
	if (!Number.isFinite(top) || top <= 0) return values.map(() => 0.6);
	return ns.map((n) => Math.max(minBar, (n ?? 0) / top));
};

/** The least width that still reads as a bar rather than as a rule. */
const MIN_BAR = 0.12;

export const CompareCard: React.FC<{
	card: TextCardSpec;
	seconds: number;
	preset: StylePreset;
}> = ({card, seconds, preset}) => {
	const frame = useCurrentFrame();
	const {fps, width, height} = useVideoConfig();
	const t = frame / fps;
	if (t > seconds) return null;

	const sides = (card.sides ?? []).slice(0, 2);
	if (sides.length < 2) return null;

	const inP = Math.min(1, t / IN);
	const outP = Math.max(0, (t - (seconds - OUT)) / OUT);
	const opacity = curveAt(inP, CURVES.outQuart) * (1 - curveAt(Math.min(1, outP), CURVES.inOutCubic));

	// Portrait has no width to give away, so the block takes more of it. Type is
	// sized against the frame's SHORT side for the reason the timeline card
	// states: a card that fills the frame should not shrink because the frame is
	// narrow.
	const portrait = height > width;
	const short = Math.min(width, height);
	const blockW = width * (portrait ? 0.84 : 0.68);
	const trackW = blockW * 0.82;
	const barH = short * (portrait ? 0.062 : 0.072);
	const gap = barH * 1.9;

	const stroke = preset.cardInk;
	const labelSize = short * (portrait ? 0.042 : 0.036);
	/**
	 * Drawn weights, in the same unit as the type — never `px()`, which scales
	 * by `width / 1280` and so renders every rule at 56% on a 9:16 frame beside
	 * type sized against the short side. Same correction the steps card carries,
	 * and for the same reason: a card built for a phone is the same drawing,
	 * not a smaller one. In landscape at 720p `unit` is 1 and nothing moves.
	 */
	const unit = short / 720;
	const valueSize = barH * 0.86;

	const axis = eased(t, AXIS, [0, 1], CURVES.outQuart);
	const fracs = barFractions(
		sides.map((s) => s.value),
		MIN_BAR,
	);

	const axisH = barH * 2 + gap;

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
							fontSize: labelSize * 0.72,
							letterSpacing: labelSize * 0.18,
							textTransform: 'uppercase',
							color: stroke,
							opacity: eased(t, LABEL, [0, 1], CURVES.outQuart),
							marginBottom: labelSize * 0.9,
						}}
					>
						{card.label}
					</div>
				)}

				<div style={{position: 'relative', height: axisH}}>
					{/* The baseline both bars leave from. Without it they are two
					    lengths floating in the frame, and a comparison needs the
					    thing they are being compared FROM to be on screen. */}
					<div
						style={{
							position: 'absolute',
							left: 0,
							top: 0,
							width: Math.max(1, 3 * unit),
							height: axisH * axis,
							background: stroke,
							opacity: 0.85,
						}}
					/>

					{sides.map((side, i) => {
						const from = BAR[0] + i * BAR_STEP;
						const grown = eased(t, [from, BAR[1] + i * BAR_STEP], [0, 1], CURVES.outExpo);
						const w = trackW * fracs[i] * grown;
						// The first side is the film's own subject and carries the
						// accent; the second is what it is measured against, in ink. Two
						// accent bars would make the card a chart of two equals, which
						// is not what a comparison says.
						const fill = i === 0 ? stroke : 'rgba(238, 230, 214, 0.5)';
						return (
							<div key={i} style={{position: 'absolute', left: 0, top: i * (barH + gap), width: '100%'}}>
								<div
									style={{
										fontFamily: preset.captionFont,
										fontWeight: 600,
										fontSize: labelSize,
										color: '#E8E4DA',
										opacity: curveAt((t - from) / 0.3, CURVES.outQuart),
										marginBottom: labelSize * 0.3,
									}}
								>
									{side.label}
								</div>
								<div style={{display: 'flex', alignItems: 'center'}}>
									<div style={{width: w, height: barH, background: fill}} />
									{/* Rides the head of its own bar: the growth is what
									    carries the figure into place. */}
									<div
										style={{
											fontFamily: preset.displayFont,
											fontWeight: preset.displayWeight,
											fontSize: valueSize,
											lineHeight: 1,
											color: i === 0 ? stroke : '#E8E4DA',
											marginLeft: barH * 0.4,
											opacity: curveAt((t - from) / 0.25, CURVES.outQuart),
											whiteSpace: 'nowrap',
										}}
									>
										{side.value}
									</div>
								</div>
							</div>
						);
					})}
				</div>

				{card.note && (
					<div style={{marginTop: gap * 0.9}}>
						<div
							style={{
								height: Math.max(1, 2 * unit),
								width: eased(t, NOTE, [0, trackW * 0.42], CURVES.outExpo),
								background: stroke,
								marginBottom: labelSize * 0.55,
							}}
						/>
						<div
							style={{
								fontFamily: preset.captionFont,
								fontWeight: 600,
								fontSize: labelSize * 1.12,
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
