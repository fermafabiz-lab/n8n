import React, {useLayoutEffect, useRef} from 'react';
import {AbsoluteFill, continueRender, delayRender, useCurrentFrame, useVideoConfig} from 'remotion';
import {GF} from './fonts';
import {backOut, power2In, power2Out, power3Out, prog} from './ease';

/**
 * The Kids story graphics, ported from the Hyperframes catalog blocks the
 * producer chose (remotion/out/sampler/kids-reel.mp4, 2026-09-25):
 *
 *   01 hw-title        → KidsTitle      chapter title, highlight sweep + squiggle
 *   02 hw-text-cloud   → SpeechBubble   a line said, in a cloud near the speaker
 *   03 hw-frame        → CharacterCard  a character's still in a drawn frame
 *   04 hw-box-label    → NameCircle     a wobbly contour round a character + name
 *   05 spring-pop      → Sticker        a badge that pops on a moment
 *   06 confetti        → Confetti       a burst on the happy ending
 *
 * The blocks draw with seeded wobble and a "boil" (the line jitters a little
 * every third frame, as a hand-drawn cel does). Both are kept, and both are
 * pure functions of the frame so any frame renders the same on any worker.
 */

const useClock = () => {
	const frame = useCurrentFrame();
	const {fps, width, height, durationInFrames} = useVideoConfig();
	return {frame, t: frame / fps, dur: durationInFrames / fps, width, height, s: Math.min(width, height) / 1080, fps};
};

/** Deterministic noise in [-1, 1]. */
const hash = (n: number, seed = 1) => {
	const x = Math.sin(n * 127.1 + seed * 311.7) * 43758.5453;
	return (x - Math.floor(x)) * 2 - 1;
};

/** The boil: a small jitter that changes every third frame. */
const boil = (frame: number, seed: number, amp: number, rot: number) => {
	const k = Math.floor(frame / 3);
	return `translate(${(hash(k, seed) * amp).toFixed(2)}px, ${(hash(k + 50, seed) * amp).toFixed(2)}px) rotate(${(hash(k + 90, seed) * rot).toFixed(3)}deg)`;
};

/** A closed wobbly loop through points on an ellipse-ish rounded rectangle. */
const wobblyLoop = (w: number, h: number, r: number, seed: number, amp: number, n = 36): string => {
	const pts: [number, number][] = [];
	for (let i = 0; i < n; i++) {
		const a = (i / n) * Math.PI * 2;
		// A superellipse with exponent from the corner radius: square-ish for a
		// box, round for a cloud.
		const e = 2 / Math.max(0.3, r);
		const c = Math.cos(a), sn = Math.sin(a);
		const x = Math.sign(c) * Math.abs(c) ** e * (w / 2);
		const y = Math.sign(sn) * Math.abs(sn) ** e * (h / 2);
		pts.push([w / 2 + x + hash(i, seed) * amp, h / 2 + y + hash(i + 17, seed) * amp]);
	}
	// Catmull-Rom → cubic Bézier through the points, closed.
	let d = `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
	for (let i = 0; i < n; i++) {
		const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
		const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
		const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
		d += ` C ${c1[0].toFixed(1)} ${c1[1].toFixed(1)}, ${c2[0].toFixed(1)} ${c2[1].toFixed(1)}, ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
	}
	return d + ' Z';
};

/** An image held until decoded, so no frame shows an empty frame (the same
 *  hold the transition stills use). */
const HeldImg: React.FC<{src: string; style: React.CSSProperties}> = ({src, style}) => {
	const ref = useRef<HTMLImageElement>(null);
	useLayoutEffect(() => {
		const img = ref.current;
		if (!img || (img.complete && img.naturalWidth > 0)) return;
		const handle = delayRender('kids image ' + src);
		const done = () => continueRender(handle);
		img.addEventListener('load', done, {once: true});
		img.addEventListener('error', done, {once: true});
		return () => continueRender(handle);
	}, [src]);
	return <img ref={ref} src={src} alt="" style={style} />;
};

const INK = '#F4F2EC';
const INK_DARK = '#2B2420';

/** 01 — the chapter title: Caveat, a marker sweep behind it, a squiggle under it. */
export const KidsTitle: React.FC<{title: string; accent: string; portrait: boolean}> = ({title, accent, portrait}) => {
	const {frame, t, dur, width, height, s} = useClock();
	const IN = Math.min(0.8, Math.max(0.3, dur * 0.08));
	const inn = power3Out(prog(t, 0.1, IN));
	const out = power2In(prog(t, dur - 0.5, 0.45));
	const sweep = power2Out(prog(t, 0.8, Math.max(0.6, dur * 0.4)));
	const under = power2Out(prog(t, 0.6, 0.9));
	const fontSize = Math.min(portrait ? 104 : 124 * s, (width * (portrait ? 0.84 : 0.8)) / Math.max(6, title.length * 0.42));
	const lineW = Math.min(width * 0.8, title.length * fontSize * 0.42);
	const squiggle = (() => {
		let d = 'M 0 10';
		for (let i = 1; i <= 14; i++) d += ` Q ${((i - 0.5) / 14) * 100} ${i % 2 ? 2 : 18}, ${(i / 14) * 100} 10`;
		return d;
	})();
	return (
		<AbsoluteFill style={{alignItems: 'center', justifyContent: 'center', paddingBottom: portrait ? height * 0.16 : 0, opacity: inn * (1 - out)}}>
			<div style={{position: 'relative', transform: `${boil(frame, 8, 1.4 * s, 0.3)} translateY(${((1 - inn) * 24 * s).toFixed(2)}px)`}}>
				<div
					style={{
						position: 'absolute',
						left: -18 * s,
						right: -18 * s,
						top: '38%',
						height: '42%',
						background: accent,
						opacity: 0.55,
						borderRadius: 10 * s,
						transformOrigin: '0% 50%',
						transform: `scaleX(${sweep.toFixed(4)}) rotate(-1.2deg)`,
					}}
				/>
				<div
					style={{
						position: 'relative',
						fontFamily: GF.caveat,
						fontWeight: 700,
						fontSize,
						lineHeight: 1.1,
						color: INK,
						textAlign: 'center',
						maxWidth: width * 0.86,
						textShadow: '0 3px 18px rgba(0,0,0,0.45)',
					}}
				>
					{title}
				</div>
				<svg viewBox="0 0 100 20" preserveAspectRatio="none" style={{display: 'block', width: lineW, height: fontSize * 0.2, margin: '0 auto', overflow: 'visible', clipPath: `inset(-50% ${((1 - under) * 100).toFixed(2)}% -50% 0)`}}>
					<path d={squiggle} fill="none" stroke={INK} strokeWidth={Math.max(3, 6 * s)} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
				</svg>
			</div>
		</AbsoluteFill>
	);
};

/**
 * 02 — a speech bubble. Placed beside the speaker's box when the plan knows
 * where they stand (normalised [x, y, w, h]), top right otherwise, with its
 * tail pointing back at them. The outline draws on, the paper fills in, the
 * line types itself a character at a time.
 */
export const SpeechBubble: React.FC<{text: string; box?: [number, number, number, number]; portrait: boolean}> = ({text, box, portrait}) => {
	const {frame, t, dur, width, height, s} = useClock();
	const W = Math.min(portrait ? width * 0.8 : 620 * s * (width / height > 1 ? 1.5 : 1), width * 0.44 + (portrait ? width * 0.36 : 0));
	const fontSize = portrait ? 44 : 58 * s * 1.2;
	const lines = Math.ceil((text.length * fontSize * 0.42) / (W * 0.78));
	const H = Math.max(fontSize * 2.6, fontSize * 1.25 * lines + fontSize * 1.4);
	// Beside the speaker's head: to their right when there is room, else left.
	let x = width - W - 60 * s, y = 90 * s, tailRight = false;
	if (box) {
		const [bx, by, bw] = box;
		const headX = (bx + bw / 2) * width, headY = by * height;
		const right = headX + bw * width * 0.25 + W + 40 * s < width;
		x = right ? headX + bw * width * 0.2 : headX - bw * width * 0.2 - W;
		tailRight = !right;
		y = Math.max(40 * s, headY - H * 0.6);
		x = Math.max(30 * s, Math.min(width - W - 30 * s, x));
	}
	const draw = power2Out(prog(t, 0.15, 0.55));
	const fill = power2Out(prog(t, 0.45, 0.35));
	const typed = Math.round(text.length * Math.min(1, Math.max(0, (t - 0.55) / Math.max(0.3, text.length * 0.03))));
	const out = power2In(prog(t, dur - 0.4, 0.35));
	const path = wobblyLoop(W, H, 1.6, 6, 6 * s);
	const tailX = tailRight ? W * 0.78 : W * 0.22;
	const tail = `M ${tailX - 22 * s} ${H * 0.9} L ${tailX + (tailRight ? 40 : -40) * s} ${H + 70 * s} L ${tailX + 26 * s} ${H * 0.88}`;
	return (
		<AbsoluteFill style={{opacity: 1 - out}}>
			<div style={{position: 'absolute', left: x, top: y, width: W, height: H + 80 * s, transform: boil(frame, 6, 1.6 * s, 0.4)}}>
				<svg width={W} height={H + 80 * s} style={{position: 'absolute', left: 0, top: 0, overflow: 'visible'}}>
					<path d={tail} fill="#FBF8F0" opacity={fill} stroke={INK_DARK} strokeWidth={4 * s} strokeLinejoin="round" />
					<path d={path} fill="#FBF8F0" fillOpacity={fill} stroke={INK_DARK} strokeWidth={4.5 * s} pathLength={1} strokeDasharray="1 1" strokeDashoffset={(1 - draw).toFixed(4)} />
				</svg>
				<div
					style={{
						position: 'absolute',
						left: W * 0.11,
						right: W * 0.11,
						top: 0,
						height: H,
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'center',
						textAlign: 'center',
						fontFamily: GF.caveat,
						fontWeight: 700,
						fontSize,
						lineHeight: 1.1,
						color: INK_DARK,
					}}
				>
					<span>
						{text.slice(0, typed)}
						<span style={{opacity: 0}}>{text.slice(typed)}</span>
					</span>
				</div>
			</div>
		</AbsoluteFill>
	);
};

/** 03 — a character's still in a hand-drawn frame, slightly tilted, captioned. */
export const CharacterCard: React.FC<{title: string; image: string; portrait: boolean}> = ({title, image, portrait}) => {
	const {frame, t, dur, width, height, s} = useClock();
	const inn = backOut(1.3)(prog(t, 0.15, 0.6));
	const fade = power2Out(prog(t, 0, 0.35));
	const out = power2In(prog(t, dur - 0.45, 0.4));
	const W = portrait ? width * 0.8 : width * 0.5;
	const H = W * (portrait ? 0.62 : 0.6);
	const border = wobblyLoop(W + 24 * s, H + 24 * s, 3.2, 14, 3 * s, 44);
	const cap = power2Out(prog(t, 0.7, 0.5));
	return (
		<AbsoluteFill style={{opacity: 1 - out}}>
			<AbsoluteFill style={{background: 'rgba(18,16,22,0.55)', opacity: fade}} />
			<AbsoluteFill style={{alignItems: 'center', justifyContent: 'center', paddingBottom: portrait ? height * 0.1 : 0}}>
				<div style={{position: 'relative', width: W, height: H, transform: `${boil(frame, 14, 1.6 * s, 0.35)} rotate(-1.2deg) scale(${(0.85 + 0.15 * inn).toFixed(4)})`, opacity: fade}}>
					<HeldImg src={image} style={{position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', borderRadius: 10 * s}} />
					<svg width={W + 24 * s} height={H + 24 * s} style={{position: 'absolute', left: -12 * s, top: -12 * s, overflow: 'visible'}}>
						<path d={border} fill="none" stroke={INK} strokeWidth={6 * s} strokeLinejoin="round" />
					</svg>
					{[0, 1, 2].map((k) => (
						<svg key={k} width={40 * s} height={40 * s} style={{position: 'absolute', overflow: 'visible', ...(k === 0 ? {left: -46 * s, top: -40 * s} : k === 1 ? {right: -44 * s, top: -34 * s} : {right: -40 * s, bottom: -38 * s})}}>
							<path d={`M 6 20 L 20 6 M 16 30 L 34 14 M 4 34 L 12 26`} stroke="#FFB020" strokeWidth={4 * s} strokeLinecap="round" opacity={cap} />
						</svg>
					))}
					<div
						style={{
							position: 'absolute',
							left: 0,
							right: 0,
							top: H + 30 * s,
							textAlign: 'center',
							fontFamily: GF.caveat,
							fontWeight: 700,
							fontSize: portrait ? 56 : 64 * s * 1.1,
							color: INK,
							textShadow: '0 2px 14px rgba(0,0,0,0.5)',
							opacity: cap,
							transform: `translateY(${((1 - cap) * 12 * s).toFixed(2)}px)`,
						}}
					>
						{title}
					</div>
				</div>
			</AbsoluteFill>
		</AbsoluteFill>
	);
};

/** 04 — a wobbly contour round a character, drawn on, with the name above. */
export const NameCircle: React.FC<{title: string; box: [number, number, number, number]}> = ({title, box}) => {
	const {frame, t, dur, width, height, s} = useClock();
	const [bx, by, bw, bh] = box;
	const pad = 18 * s;
	const x = bx * width - pad, y = by * height - pad, w = bw * width + 2 * pad, h = bh * height + 2 * pad;
	const draw = power2Out(prog(t, 0.2, 0.75));
	const label = power2Out(prog(t, 0.75, 0.4));
	const out = power2In(prog(t, dur - 0.4, 0.35));
	const d = wobblyLoop(w, h, 2.6, 3, 5 * s, 40);
	return (
		<AbsoluteFill style={{opacity: 1 - out}}>
			<div style={{position: 'absolute', left: x, top: y, width: w, height: h, transform: boil(frame, 3, 1.4 * s, 0.3)}}>
				<svg width={w} height={h} style={{position: 'absolute', inset: 0, overflow: 'visible'}}>
					<path d={d} fill="none" stroke={INK} strokeWidth={5 * s} strokeLinecap="round" pathLength={1} strokeDasharray="1 1" strokeDashoffset={(1 - draw).toFixed(4)} style={{filter: 'drop-shadow(0 2px 6px rgba(0,0,0,0.45))'}} />
				</svg>
				<div
					style={{
						position: 'absolute',
						left: 0,
						right: 0,
						top: -64 * s,
						textAlign: 'center',
						fontFamily: GF.caveat,
						fontWeight: 700,
						fontSize: 56 * s * 1.1,
						color: INK,
						textShadow: '0 2px 14px rgba(0,0,0,0.5)',
						opacity: label,
						transform: `translateY(${((1 - label) * 10 * s).toFixed(2)}px)`,
					}}
				>
					{title}
				</div>
			</div>
		</AbsoluteFill>
	);
};

/** 05 — a sticker that pops in past full size and settles (back.out 1.7). */
export const Sticker: React.FC<{label: string; accent: string; portrait: boolean}> = ({label, accent, portrait}) => {
	const {t, dur, width, s} = useClock();
	const pop = backOut(1.7)(prog(t, 0, 0.6));
	const fade = power2Out(prog(t, 0, 0.3));
	const out = power2In(prog(t, dur - 0.35, 0.3));
	const fontSize = portrait ? 46 : 54 * s * 1.2;
	return (
		<AbsoluteFill>
			<div
				style={{
					position: 'absolute',
					right: portrait ? undefined : 70 * s,
					left: portrait ? '50%' : undefined,
					top: portrait ? 230 : 110 * s,
					transform: `${portrait ? 'translateX(-50%) ' : ''}scale(${(0.9 + 0.1 * pop).toFixed(4)}) rotate(-3deg)`,
					opacity: fade * (1 - out),
					display: 'flex',
					alignItems: 'center',
					gap: 18 * s,
					padding: `${22 * s}px ${40 * s}px`,
					borderRadius: 26 * s,
					background: '#FFD166',
					border: `${4 * s}px solid #FFF3C4`,
					boxShadow: '0 16px 40px rgba(0,0,0,0.35)',
					maxWidth: width * 0.8,
				}}
			>
				<span style={{width: 22 * s, height: 22 * s, borderRadius: '50%', background: accent === '#FFFFFF' ? '#FF6B8B' : accent, flexShrink: 0}} />
				<span style={{fontFamily: GF.montserrat, fontWeight: 700, fontSize, color: '#3A2610', whiteSpace: 'nowrap'}}>{label}</span>
			</div>
		</AbsoluteFill>
	);
};

/** 06 — confetti from both lower corners, seeded, with gravity and spin. */
export const Confetti: React.FC = () => {
	const {t, width, height, s} = useClock();
	const colors = ['#FF6B8B', '#FFD166', '#7BDFF2', '#B8F2A0', '#C3A6FF', '#FFFFFF'];
	const rand = (n: number) => (hash(n, 13) + 1) / 2;
	const pieces = [];
	for (let i = 0; i < 90; i++) {
		const left = i % 2 === 0;
		const at = 0.1 + rand(i + 11) * 0.25;
		const T = 2.6 + rand(i + 3) * 0.8;
		const tt = t - at;
		if (tt < 0 || tt > T) continue;
		const vx = (left ? 1 : -1) * (300 + rand(i) * 900) * (width / 1920);
		const vy = -(900 + rand(i + 7) * 700) * (height / 1080);
		const g = 1500 * (height / 1080);
		const x = (left ? 0.06 : 0.94) * width + vx * tt * 0.55;
		const y = height + vy * tt + 0.5 * g * tt * tt;
		const round = i % 3 === 0;
		pieces.push(
			<div
				key={i}
				style={{
					position: 'absolute',
					left: 0,
					top: 0,
					width: (round ? 22 : 18) * s,
					height: (round ? 22 : 30) * s,
					borderRadius: round ? '50%' : 4 * s,
					background: colors[i % colors.length],
					opacity: tt > T - 0.4 ? (T - tt) / 0.4 : 1,
					transform: `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) rotate(${((i * 37 + tt * 540) % 360).toFixed(1)}deg)`,
				}}
			/>,
		);
	}
	return <AbsoluteFill style={{pointerEvents: 'none'}}>{pieces}</AbsoluteFill>;
};
