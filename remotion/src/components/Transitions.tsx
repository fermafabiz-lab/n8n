import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import type {SceneCaption} from '../types';
import {toneKey} from '../types';
import {CURVES, curveAt} from '../easing';
import {FLASH_PEAK, LightLeak, flashEnvelope, flashSweep} from './LightLeak';

/**
 * Chapter transitions over the single continuous video layer.
 *
 * An ordinary scene boundary gets NOTHING from this component, and that
 * absence is the point. It used to dip the luminance there — 40% for a third
 * of a second — from the era when the whole film was one unbroken clip and a
 * scene boundary had no picture change of its own to announce it. The
 * assembled montage is now one clip per scene concatenated, so the picture
 * genuinely cuts at every boundary (ffmpeg finds a hard cut on every scene
 * start of the tahiti film), and the dip had become a second transition laid
 * over a real one: the tail of the outgoing scene faded down, the head of the
 * incoming faded up, and the cut itself sat in the trough. Measured on a
 * render, 39-56% of the frame's luminance at all thirteen cuts. That reads as
 * a brightness pump around every cut — reported as "the frames move badly, it
 * looks like an error", which is exactly what a viewer should call it.
 *
 * A chapter change still needs an owner, because there the job is to mark a
 * step up from an ordinary cut rather than to mark the cut: with cards on, the
 * card's own light leak IS the transition; with cards off, a leak stands in
 * for it, because cutting to black for a quarter second on a 60s film costs
 * more momentum than the boundary is worth.
 */
export const Transitions: React.FC<{
	scenes: SceneCaption[];
	tone: string;
	/**
	 * Whether chapter cards are rendered. When they are, they own the chapter
	 * boundary — flaring here as well would stack two effects on one frame.
	 */
	chapterCards?: boolean;
}> = ({scenes, tone, chapterCards = true}) => {
	const frame = useCurrentFrame();
	const {fps} = useVideoConfig();
	const t = frame / fps;

	const k = toneKey(tone);
	const dark = /dark|horror|conspiracy|mystery/.test(k);
	const chapterLeakHalf = dark ? 0.42 : 0.38;

	let leak: {amount: number; sweep: number} | null = null;
	for (let i = 1; i < scenes.length; i++) {
		// The footage owns an ordinary cut: it changes picture there by itself.
		if ((scenes[i].chapter ?? 0) === (scenes[i - 1].chapter ?? 0)) continue;
		if (chapterCards) continue; // the card owns this frame
		const boundary = scenes[i].startSeconds;
		const d = Math.abs(t - boundary);
		if (d >= chapterLeakHalf) continue;
		// The window is placed so the envelope's PEAK lands on the boundary,
		// not so the window is centred on it. Those are different: the attack
		// is only 28% of the envelope, so a centred window flashed brightest
		// well before the cut it exists to hide. Same correction the chapter
		// card needed — see CARD_FLASH_LEAD.
		const span = 2 * chapterLeakHalf;
		const p = (t - (boundary - FLASH_PEAK * span)) / span;
		const amount = flashEnvelope(p);
		if (!leak || amount > leak.amount) leak = {amount, sweep: p};
	}

	if (!leak) return null;
	return (
		<AbsoluteFill style={{pointerEvents: 'none'}}>
			<LightLeak
				amount={leak.amount}
				sweep={flashSweep(leak.sweep)}
				hue={dark ? 'cool' : 'warm'}
			/>
		</AbsoluteFill>
	);
};

/**
 * The flare that owns ONE cut, given the second it lands on.
 *
 * The chapter card carries its own entrance and exit leak inside ImpactCard,
 * and a chapter boundary with cards off is covered by the component above.
 * The third kind of cut had nothing: a motif or text card replaces the picture
 * outright, twice — once when it takes the frame and once when it gives it
 * back — and both cuts played naked, which is what the producer saw and called
 * a missing transition. The card's own 0.22s opacity fade is not a transition;
 * it is a dissolve between two unrelated pictures, which is the one thing a
 * cut should never look like.
 *
 * `half` is deliberately shorter than the chapter boundary's 0.38-0.42: a card
 * runs two and a half to four seconds, and a flare that burns for three
 * quarters of a second at each end would be lit for half of it.
 */
export const CutFlash: React.FC<{
	/** The second the picture is replaced. The envelope PEAKS here. */
	at: number;
	tone: string;
	/** The cut back OUT of the card; sweeps the other way so the two flares do
	 *  not read as one object passing twice — same rule as ImpactCard. */
	outgoing?: boolean;
	half?: number;
}> = ({at, tone, outgoing = false, half = 0.3}) => {
	const frame = useCurrentFrame();
	const {fps} = useVideoConfig();
	const t = frame / fps;
	const span = 2 * half;
	// Placed so the PEAK lands on `at`, not so the window is centred on it —
	// the attack is 28% of the envelope, so a centred window would flash
	// brightest well before the frame it exists to hide.
	const p = (t - (at - FLASH_PEAK * span)) / span;
	if (p <= 0 || p >= 1) return null;
	const amount = flashEnvelope(p);
	if (amount <= 0.001) return null;
	const dark = /dark|horror|conspiracy|mystery/.test(toneKey(tone));
	return (
		<AbsoluteFill style={{pointerEvents: 'none'}}>
			<LightLeak
				amount={amount}
				sweep={outgoing ? 1 - flashSweep(p) : flashSweep(p)}
				hue={dark ? 'cool' : 'warm'}
			/>
		</AbsoluteFill>
	);
};

/**
 * Ken Burns on the continuous footage: slow push-in with alternating drift
 * per scene. The transform snaps at scene boundaries, and the snap is hidden
 * by the boundary itself: the footage cuts to a different picture on the same
 * frame, so there is no continuity for the eye to measure the jump against.
 * (Only a fallback now — `planMontage` returns a shot for every scene.)
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
