import React from 'react';
import {AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig} from 'remotion';
import type {Palette} from '../types';

/**
 * Cinematic title over the hook scene. Animates SCALE + opacity only —
 * animating letter-spacing (the previous approach) changed the layout every
 * frame and made the text rewrap mid-animation. Font size adapts to the
 * title length so long titles stay on 2-3 stable lines.
 */
export const HookTitle: React.FC<{
	title: string;
	palette: Palette;
	durationInSeconds: number;
}> = ({title, palette, durationInSeconds}) => {
	const frame = useCurrentFrame();
	const {fps} = useVideoConfig();
	const t = frame / fps;

	const outStart = durationInSeconds - 0.6;

	const opacity =
		interpolate(t, [0.1, 0.55], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}) *
		interpolate(t, [outStart, durationInSeconds], [1, 0], {
			extrapolateLeft: 'clamp',
			extrapolateRight: 'clamp',
		});

	// Scale-in: layout never changes, only the transform.
	const scale = interpolate(t, [0, 0.9], [1.1, 1], {
		extrapolateLeft: 'clamp',
		extrapolateRight: 'clamp',
	});
	const ruleWidth = interpolate(t, [0.5, 1.3], [0, 220], {
		extrapolateLeft: 'clamp',
		extrapolateRight: 'clamp',
	});

	// Adaptive size: short titles get big type, long ones step down.
	const len = title.length;
	const fontSize = len <= 24 ? 76 : len <= 44 ? 60 : len <= 70 ? 48 : 40;

	return (
		<AbsoluteFill style={{justifyContent: 'center', alignItems: 'center', opacity}}>
			{/* Soft scrim so the title reads over any footage. */}
			<AbsoluteFill
				style={{
					background:
						'radial-gradient(ellipse at center, rgba(0,0,0,0.45) 0%, rgba(0,0,0,0.15) 55%, rgba(0,0,0,0) 75%)',
				}}
			/>
			<div
				style={{
					textAlign: 'center',
					width: '78%',
					transform: `scale(${scale})`,
				}}
			>
				<h1
					style={{
						fontFamily: 'Georgia, "Times New Roman", serif',
						fontWeight: 700,
						fontSize,
						color: '#FFFFFF',
						lineHeight: 1.18,
						margin: 0,
						letterSpacing: 3,
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
