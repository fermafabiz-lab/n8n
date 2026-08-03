import React from 'react';
import {AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig} from 'remotion';
import type {Palette} from '../types';
import type {StylePreset} from '../style';

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

	// Everything below was tuned against the 1920-wide landscape canvas. On a
	// 1080-wide vertical canvas the same pixel sizes are 1.8x larger relative
	// to the frame, which is why long titles ran off the sides and clipped
	// words. Scale every length by the canvas so the title occupies the same
	// fraction of the frame in both orientations; at 1920 the scale is 1 and
	// nothing about the landscape render changes.
	const scale = width / 1920;
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

	const blockOpacity = interpolate(t, [outStart, durationInSeconds], [1, 0], {
		extrapolateLeft: 'clamp',
		extrapolateRight: 'clamp',
	});
	if (blockOpacity <= 0) return null;

	// Whole-block slow drift: rises ~14px over the full hold, barely felt.
	const drift = interpolate(t, [0, durationInSeconds], [px(8), px(-6)], {
		extrapolateLeft: 'clamp',
		extrapolateRight: 'clamp',
	});
	const ruleWidth = interpolate(t, [typeDone * 0.6, typeDone + 0.5], [0, px(200)], {
		extrapolateLeft: 'clamp',
		extrapolateRight: 'clamp',
	});

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
						// Last-resort guard: a single word longer than the line box
						// would otherwise overflow the frame rather than wrap, since
						// each word is an unbreakable inline-block above.
						overflowWrap: 'anywhere',
						letterSpacing: preset.uppercaseTitle ? px(2) : px(0.5),
						textTransform: preset.uppercaseTitle ? 'uppercase' : 'none',
						textShadow: `0 ${px(4)}px ${px(24)}px rgba(0,0,0,0.85)`,
					}}
				>
					{words.map((word, wi) => (
						<React.Fragment key={wi}>
							<span style={{display: 'inline-block', whiteSpace: 'pre'}}>
								{Array.from(word).map((ch, ci) => {
									const start = (wordStarts[wi] + ci) * perChar;
									const p = interpolate(t, [start, start + 0.22], [0, 1], {
										extrapolateLeft: 'clamp',
										extrapolateRight: 'clamp',
									});
									// Ease-out on both channels: soft landing, no pop.
									const e = 1 - (1 - p) * (1 - p);
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
