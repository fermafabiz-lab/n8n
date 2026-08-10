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
 */

/** Ground and reveal timings. Short: the card is a beat, not a stop. */
const IN = 0.22;
const OUT = 0.2;
const INK = '#0B0A08';

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

	return (
		<AbsoluteFill style={{background: INK, opacity, justifyContent: 'center', alignItems: 'center'}}>
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
					{card.headline}
				</div>

				{isFigure && card.kicker && (
					<div
						style={{
							fontFamily: preset.captionFont,
							fontWeight: 500,
							fontSize: smallSize,
							lineHeight: 1.35,
							letterSpacing: smallSize * 0.01,
							color: '#E8E4DA',
							marginTop: fontSize * 0.12,
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
