import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import type {SceneCaption} from '../types';
import type {CaptionAccent} from '../captionColor';
import type {StylePreset} from '../style';
import {captionAt} from '../captionTiming';

export const Captions: React.FC<{
	scenes: SceneCaption[];
	/**
	 * Colour for the spoken word and for keywords, or null for the colourless
	 * default — see src/captionColor.ts for what decides this.
	 */
	accent: CaptionAccent;
	preset: StylePreset;
	/** Hide captions before this time (while the hook title owns the frame). */
	suppressUntilSeconds?: number;
	/** Vertical (9:16) framing: bigger type, raised safe-zone position. */
	portrait?: boolean;
}> = ({scenes, accent, preset, suppressUntilSeconds = 0, portrait = false}) => {
	const frame = useCurrentFrame();
	const {fps} = useVideoConfig();
	const seconds = frame / fps;

	// One text element at a time: the hook title and captions fighting for
	// the frame in the opening seconds read as clutter (seen on the contact
	// sheet), so captions wait their turn.
	if (seconds < suppressUntilSeconds) return null;

	const active = captionAt(scenes, seconds);
	if (!active) return null;

	return (
		<AbsoluteFill
			style={{
				justifyContent: 'flex-end',
				alignItems: 'center',
				// The safe margin belongs to the frame, not the text box: padding
				// here is what a percentage max-width failed to guarantee.
				paddingLeft: portrait ? 44 : 90,
				paddingRight: portrait ? 44 : 90,
				boxSizing: 'border-box',
			}}
		>
			<div
				style={{
					// Portrait: lift captions well above the platform UI (Shorts /
					// Reels overlays live in the bottom ~20%).
					marginBottom: portrait ? 280 : 84,
					// A shrink-to-fit flex item ignored `maxWidth` and ran a long
					// chunk clean off the right edge, cut mid-word — reproduced at
					// 720x1280 with four long words. An explicit full-width box that
					// wraps between words cannot do that, whatever the font metrics
					// turn out to be.
					width: '100%',
					boxSizing: 'border-box',
					display: 'flex',
					flexWrap: 'wrap',
					justifyContent: 'center',
					columnGap: 14,
					rowGap: 2,
					textAlign: 'center',
					fontFamily: preset.captionFont,
					fontWeight: portrait ? 700 : 600,
					fontSize: portrait ? 42 : 40,
					lineHeight: 1.3,
					textShadow: '0 3px 14px rgba(0,0,0,0.9)',
				}}
			>
				{active.chunk.map((word, i) => {
					const activeNow = i === active.activeInChunk;
					const keyword = active.keywords[i];
					// Without an accent the karaoke read has to come from
					// somewhere, and opacity 1 against 0.92 is not a difference
					// anyone can see. So the colourless mode spends its whole
					// contrast budget on the spoken word — full white against a
					// clearly held-back white — and leaves keywords alone, since a
					// second bright word would compete with the one being said.
					const color = accent
						? activeNow || keyword
							? accent
							: '#FFFFFF'
						: '#FFFFFF';
					const opacity = accent ? (activeNow ? 1 : 0.92) : activeNow ? 1 : 0.72;
					return (
						<span
							key={i}
							style={{
								color,
								opacity,
								// Last resort for a single word longer than the line box
								// (compound German/Romanian nouns, URLs read aloud).
								overflowWrap: 'anywhere',
								maxWidth: '100%',
							}}
						>
							{word}
						</span>
					);
				})}
			</div>
		</AbsoluteFill>
	);
};
