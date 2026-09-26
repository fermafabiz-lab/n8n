import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import type {SceneCaption} from '../types';
import type {CaptionAccent} from '../captionColor';
import type {StylePreset} from '../style';
import {captionAt} from '../captionTiming';
import {CURVES, curveAt} from '../easing';
import type {CaptionMotion} from './packs';
import {cardTitleFont} from '../style';

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

/**
 * The punch pack's pop: a soft overshoot, not linear, landing exactly on 1.
 * Toned down on the producer's first look (2026-09-24, "punch is too
 * punchy"): the overshoot constant went from 1.70 (the textbook back-out) to
 * 0.6, and the word now grows from 85% of its size instead of 55%.
 */
const POP_OVERSHOOT = 0.6;
const POP_FROM = 0.85;
const backOut = (x: number): number => {
	const p = Math.min(1, Math.max(0, x));
	const c1 = POP_OVERSHOOT;
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

	if (motion === 'kidsPill' || motion === 'kidsBounce' || motion === 'kidsSticker') {
		return <KidsCaptions active={active} now={now} portrait={portrait} motion={motion} />;
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
					fontSize: punch ? (portrait ? 54 : 50) : portrait ? 42 : 40,
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
						const pop = backOut(since / 0.26);
						return (
							<span
								key={i}
								style={{
									display: 'inline-block',
									transform: `scale(${(POP_FROM + (1 - POP_FROM) * pop).toFixed(4)})`,
									opacity: Math.min(1, since / 0.1),
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

/** A spring that overshoots and settles — the bounce of the kids captions. */
const elastic = (x: number, amp = 1.1): number => {
	const p = Math.min(1, Math.max(0, x));
	if (p === 0 || p === 1) return p;
	return Math.pow(2, -9 * p) * Math.sin((p * 10 - 0.75) * ((2 * Math.PI) / 3) * amp) + 1;
};

/** A thick sticker outline: sixteen dark shadows round the glyph, then a drop. */
const STICKER_OUTLINE = [
	...Array.from({length: 16}, (_, k) => {
		const a = (k / 16) * Math.PI * 2;
		return `${(Math.cos(a) * 0.075).toFixed(3)}em ${(Math.sin(a) * 0.075).toFixed(3)}em 0 #2B1B3F`;
	}),
	'0 0.14em 0 #2B1B3F',
	'0 0.2em 14px rgba(0,0,0,0.45)',
].join(', ');

/** The warm colour the spoken word takes in a kids film, whatever the tone. */
const KIDS_WARM = '#FF7A45';

/**
 * The three Kids story caption styles (2026-09-26). A rounded face (Poppins
 * Bold, the chapter card's) because children's books are set round; bigger
 * than the adult captions because the viewer may be five. Same words, chunks
 * and timing as every caption (captionAt); a word never shows before it is
 * spoken.
 */
const KidsCaptions: React.FC<{
	active: NonNullable<ReturnType<typeof captionAt>>;
	now: number;
	portrait: boolean;
	motion: 'kidsPill' | 'kidsBounce' | 'kidsSticker';
}> = ({active, now, portrait, motion}) => {
	const starts = active.wordStartsSeconds;
	const size = portrait ? 50 : 46;
	const words = active.chunk.map((word, i) => {
		const since = now - (starts[i] - 0.04);
		const isActive = i === active.activeInChunk;
		return {word, i, since, isActive, spoken: i <= active.activeInChunk};
	});

	if (motion === 'kidsPill') {
		const inn = curveAt((now - starts[0] + 0.04) / 0.3, CURVES.outQuart);
		return (
			<AbsoluteFill style={{justifyContent: 'flex-end', alignItems: 'center', padding: portrait ? '0 36px' : '0 90px', boxSizing: 'border-box'}}>
				<div
					style={{
						marginBottom: portrait ? 300 : 80,
						maxWidth: '100%',
						background: '#FFFDF7',
						borderRadius: 999,
						padding: '0.28em 0.9em 0.34em',
						boxShadow: '0 8px 28px rgba(0,0,0,0.35)',
						display: 'flex',
						flexWrap: 'wrap',
						justifyContent: 'center',
						columnGap: '0.26em',
						fontFamily: cardTitleFont,
						fontWeight: 700,
						fontSize: size,
						lineHeight: 1.3,
						opacity: inn,
						transform: `translateY(${((1 - inn) * 18).toFixed(2)}px) scale(${(0.94 + 0.06 * inn).toFixed(4)})`,
					}}
				>
					{words.map((w) => (
						<span key={w.i} style={{color: w.isActive ? KIDS_WARM : w.spoken ? '#3A2A20' : 'rgba(58,42,32,0.38)', overflowWrap: 'anywhere', maxWidth: '100%'}}>
							{w.word}
						</span>
					))}
				</div>
			</AbsoluteFill>
		);
	}

	const sticker = motion === 'kidsSticker';
	return (
		<AbsoluteFill style={{justifyContent: 'flex-end', alignItems: 'center', padding: portrait ? '0 36px' : '0 90px', boxSizing: 'border-box'}}>
			<div
				style={{
					marginBottom: portrait ? 300 : 84,
					width: '100%',
					display: 'flex',
					flexWrap: 'wrap',
					justifyContent: 'center',
					alignItems: 'baseline',
					columnGap: '0.24em',
					rowGap: '0.06em',
					fontFamily: cardTitleFont,
					fontWeight: 700,
					fontSize: sticker ? size * 1.08 : size,
					lineHeight: 1.25,
				}}
			>
				{words.map((w) => {
					if (w.since < 0) return null;
					if (sticker) {
						// Squeeze in: wide and flat, then round — the catalog's
						// horizontal-squeeze entrance.
						const e = elastic(w.since / 0.5, 0.9);
						const sx = 1.35 - 0.35 * e;
						const sy = 0.6 + 0.4 * e;
						return (
							<span
								key={w.i}
								style={{
									display: 'inline-block',
									transform: `scale(${sx.toFixed(4)}, ${sy.toFixed(4)}) rotate(${w.isActive ? -3 : 0}deg)`,
									color: w.isActive ? '#FFD166' : '#FFFFFF',
									// A ring of shadows is the outline: -webkit-text-stroke
									// draws inside the glyph and thinned the letters to
									// nothing on the first render.
									textShadow: STICKER_OUTLINE,
									opacity: Math.min(1, w.since / 0.08),
								}}
							>
								{w.word}
							</span>
						);
					}
					// Bounce: each word drops in on a spring; the spoken one is bigger
					// and warm.
					const e = elastic(w.since / 0.6);
					return (
						<span
							key={w.i}
							style={{
								display: 'inline-block',
								transform: `translateY(${((1 - e) * -0.55).toFixed(4)}em) scale(${w.isActive ? 1.12 : 1})`,
								transformOrigin: '50% 90%',
								// Room for the spoken word's extra size, so it never
								// overlaps its neighbours.
								margin: w.isActive ? '0 0.14em' : undefined,
								color: w.isActive ? KIDS_WARM : '#FFFFFF',
								textShadow: '0 3px 0 rgba(0,0,0,0.35), 0 6px 18px rgba(0,0,0,0.6)',
								opacity: Math.min(1, w.since / 0.1),
							}}
						>
							{w.word}
						</span>
					);
				})}
			</div>
		</AbsoluteFill>
	);
};
