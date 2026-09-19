import React from 'react';
import {
	AbsoluteFill,
	continueRender,
	delayRender,
	interpolate,
	useCurrentFrame,
	useVideoConfig,
} from 'remotion';
import {
	bandOpacityAt,
	labelInkDrop,
	labelTrailingSpace,
	markChipPadX,
	markOpenAt,
	markPillWidth,
	markRevealAt,
	planWatermarkBands,
	scaleWatermark,
	WATERMARK_LAYOUT,
	WATERMARK_STYLE,
	type VisualOrigin,
	type VisualProvenance,
	type WatermarkMark,
} from '../provenance';
import {DASHED_ORIGINS, GLYPH_STROKE, GLYPH_VIEWBOX, ORIGIN_GLYPHS} from '../provenanceGlyphs';
import type {StylePreset} from '../style';

/**
 * The small badge in the corner saying what the viewer is looking at:
 * AI GENERATED, ARCHIVAL FOOTAGE, ACTUAL FOOTAGE, SOURCE UNVERIFIED.
 *
 * It exists because the montage cuts generated pictures and real archive
 * material together and nothing on screen has ever distinguished them. It is
 * the least decorative element in the render on purpose — a claim about
 * truthfulness that draws attention to itself stops being read as one.
 *
 * Three things about it are decisions rather than styling:
 *
 * - **It is per BAND, not per scene.** Consecutive scenes with the same badge
 *   are one continuous label (see `planWatermarkBands`), so a documentary that
 *   runs six archive shots together does not blink the same words apart and
 *   back at every cut. A CHANGE still fades, which is the only moment a viewer
 *   needs to notice it.
 * - **The label and the licence credit are separate.** The producer may switch
 *   the label off; a credit CC BY or CC BY-SA demands is a legal obligation and
 *   survives that switch. So a band can carry a credit and no label, and the
 *   badge then draws only the credit, quieter.
 * - **It never sits over a full-frame card, or over the hook title.** A card
 *   REPLACES the picture, so labelling that frame's provenance would describe
 *   something the viewer cannot see; the hook is the film's one statement
 *   frame, and the same "one text element at a time" rule the captions follow
 *   applies. The caller owns both decisions — see FinalVideo.
 */

/**
 * One provenance glyph, drawn at `size` in the current colour.
 *
 * `currentColor` rather than a literal white: the same mark has to work on a
 * light scrim the day a blown-out shot needs one, and the pack ships a black
 * copy precisely because a flattened PNG cannot do that.
 */
const Glyph: React.FC<{origin: VisualOrigin; size: number}> = ({origin, size}) => (
	<svg
		width={size}
		height={size}
		viewBox={`0 0 ${GLYPH_VIEWBOX} ${GLYPH_VIEWBOX}`}
		fill="none"
		stroke="currentColor"
		strokeWidth={GLYPH_STROKE}
		strokeLinecap="round"
		strokeLinejoin="round"
		style={{flex: 'none', display: 'block'}}
	>
		{ORIGIN_GLYPHS[origin].map((p, i) =>
			p.filled ? (
				<path key={i} d={p.d} fill="currentColor" stroke="none" />
			) : (
				<path key={i} d={p.d} />
			),
		)}
	</svg>
);

/**
 * Ask the browser where this label's ink actually sits — see `labelInkDrop`,
 * which owns the arithmetic and the refusals. Only the canvas plumbing is
 * here, because only the drawing knows which font it resolved.
 */
const measureInkDrop = (
	label: string,
	fontSize: number,
	fontFamily: string,
	/** The span's own laid-out width, letter-spacing and all. */
	advance: number,
): number => {
	try {
		if (typeof document === 'undefined') return 0;
		const ctx = document.createElement('canvas').getContext('2d');
		if (!ctx) return 0;
		ctx.font = `${WATERMARK_STYLE.labelWeight} ${fontSize}px ${fontFamily}`;
		return labelInkDrop(ctx.measureText(label), label, fontSize, advance);
	} catch {
		return 0;
	}
};

/**
 * The badge itself: a square chip holding the glyph, which opens sideways into
 * a capsule carrying the label.
 *
 * The pill is BUILT rather than drawn from the pack's pill PNG, because a real
 * opening needs the width and the corner radius to be live values — two
 * flattened images can only be cross-faded, and a cross-fade reads as one mark
 * replacing another rather than as the same mark opening.
 *
 * The label's width is MEASURED, not estimated from its character count: the
 * eight labels differ by more than half a pill's width ("ARCHIVAL PHOTO"
 * against "ILLUSTRATIVE FOOTAGE"), and a guess clips the long ones. Remotion's
 * `delayRender` holds the frame until the browser has laid the text out, so
 * every frame of the render agrees on the same number.
 *
 * Measured PER LABEL, and again once the web fonts have settled — both of
 * which this got wrong, in ways that look identical on screen and are the
 * whole of "the text does not fit in the pill":
 *
 * - `SourceWatermark` keeps ONE `Mark` in the tree and hands it a new label at
 *   every band change, so a width taken on mount is the first band's width for
 *   the rest of the film. `renderStill` hides it (a fresh page per still, one
 *   band each) and `renderMedia` does not: a tab that seeks across a band
 *   boundary draws "ILLUSTRATIVE FOOTAGE" in a capsule cut for "REAL FOOTAGE".
 * - a web font that has not arrived yet lays the label out in the fallback
 *   face, which is a different width. Remotion holds the frame for OUR handle,
 *   not for the font's, so measuring on mount can measure the wrong typeface
 *   and then draw the right one.
 *
 * Both are answered the same way: a fresh `delayRender` per measurement round,
 * and the answer tagged with the label it belongs to so a stale one is simply
 * not believed.
 */
const Mark: React.FC<{
	origin: VisualOrigin;
	label: string;
	geom: WatermarkMark;
	fontSize: number;
	fontFamily: string;
	/** 0 = chip, 1 = pill. */
	open: number;
}> = ({origin, label, geom, fontSize, fontFamily, open}) => {
	const textRef = React.useRef<HTMLSpanElement>(null);
	const [measured, setMeasured] = React.useState<{
		label: string;
		advance: number;
		drop: number;
	} | null>(null);

	React.useLayoutEffect(() => {
		const handle = delayRender(`watermark label: ${label}`);
		let live = true;
		const release = () => {
			if (!live) return;
			live = false;
			continueRender(handle);
		};
		const read = () => {
			const el = textRef.current;
			if (!live || !el) return;
			// `offsetWidth`, NOT `getBoundingClientRect().width`: the rect is
			// the VISUAL box, so any CSS transform on an ancestor multiplies
			// it. Put this badge inside a scaled container — a magnified
			// preview, a picture-in-picture — and the measured label comes
			// back k times too wide, the pill is computed k times too wide in
			// layout pixels, and it is then scaled AGAIN. Found exactly that
			// way on a 2.8× review reel: the capsule ran off the frame.
			// `offsetWidth` is layout-based and ignores transforms, at the
			// cost of rounding to whole pixels.
			const advance = el.offsetWidth;
			setMeasured({label, advance, drop: measureInkDrop(label, fontSize, fontFamily, advance)});
		};
		read();
		const ready = typeof document === 'undefined' ? null : document.fonts?.ready;
		if (ready && typeof ready.then === 'function') {
			ready.then(
				() => {
					read();
					release();
				},
				() => release(),
			);
		} else {
			release();
		}
		return release;
	}, [label, fontSize, fontFamily]);

	// Nothing is believed until it is measured for THIS label. Before that the
	// capsule is its own empty width, which no frame is ever captured at — the
	// handle above holds the render until the number exists.
	const fresh = measured && measured.label === label ? measured : null;

	const {height, glyph, gap} = geom;
	const pillWidth = markPillWidth(geom, fontSize, fresh?.advance ?? 0);
	const width = interpolate(open, [0, 1], [height, pillWidth]);
	const radius = interpolate(open, [0, 1], [height * WATERMARK_STYLE.chipRadiusRatio, height / 2]);
	// The label uncovers from the glyph outward, clipped by the container, so
	// it reads as the mark opening rather than as a second element arriving.
	const reveal = markRevealAt(open);

	return (
		<div
			style={{
				position: 'relative',
				boxSizing: 'border-box',
				height,
				width,
				display: 'flex',
				alignItems: 'center',
				paddingLeft: interpolate(open, [0, 1], [markChipPadX(geom), geom.padX]),
				borderRadius: radius,
				background: WATERMARK_STYLE.labelBackground,
				border: `${WATERMARK_STYLE.markBorderWidth}px ${
					DASHED_ORIGINS.has(origin) ? 'dashed' : 'solid'
				} ${WATERMARK_STYLE.markBorderColor}`,
				color: WATERMARK_STYLE.labelColor,
				overflow: 'hidden',
				whiteSpace: 'nowrap',
			}}
		>
			<Glyph origin={origin} size={glyph} />
			<span
				ref={textRef}
				style={{
					marginLeft: gap,
					// Pull the trailing letter-space back out of the layout, so
					// the content really does end at the last letter and the
					// capsule's own `padX` is the only thing after it.
					marginRight: -labelTrailingSpace(fontSize),
					// Measured, not guessed — see `labelInkDrop`. Relative
					// rather than a transform: it must not touch the width the
					// round above just measured.
					position: 'relative',
					top: fresh?.drop ?? 0,
					fontFamily,
					fontSize,
					fontWeight: WATERMARK_STYLE.labelWeight,
					letterSpacing: WATERMARK_STYLE.labelLetterSpacing,
					lineHeight: WATERMARK_STYLE.labelLineHeight,
					color: WATERMARK_STYLE.labelColor,
					textShadow: WATERMARK_STYLE.textShadow,
					opacity: reveal,
				}}
			>
				{label}
			</span>
		</div>
	);
};

export const SourceWatermark: React.FC<{
	scenes: {startSeconds: number; durationSeconds: number; provenance?: VisualProvenance}[];
	preset: StylePreset;
	/** False = the producer switched the label off. Credits still draw. */
	showLabel: boolean;
	/**
	 * Open the pill only the FIRST time each kind of source appears; every
	 * later band of that kind stays the small chip. The producer's switch —
	 * a documentary that runs twenty archive shots says "ARCHIVAL FOOTAGE"
	 * once and then keeps a quiet mark in the corner.
	 */
	openOncePerOrigin?: boolean;
	/**
	 * How big the badge is drawn, as a multiplier — see `WATERMARK_SCALE`.
	 * Anything outside the range, or absent, is the 1× every film rendered
	 * before this existed was drawn at.
	 */
	scale?: number;
	/** Vertical (9:16): lift clear of the platform's own bottom chrome. */
	portrait?: boolean;
	/** Hide while the hook title owns the frame, exactly as captions do. */
	suppressUntilSeconds?: number;
}> = ({
	scenes,
	preset,
	showLabel,
	openOncePerOrigin = false,
	scale,
	portrait = false,
	suppressUntilSeconds = 0,
}) => {
	const frame = useCurrentFrame();
	const {fps} = useVideoConfig();
	const seconds = frame / fps;

	const bands = React.useMemo(
		() => planWatermarkBands(scenes, {showLabel, openOncePerOrigin}),
		[scenes, showLabel, openOncePerOrigin],
	);

	if (seconds < suppressUntilSeconds) return null;

	const band = bands.find((b) => seconds >= b.startSeconds && seconds < b.endSeconds);
	if (!band) return null;

	// Symmetric in and out. `inOutCubic` rather than an entrance curve: this is
	// not an arrival, it is a label becoming legible and then stopping.
	//
	// The TIMING moved to provenance.ts on 2026-09-19, when the site's preview
	// learned to animate: the preview has to play the same curve on the same
	// clock or it is showing a different overlay, and two implementations of
	// an easing cannot be kept in agreement by reading them. Same reason the
	// geometry moved there when the preview was first built.
	const bandLength = band.endSeconds - band.startSeconds;
	const into = seconds - band.startSeconds;
	const opacity = bandOpacityAt(into, bandLength);

	// Geometry lives in provenance.ts so the site's preview can mirror ONE
	// named constant instead of numbers read out of this JSX — and the size
	// the producer chose is applied there too, by one function, rather than
	// by multiplying numbers at each of the places that read them.
	const g = scaleWatermark(
		portrait ? WATERMARK_LAYOUT.portrait : WATERMARK_LAYOUT.landscape,
		scale,
	);

	// Opens once, just after the fade has brought it up, and STAYS open for
	// the rest of the band. `markOpenAt` owns why, and owns the compression a
	// band shorter than the animation needs.
	const open = markOpenAt(into, bandLength, band.expand);

	// Bottom-LEFT, on the same left edge the captions keep, and below the band
	// they occupy: captions are bottom-anchored at 84 (landscape) / 280
	// (portrait), so the badge sits under them in landscape and just under them
	// in portrait, where the bottom fifth belongs to the platform's own UI.
	return (
		<AbsoluteFill style={{pointerEvents: 'none'}}>
			<div
				style={{
					position: 'absolute',
					left: g.left,
					bottom: g.bottom,
					maxWidth: g.maxWidth,
					opacity,
					display: 'flex',
					flexDirection: 'column',
					gap: g.gap,
					alignItems: 'flex-start',
				}}
			>
				{band.label ? (
					<Mark
						origin={band.origin}
						label={band.label}
						geom={g.mark}
						fontSize={g.label.fontSize}
						fontFamily={preset.kickerFont}
						open={open}
					/>
				) : null}
				{/* The source line belongs to the label: a chip with a long
				    "Source: …" line under it reads as a broken pill rather than
				    a deliberate one. The CREDIT below is different — a licence
				    obligation, drawn whatever the switches say. */}
				{band.source && band.expand ? (
					<span
						style={{
							fontFamily: preset.kickerFont,
							fontSize: g.source.fontSize,
							letterSpacing: WATERMARK_STYLE.sourceLetterSpacing,
							color: WATERMARK_STYLE.sourceColor,
							background: WATERMARK_STYLE.lineBackground,
							borderRadius: WATERMARK_STYLE.lineRadius,
							padding: WATERMARK_STYLE.linePadding,
							textShadow: WATERMARK_STYLE.textShadow,
							lineHeight: WATERMARK_STYLE.lineLineHeight,
						}}
					>
						{band.source}
					</span>
				) : null}
				{/* The obligation. Drawn even when the label is off, which is the
				    whole reason it is its own line rather than part of the source
				    line above. */}
				{band.credit ? (
					<span
						style={{
							fontFamily: preset.kickerFont,
							fontSize: g.credit.fontSize,
							letterSpacing: WATERMARK_STYLE.creditLetterSpacing,
							color: WATERMARK_STYLE.creditColor,
							background: WATERMARK_STYLE.lineBackground,
							borderRadius: WATERMARK_STYLE.lineRadius,
							padding: WATERMARK_STYLE.linePadding,
							textShadow: WATERMARK_STYLE.textShadow,
							lineHeight: WATERMARK_STYLE.lineLineHeight,
						}}
					>
						{band.credit}
					</span>
				) : null}
			</div>
		</AbsoluteFill>
	);
};
