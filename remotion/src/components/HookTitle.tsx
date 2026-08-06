import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import type {Palette} from '../types';
import type {StylePreset} from '../style';
import {CURVES, curveAt, eased} from '../easing';

/**
 * Opening title, as a statement.
 *
 * The previous version typed the text on character by character, centred it at
 * medium size, and underlined it with a glowing amber rule. Every one of those
 * is a tell: a typewriter reveal is the signature of template video tools, and
 * centred-text-over-a-glowing-underline is a wedding invitation. It read as
 * generated no matter how well the words were chosen.
 *
 * Now the title fills the frame. Type is sized to the text instead of picked
 * from a ladder, words rise and fade in on one curve rather than being typed,
 * the block settles out of a slight scale and blur, and there is no rule at
 * all. The frame darkens behind it and clears when it leaves.
 */

/**
 * Whether a project name can carry a title card at all.
 *
 * The form's Tema field is a description, not a headline — "A man and a woman
 * talking about equality" is a brief, and no typography rescues a brief set in
 * 100px. A statement card only works on a real title, so anything that reads
 * as a sentence opens clean instead. n8n passing a written `hookTitle` skips
 * this test entirely: a line authored to be a title is trusted as one.
 */
export const isTitleLike = (s: string): boolean => {
	const t = s.trim();
	const words = t.split(/\s+/).filter(Boolean);
	return words.length > 0 && words.length <= 7 && t.length <= 46;
};

export const HookTitle: React.FC<{
	title: string;
	palette: Palette;
	preset: StylePreset;
	durationInSeconds: number;
}> = ({title, preset, durationInSeconds}) => {
	const frame = useCurrentFrame();
	const {fps, width, height} = useVideoConfig();
	const t = frame / fps;

	const words = title.split(/\s+/).filter(Boolean);

	// Size to the text, not from a table — and by SIMULATING the line breaks
	// rather than dividing by a character count. Solving `chars per line`
	// algebraically ignores that words don't split: it put a five-word title
	// on four lines when two were right, because one long word wrapped early.
	// The greedy pass below is the same thing the browser does.
	const avail = width * (width < height ? 0.88 : 0.84);
	const advance = preset.titleAdvance;
	const MAX_LINES = 3;
	const maxHeight = height * 0.6;

	// Two numbers measured off a real render rather than assumed: a word space
	// costs ~0.58 of an average glyph (0.42em in Fraunces caps, far more than
	// the 0.25em a body face would use), and the wrap width carries a 6%
	// margin so that whatever the estimate still gets wrong pushes the type
	// one notch SMALLER instead of spilling onto an extra line.
	const wrapWidth = avail * 0.94;
	const linesAt = (size: number): number => {
		const space = advance * size * 0.58;
		let lines = 1;
		let cur = -1;
		for (const w of words) {
			const ww = w.length * advance * size;
			if (cur < 0) {
				cur = ww;
			} else if (cur + space + ww <= wrapWidth) {
				cur += space + ww;
			} else {
				lines += 1;
				cur = ww;
			}
		}
		return lines;
	};

	const maxSize = width * 0.094;
	const minSize = width * 0.03;
	let fontSize = minSize;
	for (let s = maxSize; s >= minSize; s -= maxSize / 60) {
		const lines = linesAt(s);
		if (lines <= MAX_LINES && lines * s * 1.04 <= maxHeight) {
			fontSize = s;
			break;
		}
	}

	// Entrance: each word rises and fades in turn, both on the same curve so
	// they read as one movement. Exit: the block lifts and blurs away faster
	// than it arrived, which is what makes an exit feel decisive.
	const STAGGER = 0.07;
	const WORD_REVEAL = 0.55;
	const RISE_EM = 0.38;
	const outStart = Math.max(0.8, durationInSeconds - 0.45);
	const outP = curveAt((t - outStart) / 0.45, CURVES.inOutCubic);

	const settle = curveAt(t / 0.9, CURVES.outExpo);
	const blockScale = 1.045 - 0.045 * settle;
	const blockBlur = (1 - settle) * width * 0.005 + outP * width * 0.004;
	const blockLift = -outP * height * 0.03;
	const blockOpacity = 1 - outP;
	if (blockOpacity <= 0) return null;

	// The frame darkens under the title and clears with it — a band across the
	// middle rather than the old radial blob, which sat on the picture instead
	// of behind the type.
	const scrim = Math.min(settle, 1 - outP);

	return (
		<AbsoluteFill style={{justifyContent: 'center', alignItems: 'center'}}>
			<AbsoluteFill
				style={{
					opacity: scrim,
					background:
						'linear-gradient(180deg, rgba(0,0,0,0.12) 0%, rgba(0,0,0,0.58) 34%, rgba(0,0,0,0.58) 66%, rgba(0,0,0,0.12) 100%)',
				}}
			/>
			<div
				style={{
					width: `${(avail / width) * 100}%`,
					textAlign: 'center',
					opacity: blockOpacity,
					transform: `translateY(${blockLift}px) scale(${blockScale.toFixed(4)})`,
					filter: blockBlur > 0.3 ? `blur(${blockBlur.toFixed(2)}px)` : undefined,
				}}
			>
				<h1
					style={{
						fontFamily: preset.displayFont,
						fontWeight: preset.displayWeight,
						fontSize,
						color: '#FFFFFF',
						lineHeight: 1.04,
						margin: 0,
						// Uppercase needs air between the caps; mixed case at this size
						// wants the opposite, or the words drift apart.
						letterSpacing: preset.uppercaseTitle ? '0.005em' : '-0.022em',
						textTransform: preset.uppercaseTitle ? 'uppercase' : 'none',
						textShadow: `0 ${fontSize * 0.03}px ${fontSize * 0.18}px rgba(0,0,0,0.55)`,
					}}
				>
					{words.map((word, wi) => {
						const e = curveAt((t - wi * STAGGER) / WORD_REVEAL, CURVES.outExpo);
						return (
							<React.Fragment key={wi}>
								{/* Rise and fade on ONE curve. The previous version revealed
								    each word through an `overflow: hidden` clip box, so the
								    word was visibly sliced by an invisible edge the whole way
								    up — a hard cut moving across the letterforms. Nothing on
								    screen explains that edge, so it reads as a bug. Fading the
								    word in over the same travel needs no mask at all: at every
								    frame the glyphs are whole, just lower and lighter. */}
								<span
									style={{
										display: 'inline-block',
										opacity: e,
										// A short travel — the fade carries the reveal, so a long
										// slide would only look like the word arrived late.
										transform: `translateY(${((1 - e) * RISE_EM).toFixed(4)}em)`,
										overflowWrap: 'anywhere',
										maxWidth: '100%',
									}}
								>
									{word}
								</span>
								{wi < words.length - 1 ? ' ' : null}
							</React.Fragment>
						);
					})}
				</h1>
			</div>
		</AbsoluteFill>
	);
};
