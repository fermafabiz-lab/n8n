import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import {CURVES, eased} from '../easing';
import {planWatermarkBands, type VisualProvenance} from '../provenance';
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

/** Fade at each end of a band. Long enough to be soft, short enough to be up
 *  on the scene's first frames — the spec's 150–250 ms window. */
const FADE = 0.2;

export const SourceWatermark: React.FC<{
	scenes: {startSeconds: number; durationSeconds: number; provenance?: VisualProvenance}[];
	preset: StylePreset;
	/** False = the producer switched the label off. Credits still draw. */
	showLabel: boolean;
	/** Vertical (9:16): lift clear of the platform's own bottom chrome. */
	portrait?: boolean;
	/** Hide while the hook title owns the frame, exactly as captions do. */
	suppressUntilSeconds?: number;
}> = ({scenes, preset, showLabel, portrait = false, suppressUntilSeconds = 0}) => {
	const frame = useCurrentFrame();
	const {fps} = useVideoConfig();
	const seconds = frame / fps;

	const bands = React.useMemo(
		() => planWatermarkBands(scenes, {showLabel}),
		[scenes, showLabel],
	);

	if (seconds < suppressUntilSeconds) return null;

	const band = bands.find((b) => seconds >= b.startSeconds && seconds < b.endSeconds);
	if (!band) return null;

	// Symmetric in and out. `inOutCubic` rather than an entrance curve: this is
	// not an arrival, it is a label becoming legible and then stopping.
	const opacity =
		Math.min(
			eased(seconds - band.startSeconds, [0, FADE], [0, 1], CURVES.inOutCubic),
			eased(band.endSeconds - seconds, [0, FADE], [0, 1], CURVES.inOutCubic),
		) * 0.88;

	// Bottom-LEFT, on the same left edge the captions keep, and below the band
	// they occupy: captions are bottom-anchored at 84 (landscape) / 280
	// (portrait), so the badge sits under them in landscape and just under them
	// in portrait, where the bottom fifth belongs to the platform's own UI.
	return (
		<AbsoluteFill style={{pointerEvents: 'none'}}>
			<div
				style={{
					position: 'absolute',
					left: portrait ? 44 : 90,
					bottom: portrait ? 232 : 30,
					maxWidth: portrait ? 560 : 700,
					opacity,
					display: 'flex',
					flexDirection: 'column',
					gap: 3,
					alignItems: 'flex-start',
				}}
			>
				{band.label ? (
					<span
						style={{
							fontFamily: preset.kickerFont,
							fontSize: portrait ? 17 : 16,
							fontWeight: 600,
							letterSpacing: '0.14em',
							color: '#FFFFFF',
							background: 'rgba(0,0,0,0.42)',
							border: '1px solid rgba(255,255,255,0.16)',
							borderRadius: 6,
							padding: portrait ? '5px 11px' : '5px 12px',
							textShadow: '0 2px 8px rgba(0,0,0,0.75)',
							lineHeight: 1.2,
						}}
					>
						{band.label}
					</span>
				) : null}
				{band.source ? (
					<span
						style={{
							fontFamily: preset.kickerFont,
							fontSize: portrait ? 14 : 13,
							letterSpacing: '0.05em',
							color: 'rgba(255,255,255,0.9)',
							background: 'rgba(0,0,0,0.34)',
							borderRadius: 5,
							padding: '3px 9px',
							textShadow: '0 2px 8px rgba(0,0,0,0.75)',
							lineHeight: 1.25,
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
							fontSize: portrait ? 13 : 12,
							letterSpacing: '0.04em',
							color: 'rgba(255,255,255,0.82)',
							background: 'rgba(0,0,0,0.34)',
							borderRadius: 5,
							padding: '3px 9px',
							textShadow: '0 2px 8px rgba(0,0,0,0.75)',
							lineHeight: 1.25,
						}}
					>
						{band.credit}
					</span>
				) : null}
			</div>
		</AbsoluteFill>
	);
};
