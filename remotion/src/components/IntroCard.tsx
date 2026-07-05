import React from 'react';
import {AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import type {Palette} from '../types';

export const IntroCard: React.FC<{title: string; palette: Palette}> = ({title, palette}) => {
	const frame = useCurrentFrame();
	const {fps, durationInFrames} = useVideoConfig();

	const scale = spring({frame, fps, config: {damping: 200, stiffness: 120}});
	const opacity = interpolate(frame, [0, fps * 0.4], [0, 1], {extrapolateRight: 'clamp'});
	// Fade out over the last 15 frames of the intro so it doesn't cut abruptly into the video.
	const fadeOut = interpolate(
		frame,
		[durationInFrames - 15, durationInFrames],
		[1, 0],
		{extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}
	);

	return (
		<AbsoluteFill
			style={{
				backgroundColor: palette.background,
				justifyContent: 'center',
				alignItems: 'center',
				opacity: opacity * fadeOut,
			}}
		>
			<div
				style={{
					transform: `scale(${scale})`,
					textAlign: 'center',
					padding: '0 120px',
				}}
			>
				<div
					style={{
						width: 64,
						height: 4,
						background: palette.primary,
						margin: '0 auto 32px',
						borderRadius: 2,
					}}
				/>
				<h1
					style={{
						fontFamily: 'Arial, sans-serif',
						fontWeight: 800,
						fontSize: 72,
						color: palette.text,
						lineHeight: 1.15,
						margin: 0,
					}}
				>
					{title}
				</h1>
			</div>
		</AbsoluteFill>
	);
};
