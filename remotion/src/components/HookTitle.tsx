import React from 'react';
import {AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig} from 'remotion';
import type {Palette} from '../types';

/**
 * Cinematic title over the hook scene (replaces the old separate intro card —
 * the video now starts on frame 1, which is better for retention). Letters
 * track in from wide spacing while a gold rule draws itself underneath.
 */
export const HookTitle: React.FC<{
	title: string;
	palette: Palette;
	durationInSeconds: number;
}> = ({title, palette, durationInSeconds}) => {
	const frame = useCurrentFrame();
	const {fps} = useVideoConfig();
	const t = frame / fps;

	const inEnd = 0.9;
	const outStart = durationInSeconds - 0.6;

	const opacity =
		interpolate(t, [0.1, 0.55], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}) *
		interpolate(t, [outStart, durationInSeconds], [1, 0], {
			extrapolateLeft: 'clamp',
			extrapolateRight: 'clamp',
		});

	const tracking = interpolate(t, [0, inEnd], [26, 4], {
		extrapolateLeft: 'clamp',
		extrapolateRight: 'clamp',
	});
	const rise = interpolate(t, [0.1, inEnd], [24, 0], {
		extrapolateLeft: 'clamp',
		extrapolateRight: 'clamp',
	});
	const ruleWidth = interpolate(t, [0.5, 1.3], [0, 220], {
		extrapolateLeft: 'clamp',
		extrapolateRight: 'clamp',
	});

	return (
		<AbsoluteFill style={{justifyContent: 'center', alignItems: 'center', opacity}}>
			{/* Soft scrim so the title reads over any footage. */}
			<AbsoluteFill
				style={{
					background:
						'radial-gradient(ellipse at center, rgba(0,0,0,0.45) 0%, rgba(0,0,0,0.15) 55%, rgba(0,0,0,0) 75%)',
				}}
			/>
			<div style={{textAlign: 'center', padding: '0 100px', transform: `translateY(${rise}px)`}}>
				<h1
					style={{
						fontFamily: 'Georgia, "Times New Roman", serif',
						fontWeight: 700,
						fontSize: 74,
						color: '#FFFFFF',
						lineHeight: 1.12,
						margin: 0,
						letterSpacing: `${tracking}px`,
						textTransform: 'uppercase',
						textShadow: '0 4px 24px rgba(0,0,0,0.85)',
					}}
				>
					{title}
				</h1>
				<div
					style={{
						width: ruleWidth,
						height: 3,
						background: palette.primary,
						margin: '26px auto 0',
						borderRadius: 2,
						boxShadow: `0 0 18px ${palette.primary}`,
					}}
				/>
			</div>
		</AbsoluteFill>
	);
};
