import React from 'react';
import {AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig} from 'remotion';
import type {Palette} from '../types';

const ROMAN = ['0', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

/**
 * Documentary-style lower third shown for a couple of seconds at the start
 * of each chapter. Rendered inside a Sequence that begins at the chapter's
 * first scene, so frame 0 here = chapter start.
 */
export const ChapterMarker: React.FC<{chapter: number; palette: Palette}> = ({
	chapter,
	palette,
}) => {
	const frame = useCurrentFrame();
	const {fps} = useVideoConfig();
	const t = frame / fps;

	const hold = 2.4;
	const slide = interpolate(t, [0.25, 0.75], [-60, 0], {
		extrapolateLeft: 'clamp',
		extrapolateRight: 'clamp',
	});
	const opacity =
		interpolate(t, [0.25, 0.65], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}) *
		interpolate(t, [hold, hold + 0.45], [1, 0], {
			extrapolateLeft: 'clamp',
			extrapolateRight: 'clamp',
		});

	if (opacity <= 0) return null;

	const numeral = ROMAN[chapter] ?? String(chapter);

	return (
		<AbsoluteFill style={{justifyContent: 'flex-end', alignItems: 'flex-start'}}>
			<div
				style={{
					marginBottom: 170,
					marginLeft: 72,
					transform: `translateX(${slide}px)`,
					opacity,
					display: 'flex',
					alignItems: 'center',
					gap: 18,
				}}
			>
				<div style={{width: 4, height: 46, background: palette.primary, borderRadius: 2}} />
				<div
					style={{
						fontFamily: 'Georgia, "Times New Roman", serif',
						color: '#FFFFFF',
						textShadow: '0 2px 14px rgba(0,0,0,0.9)',
					}}
				>
					<div style={{fontSize: 17, letterSpacing: 6, opacity: 0.85, textTransform: 'uppercase'}}>
						Chapter
					</div>
					<div style={{fontSize: 42, fontWeight: 700, lineHeight: 1.05}}>{numeral}</div>
				</div>
			</div>
		</AbsoluteFill>
	);
};
