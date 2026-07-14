import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import type {Palette, SceneCaption} from '../types';

/**
 * Karaoke captions with keyword emphasis.
 *
 * We only have per-scene narration text and the scene's real clip duration
 * (no word-level ASR timestamps), so words are distributed evenly across the
 * scene's duration. Swap in forced-alignment timestamps later without
 * changing this component's props shape.
 *
 * Keywords (proper nouns mid-sentence, numbers, long words) render in the
 * accent color slightly larger, so the eye catches the load-bearing words.
 */
const findActiveWord = (scenes: SceneCaption[], seconds: number) => {
	const scene = scenes.find(
		(s) => seconds >= s.startSeconds && seconds < s.startSeconds + s.durationSeconds,
	);
	if (!scene) return null;

	const words = scene.narratorText.trim().split(/\s+/).filter(Boolean);
	if (words.length === 0) return null;

	const elapsed = seconds - scene.startSeconds;
	const perWord = scene.durationSeconds / words.length;
	const activeIndex = Math.min(words.length - 1, Math.floor(elapsed / perWord));

	return {words, activeIndex};
};

const isKeyword = (word: string, index: number): boolean => {
	const clean = word.replace(/[^\p{L}\p{N}]/gu, '');
	if (!clean) return false;
	if (/\d/.test(clean)) return true; // numbers and years
	if (index > 0 && /^\p{Lu}/u.test(clean)) return true; // proper noun mid-sentence
	return clean.length >= 11; // long, usually meaningful words
};

export const Captions: React.FC<{scenes: SceneCaption[]; palette: Palette}> = ({
	scenes,
	palette,
}) => {
	const frame = useCurrentFrame();
	const {fps} = useVideoConfig();
	const seconds = frame / fps;

	const active = findActiveWord(scenes, seconds);
	if (!active) return null;

	return (
		<AbsoluteFill style={{justifyContent: 'flex-end', alignItems: 'center'}}>
			<div
				style={{
					marginBottom: 92,
					maxWidth: '82%',
					textAlign: 'center',
					fontFamily: 'Arial, sans-serif',
					fontWeight: 700,
					fontSize: 42,
					lineHeight: 1.45,
					textShadow: '0 2px 12px rgba(0,0,0,0.85)',
				}}
			>
				{active.words.map((word, i) => {
					const activeNow = i === active.activeIndex;
					const keyword = isKeyword(word, i);
					return (
						<span
							key={i}
							style={{
								color: activeNow ? palette.primary : keyword ? `${palette.primary}D9` : '#FFFFFF',
								fontSize: keyword || activeNow ? '1.09em' : '1em',
								marginRight: 12,
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
