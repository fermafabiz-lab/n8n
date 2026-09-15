/**
 * The Ken Burns move on an archive still, as ffmpeg filter strings.
 *
 * Its own module, importing nothing, for one reason: `scripts/check-kenburns.mjs`
 * asserts on the graph that actually runs, and `attach.ts` around it pulls in
 * the media store, the provider registry and an ffmpeg runner. Pure string
 * building belongs where it can be read without any of that.
 *
 * ## Why the numbers here are the shake fix
 *
 * The producer reported that archive photographs zoom out nicely and shake
 * while they do it. That is `zoompan` working exactly as documented, not an
 * error in our arithmetic. Every output frame it computes
 *
 *     w = trunc(iw / zoom)      a whole number of SOURCE pixels
 *     x = trunc(<x expr>)       a whole-pixel offset into the source
 *
 * crops that rectangle, and scales it to the output size. So the move can only
 * ever advance in whole source pixels, and two things follow:
 *
 * 1. **The still must be far larger than the canvas**, or one source pixel is
 *    a large fraction of an output pixel. At the old 2x, one source pixel was
 *    half an output pixel while the move itself was about a third of one per
 *    frame — so on most frames the picture did not move, and on the rest it
 *    jumped half a pixel. Irregularly, 24 times a second. That is the shake,
 *    and a pull-out shows it worst because the frame is being remagnified at
 *    the same time, so the stutter is in the zoom as well as the position.
 * 2. **x must be derived from the same truncated w**, or the width and the
 *    offset round independently, disagree by up to a source pixel, and the
 *    centre of the picture wanders while it zooms.
 *
 * Both are measured, not argued, in `scripts/check-kenburns.mjs`, which
 * simulates zoompan's integer arithmetic frame by frame.
 */

/** How far a Ken Burns push travels — 12% is a move you feel, not one you see. */
export const KEN_BURNS_ZOOM = 0.12;

/**
 * How many times the canvas the still is blown up to before zoompan moves
 * over it.
 *
 * There is no knee in the curve — the residue falls as 1/S — so 6 is a
 * threshold, not a shape: the SMALLEST supersample that keeps the sideways
 * jump under a tenth of an output pixel across every clip length the picker
 * allows (3-20 s), both orientations and both directions. It costs an
 * intermediate frame of 7680x4320; going further keeps helping and keeps
 * costing, which is why the check asserts 6 is the smallest that passes rather
 * than that 6 is special. The still does not need that much real DETAIL — the
 * grid only has to be finer than the motion.
 */
export const KEN_BURNS_SUPERSAMPLE = 6;

/** Cover-fit to a canvas: fill it, then trim whatever overhangs. */
export const fit = (W: number, H: number): string =>
  `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}`;

/** The whole filtergraph for a still, `frames` long at `fps`. */
export function kenBurnsFilter(
  W: number,
  H: number,
  frames: number,
  pullOut: boolean,
  fps: number,
): string {
  const S = KEN_BURNS_SUPERSAMPLE;
  const z = pullOut
    ? `max(${(1 + KEN_BURNS_ZOOM).toFixed(3)}-${KEN_BURNS_ZOOM}*on/${frames},1)`
    : `min(1+${KEN_BURNS_ZOOM}*on/${frames},${(1 + KEN_BURNS_ZOOM).toFixed(3)})`;
  // Centred on the crop zoompan is ABOUT to take, rather than rounded on its
  // own — see (2) above. Free, and it halves the wander at every supersample.
  const x = `trunc((iw-trunc(iw/zoom))/2)`;
  const y = `trunc((ih-trunc(ih/zoom))/2)`;
  // `setsar=1` for the same reason the assemble's own cover-fit carries one
  // (remotion/server/assemble.mjs, the vchain comment): a still can declare a
  // pixel aspect of 0:1 or something a hair off square, `scale` PRESERVES that
  // rather than squaring it, and ffmpeg's `concat` — which the final render
  // joins every clip with — refuses inputs whose SAR differs by so much as a
  // part in twelve thousand. The render normalises again at assemble time, so
  // this is not what unblocks an existing film; it is what stops a clip being
  // WRITTEN with a pixel aspect no other clip has.
  return (
    `[0:v]${fit(W * S, H * S)},` +
    `zoompan=z='${z}':d=${frames}:x='${x}':y='${y}':s=${W}x${H}:fps=${fps},` +
    `setsar=1,format=yuv420p[v]`
  );
}
