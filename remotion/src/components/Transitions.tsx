import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import type {SceneCaption} from '../types';
import {toneKey} from '../types';

/**
 * Scene/chapter transitions as luminance dips over the single continuous
 * video layer (a true cross-dissolve would need two decoded copies of the
 * footage — not worth the render cost). Same-chapter cuts get a quick soft
 * dip; chapter changes get a full dip-to-black. Darker tones dip deeper and
 * slightly longer.
 */
export const Transitions: React.FC<{scenes: SceneCaption[]; tone: string}> = ({scenes, tone}) => {
	const frame = useCurrentFrame();
	const {fps} = useVideoConfig();
	const t = frame / fps;

	const k = toneKey(tone);
	const dark = /dark|horror|conspiracy|mystery/.test(k);
	const cutHalf = dark ? 0.22 : 0.16; // half-width of a scene-cut dip
	const chapterHalf = dark ? 0.3 : 0.24;
	const cutDepth = dark ? 0.55 : 0.4;

	let opacity = 0;
	for (let i = 1; i < scenes.length; i++) {
		const boundary = scenes[i].startSeconds;
		const isChapterChange = (scenes[i].chapter ?? 0) !== (scenes[i - 1].chapter ?? 0);
		const half = isChapterChange ? chapterHalf : cutHalf;
		const depth = isChapterChange ? 1 : cutDepth;
		const d = Math.abs(t - boundary);
		if (d < half) {
			// Triangular ramp: 0 at edges, full depth exactly on the cut.
			opacity = Math.max(opacity, depth * (1 - d / half));
		}
	}

	if (opacity <= 0.01) return null;
	return <AbsoluteFill style={{background: '#000', opacity, pointerEvents: 'none'}} />;
};

/**
 * Ken Burns on the continuous footage: slow push-in with alternating drift
 * per scene. The transform snaps at scene boundaries, but the snap lands
 * inside the Transitions dip so it's never visible.
 */
export const kenBurnsTransform = (
	scenes: SceneCaption[],
	seconds: number,
	energy: 0 | 1 | 2 = 1,
): string => {
	const idx = scenes.findIndex(
		(s) => seconds >= s.startSeconds && seconds < s.startSeconds + s.durationSeconds,
	);
	if (idx === -1) return 'scale(1)';
	const s = scenes[idx];
	const p = Math.min(1, (seconds - s.startSeconds) / Math.max(0.1, s.durationSeconds));
	let scale = 1.015 + 0.035 * p;

	// Editor-style punch-ins: a quick extra push at 40% and 75% of the scene,
	// where a human editor would cut. Scaled by the tone's energy; calm tones
	// (energy 0) keep the pure slow push.
	if (energy > 0) {
		const punch = energy === 2 ? 0.02 : 0.011;
		for (const at of [0.4, 0.75]) {
			const d = p - at;
			if (d >= 0 && d < 0.12) {
				// Fast attack, slow release.
				const k = d < 0.02 ? d / 0.02 : 1 - (d - 0.02) / 0.1;
				scale += punch * Math.max(0, k);
			}
		}
	}

	const dir = idx % 2 === 0 ? 1 : -1;
	const tx = dir * 8 * p; // px drift at 1280w — subtle
	const ty = (idx % 3 === 0 ? -1 : 1) * 5 * p;
	return `scale(${scale.toFixed(4)}) translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px)`;
};
