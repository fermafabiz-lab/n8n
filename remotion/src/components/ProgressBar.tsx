import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import type {Palette} from '../types';

/** Thin bar along the bottom edge showing overall watch progress (intro -> scenes -> outro). */
export const ProgressBar: React.FC<{palette: Palette}> = ({palette}) => {
	const frame = useCurrentFrame();
	const {durationInFrames} = useVideoConfig();
	const pct = Math.min(1, frame / Math.max(1, durationInFrames - 1));

	return (
		<AbsoluteFill style={{justifyContent: 'flex-end'}}>
			<div style={{height: 6, width: '100%', background: 'rgba(255,255,255,0.15)'}}>
				<div
					style={{
						height: '100%',
						width: `${pct * 100}%`,
						background: palette.primary,
					}}
				/>
			</div>
		</AbsoluteFill>
	);
};
