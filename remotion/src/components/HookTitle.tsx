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
	const {fps} = useVideoConfig();
	const t = frame / fps;

	const chars = Array.from(title);
	const perChar = 1 / preset.typeSpeed;
	const typeDone = chars.length * perChar;
	// The parent sizes the hook window to fit the typing, so fading out in
	// the last 0.6s never cuts the animation short.
	const outStart = Math.max(0.5, durationInSeconds - 0.6);

	const blockOpacity = interpolate(t, [outStart, durationInSeconds], [1, 0], {
		extrapolateLeft: 'clamp',
		extrapolateRight: 'clamp',
	});
	if (blockOpacity <= 0) return null;

	// Whole-block slow drift: rises ~14px over the full hold, barely felt.
	const drift = interpolate(t, [0, durationInSeconds], [8, -6], {
		extrapolateLeft: 'clamp',
		extrapolateRight: 'clamp',
	});
	const ruleWidth = interpolate(t, [typeDone * 0.6, typeDone + 0.5], [0, 200], {
		extrapolateLeft: 'clamp',
		extrapolateRight: 'clamp',
	});

	const len = title.length;
	const fontSize = len <= 24 ? 72 : len <= 44 ? 58 : len <= 70 ? 46 : 38;

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
						letterSpacing: preset.uppercaseTitle ? 2 : 0.5,
						textTransform: preset.uppercaseTitle ? 'uppercase' : 'none',
						textShadow: '0 4px 24px rgba(0,0,0,0.85)',
					}}
				>
					{chars.map((ch, i) => {
						const start = i * perChar;
						const p = interpolate(t, [start, start + 0.22], [0, 1], {
							extrapolateLeft: 'clamp',
							extrapolateRight: 'clamp',
						});
						// Ease-out on both channels: soft landing, no pop.
						const e = 1 - (1 - p) * (1 - p);
						return (
							<span
								key={i}
								style={{
									display: 'inline-block',
									whiteSpace: 'pre',
									opacity: e,
									transform: `translateY(${(1 - e) * 14}px)`,
								}}
							>
								{ch}
							</span>
						);
					})}
				</h1>
				<div
					style={{
						width: ruleWidth,
						height: 3,
						background: palette.primary,
						margin: '24px auto 0',
						borderRadius: 2,
						boxShadow: `0 0 18px ${palette.primary}`,
					}}
				/>
			</div>
		</AbsoluteFill>
	);
};
