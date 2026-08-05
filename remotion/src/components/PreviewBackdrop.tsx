import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';

/**
 * Stand-in for the footage when no source video is supplied.
 *
 * The assembled video that FinalVideo draws over lives at the render server's
 * `/output`, which Railway wipes on redeploy — so a props fixture pointing at
 * one stops working within a day or two, and Studio died with a
 * MediaPlaybackError instead of showing the graphics. Tuning typography, easing
 * and the light leak does not need real footage; it needs moving picture with
 * varied luminance, which is all this is.
 *
 * It only ever appears when `finalVideoUrl` is empty. A production render
 * cannot reach this: the render server rejects a request with no
 * `finalVideoUrl` with a 400 before Remotion is involved at all.
 */
export const PreviewBackdrop: React.FC = () => {
	const frame = useCurrentFrame();
	const {fps, durationInFrames} = useVideoConfig();
	const t = frame / fps;

	// Slow horizontal travel so Ken Burns, the punch-ins and the leak sweep all
	// have something to read against — a static fill hides motion bugs.
	const shift = (t * 6) % 100;
	const p = frame / Math.max(1, durationInFrames);

	return (
		<AbsoluteFill style={{backgroundColor: '#15171c'}}>
			{/* Three luminance zones: a screen-blended flare has to be judged on
			    shadow, midtone and near-white at once. */}
			<AbsoluteFill
				style={{
					background:
						'linear-gradient(180deg, #0e1014 0%, #14171d 32%, #5c636c 32%, #767c85 66%, #c6cbd1 66%, #e4e7ea 100%)',
				}}
			/>
			<AbsoluteFill
				style={{
					background: `linear-gradient(${95 + p * 20}deg, rgba(255,255,255,0) ${shift - 30}%, rgba(255,255,255,0.14) ${shift}%, rgba(255,255,255,0) ${shift + 30}%)`,
				}}
			/>
			{/* Coarse vertical rules — a moving reference for the scale jumps, which
			    are invisible on a flat gradient. */}
			<AbsoluteFill
				style={{
					backgroundImage:
						'repeating-linear-gradient(90deg, rgba(0,0,0,0.16) 0 2px, rgba(0,0,0,0) 2px 96px)',
					opacity: 0.7,
				}}
			/>
		</AbsoluteFill>
	);
};
