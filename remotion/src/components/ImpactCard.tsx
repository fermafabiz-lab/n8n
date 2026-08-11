import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import type {StylePreset} from '../style';
import {CARD_SPACE_RATIO, CARD_TITLE_ADVANCE, cardTitleFont} from '../style';
import {CURVES, curveAt} from '../easing';
import {fitTitleSize} from '../fitType';
import {FLASH_PEAK, LightLeak, flashEnvelope, flashSweep} from './LightLeak';

const ROMAN = ['0', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

/** First ~8 meaningful words of the chapter's opening narration. */
export const keyLineFor = (narration: string): string => {
	const words = narration.trim().split(/\s+/).filter(Boolean).slice(0, 8);
	let line = words.join(' ');
	line = line.replace(/[,;:]$/, '');
	if (!/[.!?…]$/.test(line) && line) line += '…';
	return line;
};

/**
 * What sits behind the type. The card used to be an opaque cream panel, which
 * read as a slide dropped into the film rather than a moment of it.
 *
 *  - 'blur'    the film itself, thrown out of focus and dimmed. The ground is
 *              different in every project and every chapter, so it can never
 *              look like a template.
 *  - 'ink'     near-black with grain and a vignette. Purely typographic.
 *  - 'duotone' the film desaturated and pushed toward the tone's accent.
 *
 * 'blur' and 'duotone' read the footage through `backdrop-filter`, so neither
 * needs the video passed in: the card is already composited over the footage
 * layer in FinalVideo, and the backdrop is simply what is behind it.
 *
 * 'blur' is the producer's pick. The other two are kept because they are three
 * lines each and the choice is a matter of taste that may well be revisited —
 * flip the constant and render a still.
 */
export type CardBackdrop = 'blur' | 'ink' | 'duotone';
// Asserted rather than annotated: a `const` of union type is narrowed to its
// initializer by control-flow analysis, which makes every branch below read as
// dead code to the compiler.
const BACKDROP = 'blur' as CardBackdrop;

/**
 * Total on-screen window. Exported because FinalVideo's Sequence has to be at
 * least this long — a shorter Sequence cuts the exit flash off mid-burn and
 * the card vanishes on a hard frame.
 */
export const IMPACT_CARD_SECONDS = 2.8;

/**
 * The chapter eyebrow's colour. It used to be the preset's accent (`cardInk`),
 * a muted orange that sat in the same family as most grounds and read as part
 * of the picture rather than as a caption to it. The brief was more contrast
 * against the WHITE title, which rules out the near-white and near-gold
 * candidates however handsome they look on their own: at this size and tracking
 * a label separates by VALUE first, so a bright yellow reads as barely
 * separated from the type despite its chroma. Vermilion is dark enough against
 * the title and saturated enough against the footage.
 *
 * Deliberately one constant rather than a per-tone value: the card is now the
 * one surface that looks the same in every film.
 */
const EYEBROW_INK = '#E2533B';

/**
 * Film grain as an inline SVG turbulence, so it costs no asset and no network
 * fetch. A flat dark panel is the single clearest "this is a graphic" tell;
 * grain is what makes it read as an image.
 */
const GRAIN =
	"url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3'/%3E%3C/filter%3E%3Crect width='180' height='180' filter='url(%23n)'/%3E%3C/svg%3E\")";

/** Entrance and exit flash durations. */
const IN = 0.55;
const OUT = 0.55;

/**
 * Time from the start of a flash to its peak, and the amount by which the whole
 * card window must be placed EARLIER than the chapter start.
 *
 * A flash exists to hide a change, so its brightest moment has to sit ON the
 * change, not after it. A Sequence that begins at the chapter start can only
 * begin flashing there — so the picture cut played completely naked, and the
 * light arrived a fifth of a second late, over footage that had already
 * changed. Leading by exactly this much puts the peak, the picture cut and the
 * card's appearance all on the same frame.
 */
export const CARD_FLASH_LEAD = IN * FLASH_PEAK;
/** Set here rather than inline: the size fitter has to know it to budget height. */
const LINE_HEIGHT = 1.25;

/**
 * Director-style stop-frame at each chapter start: chapter eyebrow + the
 * chapter's title, held ~1.7s over the narration, which continues underneath.
 *
 * The card used to slide in and out on a linear translateX. Both halves of
 * that were wrong: the slide announced the graphic, and the constant speed
 * made it read as a template. Now the card is revealed and taken away by a
 * light leak — it swaps at the peak of the flash, where the frame is blown out
 * and the change is invisible.
 */
export const ImpactCard: React.FC<{
	chapter: number;
	keyLine: string;
	preset: StylePreset;
}> = ({chapter, keyLine, preset}) => {
	const frame = useCurrentFrame();
	const {fps, width, height} = useVideoConfig();
	// Same canvas-relative scaling as HookTitle: these sizes were tuned on the
	// 1280-wide landscape canvas and are 1.78x too large relative to the
	// 720-wide vertical one. At 1280 the scale is 1 and nothing changes.
	const px = (n: number) => n * (width / 1280);

	const t = frame / fps;
	if (t > IMPACT_CARD_SECONDS) return null;

	const outStart = IMPACT_CARD_SECONDS - OUT;
	const inProgress = t / IN;
	const outProgress = (t - outStart) / OUT;
	const inFlash = flashEnvelope(inProgress);
	const outFlash = flashEnvelope(outProgress);

	// The card is present, whole, between these two instants and absent outside
	// them. NEITHER end crossfades, and that is the entire trick: both moments
	// sit on a flash peak, where the frame is blown out and a hard swap cannot
	// be resolved by the eye.
	//
	// Both ends used to carry a 0.07s crossfade, written as insurance against a
	// pop on an already-bright shot. It bought nothing and cost the illusion at
	// both ends. On the way out it ghosted the title over the returning footage.
	// On the way IN it was worse, because the entrance now coincides with a
	// picture cut by design: for two frames the card sat at half opacity over a
	// SHARP new scene, so you read the incoming shot and a translucent card at
	// once — which looks exactly like a graphic that fired by mistake. A card
	// that is either fully there or not there at all cannot produce that frame.
	const appearAt = CARD_FLASH_LEAD;
	const vanishAt = outStart + OUT * FLASH_PEAK;

	// Words are unbreakable inline-blocks; the spaces BETWEEN them are plain
	// breakable text nodes. Per-character spans with white-space:pre killed
	// every soft-wrap point and the line ran straight off the screen.
	const words = keyLine.split(' ');

	// The title used to light character by character. A typewriter is a literal
	// depiction of typing, which is not what a chapter card is doing, and it is
	// one of the loudest template tells there is. Each WORD now rises and fades
	// in turn, rise and opacity on the SAME curve — the identical vocabulary
	// HookTitle uses, so the film's two title surfaces move alike. No mask is
	// involved: an `overflow: hidden` clip would draw a hard edge across the
	// letterforms for the whole travel, which reads as a rendering fault. Travel
	// is short because the fade is what reveals; a long slide only looks late.
	// `outExpo` — the hook's entrance curve — spends nearly all its travel in the
	// first few frames, which is right for a fade but makes the RISE invisible:
	// the word is already in place by the time the eye finds it. `outQuart`
	// decelerates over a distance you can actually watch, and the rise is set
	// long enough to register at this type size.
	const WORD_REVEAL = 0.62;
	const RISE_EM = 0.55;
	// The reveal still has to FINISH while the card is up — the lesson the
	// per-character rate was built around, and it applies unchanged to a
	// stagger. An eight-word fallback line at a fixed 0.07 would still be
	// arriving when the exit flash began, so the stagger compresses to whatever
	// lands the last word with 0.35s to spare.
	const revealStart = appearAt + 0.08;
	const lastWord = Math.max(1, words.length - 1);
	const budget = vanishAt - 0.35 - revealStart - WORD_REVEAL;
	const stagger = Math.min(0.07, Math.max(0, budget) / lastWord);

	// Every backdrop is now dark, so the ink is always light — the old
	// light-background branch went with the cream panel. Not pure white: a
	// hair of warmth keeps it from buzzing against the grain.
	const lightInk = '#F7F4EE';

	// The title is sized to the text, exactly as the hook is. It used to be a
	// flat px(52) — a size that can only ever suit one length, and it was
	// chosen for the long case: the eight-word narration excerpt this card
	// falls back to on old projects. A real chapter title is three words, so
	// it sat tiny in the middle of a full-frame card and read as an accident.
	// The card is a stop-frame with nothing else on it; the title is meant to
	// be the whole image.
	const blockWidth = width * 0.74;
	const fontSize = fitTitleSize({
		words,
		// The card's own face, not the preset's — the two surfaces no longer share
		// a typeface, so they must not share an advance either. Feeding Cormorant's
		// 0.44 to a Poppins card would let the fitter approve a size that then
		// wraps onto an extra line.
		advance: CARD_TITLE_ADVANCE,
		spaceRatio: CARD_SPACE_RATIO,
		wrapWidth: blockWidth * 0.94,
		// Deliberately above what any title actually reaches: the wrap and height
		// tests below decide the real size, and a low ceiling would cap a short
		// title before either of them had an opinion.
		maxSize: width * 0.125,
		minSize: width * 0.026,
		maxLines: 3,
		lineHeight: LINE_HEIGHT,
		// Not the full frame: the eyebrow shares the block, and the card needs air
		// at top and bottom to read as a card rather than as text that overflowed
		// onto one.
		maxHeight: height * 0.46,
	});

	// The eyebrow is proportional to the title, so the layout holds its shape at
	// any fitted size.
	const eyebrowSize = Math.max(px(15), fontSize * 0.2);

	// The three grounds differ only here. 'ink' paints its own panel; the other
	// two read the footage that is already behind this layer, so the card is
	// made OF the film rather than laid on top of it.
	// The blur is deliberately not crushed to black. Taken far enough down that
	// the type never fights it, the ground stops reading as footage at all and
	// the card may as well be the flat panel it replaced — so the dimming stops
	// where the shapes and the scene's own colour still carry through.
	const dim =
		BACKDROP === 'duotone'
			? 'grayscale(1) contrast(1.12) brightness(0.4)'
			: 'blur(42px) saturate(0.95) brightness(0.62)';
	const ground: React.CSSProperties =
		BACKDROP === 'ink'
			? {background: '#0E0E11'}
			: {
					backdropFilter: dim,
					WebkitBackdropFilter: dim,
					background: 'rgba(9,9,12,0.26)',
				};

	return (
		<AbsoluteFill>
			{t >= appearAt && t < vanishAt && (
				<AbsoluteFill
					style={{
						justifyContent: 'center',
						alignItems: 'center',
						...ground,
					}}
				>
					{/* Accent wash — only the duotone ground, where the picture has been
				    stripped of its own colour and needs one back. */}
					{BACKDROP === 'duotone' && (
						<AbsoluteFill
							style={{
								background: preset.cardInk,
								mixBlendMode: 'color',
								opacity: 0.55,
							}}
						/>
					)}
					{/* Grain, then vignette. Both on every ground: an unbroken flat field
				    is the clearest tell that a frame was drawn rather than shot. */}
					<AbsoluteFill
						style={{
							backgroundImage: GRAIN,
							backgroundSize: px(180),
							opacity: 0.055,
						}}
					/>
					<AbsoluteFill
						style={{
							background: `radial-gradient(120% 78% at 50% 46%, rgba(0,0,0,0) 42%, rgba(0,0,0,0.62) 100%)`,
						}}
					/>
					<div style={{width: blockWidth, textAlign: 'center'}}>
						<div
							style={{
								fontFamily: preset.kickerFont,
								fontWeight: 500,
								fontSize: eyebrowSize,
								letterSpacing: eyebrowSize * 0.35,
								// Letter-spacing also lands after the LAST character, so a
								// centred line sits visibly left of centre. Indenting by exactly
								// one tracking step puts the optical centre back.
								textIndent: eyebrowSize * 0.35,
								textTransform: 'uppercase',
								color: EYEBROW_INK,
								marginBottom: fontSize * 0.35,
							}}
						>
							Chapter {ROMAN[chapter] ?? chapter}
						</div>
						<div
							style={{
								fontFamily: cardTitleFont,
								fontWeight: 700,
								fontSize,
								lineHeight: LINE_HEIGHT,
								color: lightInk,
							}}
						>
							{words.map((word, wi) => {
								const e = curveAt((t - revealStart - wi * stagger) / WORD_REVEAL, CURVES.outQuart);
								return (
									<React.Fragment key={wi}>
										<span
											style={{
												display: 'inline-block',
												// 'pre' here made a word unbreakable, so a long chapter
												// title ran off the frame instead of wrapping — the same
												// bug HookTitle already carries a note about.
												whiteSpace: 'pre-wrap',
												overflowWrap: 'anywhere',
												maxWidth: '100%',
												opacity: e,
												transform: `translateY(${((1 - e) * RISE_EM).toFixed(4)}em)`,
											}}
										>
											{word}
										</span>
										{wi < words.length - 1 ? ' ' : null}
									</React.Fragment>
								);
							})}
						</div>
					</div>
				</AbsoluteFill>
			)}

			{/* Entrance and exit flares. Each returns null outside its window, so
			    only one is ever composited. */}
			{/* `flashSweep`, not a plain eased ramp: it puts the flare on frame
			    centre at the envelope's peak, which is the frame the swap and the
			    picture cut both land on. The exit sweeps the other way, so the two
			    flares do not read as the same object passing twice. */}
			<LightLeak amount={inFlash} sweep={flashSweep(inProgress)} />
			<LightLeak amount={outFlash} sweep={1 - flashSweep(outProgress)} />
		</AbsoluteFill>
	);
};
