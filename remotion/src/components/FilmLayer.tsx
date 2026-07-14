import React from 'react';
import {AbsoluteFill, useCurrentFrame} from 'remotion';
import {toneKey} from '../types';

/** Tone → CSS filter applied to the footage (cheap, consistent color grade). */
export const gradeForTone = (tone: string): string => {
	const k = toneKey(tone);
	if (/dark|horror|conspiracy/.test(k)) return 'contrast(1.08) saturate(0.85) brightness(0.97)';
	if (/epic|motivational|inspirational/.test(k)) return 'contrast(1.06) saturate(1.12)';
	if (/mystery|documentary/.test(k)) return 'contrast(1.05) saturate(0.92) hue-rotate(-6deg)';
	if (/emotional|dramatic/.test(k)) return 'contrast(1.04) saturate(1.05) sepia(0.06)';
	return 'contrast(1.03)';
};

// Tiny tiled noise texture (SVG turbulence), jittered every other frame so it
// reads as film grain instead of a static pattern.
const GRAIN_URI =
	'data:image/svg+xml;utf8,' +
	encodeURIComponent(
		`<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/></filter><rect width="240" height="240" filter="url(%23n)"/></svg>`,
	);

/** Grain + vignette overlay; sits above the footage, below text layers. */
export const FilmLayer: React.FC<{tone: string}> = ({tone}) => {
	const frame = useCurrentFrame();
	const jx = (frame % 2) * 120 + ((frame * 7) % 60);
	const jy = ((frame + 1) % 2) * 120 + ((frame * 13) % 60);
	const k = toneKey(tone);
	const vignetteStrength = /dark|horror|conspiracy/.test(k) ? 0.5 : 0.34;

	return (
		<AbsoluteFill style={{pointerEvents: 'none'}}>
			<AbsoluteFill
				style={{
					backgroundImage: `url("${GRAIN_URI}")`,
					backgroundPosition: `${jx}px ${jy}px`,
					opacity: 0.055,
					mixBlendMode: 'overlay',
				}}
			/>
			<AbsoluteFill
				style={{
					background: `radial-gradient(ellipse at center, rgba(0,0,0,0) 58%, rgba(0,0,0,${vignetteStrength}) 100%)`,
				}}
			/>
		</AbsoluteFill>
	);
};
