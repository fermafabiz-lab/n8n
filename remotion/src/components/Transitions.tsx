import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import type {SceneCaption} from '../types';
import {toneKey} from '../types';
import {CURVES, curveAt} from '../easing';
import {LightLeak, flashEnvelope} from './LightLeak';

/**
 * Scene/chapter transitions over the single continuous video layer (a true
 * cross-dissolve would need two decoded copies of the footage — not worth the
 * render cost).
 *
 * Same-chapter cuts get a quick luminance dip, eased into a bell rather than
 * the linear triangle it used to be. Chapter changes are handled by whichever
 * element owns that boundary: with cards on, the card's own light leak IS the
 * transition; with cards off, a leak replaces the old dip-to-black, because
 * cutting to black for a quarter second on a 60s film costs more momentum than
 * the boundary is worth.
 */
export const Transitions: React.FC<{
	scenes: SceneCaption[];
	tone: string;
	/**
	 * Whether chapter cards are rendered. When they are, they own the chapter
	 * boundary — dipping or flaring here as well would stack two effects on the
	 * same frame.
	 */
	chapterCards?: boolean;
}> = ({scenes, tone, chapterCards = true}) => {
	const frame = useCurrentFrame();
	const {fps} = useVideoConfig();
	const t = frame / fps;

	const k = toneKey(tone);
	const dark = /dark|horror|conspiracy|mystery/.test(k);
	const cutHalf = dark ? 0.22 : 0.16; // half-width of a scene-cut dip
	const cutDepth = dark ? 0.55 : 0.4;
	const chapterLeakHalf = dark ? 0.42 : 0.38;

	let dip = 0;
	let leak: {amount: number; sweep: number} | null = null;
	for (let i = 1; i < scenes.length; i++) {
		const boundary = scenes[i].startSeconds;
		const isChapterChange = (scenes[i].chapter ?? 0) !== (scenes[i - 1].chapter ?? 0);
		if (isChapterChange && chapterCards) continue; // the card owns this frame
		const half = isChapterChange ? chapterLeakHalf : cutHalf;
		const d = Math.abs(t - boundary);
		if (d >= half) continue;
		if (isChapterChange) {
			const p = (t - (boundary - half)) / (2 * half);
			const amount = flashEnvelope(p);
			if (!leak || amount > leak.amount) leak = {amount, sweep: p};
		} else {
			// Eased bell: soft at the edges, rounded on the cut. The old
			// triangular ramp changed brightness at a constant rate, which reads
			// as a shutter rather than a dip.
			dip = Math.max(dip, cutDepth * curveAt(1 - d / half, CURVES.inOutCubic));
		}
	}

	if (dip <= 0.01 && !leak) return null;
	return (
		<AbsoluteFill style={{pointerEvents: 'none'}}>
			{dip > 0.01 && <AbsoluteFill style={{background: '#000', opacity: dip}} />}
			{leak && (
				<LightLeak
					amount={leak.amount}
					sweep={curveAt(leak.sweep, CURVES.inOutCubic)}
					hue={dark ? 'cool' : 'warm'}
				/>
			)}
		</AbsoluteFill>
	);
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
	//
	// The base push above stays linear on purpose — a constant-velocity zoom is
	// what a real rostrum move looks like, and easing a whole-scene push makes
	// it visibly decelerate for no reason. A punch is a discrete event, though,
	// so it gets a shaped attack and release.
	if (energy > 0) {
		const punch = energy === 2 ? 0.02 : 0.011;
		for (const at of [0.4, 0.75]) {
			const d = p - at;
			if (d >= 0 && d < 0.12) {
				const k =
					d < 0.02
						? curveAt(d / 0.02, CURVES.outExpo)
						: 1 - curveAt((d - 0.02) / 0.1, CURVES.inOutCubic);
				scale += punch * Math.max(0, k);
			}
		}
	}

	const dir = idx % 2 === 0 ? 1 : -1;
	const tx = dir * 8 * p; // px drift at 1280w — subtle
	const ty = (idx % 3 === 0 ? -1 : 1) * 5 * p;
	return `scale(${scale.toFixed(4)}) translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px)`;
};
