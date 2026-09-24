import type {FinalVideoProps} from './types';

/**
 * 24, because that is what the film underneath is.
 *
 * `/assemble` encodes the montage at `OUT_FPS = 24` (server/assemble.mjs) and
 * the graphics pass used to draw over it at 30. Two costs came out of that
 * mismatch, and the smaller one is the money: a 24fps source in a 30fps
 * composition is 25% more frames to render than the film contains, at roughly
 * two frames a second on a box with no GPU — a ten-minute film paid about
 * twenty minutes for frames that only duplicate their neighbours.
 *
 * The larger cost was correctness. Every scene cut then sat at .0/.25/.5/.75
 * of a composition frame, and the .5 ones land exactly on the comparison that
 * decides which shot a frame belongs to — where the decoder's arithmetic and
 * `shotAt`'s broke the tie differently, so three cuts of the tahiti film
 * showed one frame of the NEW scene wearing the OLD scene's framing. The
 * half-frame lead and the epsilon in FinalVideo were the fix for that, and
 * they stay: they are general. But at 24 the ties cannot arise at all, because
 * every boundary the montage can produce is already a whole frame here.
 */
export const FPS = 24;

/**
 * Canvas and length of one film. One owner, because two engines draw it: the
 * Remotion composition (Root.tsx) and the Hyperframes page (hf/entry.tsx).
 * If they disagreed by a frame, the end screen would be cut or padded on one
 * of them and nothing would say so.
 *
 * 720p class, not 1080p: renders happen on a modest Railway box and the 720
 * pixel budget keeps Chromium comfortable. 1080p is a SCALE on top of this
 * canvas (server/index.mjs), never a different layout.
 */
export const filmMetadata = (p: FinalVideoProps) => {
	const videoDurationSeconds = p.scenes.length
		? p.scenes[p.scenes.length - 1].startSeconds + p.scenes[p.scenes.length - 1].durationSeconds
		: 0;
	const outroSeconds = p.showEndScreen === false ? 0 : p.outroDurationInSeconds;
	const totalSeconds = p.introDurationInSeconds + videoDurationSeconds + outroSeconds;
	const portrait = p.aspectRatio === '9:16';

	return {
		durationInFrames: Math.max(1, Math.round(totalSeconds * FPS)),
		width: portrait ? 720 : 1280,
		height: portrait ? 1280 : 720,
		// How long the footage Sequence in FinalVideo runs — its
		// `videoFrames`, the same rounding. The Hyperframes page times the
		// montage <video> with it, because that engine reads video timing from
		// HTML attributes rather than from the Sequence around it.
		montageSeconds: Math.round(videoDurationSeconds * FPS) / FPS,
	};
};
