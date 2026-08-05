import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import type {StylePreset} from '../style';
import {CURVES, curveAt, eased} from '../easing';
import {FLASH_PEAK, LightLeak, flashEnvelope} from './LightLeak';

const ROMAN = ['0', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

/** First ~8 meaningful words of the chapter's opening narration. */
export const keyLineFor = (narration: string): string => {
	const words = narration.trim().split(/\s+/).filter(Boolean).slice(0, 8);
	let line = words.join(' ');
	line = line.replace(/[,;:]$/, '');
	if (!/[.!?…]$/.test(line) && line) line += '…';
	return line;
};

/**
 * Total on-screen window. Exported because FinalVideo's Sequence has to be at
 * least this long — a shorter Sequence cuts the exit flash off mid-burn and
 * the card vanishes on a hard frame.
 */
export const IMPACT_CARD_SECONDS = 2.8;
/** Entrance and exit flash durations. */
const IN = 0.55;
const OUT = 0.55;

/**
 * Director-style stop-frame at each chapter start: chapter eyebrow + the
 * chapter's title, held ~1.7s over the narration, which continues underneath.
 *
 * The card used to slide in and out on a linear translateX. Both halves of
 * that were wrong: the slide announced the graphic, and the constant speed
 * made it read as a template. Now the card is revealed and taken away by a
 * light leak — it swaps at the peak of the flash, where the frame is blown out
 * and the change is invisible.
 */
export const ImpactCard: React.FC<{
	chapter: number;
	keyLine: string;
	preset: StylePreset;
}> = ({chapter, keyLine, preset}) => {
	const frame = useCurrentFrame();
	const {fps, width} = useVideoConfig();
	// Same canvas-relative scaling as HookTitle: these sizes were tuned on the
	// 1280-wide landscape canvas and are 1.78x too large relative to the
	// 720-wide vertical one. At 1280 the scale is 1 and nothing changes.
	const px = (n: number) => n * (width / 1280);

	const t = frame / fps;
	if (t > IMPACT_CARD_SECONDS) return null;

	const outStart = IMPACT_CARD_SECONDS - OUT;
	const inProgress = t / IN;
	const outProgress = (t - outStart) / OUT;
	const inFlash = flashEnvelope(inProgress);
	const outFlash = flashEnvelope(outProgress);

	// The card appears at the peak of the entrance flash and leaves at the peak
	// of the exit flash. The 0.07s eased crossfade is insurance: on an already
	// bright shot the leak may not fully overexpose, and a hard switch there
	// would pop.
	const appearAt = IN * FLASH_PEAK;
	const vanishAt = outStart + OUT * FLASH_PEAK;
	const cardOpacity =
		eased(t, [appearAt - 0.07, appearAt + 0.07], [0, 1], CURVES.inOutCubic) *
		(1 - eased(t, [vanishAt - 0.07, vanishAt + 0.07], [0, 1], CURVES.inOutCubic));

	// Words are unbreakable inline-blocks; the spaces BETWEEN them are plain
	// breakable text nodes. Per-character spans with white-space:pre killed
	// every soft-wrap point and the line ran straight off the screen.
	const words = keyLine.split(' ');
	const perChar = 1 / Math.max(18, preset.typeSpeed * 1.4);
	let charOffset = 0;
	const wordStarts = words.map((w) => {
		const s = charOffset;
		charOffset += w.length + 1;
		return s;
	});

	const lightInk =
		preset.cardBg === '#F6EFE3' || preset.cardBg === '#F4F1EA' ? '#221D14' : '#F5F2EA';
	const ruleWidth = eased(t, [appearAt + 0.12, appearAt + 0.7], [0, px(74)], CURVES.outExpo);

	return (
		<AbsoluteFill>
			<AbsoluteFill
				style={{
					opacity: cardOpacity,
					background: preset.cardBg,
					justifyContent: 'center',
					alignItems: 'center',
				}}
			>
				<div style={{width: '74%', textAlign: 'left'}}>
					<div
						style={{
							fontFamily: preset.kickerFont,
							fontWeight: 500,
							fontSize: px(17),
							letterSpacing: px(6),
							textTransform: 'uppercase',
							color: preset.cardInk,
							marginBottom: px(18),
						}}
					>
						Chapter {ROMAN[chapter] ?? chapter}
					</div>
					<div
						style={{
							fontFamily: preset.displayFont,
							fontWeight: preset.displayWeight,
							fontSize: px(52),
							lineHeight: 1.25,
							color: lightInk,
						}}
					>
						{words.map((word, wi) => (
							<React.Fragment key={wi}>
								<span
									style={{
										display: 'inline-block',
										// 'pre' here made a word unbreakable, so a long chapter
										// title ran off the frame instead of wrapping — the same
										// bug HookTitle already carries a note about.
										whiteSpace: 'pre-wrap',
										overflowWrap: 'anywhere',
										maxWidth: '100%',
									}}
								>
									{Array.from(word).map((ch, ci) => {
										const start = appearAt + 0.08 + (wordStarts[wi] + ci) * perChar;
										return (
											<span
												key={ci}
												style={{opacity: eased(t, [start, start + 0.14], [0, 1])}}
											>
												{ch}
											</span>
										);
									})}
								</span>
								{wi < words.length - 1 ? ' ' : null}
							</React.Fragment>
						))}
					</div>
					<div
						style={{
							width: ruleWidth,
							height: px(4),
							background: preset.cardInk,
							marginTop: px(24),
							borderRadius: 2,
						}}
					/>
				</div>
			</AbsoluteFill>

			{/* Entrance and exit flares. Each returns null outside its window, so
			    only one is ever composited. */}
			<LightLeak amount={inFlash} sweep={curveAt(inProgress, CURVES.inOutCubic)} />
			<LightLeak amount={outFlash} sweep={1 - curveAt(outProgress, CURVES.inOutCubic)} />
		</AbsoluteFill>
	);
};
