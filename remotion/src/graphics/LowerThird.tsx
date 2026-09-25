import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import type {LowerThirdDesign} from './styles';
import {GF} from './fonts';
import {backOut, power2In, power2Out, power3Out, power4Out, prog} from './ease';

/**
 * A name or place tag, in one of four designs ported from the Hyperframes
 * catalog (lt-side-rule, lt-dark-card, lt-kicker-name, lower-third-bild). The
 * entrance and exit follow each block's own GSAP timeline, scaled to the tag's
 * duration: the exit starts 0.5 s before the end, as the blocks' does.
 *
 * Placed ABOVE the captions rather than on them: a caption line sits at the
 * bottom centre, and a tag in the catalog's own spot would sit on top of it.
 * Wraps instead of running off a 720-wide vertical frame.
 */
/** Even lines, so a long name never leaves one word alone on the last. */
const BALANCE = {textWrap: 'balance'} as React.CSSProperties;

export const LowerThird: React.FC<{
	design: LowerThirdDesign;
	title: string;
	subtitle?: string;
	/** The tone's accent (preset.cardInk). */
	accent: string;
	portrait: boolean;
	/** A chapter opening rather than a name tag: on a vertical frame it is set
	 *  larger, higher and over a shade (see `big`). */
	chapter?: boolean;
}> = ({design, title, subtitle, accent, portrait, chapter = false}) => {
	const frame = useCurrentFrame();
	const {fps, width, height, durationInFrames} = useVideoConfig();
	const t = frame / fps;
	const dur = durationInFrames / fps;
	const s = Math.min(width, height) / 1080;
	const out = dur - 0.5;
	// A chapter opening on a vertical frame. Sized from the short side, the
	// landscape design comes out at two thirds on 9:16 — a 15 px kicker — and
	// sits on the captions' shoulder. Here it is a third larger, in the upper
	// band (below the platforms' top bar, well above the captions), with wider
	// margins and a shade so it holds on any picture.
	const big = portrait && chapter;
	// Name and place tags on a vertical frame are a fifth larger for the same
	// reason, and keep their spot above the captions.
	const k = big ? 1.3 : portrait ? 1.2 : 1;
	// Small print never under 22 px on a vertical frame: a phone shows the
	// 720-wide frame at about half size.
	const fine = (n: number) => (portrait ? Math.max(n * s, big ? 26 : 22) : n * s);
	const shade = big ? power3Out(prog(t, 0, 0.4)) * (1 - power2In(prog(t, dur - 0.45, 0.4))) : 0;
	const Shade = big ? (
		<AbsoluteFill
			style={{
				background:
					'linear-gradient(180deg, rgba(0,0,0,0) 14%, rgba(0,0,0,0.5) 26%, rgba(0,0,0,0.5) 52%, rgba(0,0,0,0) 66%)',
				opacity: shade,
			}}
		/>
	) : null;

	const box: React.CSSProperties = big
		? {position: 'absolute', left: 52, right: 60, top: height * 0.3, maxWidth: width - 112}
		: {
				position: 'absolute',
				left: portrait ? 52 : 130 * s,
				right: portrait ? 60 : undefined,
				bottom: portrait ? 440 : 215,
				maxWidth: portrait ? width - 112 : width * 0.6,
			};

	if (design === 'sideRule') {
		const bar = power3Out(prog(t, 0.1, 0.5)) * (1 - power2In(prog(t, out + 0.07, 0.32)));
		const name = power3Out(prog(t, 0.26, 0.5));
		const role = power3Out(prog(t, 0.38, 0.5));
		const nameOut = power2In(prog(t, out + 0.05, 0.32));
		const roleOut = power2In(prog(t, out, 0.3));
		return (
			<AbsoluteFill>
				{Shade}
				<div style={{...box, display: 'flex', alignItems: 'stretch', gap: 26 * s}}>
					<div
						style={{
							width: 8 * s,
							background: accent,
							borderRadius: 4 * s,
							transform: `scaleY(${bar.toFixed(4)})`,
							transformOrigin: '50% 0%',
							flexShrink: 0,
						}}
					/>
					<div style={{display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 12 * s}}>
						<div
							style={{
								fontFamily: GF.leagueGothic,
								fontSize: 92 * s * k,
								...BALANCE,
								lineHeight: 1.0,
								color: '#FFFFFF',
								letterSpacing: '0.01em',
								textTransform: 'uppercase',
								textShadow: '0 2px 22px rgba(0,0,0,0.5)',
								opacity: name * (1 - nameOut),
								transform: `translate(${((1 - name) * -24).toFixed(2)}px, ${(nameOut * -14).toFixed(2)}px)`,
							}}
						>
							{title}
						</div>
						{subtitle && (
							<div
								style={{
									fontFamily: GF.jetbrainsMono,
									fontSize: fine(26),
									lineHeight: 1.25,
									color: '#E7EAF0',
									letterSpacing: '0.04em',
									textShadow: '0 2px 16px rgba(0,0,0,0.5)',
									opacity: role * (1 - roleOut),
									transform: `translateX(${((1 - role) * -24).toFixed(2)}px)`,
								}}
							>
								{subtitle}
							</div>
						)}
					</div>
				</div>
			</AbsoluteFill>
		);
	}

	if (design === 'darkCard') {
		const card = power3Out(prog(t, 0.1, 0.5));
		const cardOut = power2In(prog(t, out + 0.05, 0.35));
		const name = power3Out(prog(t, 0.26, 0.45));
		const rule = power4Out(prog(t, 0.42, 0.5));
		const role = power2Out(prog(t, 0.56, 0.45));
		return (
			<AbsoluteFill>
				{Shade}
				<div
					style={{
						...box,
						background: '#16181D',
						borderRadius: 14 * s,
						padding: `${24 * s}px ${38 * s}px ${26 * s}px ${32 * s}px`,
						boxShadow: '0 18px 50px rgba(0,0,0,0.4)',
						display: 'flex',
						flexDirection: 'column',
						gap: 12 * s,
						opacity: card * (1 - cardOut),
						transform: `translateY(${((1 - card) * 60 * s + cardOut * 24 * s).toFixed(2)}px)`,
					}}
				>
					<div
						style={{
							fontFamily: GF.montserrat,
							fontWeight: 700,
							// The card's sans reads smaller than the condensed faces at one size.
							fontSize: 48 * s * k * (portrait && !big ? 1.2 : 1),
							...BALANCE,
							lineHeight: 1.12,
							letterSpacing: '-0.015em',
							color: '#FFFFFF',
							opacity: name,
							transform: `translateY(${((1 - name) * 14 * s).toFixed(2)}px)`,
						}}
					>
						{title}
					</div>
					<div
						style={{
							height: 4 * s,
							background: accent,
							borderRadius: 2 * s,
							transform: `scaleX(${rule.toFixed(4)})`,
							transformOrigin: '0% 50%',
						}}
					/>
					{subtitle && (
						<div
							style={{
								fontFamily: GF.montserrat,
								fontWeight: 400,
								fontSize: portrait ? Math.max(25 * s * k, 24) : 25 * s,
								lineHeight: 1.25,
								letterSpacing: '0.02em',
								color: '#AEB6C2',
								opacity: role,
							}}
						>
							{subtitle}
						</div>
					)}
				</div>
			</AbsoluteFill>
		);
	}

	if (design === 'kicker') {
		const kick = backOut(2)(prog(t, 0.1, 0.42));
		const kickOut = power2In(prog(t, out + 0.07, 0.3));
		const name = backOut(1.5)(prog(t, 0.32, 0.45));
		const nameFade = power3Out(prog(t, 0.32, 0.3));
		const nameOut = power2In(prog(t, out + 0.05, 0.32));
		const base = power4Out(prog(t, 0.5, 0.5)) * (1 - power2In(prog(t, out, 0.3)));
		return (
			<AbsoluteFill>
				{Shade}
				<div style={{...box, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 14 * s}}>
					{subtitle && (
						<div style={{overflow: 'visible'}}>
							<span
								style={{
									display: 'inline-block',
									fontFamily: GF.spaceMono,
									fontWeight: 700,
									fontSize: fine(22),
									color: '#141518',
									background: accent,
									padding: `${6 * s}px ${14 * s}px`,
									letterSpacing: '0.1em',
									textTransform: 'uppercase',
									opacity: 1 - kickOut,
									transform: `translateY(${((1 - kick) * -40 * s + kickOut * -40 * s).toFixed(2)}px)`,
								}}
							>
								{subtitle}
							</span>
						</div>
					)}
					<div
						style={{
							fontFamily: GF.archivoBlack,
							fontSize: 70 * s * k,
							...BALANCE,
							lineHeight: 1.08,
							letterSpacing: '-0.015em',
							textTransform: 'uppercase',
							color: '#FFFFFF',
							textShadow: '0 2px 22px rgba(0,0,0,0.5)',
							opacity: nameFade * (1 - nameOut),
							transform: `translateY(${((1 - name) * 34 * s + nameOut * -16 * s).toFixed(2)}px)`,
						}}
					>
						{title}
					</div>
					<div
						style={{
							alignSelf: 'stretch',
							height: 5 * s,
							background: accent,
							borderRadius: 3 * s,
							transform: `scaleX(${base.toFixed(4)})`,
							transformOrigin: '0% 50%',
						}}
					/>
				</div>
			</AbsoluteFill>
		);
	}

	// newsBar — the catalog's BILD bar cuts in and out hard, as a news graphic
	// does; the only motion is a short slide so the cut is not a pop.
	const inn = power3Out(prog(t, 0, 0.25));
	const sub = power3Out(prog(t, 0.12, 0.25));
	const gone = t >= dur - 0.08;
	if (gone) return null;
	return (
		<AbsoluteFill>
			{Shade}
			<div style={{...box, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 22 * s * k}}>
				<div
					style={{
						fontFamily: GF.barlowCondensed,
						fontWeight: 800,
						fontSize: 88 * s * k,
						...BALANCE,
						lineHeight: 1.12,
						color: '#212529',
						background: '#FFFFFF',
						padding: `${10 * s}px ${22 * s}px ${8 * s}px`,
						textTransform: 'uppercase',
						letterSpacing: '0.02em',
						boxShadow: `${12 * s}px ${12 * s}px 0 0 ${accent}`,
						opacity: inn,
						transform: `translateX(${((1 - inn) * -30 * s).toFixed(2)}px)`,
					}}
				>
					{title}
				</div>
				{subtitle && (
					<div
						style={{
							fontFamily: GF.barlowCondensed,
							fontWeight: 700,
							fontSize: 48 * s * k,
							lineHeight: 1.15,
							color: '#FFFFFF',
							background: accent,
							padding: `${6 * s}px ${18 * s}px ${5 * s}px`,
							textTransform: 'uppercase',
							letterSpacing: '0.04em',
							boxShadow: `${8 * s}px ${8 * s}px 0 0 #FFFFFF`,
							opacity: sub,
							transform: `translateX(${((1 - sub) * -30 * s).toFixed(2)}px)`,
						}}
					>
						{subtitle}
					</div>
				)}
			</div>
		</AbsoluteFill>
	);
};
