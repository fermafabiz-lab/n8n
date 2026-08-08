"use client";

/**
 * The genre spiral — a helix of film rings drifting down the right rail.
 *
 * It is a shop window: every ring is a genre the factory can make, so the
 * page shows the range of the thing you are about to commission while you
 * commission it.
 *
 * Each ring carries `public/genres/<slug>.webp` when that file exists and
 * falls back to a gradient built from the genre's own palette when it does
 * not — so the spiral is complete from the first render and gets
 * photographic the moment the stills are dropped in, with no code change.
 */

/**
 * Flip to true once `public/genres/<slug>.webp` exists for every genre
 * below. Until then the rings use their gradients — asking for 32 images
 * that aren't there would mean 32 failed requests on every page load, and
 * the fallback is what would render anyway.
 */
const HAS_STILLS = true;

export interface Genre {
  slug: string;
  label: string;
  /** Fallback look: the genre's palette, used until a still is added. */
  gradient: string;
}

// Deliberately broad — the point of the piece is range.
export const GENRES: Genre[] = [
  {
    slug: "nature",
    label: "Nature",
    gradient: "linear-gradient(150deg,#7fb069 0%,#2f5d3a 45%,#16301f 100%)",
  },
  {
    slug: "racing",
    label: "Racing",
    gradient: "linear-gradient(150deg,#2b3a67 0%,#8e2b3a 55%,#1b0f14 100%)",
  },
  {
    slug: "space",
    label: "Space",
    gradient: "linear-gradient(150deg,#c98b5e 0%,#6d3f2c 45%,#20120d 100%)",
  },
  {
    slug: "underwater",
    label: "Underwater",
    gradient: "linear-gradient(150deg,#4fb3d9 0%,#14607f 50%,#062231 100%)",
  },
  {
    slug: "war",
    label: "War",
    gradient: "linear-gradient(150deg,#c2683a 0%,#4a3524 45%,#14100c 100%)",
  },
  {
    slug: "scifi-city",
    label: "Sci-fi city",
    gradient: "linear-gradient(150deg,#b06fd6 0%,#3c4a8f 50%,#0d1230 100%)",
  },
  {
    slug: "history",
    label: "History",
    gradient: "linear-gradient(150deg,#d8b06a 0%,#6d5330 48%,#241a0f 100%)",
  },
  {
    slug: "coast",
    label: "Coast",
    gradient: "linear-gradient(150deg,#f0a35e 0%,#a04f43 45%,#231218 100%)",
  },
  {
    slug: "cyberpunk",
    label: "Cyberpunk",
    gradient: "linear-gradient(150deg,#ff5fa2 0%,#3a2b8f 50%,#0a0a24 100%)",
  },
  {
    slug: "mountains",
    label: "Mountains",
    gradient: "linear-gradient(150deg,#9ec7d8 0%,#3d6b78 48%,#12242b 100%)",
  },
  {
    slug: "rally",
    label: "Rally",
    gradient: "linear-gradient(150deg,#cfd3d6 0%,#5b6469 48%,#161a1d 100%)",
  },
  {
    slug: "orbit",
    label: "Orbit",
    gradient: "linear-gradient(150deg,#8fd0ff 0%,#20406e 50%,#04070f 100%)",
  },
  {
    slug: "desert",
    label: "Desert",
    gradient: "linear-gradient(150deg,#e8c07d 0%,#9a6b3c 48%,#2a1a0f 100%)",
  },
  {
    slug: "horror",
    label: "Horror",
    gradient: "linear-gradient(150deg,#5c7a5f 0%,#22301f 50%,#080b08 100%)",
  },
  {
    slug: "kids",
    label: "Kids story",
    gradient: "linear-gradient(150deg,#ffd28a 0%,#e08a72 45%,#5b3350 100%)",
  },
  {
    slug: "documentary",
    label: "Documentary",
    gradient: "linear-gradient(150deg,#c9c2b4 0%,#6a6154 48%,#1d1a16 100%)",
  },
];

/**
 * Every genre twice, so the strand stays full on a tall screen without any
 * one band having to travel a suspiciously long way.
 */
const RINGS = [...GENRES, ...GENRES];

/**
 * The strand, as a real helix — and as ONE continuous film strip.
 *
 * Every band is a whole video, and consecutive bands touch: a band is not
 * placed at a point of the path but spans the SEGMENT between its own point
 * and the next one, so the strip has no seams to leave gaps in. The helix is
 * then drawn purely by the direction each segment points — which is what the
 * strand is supposed to read as.
 *
 * Two things had to go for that to hold, and both are gaps waiting to happen:
 * the per-band `rotateY` twist (a turned band is foreshortened, so it no
 * longer reaches its neighbour) and the per-band depth `scale` (two adjacent
 * bands at different scales cannot share an edge). Depth is carried by
 * brightness and stacking order instead, which cost no length.
 */
const RADIUS = 80; // px — half the strand's width on screen
/** Vertical rise per radian of turn: RADIUS/RISE sets the steepest lean. */
const RISE = 56; // atan(80/56) ≈ 55°, inside the 45-60° the strand should read at
const BAND_H = 48; // px, the width of the strip across its own path
/** Fourteen bands per turn. */
const TURN_PER_BAND = (2 * Math.PI) / 14;

const SPAN = RINGS.length * TURN_PER_BAND * RISE;

/** A point of the path, at fraction p of the descent. */
function pointAt(p: number) {
  const a = p * RINGS.length * TURN_PER_BAND;
  return { x: Math.sin(a) * RADIUS, y: p * SPAN, depth: Math.cos(a) };
}

/**
 * The band's own length, fixed. It is the LONGEST segment the path produces
 * (steepest lean, where horizontal and vertical travel add up); every other
 * segment is reached by scaling this length DOWN along the strip's own axis,
 * so a band always covers its segment exactly and never falls short.
 */
const STEP = 1 / RINGS.length;
const BAND_W = (() => {
  let max = 0;
  for (let i = 0; i < RINGS.length; i++) {
    const a = pointAt(i * STEP);
    const b = pointAt((i + 1) * STEP);
    max = Math.max(max, Math.hypot(b.x - a.x, b.y - a.y));
  }
  return Math.ceil(max) + 1; // +1: a hairline of overlap beats a hairline of gap
})();

/** Where the band covering the segment starting at p sits, and how it lies. */
function poseAt(p: number) {
  const a = pointAt(p);
  const b = pointAt(p + STEP);
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  return {
    // The segment's midpoint — the band is centred on what it covers.
    x: (a.x + b.x) / 2,
    y: -BAND_H + (a.y + b.y) / 2,
    depth: (a.depth + b.depth) / 2, // +1 at the front of the strand, -1 behind
    // The direction of travel. This angle, alternating as the path swings
    // left and right, is the only thing drawing the helix.
    lean: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI,
    // Shrink along the strip's own axis so its ends land on the segment's
    // ends. Never grow: the band is cut to the longest case.
    squeeze: (len + 1) / BAND_W,
  };
}

const transformFor = (p: number) => {
  const { x, y, lean, squeeze } = poseAt(p);
  return (
    `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) ` +
    `rotate(${lean.toFixed(1)}deg) scaleX(${squeeze.toFixed(4)})`
  );
};

const brightnessAt = (depth: number) => 0.45 + 0.55 * (0.5 + 0.5 * depth);

/**
 * Generated, not hand-written: the keyframes have to trace the same path as
 * the resting pose, or the position a prefers-reduced-motion user sees —
 * animations are stripped globally — would not match the motion.
 *
 * The step count is a multiple of the band count on purpose. The tiling is
 * exact only where a keyframe lands on a segment boundary; between two stops
 * CSS interpolates the transform linearly, and a coarse grid would let the
 * strip breathe apart mid-tween.
 */
const KEYFRAMES = (() => {
  const stops: string[] = [];
  const STEPS = RINGS.length * 4;
  for (let i = 0; i <= STEPS; i++) {
    const p = i / STEPS;
    const { depth } = poseAt(p);
    stops.push(
      `${(p * 100).toFixed(3)}%{transform:${transformFor(p)};` +
        `filter:brightness(${brightnessAt(depth).toFixed(3)});` +
        `z-index:${depth >= 0 ? 2 : 1}}`,
    );
  }
  return `@keyframes gspiral{${stops.join("")}}`;
})();

export default function GenreSpiral({ speedSeconds = 70 }: { speedSeconds?: number }) {
  return (
    <div className="gspiral" aria-hidden="true">
      <style>{KEYFRAMES}</style>
      <div className="gsstage">
        {RINGS.map((g, i) => {
          const p = i / RINGS.length;
          const pose = poseAt(p);
          return (
            <span
              key={`${g.slug}-${i}`}
              className="gsband"
              style={{
                width: BAND_W,
                height: BAND_H,
                marginLeft: -BAND_W / 2,
                marginTop: -BAND_H / 2,
                backgroundImage: HAS_STILLS
                  ? `url(/genres/${g.slug}.webp), ${g.gradient}`
                  : g.gradient,
                // The resting pose lives on the element as well as in the
                // keyframes — see KEYFRAMES.
                transform: transformFor(p),
                filter: `brightness(${brightnessAt(pose.depth).toFixed(3)})`,
                zIndex: pose.depth >= 0 ? 2 : 1,
                animationDelay: `${(-p * speedSeconds).toFixed(2)}s`,
                animationDuration: `${speedSeconds}s`,
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
