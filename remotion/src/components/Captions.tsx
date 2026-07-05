import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import type {Palette, SceneCaption} from '../types';

/**
 * Finds the scene active at `seconds` and highlights the current word.
 *
 * We only have per-scene narration text and the scene's real clip duration
 * (no word-level ASR timestamps), so words are distributed evenly across the
 * scene's duration. This is a solid approximation for ~14-28 word scenes;
 * swap in real forced-alignment timestamps (e.g. from Whisper) later for
 * frame-perfect sync without changing this component's props shape.
 */
const findActiveWord = (scenes: SceneCaption[], seconds: number) => {
	const scene = scenes.find(
		(s) => seconds >= s.startSeconds && seconds < s.startSeconds + s.durationSeconds
	);
	if (!scene) return null;

	const words = scene.narratorText.trim().split(/\s+/).filter(Boolean);
	if (words.length === 0) return null;

	const elapsed = seconds - scene.startSeconds;
	const perWord = scene.durationSeconds / words.length;
	const activeIndex = Math.min(words.length - 1, Math.floor(elapsed / perWord));

	return {words, activeIndex};
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
					marginBottom: 96,
					maxWidth: '80%',
					textAlign: 'center',
					fontFamily: 'Arial, sans-serif',
					fontWeight: 700,
					fontSize: 44,
					lineHeight: 1.4,
					textShadow: '0 2px 12px rgba(0,0,0,0.8)',
				}}
			>
				{active.words.map((word, i) => (
					<span
						key={i}
						style={{
							color: i === active.activeIndex ? palette.primary : '#FFFFFF',
							marginRight: 12,
						}}
					>
						{word}
					</span>
				))}
			</div>
		</AbsoluteFill>
	);
};
