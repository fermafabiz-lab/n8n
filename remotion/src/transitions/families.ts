/**
 * Transition families: HOW one picture hands over to the next at a planned
 * cut. Chosen per film by theme, one family per film (the producer,
 * 2026-09-24), from the Hyperframes catalog blocks picked in the sampler:
 *
 *   push       Push Slide [push 01] and Vertical Push [push 02]
 *   crossfade  Crossfade [dissolve 01]
 *   blur       Blur Through [blur 01] and Directional Blur [blur 02]
 *   shutter    Shutter [mechanical 01]
 *   glitch     Glitch [distortion 01] and Ripple [distortion 03]
 *
 * A family with two variants alternates them cut by cut, so a film reads as
 * one hand without repeating the same move every time.
 *
 * Every variant is a pure function of the time since its window opened, with
 * the block's own durations and eases. The window is placed so the PICTURE
 * cut lands where the block swaps its scenes (`cutAt`): before it the live
 * footage is the outgoing shot and a still of the first incoming frame plays
 * the incoming one; after it, the other way round. Nothing about the montage
 * moves, so the sound, the captions and every scene start stay exactly true.
 */

export type TransitionStyleId = 'none' | 'push' | 'crossfade' | 'blur' | 'shutter' | 'glitch';
export const TRANSITION_STYLES: TransitionStyleId[] = ['none', 'push', 'crossfade', 'blur', 'shutter', 'glitch'];

export type VariantId = 'pushLeft' | 'pushUp' | 'crossfade' | 'blurThrough' | 'blurDirectional' | 'shutter' | 'glitch' | 'ripple';

export const VARIANTS: Record<Exclude<TransitionStyleId, 'none'>, VariantId[]> = {
	push: ['pushLeft', 'pushUp'],
	crossfade: ['crossfade'],
	blur: ['blurThrough', 'blurDirectional'],
	shutter: ['shutter'],
	glitch: ['glitch', 'ripple'],
};

/** Unknown or absent → none: a typo must never add movement to a film. */
export const transitionStyleFor = (id?: string | null): TransitionStyleId =>
	TRANSITION_STYLES.includes(String(id ?? '') as TransitionStyleId) ? (id as TransitionStyleId) : 'none';

const c = (t: number) => Math.min(1, Math.max(0, t));
const p2in = (t: number) => c(t) ** 2;
const p2out = (t: number) => 1 - (1 - c(t)) ** 2;
const p2io = (t: number) => (c(t) < 0.5 ? 2 * c(t) ** 2 : 1 - (-2 * c(t) + 2) ** 2 / 2);
const p3in = (t: number) => c(t) ** 3;
const p3out = (t: number) => 1 - (1 - c(t)) ** 3;
const p3io = (t: number) => (c(t) < 0.5 ? 4 * c(t) ** 3 : 1 - (-2 * c(t) + 2) ** 3 / 2);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** What one picture layer looks like at an instant. */
export type LayerLook = {x?: number; y?: number; scale?: number; skewX?: number; blur?: number; opacity?: number};

export type Frame = {
	out: LayerLook;
	in: LayerLook;
	/** Shutter: how far each half has closed, 0 open … 1 shut. */
	shutter?: number;
	/** Glitch: the two tinted copies of the outgoing still, offset in px. */
	glitch?: {r: [number, number]; b: [number, number]} | null;
};

export type Variant = {
	/** Window length, seconds. */
	length: number;
	/** Where in the window the picture cuts, seconds from its start. */
	cutAt: number;
	/** Whether the variant draws the stills at all (the shutter does not). */
	stills: boolean;
	frame: (tau: number, W: number, H: number) => Frame;
};

/** Stepped keyframes, linear between them — the ripple's 0.04 s jolts. */
const steps = (tau: number, keys: [number, number][]): number => {
	if (tau <= keys[0][0]) return keys[0][1];
	for (let i = 1; i < keys.length; i++) {
		if (tau <= keys[i][0]) {
			const [t0, v0] = keys[i - 1];
			const [t1, v1] = keys[i];
			return lerp(v0, v1, (tau - t0) / (t1 - t0));
		}
	}
	return keys[keys.length - 1][1];
};

export const VARIANT: Record<VariantId, Variant> = {
	// push 01: both 0.5 s, power3.inOut, the whole frame's width.
	pushLeft: {
		length: 0.5,
		cutAt: 0.25,
		stills: true,
		frame: (tau, W) => {
			const e = p3io(tau / 0.5);
			return {out: {x: -W * e}, in: {x: W * (1 - e)}};
		},
	},
	// push 02: the same, vertically.
	pushUp: {
		length: 0.5,
		cutAt: 0.25,
		stills: true,
		frame: (tau, _W, H) => {
			const e = p3io(tau / 0.5);
			return {out: {y: -H * e}, in: {y: H * (1 - e)}};
		},
	},
	// dissolve 01: out fades 1→0 while in fades 0→1, 0.5 s power2.inOut.
	crossfade: {
		length: 0.5,
		cutAt: 0.25,
		stills: true,
		frame: (tau) => {
			const e = p2io(tau / 0.5);
			return {out: {opacity: 1 - e}, in: {opacity: e}};
		},
	},
	// blur 01: out blurs to 15px, grows 5% and fades (power2.in); in arrives
	// from 15px and 95% (power2.out); both 0.4 s.
	blurThrough: {
		length: 0.4,
		cutAt: 0.2,
		stills: true,
		frame: (tau) => {
			const o = p2in(tau / 0.4);
			const i = p2out(tau / 0.4);
			return {
				out: {blur: 15 * o, scale: 1 + 0.05 * o, opacity: 1 - o},
				in: {blur: 15 * (1 - i), scale: 0.95 + 0.05 * i, opacity: i},
			};
		},
	},
	// blur 02: out smears left (blur 12, skew -8°, -200px, power3.in, 0.4 s);
	// in follows 0.15 s later from the right (power3.out, 0.4 s). The block's
	// 200px are on a 1920 frame, so they scale with the canvas.
	blurDirectional: {
		length: 0.55,
		cutAt: 0.275,
		stills: true,
		frame: (tau, W) => {
			const k = W / 1920;
			const o = p3in(tau / 0.4);
			const i = p3out((tau - 0.15) / 0.4);
			return {
				out: {blur: 12 * o, skewX: -8 * o, x: -200 * k * o, opacity: 1 - o},
				in: {blur: 12 * (1 - i), skewX: 8 * (1 - i), x: 200 * k * (1 - i), opacity: i},
			};
		},
	},
	// mechanical 01: two halves close in 0.25 s (power3.in), the picture
	// swaps behind them, they open from 0.3 s to 0.55 s (power3.out).
	shutter: {
		length: 0.55,
		cutAt: 0.275,
		stills: false,
		frame: (tau) => ({
			out: {},
			in: {},
			shutter: tau < 0.25 ? p3in(tau / 0.25) : tau < 0.3 ? 1 : 1 - p3out((tau - 0.3) / 0.25),
		}),
	},
	// distortion 01: four jolts of a red and a blue copy with the picture
	// shaking under them, then the swap and a clean frame. The block steps
	// every 0.03 s; at 24 fps that is one step a frame, so the window is four
	// frames of jolts and one after.
	glitch: {
		length: 5 / 24,
		cutAt: 4 / 24,
		stills: true,
		frame: (tau, W, H) => {
			// Scaled by the LONG side: on a 720-wide vertical frame the block's
			// 1920-based jolts shrank to a few pixels and read as nothing.
			const k = Math.max(W, H) / 1920;
			const f = Math.floor(tau * 24 + 1e-6);
			const R: [number, number][] = [[40, -8], [-30, 15], [60, -20], [-20, 5]];
			const B: [number, number][] = [[-30, 12], [50, -10], [-40, 8], [35, -15]];
			const X = [-15, 20, -25, 0];
			// The swap is a hard one: the incoming picture is not there at all
			// before it, and the outgoing one is gone after it.
			if (f >= 4) return {out: {opacity: 0}, in: {}, glitch: null};
			return {
				out: {x: X[f] * k},
				in: {opacity: 0},
				glitch: {r: [R[f][0] * k, R[f][1] * k], b: [B[f][0] * k, B[f][1] * k]},
			};
		},
	},
	// distortion 03: the picture shudders (±30px, scale ±2%, blur to 10px)
	// in 0.04 s steps and drops out at 0.16 s; the next one settles in from
	// -15px, 102%, 8px blur over 0.2 s (power2.out).
	ripple: {
		length: 0.36,
		cutAt: 0.16,
		stills: true,
		frame: (tau, W) => {
			const k = W / 1920;
			if (tau < 0.16) {
				return {
					out: {
						x: steps(tau, [[0, 0], [0.04, 30], [0.08, -25], [0.12, 20], [0.16, 10]]) * k,
						scale: steps(tau, [[0, 1], [0.04, 1.02], [0.08, 0.98], [0.12, 1.01], [0.16, 0.99]]),
						blur: steps(tau, [[0, 0], [0.04, 0], [0.08, 4], [0.12, 6], [0.16, 10]]),
						opacity: steps(tau, [[0, 1], [0.12, 1], [0.16, 0]]),
					},
					in: {opacity: 0},
				};
			}
			const e = p2out((tau - 0.16) / 0.2);
			return {out: {opacity: 0}, in: {x: -15 * k * (1 - e), scale: 1.02 - 0.02 * e, blur: 8 * (1 - e)}};
		},
	},
};

/** CSS for a layer look. Transforms compose onto whatever framing is inside. */
export const lookStyle = (l: LayerLook): {transform?: string; filter?: string; opacity?: number} => {
	const t: string[] = [];
	if (l.x || l.y) t.push(`translate(${(l.x ?? 0).toFixed(2)}px, ${(l.y ?? 0).toFixed(2)}px)`);
	if (l.skewX) t.push(`skewX(${l.skewX.toFixed(3)}deg)`);
	if (l.scale !== undefined && l.scale !== 1) t.push(`scale(${l.scale.toFixed(4)})`);
	return {
		...(t.length ? {transform: t.join(' ')} : {}),
		...(l.blur && l.blur > 0.05 ? {filter: `blur(${l.blur.toFixed(2)}px)`} : {}),
		...(l.opacity !== undefined && l.opacity < 1 ? {opacity: Math.max(0, l.opacity)} : {}),
	};
};
