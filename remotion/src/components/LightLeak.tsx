import React from 'react';
import {AbsoluteFill, useVideoConfig} from 'remotion';
import {CURVES, curveAt} from '../easing';

/**
 * Additive warm light leak — the transition that replaced the chapter card's
 * horizontal slide.
 *
 * A slide is a move, and a move is exactly what tells the viewer "a graphic
 * just arrived". A leak instead overexposes the frame for a fraction of a
 * second, and the change happens *inside* the flash, where the eye cannot
 * resolve it. That is why it reads as photographed rather than composited.
 *
 * The component owns no timing: the caller passes an envelope, so the same
 * leak serves the card's entrance, its exit, and a chapter boundary that has
 * no card at all.
 */

/**
 * Where in the envelope the flash peaks — the moment at which whatever sits
 * under the leak can be swapped invisibly.
 */
export const FLASH_PEAK = 0.28;

/** How long a full-frame card's entrance or exit flare burns. */
export const FLASH_IN = 0.55;

/**
 * Time from the start of a flash to its peak, and the amount by which a card's
 * whole window must be placed EARLIER than the moment it replaces.
 *
 * A flash exists to hide a change, so its brightest instant has to sit ON the
 * change, not after it. A Sequence that begins at the change can only begin
 * flashing there — so the cut plays completely naked and the light arrives a
 * fifth of a second late, over a picture that has already changed. Leading by
 * exactly this much puts the peak and the swap on the same frame.
 *
 * Lives here rather than on either card because both use it and they must not
 * drift apart.
 */
export const FLASH_LEAD = FLASH_IN * FLASH_PEAK;

/**
 * Asymmetric envelope: fast attack, slow decay.
 *
 * This asymmetry is the whole effect. A symmetric ramp reads as a
 * cross-dissolve; light behaves as a sudden bloom that falls away, and the
 * 28/72 split is what the eye accepts as a real flare passing the lens.
 */
export const flashEnvelope = (p: number, attack: number = FLASH_PEAK): number => {
	if (p <= 0 || p >= 1) return 0;
	return p < attack
		? curveAt(p / attack, CURVES.outExpo)
		: 1 - curveAt((p - attack) / (1 - attack), CURVES.inOutCubic);
};

/**
 * Where the flare sits at progress `p`, as the 0..1 the `sweep` prop wants.
 *
 * Intensity is only half of how bright the frame looks — the other half is
 * whether the bright part of the flare is ON it. Swept by a plain eased ramp,
 * the flare was still at -3% of frame width when the envelope peaked, so the
 * brightest thing on screen arrived two to three frames after the moment the
 * swap was timed to, and the cut it was hiding showed at its edge. Measured, on
 * a real render: peak intensity at frame 230, peak luminance at 232-233.
 *
 * So the sweep is bent to reach frame CENTRE exactly at `attack`, and to finish
 * its exit during the long decay. Same physical story — a flare crossing the
 * lens — with its brightest instant on the frame that matters.
 */
export const flashSweep = (p: number, attack: number = FLASH_PEAK): number =>
	p < attack
		? 0.5 * curveAt(p / attack, CURVES.inOutCubic)
		: 0.5 + 0.5 * curveAt((p - attack) / (1 - attack), CURVES.inOutCubic);

export const LightLeak: React.FC<{
	/** Envelope value, 0..1 — see flashEnvelope. */
	amount: number;
	/** Sweep position, 0..1: the flare travels across frame as it burns. */
	sweep: number;
	/** Warm reads as sunlight through a lens; cool suits cold-graded tones. */
	hue?: 'warm' | 'cool';
}> = ({amount, sweep, hue = 'warm'}) => {
	const {width} = useVideoConfig();
	// Same canvas-relative scaling as the other overlays: sizes are tuned on
	// the 1280-wide landscape canvas, and the vertical one is 720 wide.
	const px = (n: number) => n * (width / 1280);
	const a = Math.min(1, Math.max(0, amount));
	// Below this the layers cost a composite and contribute nothing visible.
	if (a <= 0.004) return null;

	// -20..120 so the flare enters and leaves fully off-frame instead of
	// popping into existence at the edge.
	const x = -20 + sweep * 140;
	const core = hue === 'warm' ? '255,226,178' : '206,230,255';
	const edge = hue === 'warm' ? '255,150,64' : '96,164,255';

	// 'screen' goes on each layer, never on the wrapper: a blend mode set on
	// the parent composites the whole GROUP against the footage, so the layers
	// would blend with each other first and most of the light is lost.
	const screen = {mixBlendMode: 'screen' as const};

	return (
		<AbsoluteFill style={{pointerEvents: 'none'}}>
			{/* The body of the flare: a soft off-axis bloom. */}
			<AbsoluteFill
				style={{
					...screen,
					background: `radial-gradient(ellipse 62% 118% at ${x.toFixed(1)}% 44%, rgba(${core},${(0.92 * a).toFixed(3)}) 0%, rgba(${edge},${(0.46 * a).toFixed(3)}) 38%, rgba(${edge},0) 72%)`,
				}}
			/>
			{/* The streak — a hard highlight the bloom alone doesn't give. */}
			<AbsoluteFill
				style={{
					...screen,
					background: `linear-gradient(101deg, rgba(255,244,214,0) ${(x - 15).toFixed(1)}%, rgba(255,244,214,${(0.7 * a).toFixed(3)}) ${x.toFixed(1)}%, rgba(255,244,214,0) ${(x + 13).toFixed(1)}%)`,
					filter: `blur(${px(26)}px)`,
				}}
			/>
			{/* Global exposure lift. Without it the flare sits ON the picture
			    instead of overexposing it, and the swap underneath shows. */}
			<AbsoluteFill
				style={{...screen, background: `rgba(${core},${(0.32 * a).toFixed(3)})`}}
			/>
		</AbsoluteFill>
	);
};
