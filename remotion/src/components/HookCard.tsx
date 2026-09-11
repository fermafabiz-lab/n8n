import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import type {StylePreset} from '../style';
import type {EvidenceClaim} from '../types';
import type {HookPlan} from '../hook';
import {CURVES, curveAt, eased} from '../easing';
import {fitTitleSize} from '../fitType';

/**
 * The one card a hook style may put over its shots.
 *
 * Three styles draw one, and each draws a different thing:
 *
 *  - `question`  the question the film answers, set as a statement over the
 *                teaser — the size and movement of the retired opening title,
 *                with words rather than a project name.
 *  - `figure`    a number the film states, huge, with what it counts under it
 *                and its source when the research pack has one.
 *  - `slate`     PLACE and DATE over the establishing frame — a documentary
 *                slate: tracked capitals, a short rule, the date as eyebrow.
 *
 * `teaser`, `action` and `cliffhanger` draw nothing; the shots are the hook.
 *
 * Every card here shares one vocabulary with the chapter card and the retired
 * hook title: words rise and fade on ONE curve with no mask, the block settles
 * out of a slight scale, and the exit lifts and blurs faster than the entrance
 * arrived. A darkening band sits behind the type, never a panel — the card is
 * OVER the teaser, and the teaser is the point.
 *
 * Timing is the caller's (`hookCardWindow` in src/hook.ts): the component only
 * knows how long it has, and every reveal is budgeted to FINISH inside that,
 * the rule the chapter card learned the hard way.
 */
const WORD_REVEAL = 0.55;
const RISE_EM = 0.42;
const OUT = 0.45;
const LINE_HEIGHT = 1.12;
/** The last word must have landed this long before the exit begins. */
const LANDED_BEFORE_EXIT = 0.35;

export const HookCard: React.FC<{
	plan: HookPlan;
	/** How long the card is on screen — the window from `hookCardWindow`. */
	seconds: number;
	preset: StylePreset;
	/** To print a figure's source by name rather than by its E-ref. */
	evidence?: EvidenceClaim[];
}> = ({plan, seconds, preset, evidence = []}) => {
	const frame = useCurrentFrame();
	const {fps, width, height} = useVideoConfig();
	const px = (n: number) => n * (width / 1280);
	const t = frame / fps;
	if (t > seconds) return null;

	const style = plan.style;
	const line1 = plan.card.line1;
	const line2 = plan.card.line2;
	const words = line1.split(/\s+/).filter(Boolean);
	if (!words.length) return null;

	// Exit: lift, blur and fade, decisively.
	const outStart = Math.max(0.6, seconds - OUT);
	const outP = curveAt((t - outStart) / OUT, CURVES.inOutCubic);
	const settle = curveAt(t / 0.9, CURVES.outExpo);
	const blockScale = 1.04 - 0.04 * settle;
	const blockBlur = (1 - settle) * width * 0.004 + outP * width * 0.004;
	const blockLift = -outP * height * 0.03;
	const blockOpacity = 1 - outP;
	if (blockOpacity <= 0) return null;
	const scrim = Math.min(settle, 1 - outP);

	// The stagger compresses so the LAST word lands before the exit — a card
	// that leaves mid-reveal was never read.
	const revealStart = 0.06;
	const budget = outStart - LANDED_BEFORE_EXIT - revealStart - WORD_REVEAL;
	const stagger = Math.min(0.07, Math.max(0, budget) / Math.max(1, words.length - 1));
	const wordP = (i: number) =>
		curveAt((t - revealStart - i * stagger) / WORD_REVEAL, CURVES.outQuart);

	const avail = width * (width < height ? 0.88 : 0.82);

	// --- the three layouts differ only in what the main line is and how big ---
	const fontSize =
		style === 'figure'
			? fitTitleSize({
					words,
					advance: preset.titleAdvance,
					spaceRatio: preset.titleSpaceRatio,
					wrapWidth: avail * 0.94,
					maxSize: width * 0.26,
					minSize: width * 0.05,
					maxLines: 1,
					lineHeight: 1.0,
					maxHeight: height * 0.4,
				})
			: style === 'slate'
				? fitTitleSize({
						words,
						// Tracked capitals set wider than the face's own advance says.
						advance: preset.titleAdvance + 0.14,
						spaceRatio: preset.titleSpaceRatio,
						wrapWidth: avail * 0.9,
						maxSize: width * 0.062,
						minSize: width * 0.026,
						maxLines: 2,
						lineHeight: 1.25,
						maxHeight: height * 0.3,
					})
				: fitTitleSize({
						words,
						advance: preset.titleAdvance,
						spaceRatio: preset.titleSpaceRatio,
						wrapWidth: avail * 0.94,
						maxSize: width * 0.088,
						minSize: width * 0.03,
						maxLines: 3,
						lineHeight: LINE_HEIGHT,
						maxHeight: height * 0.56,
					});
	const smallSize = Math.max(px(15), fontSize * (style === 'figure' ? 0.14 : 0.3));

	// A figure's source, by name. The plan carries the evidence REF the guard
	// verified (E1..E20); the ref is bookkeeping, the source is what a viewer
	// is owed. A figure copied from the narration has no source and no line.
	const sourceLine = (() => {
		if (style !== 'figure' || !plan.card.source) return '';
		const e = evidence.find((c) => c.ref === plan.card.source);
		if (!e || !e.source) return '';
		return e.date ? `${e.source} · ${e.date}` : e.source;
	})();
	// The line under the main one arrives after it, on the same curve.
	const subStart = revealStart + (words.length - 1) * stagger + WORD_REVEAL * 0.6;
	const subP = curveAt((t - subStart) / 0.5, CURVES.outQuart);

	const wordSpans = (extra: React.CSSProperties = {}) =>
		words.map((word, wi) => {
			const e = wordP(wi);
			return (
				<React.Fragment key={wi}>
					<span
						style={{
							display: 'inline-block',
							opacity: e,
							transform: `translateY(${((1 - e) * RISE_EM).toFixed(4)}em)`,
							overflowWrap: 'anywhere',
							maxWidth: '100%',
							...extra,
						}}
					>
						{word}
					</span>
					{wi < words.length - 1 ? ' ' : null}
				</React.Fragment>
			);
		});

	return (
		<AbsoluteFill style={{justifyContent: 'center', alignItems: 'center', pointerEvents: 'none'}}>
			{/* The band darkens under the type and clears with it. */}
			<AbsoluteFill
				style={{
					opacity: scrim,
					background:
						style === 'slate'
							? 'linear-gradient(180deg, rgba(0,0,0,0.05) 0%, rgba(0,0,0,0.42) 36%, rgba(0,0,0,0.42) 64%, rgba(0,0,0,0.05) 100%)'
							: 'linear-gradient(180deg, rgba(0,0,0,0.12) 0%, rgba(0,0,0,0.58) 34%, rgba(0,0,0,0.58) 66%, rgba(0,0,0,0.12) 100%)',
				}}
			/>
			<div
				style={{
					width: `${(avail / width) * 100}%`,
					textAlign: 'center',
					opacity: blockOpacity,
					transform: `translateY(${blockLift}px) scale(${blockScale.toFixed(4)})`,
					filter: blockBlur > 0.3 ? `blur(${blockBlur.toFixed(2)}px)` : undefined,
				}}
			>
				{style === 'slate' && line2 && (
					// The DATE as eyebrow, above the place — read first, as a slate is.
					<div
						style={{
							fontFamily: preset.kickerFont,
							fontWeight: 500,
							fontSize: smallSize * 0.9,
							letterSpacing: smallSize * 0.3,
							textIndent: smallSize * 0.3,
							textTransform: 'uppercase',
							color: '#F2E9D8',
							opacity: settle,
							marginBottom: fontSize * 0.55,
						}}
					>
						{line2}
					</div>
				)}

				<h1
					style={{
						fontFamily: preset.displayFont,
						fontWeight: preset.displayWeight,
						fontSize,
						color: style === 'figure' ? preset.cardInk : '#FFFFFF',
						lineHeight: style === 'figure' ? 1.0 : style === 'slate' ? 1.25 : LINE_HEIGHT,
						margin: 0,
						letterSpacing:
							style === 'slate'
								? '0.14em'
								: preset.uppercaseTitle
									? '0.005em'
									: '-0.022em',
						textTransform: style === 'slate' || preset.uppercaseTitle ? 'uppercase' : 'none',
						textShadow: `0 ${fontSize * 0.03}px ${fontSize * 0.18}px rgba(0,0,0,0.55)`,
						fontVariantNumeric: style === 'figure' ? 'tabular-nums' : undefined,
					}}
				>
					{wordSpans()}
				</h1>

				{style === 'slate' && (
					// A short rule drawn from the middle out — the slate's own idiom,
					// and the one place in the opening a rule belongs.
					<div
						style={{
							height: Math.max(1, px(2)),
							width: eased(t, [0.3, 0.95], [0, fontSize * 2.2], CURVES.outExpo),
							background: '#F2E9D8',
							margin: `${fontSize * 0.5}px auto 0`,
							opacity: 0.85,
						}}
					/>
				)}

				{style === 'figure' && line2 && (
					<div
						style={{
							fontFamily: preset.captionFont,
							fontWeight: 500,
							fontSize: smallSize * 1.6,
							lineHeight: 1.3,
							color: '#F5F2EA',
							marginTop: fontSize * 0.12,
							opacity: subP,
							transform: `translateY(${((1 - subP) * smallSize * 0.5).toFixed(2)}px)`,
							textShadow: `0 ${px(2)}px ${px(10)}px rgba(0,0,0,0.6)`,
						}}
					>
						{line2}
					</div>
				)}

				{style === 'figure' && sourceLine && (
					<div
						style={{
							fontFamily: preset.kickerFont,
							fontWeight: 500,
							fontSize: smallSize * 0.85,
							letterSpacing: smallSize * 0.2,
							textTransform: 'uppercase',
							color: preset.cardInk,
							marginTop: fontSize * 0.14,
							opacity: curveAt((t - subStart - 0.2) / 0.5, CURVES.outQuart),
						}}
					>
						{sourceLine}
					</div>
				)}
			</div>
		</AbsoluteFill>
	);
};
