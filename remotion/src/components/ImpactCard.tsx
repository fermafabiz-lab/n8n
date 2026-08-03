import React from 'react';
import {AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig} from 'remotion';
import type {StylePreset} from '../style';

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
 * Director-style stop-frame at each chapter start: full-screen opaque card
 * in the preset palette, chapter eyebrow + the chapter's key line typing on.
 * Runs ~2s as an overlay (footage and narration continue underneath), then
 * wipes away — a hard visual reset that re-hooks attention.
 */
export const ImpactCard: React.FC<{
	chapter: number;
	keyLine: string;
	preset: StylePreset;
}> = ({chapter, keyLine, preset}) => {
	const frame = useCurrentFrame();
	const {fps, width} = useVideoConfig();
	// Same canvas-relative scaling as HookTitle: these sizes were tuned on
	// the 1280-wide landscape canvas and are 1.78x too large relative to the
	// 720-wide vertical one. At 1280 the scale is 1 and nothing changes.
	const px = (n: number) => n * (width / 1280);

	const t = frame / fps;

	const hold = 2.2;
	// Card slides in as a wipe, holds, wipes out.
	const wipeIn = interpolate(t, [0, 0.3], [100, 0], {
		extrapolateLeft: 'clamp',
		extrapolateRight: 'clamp',
	});
	const wipeOut = interpolate(t, [hold, hold + 0.35], [0, -100], {
		extrapolateLeft: 'clamp',
		extrapolateRight: 'clamp',
	});
	const x = wipeIn + wipeOut;
	if (t > hold + 0.4) return null;

	// Words are unbreakable inline-blocks; the spaces BETWEEN them are plain
	// breakable text nodes. Per-character spans with white-space:pre killed
	// every soft-wrap point and the line ran straight off the screen.
	const words = keyLine.split(' ');
	const perChar = 1 / Math.max(18, preset.typeSpeed * 1.4);
	let charOffset = 0;
	const wordStarts = words.map((w) => {
		const s = charOffset;
		charOffset += w.length + 1;
		return s;
	});

	return (
		<AbsoluteFill style={{transform: `translateX(${x}%)`}}>
			<AbsoluteFill
				style={{
					background: preset.cardBg,
					justifyContent: 'center',
					alignItems: 'center',
				}}
			>
				<div style={{width: '74%', textAlign: 'left'}}>
					<div
						style={{
							fontFamily: preset.captionFont,
							fontWeight: 600,
							fontSize: px(17),
							letterSpacing: px(5),
							textTransform: 'uppercase',
							color: preset.cardInk,
							marginBottom: px(18),
						}}
					>
						Chapter {ROMAN[chapter] ?? chapter}
					</div>
					<div
						style={{
							fontFamily: preset.displayFont,
							fontWeight: preset.displayWeight,
							fontSize: px(52),
							lineHeight: 1.25,
							color: preset.cardBg === '#F6EFE3' || preset.cardBg === '#F4F1EA' ? '#221D14' : '#F5F2EA',
						}}
					>
						{words.map((word, wi) => (
							<React.Fragment key={wi}>
								<span style={{display: 'inline-block', whiteSpace: 'pre'}}>
									{Array.from(word).map((ch, ci) => {
										const start = 0.25 + (wordStarts[wi] + ci) * perChar;
										const o = interpolate(t, [start, start + 0.12], [0, 1], {
											extrapolateLeft: 'clamp',
											extrapolateRight: 'clamp',
										});
										return (
											<span key={ci} style={{opacity: o}}>
												{ch}
											</span>
										);
									})}
								</span>
								{wi < words.length - 1 ? ' ' : null}
							</React.Fragment>
						))}
					</div>
					<div
						style={{
							width: 74,
							height: 4,
							background: preset.cardInk,
							marginTop: 24,
							borderRadius: 2,
						}}
					/>
				</div>
			</AbsoluteFill>
		</AbsoluteFill>
	);
};
