import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import type {SceneCaption} from '../types';
import type {CaptionAccent} from '../captionColor';
import type {StylePreset} from '../style';
import {captionAt} from '../captionTiming';
import {CURVES, curveAt} from '../easing';
import type {CaptionMotion} from './packs';

/**
 * Captions drawn by a motion pack. Same words, same chunks and same timing as
 * the classic captions (captionAt owns all three); only the drawing differs.
 *
 * Rules carried over from docs/lessons-render.md, each checked on the
 * storyboard renders:
 *   - nothing moves linearly (easing.ts curves, or the back-out below);
 *   - a word never appears before it is spoken, so the picture cannot read
 *     ahead of the voice;
 *   - line height leaves room for the comma under Ș and Ț;
 *   - the safe margins of the classic captions are kept, portrait included
 *     (platform UI owns the bottom ~20% of a 9:16 frame).
 */

/** A small overshoot, for the punch pack's pop. Not linear, lands exactly on 1. */
const backOut = (x: number): number => {
	const p = Math.min(1, Math.max(0, x));
	const c1 = 1.70158;
	const c3 = c1 + 1;
	return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2);
};

export const PackCaptions: React.FC<{
	scenes: SceneCaption[];
	accent: CaptionAccent;
	preset: StylePreset;
	portrait: boolean;
	motion: Exclude<CaptionMotion, 'classic'>;
}> = ({scenes, accent, preset, portrait, motion}) => {
	const frame = useCurrentFrame();
	const {fps} = useVideoConfig();
	const now = frame / fps;

	const active = captionAt(scenes, now);
	if (!active) return null;
	const starts = active.wordStartsSeconds;
	// The ink the tone already uses for its cards: one accent across the film.
	const ink = accent ?? preset.cardInk;

	if (motion === 'lowerThird') {
		const a = curveAt((now - starts[0] + 0.02) / 0.25, CURVES.outQuart);
		return (
			<AbsoluteFill
				style={{
					justifyContent: 'flex-end',
					alignItems: 'flex-start',
					paddingLeft: portrait ? 36 : 72,
					paddingRight: portrait ? 36 : 72,
					boxSizing: 'border-box',
				}}
			>
				<div
					style={{
						marginBottom: portrait ? 300 : 90,
						maxWidth: portrait ? '90%' : '62%',
						boxSizing: 'border-box',
						background: 'rgba(10,10,14,0.58)',
						backdropFilter: 'blur(6px)',
						WebkitBackdropFilter: 'blur(6px)',
						borderLeft: `6px solid ${ink}`,
						borderRadius: 4,
						padding: '0.32em 0.62em 0.4em',
						fontFamily: preset.captionFont,
						fontWeight: 500,
						fontSize: portrait ? 38 : 34,
						lineHeight: 1.32,
						textAlign: 'left',
						opacity: a,
						transform: `translateX(${((1 - a) * -24).toFixed(2)}px)`,
						display: 'flex',
						flexWrap: 'wrap',
						columnGap: '0.28em',
					}}
				>
					{active.chunk.map((word, i) => {
						const spoken = i <= active.activeInChunk;
						const isActive = i === active.activeInChunk;
						return (
							<span
								key={i}
								style={{
									color: isActive ? ink : '#FFFFFF',
									opacity: isActive ? 1 : spoken ? 0.95 : 0.6,
									overflowWrap: 'anywhere',
									maxWidth: '100%',
								}}
							>
								{word}
							</span>
						);
					})}
				</div>
			</AbsoluteFill>
		);
	}

	const punch = motion === 'punch';
	return (
		<AbsoluteFill
			style={{
				justifyContent: 'flex-end',
				alignItems: 'center',
				paddingLeft: portrait ? 40 : 90,
				paddingRight: portrait ? 40 : 90,
				boxSizing: 'border-box',
			}}
		>
			<div
				style={{
					marginBottom: punch ? (portrait ? 360 : 110) : portrait ? 280 : 84,
					width: '100%',
					boxSizing: 'border-box',
					display: 'flex',
					flexWrap: 'wrap',
					justifyContent: 'center',
					alignItems: 'baseline',
					columnGap: punch ? '0.24em' : 14,
					rowGap: punch ? '0.08em' : 2,
					textAlign: 'center',
					fontFamily: punch ? preset.displayFont : preset.captionFont,
					fontWeight: punch ? preset.displayWeight : portrait ? 700 : 600,
					fontSize: punch ? (portrait ? 62 : 58) : portrait ? 42 : 40,
					// Uppercase Ș/Ț carry their comma below the baseline; 1.2 clears
					// it for every display face in style.ts (docs: lessons-render,
					// "diacritics and line height").
					lineHeight: punch ? 1.2 : 1.3,
					textTransform: punch ? 'uppercase' : undefined,
					textShadow: punch
						? '0 4px 0 rgba(0,0,0,0.35), 0 6px 20px rgba(0,0,0,0.85)'
						: '0 3px 14px rgba(0,0,0,0.9)',
				}}
			>
				{active.chunk.map((word, i) => {
					// A word enters at the instant it is spoken, never before.
					const since = now - (starts[i] - 0.04);
					if (since < 0) return null;
					const isActive = i === active.activeInChunk;
					if (punch) {
						const pop = backOut(since / 0.22);
						return (
							<span
								key={i}
								style={{
									display: 'inline-block',
									transform: `scale(${(0.55 + 0.45 * pop).toFixed(4)})`,
									opacity: Math.min(1, since / 0.07),
									color: isActive ? '#111111' : '#FFFFFF',
									background: isActive ? ink : 'transparent',
									padding: '0 0.16em',
									borderRadius: '0.14em',
									textShadow: isActive ? 'none' : undefined,
									overflowWrap: 'anywhere',
									maxWidth: '100%',
								}}
							>
								{word}
							</span>
						);
					}
					const e = curveAt(since / 0.28, CURVES.outQuart);
					return (
						<span
							key={i}
							style={{
								display: 'inline-block',
								opacity: e * (isActive ? 1 : 0.84),
								transform: `translateY(${((1 - e) * 0.4).toFixed(4)}em)`,
								color: '#FFFFFF',
								// The spoken word is underlined in the ink, not recoloured:
								// the word stays white and legible on any footage.
								boxShadow: isActive ? `inset 0 -0.11em 0 ${ink}` : undefined,
								overflowWrap: 'anywhere',
								maxWidth: '100%',
							}}
						>
							{word}
						</span>
					);
				})}
			</div>
		</AbsoluteFill>
	);
};
