import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import type {Palette} from '../types';
import type {StylePreset} from '../style';
import {CURVES, curveAt, eased} from '../easing';

/**
 * Hook title as an After-Effects-style text animator: characters type on
 * sequentially, each with its own opacity + y-offset ramp, while the whole
 * block drifts up gently. Layout is fixed from frame 0 (invisible characters
 * still occupy their space), so nothing ever re-wraps mid-animation.
 */
export const HookTitle: React.FC<{
	title: string;
	palette: Palette;
	preset: StylePreset;
	durationInSeconds: number;
}> = ({title, palette, preset, durationInSeconds}) => {
	const frame = useCurrentFrame();
	const {fps, width} = useVideoConfig();
	const t = frame / fps;

	// Every length here was tuned against the landscape canvas, which
	// calculateMetadata sizes at 1280x720; the vertical one is 720x1280. The
	// same pixel sizes are therefore 1.78x larger relative to a vertical
	// frame, which is why long titles ran off the sides and clipped words.
	// Scale by the canvas so the title takes the same fraction of frame in
	// both orientations — at 1280 the scale is exactly 1, so the landscape
	// render is unchanged.
	const scale = width / 1280;
	const px = (n: number) => n * scale;

	// Words are unbreakable inline-blocks so the line can only wrap BETWEEN
	// words — per-character inline-blocks allowed mid-word line breaks.
	const words = title.split(' ');
	const perChar = 1 / preset.typeSpeed;
	const typeDone = title.length * perChar;
	let charOffset = 0;
	const wordStarts = words.map((w) => {
		const s = charOffset;
		charOffset += w.length + 1;
		return s;
	});
	// The parent sizes the hook window to fit the typing, so fading out in
	// the last 0.6s never cuts the animation short.
	const outStart = Math.max(0.5, durationInSeconds - 0.6);

	const blockOpacity = eased(t, [outStart, durationInSeconds], [1, 0], CURVES.inOutCubic);
	if (blockOpacity <= 0) return null;

	// Whole-block slow drift: rises ~14px over the full hold, barely felt.
	// Eased so it settles instead of still travelling when it fades out.
	const drift = eased(t, [0, durationInSeconds], [px(8), px(-6)], CURVES.outQuart);
	const ruleWidth = eased(t, [typeDone * 0.6, typeDone + 0.5], [0, px(200)], CURVES.outExpo);

	const len = title.length;
	const fontSize = px(len <= 24 ? 72 : len <= 44 ? 58 : len <= 70 ? 46 : 38);

	return (
		<AbsoluteFill
			style={{justifyContent: 'center', alignItems: 'center', opacity: blockOpacity}}
		>
			<AbsoluteFill
				style={{
					background:
						'radial-gradient(ellipse at center, rgba(0,0,0,0.42) 0%, rgba(0,0,0,0.14) 55%, rgba(0,0,0,0) 75%)',
				}}
			/>
			<div style={{textAlign: 'center', width: '80%', transform: `translateY(${drift}px)`}}>
				<h1
					style={{
						fontFamily: preset.displayFont,
						fontWeight: preset.displayWeight,
						fontSize,
						color: '#FFFFFF',
						lineHeight: 1.2,
						margin: 0,
						letterSpacing: preset.uppercaseTitle ? px(2) : px(0.5),
						textTransform: preset.uppercaseTitle ? 'uppercase' : 'none',
						textShadow: `0 ${px(4)}px ${px(24)}px rgba(0,0,0,0.85)`,
					}}
				>
					{words.map((word, wi) => (
						<React.Fragment key={wi}>
							<span
								style={{
									display: 'inline-block',
									// 'pre' here made a word unbreakable, so one longer than
									// the line box ran off the frame and got cut instead of
									// wrapping — the whole point of the inline-block is to
									// stop breaks BETWEEN characters, not to forbid them when
									// there is no other way to fit. pre-wrap keeps that
									// behaviour (a word holds no spaces to collapse anyway)
									// while letting 'anywhere' break as a last resort.
									whiteSpace: 'pre-wrap',
									overflowWrap: 'anywhere',
									maxWidth: '100%',
								}}
							>
								{Array.from(word).map((ch, ci) => {
									const start = (wordStarts[wi] + ci) * perChar;
									// Ease-out on both channels: soft landing, no pop. This was a
									// hand-rolled easeOutQuad; outExpo lands harder and matches
									// every other reveal in the project.
									const e = curveAt((t - start) / 0.22, CURVES.outExpo);
									return (
										<span
											key={ci}
											style={{
												display: 'inline-block',
												opacity: e,
												transform: `translateY(${(1 - e) * px(14)}px)`,
											}}
										>
											{ch}
										</span>
									);
								})}
							</span>
							{wi < words.length - 1 ? ' ' : null}
						</React.Fragment>
					))}
				</h1>
				<div
					style={{
						width: ruleWidth,
						height: px(3),
						background: palette.primary,
						margin: `${px(24)}px auto 0`,
						borderRadius: 2,
						boxShadow: `0 0 ${px(18)}px ${palette.primary}`,
					}}
				/>
			</div>
		</AbsoluteFill>
	);
};
