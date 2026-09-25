import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import {GF} from './fonts';
import {power2In, power2Out, power3Out, prog} from './ease';

/**
 * The Cinematic graphics, ported from what the producer chose in the sampler
 * (remotion/out/sampler/cine-reel.mp4, 2026-09-25). A Cinematic film is silent,
 * so nothing here labels what is said — it frames the film as a film:
 *
 *   C1 titlecard-lockup     → FilmTitle   the film's name over its first shot
 *   C2 typed slate          → Slate       where and when a sequence opens
 *   C3 2.39:1 bars          → Letterbox   over the whole film
 *   C4 organic light leak   → OrganicLeak on a chapter change
 *   C5 titlecard-calm       → CalmTitle   a chapter title
 *   C6 RGB glitch title     → GlitchTitle a chapter title that tears in
 */

const useClock = () => {
	const frame = useCurrentFrame();
	const {fps, width, height, durationInFrames} = useVideoConfig();
	return {frame, t: frame / fps, dur: durationInFrames / fps, width, height, s: Math.min(width, height) / 1080, fps};
};

const hash = (n: number, seed = 1) => {
	const x = Math.sin(n * 78.233 + seed * 1.7) * 43758.5453;
	return (x - Math.floor(x)) * 2 - 1;
};

/** C1 — kicker, wordmark, a hairline rule drawing left to right, a label. */
export const FilmTitle: React.FC<{title: string; kicker?: string; label?: string; portrait: boolean}> = ({title, kicker = 'A FILM', label, portrait}) => {
	const {t, dur, width, s} = useClock();
	const k = power2Out(prog(t, 0.15, 0.6));
	const w = power3Out(prog(t, 0.35, 0.8));
	const rule = power3Out(prog(t, 0.9, 0.8));
	const lab = power2Out(prog(t, 1.3, 0.6));
	const out = power2In(prog(t, dur - 0.6, 0.55));
	const size = Math.min(portrait ? 96 : 150 * s, (width * 0.84) / Math.max(4, title.length * 0.62));
	return (
		<AbsoluteFill style={{alignItems: 'center', justifyContent: 'center', opacity: 1 - out}}>
			<AbsoluteFill style={{background: 'rgba(0,0,0,0.42)', opacity: k}} />
			<div style={{position: 'relative', textAlign: 'center', color: '#F4F4F2'}}>
				<div style={{fontFamily: GF.jetbrainsMono, fontSize: Math.max(20, 24 * s), letterSpacing: '0.6em', opacity: k * 0.8, marginBottom: 18 * s}}>{kicker}</div>
				<div
					style={{
						fontFamily: GF.inter,
						fontWeight: 600,
						fontSize: size,
						lineHeight: 1.02,
						letterSpacing: '-0.02em',
						opacity: w,
						transform: `translateY(${((1 - w) * 22 * s).toFixed(2)}px)`,
						maxWidth: width * 0.86,
						textShadow: '0 4px 30px rgba(0,0,0,0.5)',
					}}
				>
					{title}
				</div>
				<div style={{height: 2, margin: `${28 * s}px auto ${22 * s}px`, width: Math.min(width * 0.5, 620 * s), background: 'rgba(244,244,242,0.7)', transformOrigin: '0% 50%', transform: `scaleX(${rule.toFixed(4)})`}} />
				{label && <div style={{fontFamily: GF.jetbrainsMono, fontSize: Math.max(18, 22 * s), letterSpacing: '0.45em', opacity: lab * 0.8}}>{label}</div>}
			</div>
		</AbsoluteFill>
	);
};

/** C2 — a location slate typed a character at a time, bottom left. */
export const Slate: React.FC<{title: string; subtitle?: string; portrait: boolean}> = ({title, subtitle = '', portrait}) => {
	const {t, dur, s, height} = useClock();
	const aDur = title.length * 0.055;
	const a = Math.round(title.length * Math.min(1, Math.max(0, (t - 0.3) / aDur)));
	const b = Math.round(subtitle.length * Math.min(1, Math.max(0, (t - 0.55 - aDur) / Math.max(0.1, subtitle.length * 0.045))));
	const caret = Math.floor((t - 0.3) / 0.25) % 2 === 0 && t < dur - 0.6 ? 1 : 0;
	const out = power2In(prog(t, dur - 0.5, 0.45));
	return (
		<AbsoluteFill style={{opacity: 1 - out}}>
			<div style={{position: 'absolute', left: portrait ? 44 : 110 * s, bottom: portrait ? height * 0.2 : 130 * s, color: '#F2F2F0', textShadow: '0 2px 16px rgba(0,0,0,0.6)', fontFamily: GF.jetbrainsMono}}>
				<div style={{fontSize: portrait ? 34 : 40 * s, letterSpacing: '0.14em', whiteSpace: 'pre'}}>
					{title.slice(0, a)}
					<span style={{display: 'inline-block', width: 14 * s, height: 36 * s, background: '#F2F2F0', verticalAlign: -5 * s, marginLeft: 4 * s, opacity: caret}} />
				</div>
				{subtitle && <div style={{fontSize: portrait ? 22 : 26 * s, letterSpacing: '0.22em', opacity: 0.75, marginTop: 12 * s, whiteSpace: 'pre'}}>{subtitle.slice(0, b)}</div>}
			</div>
		</AbsoluteFill>
	);
};

/** C3 — 2.39:1 bars. Slide in at the start, out at the end of the window. */
export const Letterbox: React.FC = () => {
	const {t, dur, width, height} = useClock();
	// On a vertical frame the film is already narrower than 2.39:1; the bars
	// frame a 2.39:1 band of it only on landscape.
	const bar = Math.max(0, (height - width / 2.39) / 2);
	const inn = power3Out(prog(t, 0.2, 1.1));
	const out = power2In(prog(t, dur - 1, 0.9));
	const k = inn * (1 - out);
	return (
		<AbsoluteFill style={{pointerEvents: 'none'}}>
			<div style={{position: 'absolute', left: 0, right: 0, top: 0, height: bar, background: '#000', transform: `translateY(${(-(1 - k) * 100).toFixed(2)}%)`}} />
			<div style={{position: 'absolute', left: 0, right: 0, bottom: 0, height: bar, background: '#000', transform: `translateY(${((1 - k) * 100).toFixed(2)}%)`}} />
		</AbsoluteFill>
	);
};

/** C4 — warm, drifting light leaking across the frame, screen-blended. */
export const OrganicLeak: React.FC = () => {
	const {t, dur} = useClock();
	const env = Math.sin(Math.PI * Math.min(1, Math.max(0, t / dur)));
	const drift = t / Math.max(1, dur);
	return (
		<AbsoluteFill style={{pointerEvents: 'none', mixBlendMode: 'screen', opacity: 0.5 * env}}>
			<AbsoluteFill
				style={{
					background: `radial-gradient(ellipse 55% 70% at ${(8 + drift * 30).toFixed(1)}% ${(30 + drift * 20).toFixed(1)}%, rgba(255,140,60,0.8), rgba(255,90,40,0.3) 45%, transparent 70%)`,
					filter: 'blur(30px)',
				}}
			/>
			<AbsoluteFill
				style={{
					background: `radial-gradient(ellipse 40% 55% at ${(92 - drift * 25).toFixed(1)}% ${(70 - drift * 25).toFixed(1)}%, rgba(255,190,110,0.55), rgba(255,120,60,0.18) 50%, transparent 72%)`,
					filter: 'blur(40px)',
				}}
			/>
		</AbsoluteFill>
	);
};

/** C5 — a restrained chapter title: mono kicker, headline fading upward. */
export const CalmTitle: React.FC<{title: string; kicker: string; portrait: boolean}> = ({title, kicker, portrait}) => {
	const {t, dur, width, height, s} = useClock();
	const k = power2Out(prog(t, 0.15, 0.7));
	const h = power3Out(prog(t, 0.35, 0.9));
	const drift = (t / Math.max(1, dur)) * 6 * s;
	const out = power2In(prog(t, dur - 0.55, 0.5));
	const size = Math.min(portrait ? 84 : 128 * s, (width * 0.8) / Math.max(4, title.length * 0.55));
	return (
		<AbsoluteFill style={{justifyContent: 'center', padding: portrait ? '0 44px' : `0 ${220 * s}px`, paddingBottom: portrait ? height * 0.16 : 0, opacity: 1 - out}}>
			<div style={{color: '#F4F4F2', textShadow: '0 4px 28px rgba(0,0,0,0.5)'}}>
				<div style={{fontFamily: GF.jetbrainsMono, fontSize: Math.max(20, 26 * s), letterSpacing: '0.3em', opacity: k * 0.85, marginBottom: 14 * s}}>{kicker}</div>
				<div style={{fontFamily: GF.inter, fontWeight: 600, fontSize: size, lineHeight: 1.02, letterSpacing: '-0.03em', opacity: h, transform: `translateY(${((1 - h) * 24 * s - drift).toFixed(2)}px)`}}>{title}</div>
			</div>
		</AbsoluteFill>
	);
};

/** C6 — a chapter title that tears in and out on single-frame RGB jolts. */
export const GlitchTitle: React.FC<{title: string; kicker: string; portrait: boolean}> = ({title, kicker, portrait}) => {
	const {frame, t, dur, width, s, fps} = useClock();
	const size = Math.min(portrait ? 64 : 120 * s, (width * 0.86) / Math.max(4, title.length * 0.72));
	const inEnd = 0.15 + 8 / fps;
	const outStart = dur - 0.65;
	let op = 1, jx = 0, skew = 0, rx = 0, cx = 0;
	if (t < 0.15) op = 0;
	else if (t < inEnd) {
		const i = frame - Math.round(0.15 * fps), k = 1 - i / 8;
		op = i % 3 === 1 ? 0.35 : 1;
		jx = hash(i) * 18 * k * s; skew = hash(i + 9) * 8 * k; rx = hash(i + 3) * 34 * k * s; cx = hash(i + 4) * -34 * k * s;
	} else if (t >= outStart) {
		const i = frame - Math.round(outStart * fps);
		op = i >= 5 ? 0 : i % 2 ? 0.4 : 1;
		jx = hash(i + 20) * 22 * s; rx = hash(i + 23) * 40 * s; cx = hash(i + 24) * -40 * s;
	}
	const word: React.CSSProperties = {fontFamily: GF.archivoBlack, fontSize: size, letterSpacing: '0.06em', whiteSpace: 'nowrap'};
	return (
		<AbsoluteFill style={{alignItems: 'center', justifyContent: 'center'}}>
			<div style={{position: 'relative', opacity: op, transform: `translateX(${jx.toFixed(1)}px) skewX(${skew.toFixed(2)}deg)`}}>
				<div style={{position: 'absolute', top: -58 * s, left: 4 * s, fontFamily: GF.jetbrainsMono, fontSize: Math.max(18, 24 * s), letterSpacing: '0.4em', color: '#20E3FF'}}>{kicker}</div>
				<div style={{...word, position: 'absolute', left: 0, top: 0, color: '#FF2A4D', mixBlendMode: 'screen', transform: `translateX(${rx.toFixed(1)}px)`}}>{title}</div>
				<div style={{...word, position: 'absolute', left: 0, top: 0, color: '#20E3FF', mixBlendMode: 'screen', transform: `translateX(${cx.toFixed(1)}px)`}}>{title}</div>
				<div style={{...word, position: 'relative', color: '#F4F4F4', textShadow: '0 4px 30px rgba(0,0,0,0.55)'}}>{title}</div>
			</div>
		</AbsoluteFill>
	);
};
