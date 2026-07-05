import React from 'react';
import {AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import type {Palette} from '../types';

export const OutroCard: React.FC<{
	channelName: string;
	subscribeText: string;
	palette: Palette;
}> = ({channelName, subscribeText, palette}) => {
	const frame = useCurrentFrame();
	const {fps} = useVideoConfig();

	const opacity = interpolate(frame, [0, fps * 0.4], [0, 1], {extrapolateRight: 'clamp'});
	const buttonScale = spring({frame: frame - fps * 0.3, fps, config: {damping: 200, stiffness: 150}});

	return (
		<AbsoluteFill
			style={{
				backgroundColor: palette.background,
				justifyContent: 'center',
				alignItems: 'center',
				opacity,
			}}
		>
			<div style={{textAlign: 'center'}}>
				<div
					style={{
						fontFamily: 'Arial, sans-serif',
						fontWeight: 700,
						fontSize: 40,
						color: palette.text,
						marginBottom: 28,
					}}
				>
					{channelName}
				</div>
				<div
					style={{
						transform: `scale(${Math.max(0, buttonScale)})`,
						display: 'inline-block',
						background: palette.primary,
						color: palette.secondary,
						fontFamily: 'Arial, sans-serif',
						fontWeight: 800,
						fontSize: 32,
						padding: '18px 48px',
						borderRadius: 999,
					}}
				>
					{subscribeText}
				</div>
			</div>
		</AbsoluteFill>
	);
};
