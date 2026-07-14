import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import type {Palette, SceneCaption} from '../types';

/**
 * Instagram-story-style progress bar: one segment per chapter, filled left to
 * right, with small gaps at chapter boundaries so the viewer can see how much
 * of the story remains.
 */
export const ProgressBar: React.FC<{palette: Palette; scenes: SceneCaption[]}> = ({
	palette,
	scenes,
}) => {
	const frame = useCurrentFrame();
	const {durationInFrames, fps} = useVideoConfig();
	const pct = Math.min(1, frame / Math.max(1, durationInFrames - 1));

	// Chapter boundaries as fractions of the FULL composition (incl. outro).
	const boundaries: number[] = [];
	for (let i = 1; i < scenes.length; i++) {
		if ((scenes[i].chapter ?? 0) !== (scenes[i - 1].chapter ?? 0)) {
			boundaries.push((scenes[i].startSeconds * fps) / Math.max(1, durationInFrames));
		}
	}
	const edges = [0, ...boundaries, 1];

	return (
		<AbsoluteFill style={{justifyContent: 'flex-end', pointerEvents: 'none'}}>
			<div style={{display: 'flex', gap: 5, padding: '0 0 0 0', height: 6}}>
				{edges.slice(0, -1).map((start, i) => {
					const end = edges[i + 1];
					const width = (end - start) * 100;
					const fill = Math.max(0, Math.min(1, (pct - start) / Math.max(0.0001, end - start)));
					return (
						<div
							key={i}
							style={{
								width: `${width}%`,
								height: '100%',
								background: 'rgba(255,255,255,0.16)',
								overflow: 'hidden',
							}}
						>
							<div
								style={{
									height: '100%',
									width: `${fill * 100}%`,
									background: palette.primary,
									boxShadow: fill > 0 && fill < 1 ? `0 0 10px ${palette.primary}` : 'none',
								}}
							/>
						</div>
					);
				})}
			</div>
		</AbsoluteFill>
	);
};
