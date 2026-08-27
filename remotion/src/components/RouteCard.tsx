import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import type {StylePreset} from '../style';
import type {TextCardSpec} from '../types';
import {CURVES, curveAt, eased} from '../easing';

/**
 * The route card: a chart that unfolds, and a line that draws itself across it.
 *
 * ## What earns it the frame
 *
 * The same test every card has to pass — does it show what the narration is
 * NOT saying? A map that unfolds while the voice says "he unfolds the map",
 * over footage of a man unfolding a map, is the same fact three times and the
 * captions are already printing one of them. What the picture cannot show is
 * the SHAPE of the journey: where it starts, how many legs it has, and how
 * absurdly far the far end is. That is why the stops are drawn in order and
 * why `note` (a distance) is the only number on the card.
 *
 * ## Why it is paper and not a UI
 *
 * The unfold is two overlapping beats — the sheet opens across, then down —
 * and the creases stay faintly visible afterwards. That is the whole reason
 * it reads as a folded chart rather than a panel that scaled in: a panel has
 * no reason to have been folded. Nothing here is linear, per easing.ts.
 *
 * ## Why the labels follow the pen
 *
 * A stop's reveal starts at the moment the pen ARRIVES there — `timeAtProgress`
 * inverts the eased draw to find that moment — rather than on a schedule of its
 * own. So the line reaching a place is what puts its name on screen: one causal
 * chain the eye can follow, instead of two animations that happen to overlap.
 */

/** Shared with TextCard: one card family, one fade. */
const IN = 0.22;
const OUT = 0.2;
const INK = '#0B0A08';
const PAPER_LINE = 'rgba(238, 230, 214, 0.16)';

/** The unfold. Across first, then down — the way a map is opened. */
const FOLD_X: readonly [number, number] = [0, 0.24];
const FOLD_Y: readonly [number, number] = [0.14, 0.44];
/** The graticule, once there is a sheet to print it on. */
const GRID: readonly [number, number] = [0.3, 0.68];
/** The pen. Slow in, slow out: a finger tracing, not a wipe. */
const DRAW: readonly [number, number] = [0.46, 1.72];
/** The distance lands last, and must still settle before the exit. */
const NOTE: readonly [number, number] = [1.75, 2.05];
/** How long a stop takes to arrive, once the pen has reached it. */
const STOP_REVEAL = 0.32;

type Pt = {x: number; y: number};

const quadAt = (a: Pt, c: Pt, b: Pt, u: number): Pt => {
	const m = 1 - u;
	return {
		x: m * m * a.x + 2 * m * u * c.x + u * u * b.x,
		y: m * m * a.y + 2 * m * u * c.y + u * u * b.y,
	};
};

/**
 * The curve as a polyline plus its cumulative length, so both "draw the first
 * p of it" and "where is stop k" are answered by ARC LENGTH rather than by the
 * Bezier parameter. They are not the same thing: `u` runs fast through the
 * bow and slow at the ends, so spacing stops by `u` would bunch them visibly
 * at the corners of the frame while the pen appeared to change speed.
 */
const traceCurve = (a: Pt, c: Pt, b: Pt, steps = 240) => {
	const pts: Pt[] = [];
	const cum: number[] = [0];
	for (let i = 0; i <= steps; i++) {
		const p = quadAt(a, c, b, i / steps);
		pts.push(p);
		if (i > 0) {
			const q = pts[i - 1];
			cum.push(cum[i - 1] + Math.hypot(p.x - q.x, p.y - q.y));
		}
	}
	return {pts, cum, length: cum[cum.length - 1]};
};

const pointAtFraction = (t: ReturnType<typeof traceCurve>, f: number): Pt => {
	const target = Math.min(1, Math.max(0, f)) * t.length;
	const i = t.cum.findIndex((l) => l >= target);
	if (i <= 0) return t.pts[0];
	const span = t.cum[i] - t.cum[i - 1] || 1;
	const k = (target - t.cum[i - 1]) / span;
	return {
		x: t.pts[i - 1].x + (t.pts[i].x - t.pts[i - 1].x) * k,
		y: t.pts[i - 1].y + (t.pts[i].y - t.pts[i - 1].y) * k,
	};
};

/**
 * When the pen reaches fraction `u` — the eased draw, inverted.
 *
 * The obvious version of this ("reveal a stop once `drawn` has passed `u`, over
 * the next few percent of progress") is wrong at exactly one place, and it is
 * the place that matters: the DESTINATION sits at u = 1, `drawn` is clamped at
 * 1, so `(drawn - u)` never becomes positive and the far end of the journey
 * never appears at all. Measured on the first render — the line reached Tahiti
 * and Tahiti was not there. Inverting instead gives every stop the same
 * treatment and a real clock of its own, so the last one lands like the rest.
 */
const timeAtProgress = (u: number): number => {
	if (u <= 0) return DRAW[0];
	let lo = DRAW[0];
	let hi = DRAW[1];
	for (let i = 0; i < 24; i++) {
		const mid = (lo + hi) / 2;
		if (eased(mid, DRAW, [0, 1], CURVES.inOutCubic) < u) lo = mid;
		else hi = mid;
	}
	return hi;
};

/** The drawn prefix as an SVG path, ending exactly on the pen. */
const prefixPath = (t: ReturnType<typeof traceCurve>, p: number): string => {
	const target = Math.min(1, Math.max(0, p)) * t.length;
	let d = `M ${t.pts[0].x.toFixed(2)} ${t.pts[0].y.toFixed(2)}`;
	for (let i = 1; i < t.pts.length; i++) {
		if (t.cum[i] >= target) break;
		d += ` L ${t.pts[i].x.toFixed(2)} ${t.pts[i].y.toFixed(2)}`;
	}
	const head = pointAtFraction(t, p);
	return `${d} L ${head.x.toFixed(2)} ${head.y.toFixed(2)}`;
};

export const RouteCard: React.FC<{
	card: TextCardSpec;
	/** Actual on-screen window — from the planned SHOT, never from the spec. */
	seconds: number;
	preset: StylePreset;
}> = ({card, seconds, preset}) => {
	const frame = useCurrentFrame();
	const {fps, width, height} = useVideoConfig();
	const px = (n: number) => n * (width / 1280);
	const t = frame / fps;
	if (t > seconds) return null;

	const stops = (card.stops ?? []).filter(Boolean);
	if (stops.length < 2) return null;

	const inP = Math.min(1, t / IN);
	const outP = Math.max(0, (t - (seconds - OUT)) / OUT);
	const opacity =
		curveAt(inP, CURVES.outQuart) * (1 - curveAt(Math.min(1, outP), CURVES.inOutCubic));

	// The sheet. Wide and shallow, because a route is read left to right and
	// the bottom third has to stay clear for the names.
	const sheetW = width * (height > width ? 0.88 : 0.8);
	const sheetH = sheetW * 0.5;

	// The bow lives in the upper two thirds; every label hangs BELOW its dot,
	// which is what keeps names off the line without any collision logic.
	const A = {x: sheetW * 0.1, y: sheetH * 0.62};
	const C = {x: sheetW * 0.5, y: sheetH * 0.12};
	const B = {x: sheetW * 0.88, y: sheetH * 0.46};
	const curve = traceCurve(A, C, B);

	const foldX = eased(t, FOLD_X, [0.32, 1], CURVES.outQuart);
	const foldY = eased(t, FOLD_Y, [0.1, 1], CURVES.outQuart);
	const grid = eased(t, GRID, [0, 1], CURVES.outQuart);
	const drawn = eased(t, DRAW, [0, 1], CURVES.inOutCubic);
	const noteIn = eased(t, NOTE, [0, 1], CURVES.outQuart);

	const stroke = preset.cardInk;
	// Sized to be read at a glance from a sofa, not to be admired at 100%. The
	// first pass set these at 19px against a 1280 frame and every name read as
	// small print — a label nobody has time to read is a label that is not there.
	const labelSize = px(24);
	const head = pointAtFraction(curve, drawn);

	return (
		<AbsoluteFill
			style={{background: INK, opacity, justifyContent: 'center', alignItems: 'center'}}
		>
			<div
				style={{
					position: 'relative',
					width: sheetW,
					height: sheetH,
					transform: `scale(${foldX.toFixed(4)}, ${foldY.toFixed(4)})`,
				}}
			>
				<svg width={sheetW} height={sheetH} style={{display: 'block', overflow: 'visible'}}>
					{/* Graticule — a chart's own ruling, not a UI grid: unevenly
					    weighted, so it reads as printed rather than drawn by us. */}
					<g opacity={grid * 0.9}>
						{Array.from({length: 7}, (_, i) => (
							<line
								key={`v${i}`}
								x1={(sheetW / 8) * (i + 1)}
								y1={0}
								x2={(sheetW / 8) * (i + 1)}
								y2={sheetH}
								stroke={PAPER_LINE}
								strokeWidth={px(1)}
								opacity={i % 2 ? 0.55 : 1}
							/>
						))}
						{Array.from({length: 4}, (_, i) => (
							<line
								key={`h${i}`}
								x1={0}
								y1={(sheetH / 5) * (i + 1)}
								x2={sheetW}
								y2={(sheetH / 5) * (i + 1)}
								stroke={PAPER_LINE}
								strokeWidth={px(1)}
								opacity={i % 2 ? 0.55 : 1}
							/>
						))}
					</g>

					{/* The creases stay. A sheet that unfolds and then shows no fold
					    was never folded — it was a panel that scaled in. */}
					<g opacity={grid}>
						{[1 / 3, 2 / 3].map((f) => (
							<line
								key={`c${f}`}
								x1={sheetW * f}
								y1={0}
								x2={sheetW * f}
								y2={sheetH}
								stroke="rgba(245, 242, 234, 0.3)"
								strokeWidth={px(1.5)}
							/>
						))}
						<line
							x1={0}
							y1={sheetH / 2}
							x2={sheetW}
							y2={sheetH / 2}
							stroke="rgba(245, 242, 234, 0.22)"
							strokeWidth={px(1.5)}
						/>
					</g>

					{/* The route, dashed like a plotted course. */}
					<path
						d={prefixPath(curve, drawn)}
						fill="none"
						stroke={stroke}
						strokeWidth={px(4)}
						strokeLinecap="round"
						strokeDasharray={`${px(13)} ${px(10)}`}
					/>

					{/* The pen: the head of the line, only while it is moving. */}
					{drawn > 0.001 && drawn < 0.999 && (
						<circle cx={head.x} cy={head.y} r={px(6)} fill={stroke} />
					)}

					{stops.map((_, i) => {
						const u = i / (stops.length - 1);
						const p = curveAt((t - timeAtProgress(u)) / STOP_REVEAL, CURVES.outQuart);
						if (p <= 0) return null;
						const at = pointAtFraction(curve, u);
						const last = i === stops.length - 1;
						// The destination is a filled mark; everything before it is a
						// waypoint the line merely passes through.
						return (
							<g key={`s${i}`} opacity={p}>
								<circle
									cx={at.x}
									cy={at.y}
									r={px(last ? 11 : 7) * (0.6 + 0.4 * p)}
									fill={last ? stroke : INK}
									stroke={stroke}
									strokeWidth={px(2.5)}
								/>
							</g>
						);
					})}
				</svg>

				{/* Names as HTML, not SVG text: tracking, uppercasing and the font
				    stack all behave here, and a label is type rather than drawing. */}
				{stops.map((name, i) => {
					const u = i / (stops.length - 1);
					const p = curveAt((t - timeAtProgress(u)) / STOP_REVEAL, CURVES.outQuart);
					if (p <= 0) return null;
					const at = pointAtFraction(curve, u);
					const last = i === stops.length - 1;
					return (
						<div
							key={`l${i}`}
							style={{
								position: 'absolute',
								left: at.x,
								top: at.y + px(22),
								transform: `translate(-50%, ${((1 - p) * px(10)).toFixed(2)}px)`,
								opacity: p,
								whiteSpace: 'nowrap',
								fontFamily: preset.kickerFont,
								fontWeight: 500,
								fontSize: labelSize * (last ? 1.3 : 1),
								letterSpacing: labelSize * 0.16,
								textTransform: 'uppercase',
								color: last ? stroke : '#EDE7DA',
							}}
						>
							{name}
						</div>
					);
				})}

				{card.label && (
					<div
						style={{
							position: 'absolute',
							left: 0,
							top: -px(34),
							opacity: grid,
							fontFamily: preset.kickerFont,
							fontWeight: 500,
							fontSize: px(16),
							letterSpacing: px(16) * 0.24,
							textTransform: 'uppercase',
							color: 'rgba(237, 231, 218, 0.55)',
						}}
					>
						{card.label}
					</div>
				)}

				{card.note && (
					<div
						style={{
							position: 'absolute',
							right: 0,
							bottom: -px(34),
							opacity: noteIn,
							transform: `translateY(${((1 - noteIn) * px(8)).toFixed(2)}px)`,
							fontFamily: preset.kickerFont,
							fontWeight: 500,
							fontSize: px(19),
							letterSpacing: px(19) * 0.18,
							textTransform: 'uppercase',
							color: stroke,
						}}
					>
						{card.note}
					</div>
				)}
			</div>
		</AbsoluteFill>
	);
};
