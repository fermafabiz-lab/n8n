import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import type {Palette, SceneCaption} from '../types';
import type {StylePreset} from '../style';

/**
 * Short caption chunks (max 4-5 words on screen at once), paced over the
 * scene's REAL narration length (`speechSeconds`, measured by the assemble
 * step) rather than the silence-padded scene duration — that mismatch is
 * what made captions lag the voice and keep playing into the silence.
 * After the narration ends, no caption is shown.
 */
const CHUNK_SIZE = 4;

const buildChunks = (text: string) => {
	const words = text.trim().split(/\s+/).filter(Boolean);
	const chunks: string[][] = [];
	for (let i = 0; i < words.length; i += CHUNK_SIZE) {
		chunks.push(words.slice(i, i + CHUNK_SIZE));
	}
	// Avoid a lonely 1-word last chunk: merge it into the previous one.
	if (chunks.length > 1 && chunks[chunks.length - 1].length === 1) {
		const last = chunks.pop()!;
		chunks[chunks.length - 1].push(...last);
	}
	return {words, chunks};
};

const findActive = (scenes: SceneCaption[], seconds: number) => {
	const scene = scenes.find(
		(s) => seconds >= s.startSeconds && seconds < s.startSeconds + s.durationSeconds,
	);
	if (!scene) return null;

	const {words, chunks} = buildChunks(scene.narratorText);
	if (words.length === 0) return null;

	// Words are spoken during speechSeconds; fall back to a ~2.6 words/sec
	// estimate if the measurement is missing.
	const speech = scene.speechSeconds && scene.speechSeconds > 0
		? Math.min(scene.speechSeconds, scene.durationSeconds)
		: Math.min(words.length / 2.6, scene.durationSeconds);

	const elapsed = seconds - scene.startSeconds;
	if (elapsed > speech + 0.35) return null; // narration over → captions off

	const perWord = speech / words.length;
	const wordIndex = Math.min(words.length - 1, Math.floor(elapsed / perWord));

	let count = 0;
	for (const chunk of chunks) {
		if (wordIndex < count + chunk.length) {
			return {chunk, activeInChunk: wordIndex - count};
		}
		count += chunk.length;
	}
	return null;
};

const isKeyword = (word: string): boolean => {
	const clean = word.replace(/[^\p{L}\p{N}]/gu, '');
	if (!clean) return false;
	if (/\d/.test(clean)) return true; // numbers and years
	return /^\p{Lu}/u.test(clean) || clean.length >= 11;
};

export const Captions: React.FC<{
	scenes: SceneCaption[];
	palette: Palette;
	preset: StylePreset;
	/** Hide captions before this time (while the hook title owns the frame). */
	suppressUntilSeconds?: number;
	/** Vertical (9:16) framing: bigger type, raised safe-zone position. */
	portrait?: boolean;
}> = ({scenes, palette, preset, suppressUntilSeconds = 0, portrait = false}) => {
	const frame = useCurrentFrame();
	const {fps} = useVideoConfig();
	const seconds = frame / fps;

	// One text element at a time: the hook title and captions fighting for
	// the frame in the opening seconds read as clutter (seen on the contact
	// sheet), so captions wait their turn.
	if (seconds < suppressUntilSeconds) return null;

	const active = findActive(scenes, seconds);
	if (!active) return null;

	return (
		<AbsoluteFill
			style={{
				justifyContent: 'flex-end',
				alignItems: 'center',
				// The safe margin belongs to the frame, not the text box: padding
				// here is what a percentage max-width failed to guarantee.
				paddingLeft: portrait ? 44 : 90,
				paddingRight: portrait ? 44 : 90,
				boxSizing: 'border-box',
			}}
		>
			<div
				style={{
					// Portrait: lift captions well above the platform UI (Shorts /
					// Reels overlays live in the bottom ~20%).
					marginBottom: portrait ? 280 : 84,
					// A shrink-to-fit flex item ignored `maxWidth` and ran a long
					// chunk clean off the right edge, cut mid-word — reproduced at
					// 720x1280 with four long words. An explicit full-width box that
					// wraps between words cannot do that, whatever the font metrics
					// turn out to be.
					width: '100%',
					boxSizing: 'border-box',
					display: 'flex',
					flexWrap: 'wrap',
					justifyContent: 'center',
					columnGap: 14,
					rowGap: 2,
					textAlign: 'center',
					fontFamily: preset.captionFont,
					fontWeight: portrait ? 700 : 600,
					fontSize: portrait ? 42 : 40,
					lineHeight: 1.3,
					textShadow: '0 3px 14px rgba(0,0,0,0.9)',
				}}
			>
				{active.chunk.map((word, i) => {
					const activeNow = i === active.activeInChunk;
					const keyword = isKeyword(word);
					return (
						<span
							key={i}
							style={{
								color: activeNow || keyword ? palette.primary : '#FFFFFF',
								opacity: activeNow ? 1 : 0.92,
								// Last resort for a single word longer than the line box
								// (compound German/Romanian nouns, URLs read aloud).
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
