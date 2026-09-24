/**
 * The GSAP eases the catalog blocks were authored with, as plain functions of
 * progress, so the ported elements move exactly like the sampler the producer
 * chose from. Every one is clamped to [0, 1] and none is linear.
 */
const c = (t: number) => Math.min(1, Math.max(0, t));
export const power2In = (t: number) => c(t) ** 2;
export const power2Out = (t: number) => 1 - (1 - c(t)) ** 2;
export const power3Out = (t: number) => 1 - (1 - c(t)) ** 3;
export const power4Out = (t: number) => 1 - (1 - c(t)) ** 4;
export const power4In = (t: number) => c(t) ** 4;
export const backOut = (s: number) => (t: number) => {
	const p = c(t) - 1;
	return 1 + (s + 1) * p ** 3 + s * p ** 2;
};

/** Progress of a tween that starts at `start` and lasts `dur`, at time `t`. */
export const prog = (t: number, start: number, dur: number) => (t - start) / dur;
