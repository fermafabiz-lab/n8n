import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import type {StylePreset} from '../style';
import type {TextCardSpec} from '../types';
import {CURVES, curveAt, eased} from '../easing';

/**
 * The timeline card: a dimension line measured out across a span of years.
 *
 * ## What earns it the frame
 *
 * The same test as the other two motifs — does it show what the narration is
 * NOT saying? A film about a life says its dates one at a time, minutes apart,
 * in the middle of sentences: 1941, then 1952, then 1962, then 1966. A
 * listener cannot hold four dates, and nobody can hear the SHAPE of them —
 * that the first two are twenty-one years apart and the last two are four.
 * That shape is this card's whole content, and it is why the marks sit at
 * their real positions rather than at even intervals: the gaps ARE the fact.
 *
 * It exists because the first two motifs could not take the commonest material
 * this pipeline produces. `route` wants a journey with named stops; `schedule`
 * wants clock times. A model handed a film of dates and sums had neither, and
 * the failure was visible in production: asked for a schedule, it rendered the
 * years 1893 and 1896 as the clock times "18:93" and "18:96", which the
 * validator rejected — correctly, and with nothing left to draw.
 *
 * ## Why a dimension line and not a list
 *
 * A drawing that says "this far, between these two" has a settled convention:
 * a rule with end caps, and the measurement written above it. Borrowing it
 * costs nothing and tells the viewer what kind of statement this is before
 * they have read a word of it. A list of years down the frame would be the
 * script again, typeset — the exact failure a card is supposed to avoid.
 *
 * ## Why the ticks land under the rule as it passes
 *
 * Same causal chain as the route card's pen: the rule reaching a year is what
 * puts that year on screen, so there is one thing to follow rather than two
 * animations that happen to overlap. `timeAtProgress` inverts the eased draw
 * to find the moment the rule arrives.
 *
 * ## Why it turns on its side for a vertical film
 *
 * Five marks across a 9:16 frame is 633 pixels for five dates and five labels,
 * and the first portrait still showed exactly that: type at half the size it
 * has in landscape, three-word labels wrapping into columns two characters
 * wide. A phone has no width and plenty of height, so on a portrait film the
 * dimension line runs DOWN the frame instead — years to the left of it, labels
 * to the right — which is the same drawing rotated, not a second design. Type
 * is sized against the frame's own short side for the same reason: a card that
 * fills the frame should not shrink because the frame is narrow.
 *
 * ## Why the spacing can compromise
 *
 * True proportion can put two marks on top of each other — 1975 and 1977 in a
 * span that starts in 1941 are two percent apart, and two labels two percent
 * apart are one illegible label. The positions are therefore blended toward
 * even spacing by the SMALLEST amount that makes every gap readable, and no
 * more. Proportion is the point, so it is given up by the minimum, not
 * abandoned at the first collision.
 */

/** Shared with the other cards: one family, one fade. */
const IN = 0.22;
const OUT = 0.2;
const INK = '#0B0A08';
const PAPER_LINE = 'rgba(238, 230, 214, 0.16)';

/** The strip of paper is pulled out first, then ruled. */
const SHEET: readonly [number, number] = [0, 0.26];
/** The ledger's own ruling, once there is paper to print it on. */
const GRID: readonly [number, number] = [0.2, 0.6];
/** The rule itself, measured out left to right. Slow in, slow out. */
const DRAW: readonly [number, number] = [0.42, 1.6];
/** The measurement lands last, and must settle before the exit. */
const NOTE: readonly [number, number] = [1.62, 1.95];
/** How long a mark takes to arrive, once the rule has reached it. */
const MARK_REVEAL = 0.34;
/**
 * The closest two marks may sit, as a fraction of the rule's length. Below
 * this their labels touch; four characters of year at 26px need roughly a
 * sixth of a 1024px rule.
 */
const MIN_GAP = 0.17;

/** The year a mark is pinned at, or null if it does not state one. */
export const yearOf = (at: string): number | null => {
	const m = /-?\d+/.exec(String(at ?? ''));
	if (!m) return null;
	const n = Number(m[0]);
	return Number.isFinite(n) ? n : null;
};

/**
 * Positions along the rule: proportional to the real years, conceded toward
 * even spacing by the least amount that keeps every label readable.
 *
 * Returns 0..1 fractions, always ascending.
 */
export const markPositions = (years: (number | null)[]): number[] => {
	const n = years.length;
	if (n <= 1) return years.map(() => 0.5);
	const even = years.map((_, i) => i / (n - 1));
	const usable = years.every((y) => y !== null) && (years[n - 1] as number) > (years[0] as number);
	if (!usable) return even;
	const lo = years[0] as number;
	const hi = years[n - 1] as number;
	const prop = years.map((y) => ((y as number) - lo) / (hi - lo));
	const blend = (k: number) => prop.map((p, i) => p * (1 - k) + even[i] * k);
	const minGap = (xs: number[]) =>
		xs.slice(1).reduce((m, x, i) => Math.min(m, x - xs[i]), Infinity);
	if (minGap(prop) >= MIN_GAP) return prop;
	// Even spacing is the widest any gap can be, so if it still fails there is
	// nothing to search for — that is a card with too many marks, which the
	// validator refuses before it ever gets here.
	let lo_k = 0;
	let hi_k = 1;
	for (let i = 0; i < 24; i++) {
		const mid = (lo_k + hi_k) / 2;
		if (minGap(blend(mid)) < MIN_GAP) lo_k = mid;
		else hi_k = mid;
	}
	return blend(hi_k);
};

/** When the rule reaches fraction `u` — the eased draw, inverted. */
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

export const TimelineCard: React.FC<{
	card: TextCardSpec;
	/** Actual on-screen window — from the planned SHOT, never from the spec. */
	seconds: number;
	preset: StylePreset;
}> = ({card, seconds, preset}) => {
	const frame = useCurrentFrame();
	const {fps, width, height} = useVideoConfig();
	const portrait = height > width;
	// Against the frame's SHORT side, so a vertical film gets the same type it
	// would get on a phone-sized landscape one rather than 56% of it.
	const px = (n: number) => n * (width / (portrait ? 720 : 1280));
	const t = frame / fps;
	if (t > seconds) return null;

	const marks = (card.marks ?? []).filter((m) => m && String(m.at ?? '').trim());
	if (marks.length < 2) return null;

	const inP = Math.min(1, t / IN);
	const outP = Math.max(0, (t - (seconds - OUT)) / OUT);
	const opacity =
		curveAt(inP, CURVES.outQuart) * (1 - curveAt(Math.min(1, outP), CURVES.inOutCubic));

	// Landscape: wide and shallow, read left to right. Portrait: tall and
	// narrow, read top to bottom. Same drawing, turned.
	const sheetW = portrait ? width * 0.86 : width * 0.8;
	const sheetH = portrait ? height * 0.6 : sheetW * 0.34;
	const pad = portrait ? sheetH * 0.06 : sheetW * 0.09;
	// Where the rule sits on the axis it does NOT run along.
	const ruleAcross = portrait ? sheetW * 0.42 : sheetH * 0.56;
	const from = pad;
	const to = (portrait ? sheetH : sheetW) - pad;

	const fractions = markPositions(marks.map((m) => yearOf(m.at)));

	const sheetIn = eased(t, SHEET, [0.3, 1], CURVES.outQuart);
	const grid = eased(t, GRID, [0, 1], CURVES.outQuart);
	const drawn = eased(t, DRAW, [0, 1], CURVES.inOutCubic);
	const noteIn = eased(t, NOTE, [0, 1], CURVES.outQuart);

	const stroke = preset.cardInk;
	const yearSize = px(30);
	const labelSize = px(19);
	const head = from + (to - from) * drawn;
	/** A point on the rule, in svg coordinates, whatever way it runs. */
	const at = (along: number) =>
		portrait ? {x: ruleAcross, y: along} : {x: along, y: ruleAcross};
	const capA = px(13);

	return (
		<AbsoluteFill
			style={{background: INK, opacity, justifyContent: 'center', alignItems: 'center'}}
		>
			<div
				style={{
					position: 'relative',
					width: sheetW,
					height: sheetH,
					// Pulled out along its own axis, the way a strip of paper comes
					// off a roll. One axis only, so it never reads as a panel
					// scaling in.
					transform: portrait
						? `scale(1, ${sheetIn.toFixed(4)})`
						: `scale(${sheetIn.toFixed(4)}, 1)`,
				}}
			>
				<svg width={sheetW} height={sheetH} style={{display: 'block', overflow: 'visible'}}>
					{/* Ledger ruling: across the reading direction, evenly weighted,
					    faint. It is the paper this is measured on, not a chart of its
					    own. */}
					<g opacity={grid * 0.9}>
						{Array.from({length: 5}, (_, i) =>
							portrait ? (
								<line
									key={`r${i}`}
									x1={(sheetW / 6) * (i + 1)}
									y1={0}
									x2={(sheetW / 6) * (i + 1)}
									y2={sheetH}
									stroke={PAPER_LINE}
									strokeWidth={px(1)}
									opacity={i % 2 ? 0.55 : 1}
								/>
							) : (
								<line
									key={`r${i}`}
									x1={0}
									y1={(sheetH / 6) * (i + 1)}
									x2={sheetW}
									y2={(sheetH / 6) * (i + 1)}
									stroke={PAPER_LINE}
									strokeWidth={px(1)}
									opacity={i % 2 ? 0.55 : 1}
								/>
							),
						)}
					</g>

					{/* The rule, measured out. Solid, unlike the route's dashed
					    course: this is a measurement, not a path anybody walked. */}
					<line
						x1={at(from).x}
						y1={at(from).y}
						x2={at(head).x}
						y2={at(head).y}
						stroke={stroke}
						strokeWidth={px(3)}
						strokeLinecap="butt"
					/>

					{/* End caps — the convention that says "between these two, this
					    far". The far one only exists once the rule has reached it. */}
					{[
						{along: from, o: curveAt(drawn / 0.06, CURVES.outQuart)},
						{along: to, o: curveAt((drawn - 0.985) / 0.015, CURVES.outQuart)},
					].map((cap, i) => {
						const p = at(cap.along);
						return (
							<line
								key={`cap${i}`}
								x1={portrait ? p.x - capA : p.x}
								y1={portrait ? p.y : p.y - capA}
								x2={portrait ? p.x + capA : p.x}
								y2={portrait ? p.y : p.y + capA}
								stroke={stroke}
								strokeWidth={px(3)}
								opacity={cap.o}
							/>
						);
					})}

					{marks.map((_, i) => {
						const u = fractions[i];
						const p = curveAt((t - timeAtProgress(u)) / MARK_REVEAL, CURVES.outQuart);
						if (p <= 0) return null;
						const c = at(from + (to - from) * u);
						const len = px(9) * p;
						return (
							<line
								key={`tick${i}`}
								x1={c.x}
								y1={c.y}
								x2={portrait ? c.x + len : c.x}
								y2={portrait ? c.y : c.y + len}
								stroke={stroke}
								strokeWidth={px(2.5)}
								opacity={p}
							/>
						);
					})}
				</svg>

				{/* Type as HTML, not SVG text: tracking, uppercasing and the font
				    stack all behave here. */}
				{marks.map((m, i) => {
					const u = fractions[i];
					const p = curveAt((t - timeAtProgress(u)) / MARK_REVEAL, CURVES.outQuart);
					if (p <= 0) return null;
					const c = at(from + (to - from) * u);
					// Landscape stacks year over label across the rule; portrait sets
					// them either side of it, which is the only way five three-word
					// labels fit a phone.
					const yearBox: React.CSSProperties = portrait
						? {
								left: c.x - px(22),
								top: c.y,
								transform: `translate(-100%, calc(-50% + ${((1 - p) * px(8)).toFixed(2)}px))`,
								textAlign: 'right',
							}
						: {
								left: c.x,
								top: c.y - px(20),
								transform: `translate(-50%, calc(-100% + ${((1 - p) * px(10)).toFixed(2)}px))`,
							};
					const labelBox: React.CSSProperties = portrait
						? {
								left: c.x + px(26),
								top: c.y,
								transform: `translate(0, calc(-50% + ${((1 - p) * px(8)).toFixed(2)}px))`,
								width: sheetW * 0.5,
								textAlign: 'left',
							}
						: {
								left: c.x,
								top: c.y + px(24),
								transform: `translate(-50%, ${((1 - p) * px(8)).toFixed(2)}px)`,
								width: px(150),
								textAlign: 'center',
							};
					return (
						<div key={`m${i}`}>
							<div
								style={{
									position: 'absolute',
									...yearBox,
									opacity: p,
									whiteSpace: 'nowrap',
									fontFamily: preset.kickerFont,
									fontWeight: 600,
									fontSize: yearSize,
									letterSpacing: yearSize * 0.1,
									color: stroke,
								}}
							>
								{m.at}
							</div>
							{m.label ? (
								<div
									style={{
										position: 'absolute',
										...labelBox,
										opacity: p * 0.92,
										fontFamily: preset.kickerFont,
										fontWeight: 500,
										fontSize: labelSize,
										lineHeight: 1.2,
										letterSpacing: labelSize * 0.14,
										textTransform: 'uppercase',
										color: '#EDE7DA',
									}}
								>
									{m.label}
								</div>
							) : null}
						</div>
					);
				})}

				{card.label && (
					<div
						style={{
							position: 'absolute',
							left: 0,
							top: -px(30),
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

				{/* The measurement, centred under the whole drawing — the one thing
				    here the narration never says: the size of the span. */}
				{card.note && (
					<div
						style={{
							position: 'absolute',
							left: sheetW / 2,
							top: sheetH + px(14),
							transform: `translate(-50%, ${((1 - noteIn) * px(8)).toFixed(2)}px)`,
							opacity: noteIn,
							whiteSpace: 'nowrap',
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
