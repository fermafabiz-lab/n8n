/**
 * The slice of Remotion's API that FinalVideo uses, re-implemented so the SAME
 * components can be drawn by Hyperframes instead.
 *
 * `hf/build.mjs` aliases the module name `remotion` to this file when it
 * bundles the Hyperframes page, so not one component changes to run on the
 * other engine: every timing lesson in docs/lessons-render.md stays where it
 * was learned. The Remotion bundle (src/index.ts) never sees this file.
 *
 * What is here is exactly what `grep "from 'remotion'" src` asks for, and each
 * piece copies Remotion's BEHAVIOUR, measured against the real package by
 * scripts/check-shim.mjs — not its code:
 *   AbsoluteFill, Sequence, useCurrentFrame, useVideoConfig,
 *   interpolate, Easing.bezier, spring, staticFile,
 *   OffthreadVideo / Video, delayRender / continueRender,
 *   getRemotionEnvironment.
 * Anything else a component starts importing fails the bundle loudly, which
 * is the point: a new API is a new thing to verify, not a silent no-op.
 */
import React, {createContext, useContext, useLayoutEffect, useRef} from 'react';

// ── Timeline ────────────────────────────────────────────────────────────────

export type VideoConfig = {
	id: string;
	fps: number;
	width: number;
	height: number;
	durationInFrames: number;
};

type Timeline = {frame: number; config: VideoConfig};
type SequenceCtx = {cumulatedFrom: number; relativeFrom: number; durationInFrames: number};

const TimelineContext = createContext<Timeline | null>(null);
const SequenceContext = createContext<SequenceCtx | null>(null);

/** The root the Hyperframes page renders every frame through. */
export const TimelineProvider: React.FC<{
	frame: number;
	config: VideoConfig;
	children: React.ReactNode;
}> = ({frame, config, children}) => (
	<TimelineContext.Provider value={{frame, config}}>{children}</TimelineContext.Provider>
);

const useTimeline = (): Timeline => {
	const t = useContext(TimelineContext);
	if (!t) throw new Error('remotion-shim: hook called outside the Hyperframes timeline');
	return t;
};

/** Relative to the enclosing Sequences, as in Remotion. */
export const useCurrentFrame = (): number => {
	const {frame} = useTimeline();
	const seq = useContext(SequenceContext);
	return seq ? frame - (seq.cumulatedFrom + seq.relativeFrom) : frame;
};

/** Inside a Sequence, `durationInFrames` is the Sequence's, as in Remotion. */
export const useVideoConfig = (): VideoConfig => {
	const {config} = useTimeline();
	const seq = useContext(SequenceContext);
	return seq ? {...config, durationInFrames: seq.durationInFrames} : config;
};

export const getRemotionEnvironment = () => ({
	isRendering: true,
	isStudio: false,
	isPlayer: false,
	isReadOnlyStudio: false,
	isClientSideRendering: false,
});

// ── Layout ──────────────────────────────────────────────────────────────────

const ABSOLUTE_FILL: React.CSSProperties = {
	position: 'absolute',
	top: 0,
	left: 0,
	right: 0,
	bottom: 0,
	width: '100%',
	height: '100%',
	display: 'flex',
	flexDirection: 'column',
};

export const AbsoluteFill = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
	({style, ...rest}, ref) => <div ref={ref} style={{...ABSOLUTE_FILL, ...style}} {...rest} />,
);
AbsoluteFill.displayName = 'AbsoluteFill';

/**
 * Time-shifts its children and shows them only inside
 * `[from, ceil(from + durationInFrames - 1)]` of its parent's clock — the
 * same window Remotion computes, ceil included (it exists for float
 * durations). The wrapper is an AbsoluteFill whose flexDirection is reset to
 * the CSS default, which is what Remotion's Sequence does; a card laid out
 * under the column default would sit differently.
 */
export const Sequence: React.FC<{
	from?: number;
	durationInFrames?: number;
	layout?: 'absolute-fill' | 'none';
	style?: React.CSSProperties;
	name?: string;
	children?: React.ReactNode;
}> = ({from = 0, durationInFrames = Infinity, layout = 'absolute-fill', style, children}) => {
	const {frame, config} = useTimeline();
	const parent = useContext(SequenceContext);
	const cumulatedFrom = parent ? parent.cumulatedFrom + parent.relativeFrom : 0;
	const parentDuration = parent ? Math.min(parent.durationInFrames - from, durationInFrames) : durationInFrames;
	const actualDuration = Math.max(0, Math.min(config.durationInFrames - from, parentDuration));

	const endThreshold = Math.ceil(cumulatedFrom + from + durationInFrames - 1);
	if (frame < cumulatedFrom + from || frame > endThreshold) return null;

	const ctx: SequenceCtx = {cumulatedFrom, relativeFrom: from, durationInFrames: actualDuration};
	return (
		<SequenceContext.Provider value={ctx}>
			{layout === 'none' ? (
				children
			) : (
				<AbsoluteFill style={{flexDirection: undefined, ...style}}>{children}</AbsoluteFill>
			)}
		</SequenceContext.Provider>
	);
};

// ── Maths ───────────────────────────────────────────────────────────────────

type Extrapolate = 'extend' | 'clamp' | 'identity';

/**
 * Numeric interpolate: piecewise-linear over a strictly increasing input
 * range, the easing applied to each segment's own 0..1 progress, and
 * `extend` by default at both ends. That is the whole of what our components
 * ask of it (numbers only — no colour or transform strings).
 */
export const interpolate = (
	input: number,
	inputRange: readonly number[],
	outputRange: readonly number[],
	options: {
		easing?: (t: number) => number;
		extrapolateLeft?: Extrapolate;
		extrapolateRight?: Extrapolate;
	} = {},
): number => {
	if (inputRange.length !== outputRange.length || inputRange.length < 2) {
		throw new Error('interpolate: inputRange and outputRange must have the same length, at least 2');
	}
	for (let i = 1; i < inputRange.length; i++) {
		if (!(inputRange[i] > inputRange[i - 1])) {
			throw new Error(`interpolate: inputRange must be strictly increasing, got [${inputRange.join(',')}]`);
		}
	}
	const easing = options.easing ?? ((t: number) => t);
	const left = options.extrapolateLeft ?? 'extend';
	const right = options.extrapolateRight ?? 'extend';

	let seg = 1;
	while (seg < inputRange.length - 1 && input > inputRange[seg]) seg++;
	const inMin = inputRange[seg - 1];
	const inMax = inputRange[seg];
	const outMin = outputRange[seg - 1];
	const outMax = outputRange[seg];

	let x = input;
	if (x < inMin) {
		if (left === 'identity') return x;
		if (left === 'clamp') x = inMin;
	}
	if (x > inMax) {
		if (right === 'identity') return x;
		if (right === 'clamp') x = inMax;
	}
	if (outMin === outMax) return outMin;
	const progress = easing((x - inMin) / (inMax - inMin));
	const result = outMin + progress * (outMax - outMin);
	return Object.is(result, -0) ? 0 : result;
};

/**
 * CSS cubic-bezier easing: solve x(t) = input for t (Newton, falling back to
 * bisection where the slope is too flat), return y(t). The end points are
 * returned exactly, so a clamped ramp lands on its target and not 1e-9 short.
 */
const bezier = (x1: number, y1: number, x2: number, y2: number) => {
	const a = (p1: number, p2: number) => 1 - 3 * p2 + 3 * p1;
	const b = (p1: number, p2: number) => 3 * p2 - 6 * p1;
	const c = (p1: number) => 3 * p1;
	const at = (t: number, p1: number, p2: number) => ((a(p1, p2) * t + b(p1, p2)) * t + c(p1)) * t;
	const slope = (t: number, p1: number, p2: number) => 3 * a(p1, p2) * t * t + 2 * b(p1, p2) * t + c(p1);

	const tForX = (x: number) => {
		let t = x;
		for (let i = 0; i < 8; i++) {
			const s = slope(t, x1, x2);
			if (Math.abs(s) < 1e-7) break;
			const err = at(t, x1, x2) - x;
			if (Math.abs(err) < 1e-9) return t;
			t -= err / s;
		}
		let lo = 0;
		let hi = 1;
		t = x;
		for (let i = 0; i < 60; i++) {
			const v = at(t, x1, x2);
			if (Math.abs(v - x) < 1e-9) break;
			if (v < x) lo = t;
			else hi = t;
			t = (lo + hi) / 2;
		}
		return t;
	};

	return (x: number): number => {
		if (x1 === y1 && x2 === y2) return x;
		if (x <= 0) return 0;
		if (x >= 1) return 1;
		return at(tForX(x), y1, y2);
	};
};

export const Easing = {bezier};

/**
 * Damped spring from 0 to 1, stepped one frame at a time the way Remotion
 * steps it (each frame advances the closed-form oscillator by 1/fps), so the
 * subscribe pill's overshoot lands on the same frames. Only the call shape
 * our components use: `{frame, fps, config: {damping, stiffness, mass}}`.
 */
export const spring = ({
	frame,
	fps,
	config = {},
}: {
	frame: number;
	fps: number;
	config?: {damping?: number; mass?: number; stiffness?: number; overshootClamping?: boolean};
}): number => {
	const c = config.damping ?? 10;
	const m = config.mass ?? 1;
	const k = config.stiffness ?? 100;
	if (c <= 0) throw new Error('spring: damping must be greater than 0');
	const zeta = c / (2 * Math.sqrt(k * m));
	const omega0 = Math.sqrt(k / m);
	const omega1 = omega0 * Math.sqrt(1 - zeta ** 2);

	let current = 0;
	let velocity = 0;
	let last = 0;
	const f = Math.max(0, frame);
	const whole = Math.floor(f);
	for (let i = 0; i <= whole; i++) {
		const step = i === whole ? i + (f % 1) : i;
		const now = (step / fps) * 1000;
		const t = Math.min(now - last, 64) / 1000;
		const x0 = 1 - current;
		const v0 = -velocity;
		if (zeta < 1) {
			const env = Math.exp(-zeta * omega0 * t);
			const sin1 = Math.sin(omega1 * t);
			const cos1 = Math.cos(omega1 * t);
			const frag = env * (sin1 * ((v0 + zeta * omega0 * x0) / omega1) + x0 * cos1);
			current = 1 - frag;
			velocity = zeta * omega0 * frag - env * (cos1 * (v0 + zeta * omega0 * x0) - omega1 * x0 * sin1);
		} else {
			const env = Math.exp(-omega0 * t);
			current = 1 - env * (x0 + (v0 + omega0 * x0) * t);
			velocity = env * (v0 * (t * omega0 - 1) + t * x0 * omega0 * omega0);
		}
		last = now;
	}
	return config.overshootClamping ? Math.min(current, 1) : current;
};

// ── Assets ──────────────────────────────────────────────────────────────────

/** The page is served from the job directory, so a public file is a sibling. */
export const staticFile = (path: string): string => path.replace(/^\/+/, '');

// ── Render holds ────────────────────────────────────────────────────────────

/**
 * `delayRender` holds the frame until `continueRender`; the page's seek
 * handler (hf/entry.tsx) waits on `whenSettled()` before Hyperframes captures.
 * The page renders React in legacy (synchronous) mode, so a setState made
 * just before `continueRender` is already in the DOM when the hold lifts.
 */
const holds = new Map<number, string>();
let nextHold = 1;
let waiters: Array<() => void> = [];

export const delayRender = (label = 'delayRender'): number => {
	const handle = nextHold++;
	holds.set(handle, label);
	return handle;
};

export const continueRender = (handle: number): void => {
	holds.delete(handle);
	if (holds.size === 0) {
		const w = waiters;
		waiters = [];
		w.forEach((resolve) => resolve());
	}
};

export const whenSettled = (timeoutMs: number): Promise<void> => {
	if (holds.size === 0) return Promise.resolve();
	return new Promise((resolve, reject) => {
		const timer = setTimeout(
			() => reject(new Error(`delayRender not released in ${timeoutMs}ms: ${[...holds.values()].join(', ')}`)),
			timeoutMs,
		);
		waiters.push(() => {
			clearTimeout(timer);
			resolve();
		});
	});
};

// ── Video ───────────────────────────────────────────────────────────────────

/**
 * Hyperframes finds the videos it must decode by reading the page's HTML
 * BEFORE any script runs, so the montage cannot be created by React. The
 * job's index.html declares it once (`<video id="hov-montage">`, timed by
 * data-start / data-duration) and this component adopts that element into
 * wherever FinalVideo put it — inside the framing transform and the grade —
 * so the picture moves exactly as the Remotion one did.
 *
 * The size is the Remotion one too: OffthreadVideo draws an <img> with
 * `object-fit: contain`, at the canvas's size because the montage is always
 * encoded at the canvas's aspect.
 */
export const MONTAGE_ELEMENT_ID = 'hov-montage';

const AdoptedVideo: React.FC<{src: string; style?: React.CSSProperties}> = ({style}) => {
	const slot = useRef<HTMLDivElement>(null);
	useLayoutEffect(() => {
		const el = document.getElementById(MONTAGE_ELEMENT_ID);
		if (!el) throw new Error(`remotion-shim: the page has no <video id="${MONTAGE_ELEMENT_ID}">`);
		const home = el.parentElement;
		if (slot.current && home !== slot.current) slot.current.appendChild(el);
		// Hand it back on unmount. The footage Sequence ends where the end
		// screen starts, and Hyperframes seeks frames in any order (and each
		// worker is its own page), so a later seek back into the film must
		// find the element in the document again, not detached with a dead
		// slot.
		return () => {
			if (home && el.parentElement !== home) home.appendChild(el);
		};
	}, []);
	return <div ref={slot} style={{position: 'relative', width: '100%', height: '100%', ...style}} />;
};

export const OffthreadVideo = AdoptedVideo;
export const Video = AdoptedVideo;
