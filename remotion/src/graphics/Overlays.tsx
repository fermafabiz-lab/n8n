import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import {GF} from './fonts';
import {fitTitleSize} from '../fitType';
import {power2In, power2Out, power3Out, power4In, prog} from './ease';

/**
 * The count-up stat, the two full-frame chapter titles and the editorial flash
 * — ported from the catalog blocks mk-progress-stat, yt-prism-title,
 * hw-write-title and editorial-flash-overlay. Frame-driven, no wall clock, no
 * randomness: every frame is a pure function of its time, which is what lets
 * Hyperframes seek them in any order.
 */

const useClock = () => {
	const frame = useCurrentFrame();
	const {fps, width, height, durationInFrames} = useVideoConfig();
	return {t: frame / fps, dur: durationInFrames / fps, width, height, s: Math.min(width, height) / 1080};
};

/** A spoken figure counting up over the footage, with a bar that fills to it. */
export const StatOverlay: React.FC<{
	value: number;
	suffix?: string;
	label: string;
	caption?: string;
	accent: string;
	portrait: boolean;
}> = ({value, suffix = '', label, caption, accent, portrait}) => {
	const {t, dur, width, s} = useClock();
	const inn = power3Out(prog(t, 0.3, 0.7));
	const count = power2Out(prog(t, 0.5, 1.6));
	const out = power2In(prog(t, dur - 0.5, 0.4));
	// Whole numbers count in whole steps, as the block does; a fractional figure
	// keeps its one decimal so "2.5" never shows "3" on the way.
	const decimals = Number.isInteger(value) ? 0 : 1;
	const shown = (value * count).toFixed(decimals);
	return (
		<AbsoluteFill>
			{/* A soft dark pool behind the figure: white type on a bright sky
			    otherwise reads as nothing (Rome film, scene 5). */}
			<div
				style={{
					position: 'absolute',
					left: portrait ? -120 : width * 0.62 - 200 * s,
					top: portrait ? 60 : 20 * s,
					width: portrait ? width + 40 : width * 0.34 + 400 * s,
					height: portrait ? 560 : 620 * s,
					background: 'radial-gradient(closest-side, rgba(0,0,0,0.5), rgba(0,0,0,0.28) 55%, rgba(0,0,0,0))',
					opacity: inn * (1 - out),
				}}
			/>
			<div
				style={{
					position: 'absolute',
					left: portrait ? 52 : width * 0.62,
					top: portrait ? 240 : 150 * s,
					width: portrait ? width - 112 : width * 0.34,
					opacity: inn * (1 - out),
					transform: `translateY(${((1 - inn) * 28 * s + out * -20 * s).toFixed(2)}px)`,
					fontFamily: GF.inter,
					textShadow: '0 2px 24px rgba(0,0,0,0.7), 0 0 4px rgba(0,0,0,0.35)',
				}}
			>
				<div
					style={{
						fontWeight: 600,
						fontSize: 190 * s,
						lineHeight: 1,
						letterSpacing: '-0.03em',
						color: '#F5F5F7',
						fontVariantNumeric: 'tabular-nums',
					}}
				>
					{shown}
					{suffix}
				</div>
				<div style={{marginTop: 10 * s, fontWeight: 500, fontSize: portrait ? 34 : 42 * s, lineHeight: 1.2, color: '#F5F5F7'}}>{label}</div>
				<div
					style={{
						position: 'relative',
						marginTop: 28 * s,
						height: 6 * s,
						width: Math.min(480 * s, portrait ? width - 88 : width * 0.3),
						borderRadius: 3 * s,
						background: 'rgba(245,245,247,0.18)',
					}}
				>
					<div
						style={{
							position: 'absolute',
							inset: 0,
							borderRadius: 3 * s,
							background: accent,
							transform: `scaleX(${count.toFixed(4)})`,
							transformOrigin: 'left center',
						}}
					/>
				</div>
				{caption && (
					<div style={{marginTop: 22 * s, fontWeight: 500, fontSize: portrait ? 24 : 30 * s, lineHeight: 1.3, color: '#E6E6EA'}}>{caption}</div>
				)}
			</div>
		</AbsoluteFill>
	);
};

/** A dimming behind a full-frame title, so it reads on any footage. */
const Dim: React.FC<{amount: number}> = ({amount}) => (
	<AbsoluteFill
		style={{
			background: 'radial-gradient(ellipse 80% 70% at 50% 50%, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.25) 100%)',
			opacity: amount,
		}}
	/>
);

/**
 * The chromatic title: the words focus in from a heavy blur while a red and a
 * blue copy settle from wide to a few pixels either side, on a slight
 * perspective bow, then breathe until they blur out.
 */
export const PrismTitle: React.FC<{title: string; kicker?: string; accent: string; portrait?: boolean}> = ({
	title,
	kicker,
	accent,
	portrait = false,
}) => {
	const {t, dur, width, height, s} = useClock();
	const IN = Math.min(0.8, Math.max(0.3, dur * 0.08));
	const OUT = Math.min(0.6, Math.max(0.25, dur * 0.06));
	const fade = power2Out(prog(t, 0.1, IN * 1.4));
	const focus = power2Out(prog(t, 0.1, IN * 2.4));
	const leave = power2In(prog(t, dur - OUT, OUT));
	const blur = 18 - (18 - 2.5) * focus + 14 * leave;
	const O = 4 * s;
	const spread = O * (4.5 - 3.5 * focus);
	const breathe = 1 + 0.03 * Math.min(1, Math.max(0, (t - 0.1) / Math.max(1, dur)));
	const words = title.trim().split(/\s+/);
	const fontSize = fitTitleSize({
		words,
		advance: 0.6,
		spaceRatio: 0.3,
		wrapWidth: width * (portrait ? 0.8 : 0.84),
		maxSize: portrait ? 150 : 260 * s,
		minSize: portrait ? 56 : 60 * s,
		maxLines: 3,
		lineHeight: 1.12,
		maxHeight: height * (portrait ? 0.34 : 0.5),
	});
	const layer = (color: string, dx: number, opacity: number): React.CSSProperties => ({
		position: 'absolute',
		inset: 0,
		color,
		opacity,
		transform: `translateX(${dx.toFixed(2)}px)`,
	});
	return (
		<AbsoluteFill>
			<Dim amount={fade * (1 - leave)} />
			<AbsoluteFill
				style={{
					alignItems: 'center',
					justifyContent: 'center',
					// Vertical: centred at 42% of the height, clear of the captions.
					paddingBottom: portrait ? height * 0.16 : 0,
					transform: `perspective(${950 * s}px) rotateX(6deg) scale(${breathe.toFixed(4)})`,
					opacity: fade * (1 - leave),
					// On a vertical frame the kicker is too small to survive the
					// blur, so only the title is blurred there.
					filter: portrait ? undefined : `blur(${blur.toFixed(2)}px)`,
				}}
			>
				{kicker && (
					<div
						style={{
							fontFamily: GF.spaceMono,
							fontWeight: 700,
							fontSize: portrait ? 28 : 24 * s,
							letterSpacing: portrait ? '0.3em' : '0.35em',
							textShadow: portrait ? '0 2px 12px rgba(0,0,0,0.6)' : undefined,
							textTransform: 'uppercase',
							color: '#FFFFFF',
							opacity: portrait ? 0.92 : 0.8,
							marginBottom: 24 * s,
						}}
					>
						{kicker}
					</div>
				)}
				<div
					style={{
						position: 'relative',
						maxWidth: width * (portrait ? 0.82 : 0.86),
						textAlign: 'center',
						fontFamily: GF.inter,
						fontWeight: 600,
						fontSize,
						lineHeight: 1.12,
						letterSpacing: '-0.02em',
						filter: portrait ? `blur(${blur.toFixed(2)}px)` : undefined,
					}}
				>
					<div style={layer('#FF2A4D', -spread, 0.45 + 0.4 * focus)}>{title}</div>
					<div style={layer('#2A7FFF', spread, 0.45 + 0.4 * focus)}>{title}</div>
					<div style={{position: 'relative', color: accent}}>{title}</div>
				</div>
			</AbsoluteFill>
		</AbsoluteFill>
	);
};

/**
 * The handwritten title: the words are written on left to right behind a soft
 * pen edge, then a stroke underlines them. The catalog block traces glyph
 * outlines; a feathered wipe over the same Caveat face reads the same at
 * video size and needs no per-glyph paths, which is what lets any title in
 * any language use it.
 */
export const HandwrittenTitle: React.FC<{title: string; kicker?: string; accent: string; portrait?: boolean}> = ({
	title,
	kicker,
	accent,
	portrait = false,
}) => {
	const {t, dur, width, height, s} = useClock();
	const write = power2Out(prog(t, 0.25, Math.min(1.8, dur * 0.45)));
	const under = power2Out(prog(t, 0.25 + Math.min(1.8, dur * 0.45) - 0.1, 0.7));
	const dim = power3Out(prog(t, 0, 0.4));
	const leave = power2In(prog(t, dur - 0.45, 0.4));
	const words = title.trim().split(/\s+/);
	const fontSize = fitTitleSize({
		words,
		advance: 0.42,
		spaceRatio: 0.25,
		wrapWidth: width * (portrait ? 0.8 : 0.84),
		maxSize: portrait ? 130 : 170 * s,
		minSize: portrait ? 56 : 50 * s,
		maxLines: 3,
		lineHeight: 1.15,
		maxHeight: height * (portrait ? 0.34 : 0.5),
	});
	// The feathered edge of the wipe, 12% wide, travels from before the first
	// letter to past the last, so the first and last glyphs are written too.
	const edge = -12 + write * 124;
	const mask = `linear-gradient(90deg, #000 ${edge.toFixed(2)}%, transparent ${(edge + 12).toFixed(2)}%)`;
	return (
		<AbsoluteFill style={{opacity: 1 - leave}}>
			<Dim amount={dim} />
			<AbsoluteFill style={{alignItems: 'center', justifyContent: 'center', paddingBottom: portrait ? height * 0.16 : 0}}>
				{kicker && (
					<div
						style={{
							fontFamily: GF.caveat,
							fontWeight: 700,
							fontSize: portrait ? Math.max(fontSize * 0.42, 36) : fontSize * 0.34,
							color: accent,
							marginBottom: 6 * s,
							opacity: power2Out(prog(t, 0.1, 0.4)),
						}}
					>
						{kicker}
					</div>
				)}
				<div style={{position: 'relative', maxWidth: width * (portrait ? 0.82 : 0.86), textAlign: 'center'}}>
					<div
						style={{
							fontFamily: GF.caveat,
							fontWeight: 700,
							fontSize,
							lineHeight: 1.15,
							color: '#F4F2EC',
							WebkitMaskImage: mask,
							maskImage: mask,
							textShadow: '0 3px 18px rgba(0,0,0,0.45)',
						}}
					>
						{title}
					</div>
					<svg
						viewBox="0 0 100 10"
						preserveAspectRatio="none"
						style={{
							display: 'block',
							width: '70%',
							height: fontSize * 0.14,
							margin: '0 auto',
							overflow: 'visible',
							clipPath: `inset(-50% ${((1 - under) * 100).toFixed(2)}% -50% 0)`,
						}}
					>
						<path
							d="M2 6 C 25 2, 55 9, 98 4"
							fill="none"
							stroke={accent}
							strokeWidth={1.4}
							strokeLinecap="round"
							vectorEffect="non-scaling-stroke"
							style={{strokeWidth: 7 * s}}
						/>
					</svg>
				</div>
			</AbsoluteFill>
		</AbsoluteFill>
	);
};

/**
 * The editorial flash: a white wash with a warm core and a light sweep, hit at
 * `hitAt` seconds into its window — placed so the hit lands ON a cut, where a
 * flash can hide a change (docs: lessons-render, "A flash hides a change only
 * if its brightest instant sits ON the change").
 */
export const EditorialFlash: React.FC<{hitAt: number}> = ({hitAt}) => {
	const {t} = useClock();
	const rise = power4In(prog(t, hitAt, 0.05));
	const wash = t < hitAt ? 0 : t < hitAt + 0.04 ? 0.92 * rise : 0.92 * (1 - power3Out(prog(t, hitAt + 0.04, 0.18)));
	const core = t < hitAt - 0.01 ? 0 : t < hitAt + 0.04 ? power4In(prog(t, hitAt - 0.01, 0.05)) : 1 - power2Out(prog(t, hitAt + 0.04, 0.34));
	const coreScale = t < hitAt + 0.04 ? 0.86 + 0.14 * power4In(prog(t, hitAt - 0.01, 0.05)) : 1 + 0.18 * power2Out(prog(t, hitAt + 0.04, 0.34));
	const sweep = t < hitAt ? 0 : t < hitAt + 0.04 ? 0.9 * rise : 0.9 * (1 - power2Out(prog(t, hitAt + 0.04, 0.3)));
	const sweepX = t < hitAt + 0.04 ? -12 + 20 * rise : 8 + 20 * power2Out(prog(t, hitAt + 0.04, 0.3));
	if (wash <= 0 && core <= 0 && sweep <= 0) return null;
	return (
		<AbsoluteFill style={{pointerEvents: 'none'}}>
			<AbsoluteFill style={{background: 'rgb(255,253,250)', opacity: wash}} />
			<AbsoluteFill
				style={{
					inset: '-18%',
					background:
						'radial-gradient(ellipse 68% 92% at 37% 47%, #fff 0%, rgba(255,255,255,0.98) 20%, rgba(255,253,250,0.86) 45%, rgba(255,174,105,0.32) 67%, transparent 86%)',
					mixBlendMode: 'screen',
					opacity: core,
					transform: `scale(${coreScale.toFixed(4)}) rotate(-5deg)`,
					transformOrigin: '38% 48%',
				}}
			/>
			<AbsoluteFill
				style={{
					inset: '-28%',
					background:
						'linear-gradient(108deg, transparent 21%, rgba(255,174,105,0.1) 38%, rgba(255,253,250,0.9) 49%, rgba(255,255,255,0.98) 53%, rgba(183,218,255,0.24) 62%, transparent 79%)',
					mixBlendMode: 'screen',
					opacity: sweep,
					transform: `translateX(${sweepX.toFixed(2)}%) rotate(-2deg)`,
				}}
			/>
		</AbsoluteFill>
	);
};
