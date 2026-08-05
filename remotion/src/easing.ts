import {Easing, interpolate} from 'remotion';

/**
 * The project's easing vocabulary.
 *
 * Nothing that moves should be linear. Every ramp in the first version of
 * these components was a raw `interpolate` — the card slid at constant speed,
 * the hook faded at constant speed, the transition dip was a triangle — and
 * constant speed is the single clearest tell that a graphic was generated
 * rather than designed. Motion in the real world accelerates and settles.
 *
 * Three curves cover everything here. Pick by intent, so two components
 * animating the same kind of thing agree instead of each inventing a feel.
 */
export const CURVES = {
	/** Entrances and reveals: leaves fast, lands soft. The default. */
	outExpo: Easing.bezier(0.16, 1, 0.3, 1),
	/** Small settles — a slow drift, a rule drawing itself. Gentler than outExpo. */
	outQuart: Easing.bezier(0.25, 1, 0.5, 1),
	/** Things that need symmetry: fades out, luminance dips, sweeps. */
	inOutCubic: Easing.bezier(0.65, 0, 0.35, 1),
} as const;

export type Curve = (input: number) => number;

/**
 * Clamped, eased interpolate — what essentially every call site wants.
 * The clamp matters as much as the curve: an unclamped ramp keeps
 * extrapolating past its range, which is how a fade-out ends up at negative
 * opacity and a drift keeps drifting after it should have settled.
 */
export const eased = (
	input: number,
	inputRange: readonly [number, number],
	outputRange: readonly [number, number],
	curve: Curve = CURVES.outExpo,
): number =>
	interpolate(
		input,
		inputRange as [number, number],
		outputRange as [number, number],
		{easing: curve, extrapolateLeft: 'clamp', extrapolateRight: 'clamp'},
	);

/** Shape a raw 0..1 progress with a curve, clamped at both ends. */
export const curveAt = (p: number, curve: Curve = CURVES.outExpo): number =>
	curve(Math.min(1, Math.max(0, p)));
