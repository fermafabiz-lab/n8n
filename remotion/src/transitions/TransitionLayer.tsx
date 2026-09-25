import React, {useLayoutEffect, useRef} from 'react';
import {AbsoluteFill, continueRender, delayRender} from 'remotion';
import {VARIANT, lookStyle, type LayerLook} from './families';
import type {PlannedTransition} from './plan';

/**
 * One frame of a still, held until the browser has decoded it: a frame
 * captured before the image paints would show the transition sliding in
 * black. The hold is the same one fonts use (delayRender), which the
 * Hyperframes page waits on before every capture.
 */
const Still: React.FC<{src: string}> = ({src}) => {
	const ref = useRef<HTMLImageElement>(null);
	useLayoutEffect(() => {
		const img = ref.current;
		if (!img || (img.complete && img.naturalWidth > 0)) return;
		const handle = delayRender('transition still ' + src);
		const done = () => continueRender(handle);
		img.addEventListener('load', done, {once: true});
		img.addEventListener('error', done, {once: true});
		return () => {
			img.removeEventListener('load', done);
			img.removeEventListener('error', done);
			continueRender(handle);
		};
	}, [src]);
	return <img ref={ref} src={src} alt="" style={{width: '100%', height: '100%', objectFit: 'contain', display: 'block'}} />;
};

/** A still drawn exactly as the footage layer draws that instant: framed and graded. */
const StillLayer: React.FC<{src: string; look: LayerLook; framing: string; grade: string; extra?: React.CSSProperties}> = ({
	src,
	look,
	framing,
	grade,
	extra,
}) => (
	<AbsoluteFill style={{...lookStyle(look), ...extra}}>
		<AbsoluteFill style={{transform: framing, filter: grade}}>
			<Still key={src} src={src} />
		</AbsoluteFill>
	</AbsoluteFill>
);

export type TransitionNow = {
	/** Applied around the live footage layer. */
	live: React.CSSProperties;
	/** Drawn right above the footage, under the grain and every graphic. */
	overlay: React.ReactNode;
};

const NONE: TransitionNow = {live: {}, overlay: null};

/**
 * The transition at `seconds` (montage time), if one is running.
 *
 * Before the cut the live footage is still the outgoing shot and the first
 * incoming frame is a still; after it, the live footage is the incoming shot
 * and the last outgoing frame is the still. Each side is frozen only while it
 * is the smaller part of the move.
 */
export function transitionAt(o: {
	planned: PlannedTransition[];
	seconds: number;
	stillsBase: string;
	width: number;
	height: number;
	/** The footage framing at a given second (shotTransform / Ken Burns). */
	framingAt: (seconds: number) => string;
	grade: string;
	fps: number;
}): TransitionNow {
	// The same lead FinalVideo's framing uses: the footage shows the frame
	// sampled at the CENTRE of its interval, so the picture changes on frame
	// round(cut * fps), and a cut a hair after a frame boundary (Rome's
	// 12.416667 against frame 298's 12.416666) must already count as "after"
	// on that frame — or the incoming still is laid over incoming footage.
	const t = o.seconds + 0.5 / o.fps + 1e-6;
	const p = o.planned.find((x) => t >= x.from && t < x.to);
	if (!p) return NONE;
	const v = VARIANT[p.variant];
	const tau = t - p.from;
	const f = v.frame(tau, o.width, o.height);
	const before = t < p.at;
	const outSrc = `${o.stillsBase}c${p.cut}-out.jpg`;
	const inSrc = `${o.stillsBase}c${p.cut}-in.jpg`;
	// The frozen frames wear the framing of the instant they were taken at.
	const outFraming = o.framingAt(p.at - 0.5 / o.fps);
	const inFraming = o.framingAt(p.at + 0.5 / o.fps);

	const overlay = (
		<AbsoluteFill style={{pointerEvents: 'none'}}>
			{v.stills &&
				(before ? (
					<StillLayer src={inSrc} look={f.in} framing={inFraming} grade={o.grade} />
				) : (
					<StillLayer src={outSrc} look={f.out} framing={outFraming} grade={o.grade} />
				))}
			{f.glitch && (
				<>
					<StillLayer
						src={outSrc}
						look={{x: f.glitch.r[0], y: f.glitch.r[1]}}
						framing={outFraming}
						grade="brightness(0.8) sepia(1) saturate(9) hue-rotate(-45deg)"
						extra={{mixBlendMode: 'screen', opacity: 0.5}}
					/>
					<StillLayer
						src={outSrc}
						look={{x: f.glitch.b[0], y: f.glitch.b[1]}}
						framing={outFraming}
						grade="brightness(0.8) sepia(1) saturate(9) hue-rotate(165deg)"
						extra={{mixBlendMode: 'screen', opacity: 0.5}}
					/>
				</>
			)}
			{f.shutter !== undefined && f.shutter > 0 && (
				<>
					<div
						style={{
							position: 'absolute', left: 0, right: 0, top: 0, height: '50%', background: '#0B0B0D',
							transform: `translateY(${(-(1 - f.shutter) * 100).toFixed(2)}%)`,
						}}
					/>
					<div
						style={{
							position: 'absolute', left: 0, right: 0, bottom: 0, height: '50%', background: '#0B0B0D',
							transform: `translateY(${((1 - f.shutter) * 100).toFixed(2)}%)`,
						}}
					/>
				</>
			)}
		</AbsoluteFill>
	);
	return {live: lookStyle(before ? f.out : f.in), overlay};
}
