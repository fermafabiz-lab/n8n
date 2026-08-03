import React from 'react';
import {AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import type {Palette} from '../types';

export const IntroCard: React.FC<{title: string; palette: Palette}> = ({title, palette}) => {
	const frame = useCurrentFrame();
	const {fps, durationInFrames, width} = useVideoConfig();
	// Same canvas-relative scaling as HookTitle: these sizes were tuned on
	// the 1280-wide landscape canvas and are 1.78x too large relative to the
	// 720-wide vertical one. At 1280 the scale is 1 and nothing changes.
	const px = (n: number) => n * (width / 1280);


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
					padding: `0 ${px(120)}px`,
				}}
			>
				<div
					style={{
						width: px(64),
						height: px(4),
						background: palette.primary,
						margin: `0 auto ${px(32)}px`,
						borderRadius: 2,
					}}
				/>
				<h1
					style={{
						fontFamily: 'Arial, sans-serif',
						fontWeight: 800,
						fontSize: px(72),
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
