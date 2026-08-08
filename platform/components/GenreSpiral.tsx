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
 * The strand, as a real helix.
 *
 * A band is a film strip riding a helical path: it swings left and right as
 * the strand turns, faces the viewer at the front, turns edge-on at the
 * sides, and LEANS along the direction the strand is travelling. That lean is
 * the whole difference between a helix and a stack of hoops — the previous
 * version rotated bands about their own centres at a fixed horizontal angle,
 * which is why it read as images going round a circle rather than as a strand
 * going somewhere.
 *
 * The lean is not a constant: it is the tangent of the path, steepest where
 * the strand crosses the middle and flattest at the far left and right where
 * it turns around — the way a drawn DNA backbone behaves.
 */
const RADIUS = 80; // px — half the strand's width on screen
/** Vertical rise per radian of turn: RADIUS/RISE sets the steepest lean. */
const RISE = 56; // atan(80/56) ≈ 55°, inside the 45-60° the strand should read at
const BAND_W = 112; // px, the length of one strip along the path
const BAND_H = 48; // px, its width across the path
const SLICES = 12;
/** Fourteen bands per turn: short enough steps that they overlap into a
 *  continuous ribbon rather than a dotted line of tiles. */
const TURN_PER_BAND = (2 * Math.PI) / 14;
/** How far a band turns away from the viewer at the sides of the strand. */
const TWIST = 46;
/** Arc the band bends through, in degrees — a gentle curve, not a curl. */
const ARC = 84;

const ARC_LEN = BAND_W;
const SLICE_W = ARC_LEN / SLICES;
const BEND_R = ARC_LEN / ((ARC * Math.PI) / 180);
const SPAN = RINGS.length * TURN_PER_BAND * RISE;

/** Where a band sits, and which way it leans, at a point of its descent. */
function poseAt(p: number) {
  const a = p * RINGS.length * TURN_PER_BAND;
  return {
    x: Math.sin(a) * RADIUS,
    y: -BAND_W + p * SPAN,
    depth: Math.cos(a), // +1 at the front of the strand, -1 behind it
    // dx/dy of the path: the direction of travel, which the band lies along.
    lean: (Math.atan2(Math.cos(a) * RADIUS, RISE) * 180) / Math.PI,
    // NOT the full turn. A band twisted a full 360° goes edge-on at the far
    // left and right, vanishing to a sliver — which is what left gaps in the
    // strand. Swinging ±TWIST instead keeps every video facing the viewer
    // enough to be seen, while still reading as a strip that turns.
    twist: TWIST * Math.sin(a),
  };
}

const transformFor = (p: number) => {
  const { x, y, lean, twist, depth } = poseAt(p);
  const scale = 0.8 + 0.2 * (0.5 + 0.5 * depth);
  // Order matters, and getting it wrong is what turned the strand into
  // scattered chips: the face has to be aimed outward from the strand's axis
  // FIRST, in world space, and only then leaned along the path within its own
  // plane. Leaning first makes the twist happen about a tilted axis, which
  // throws every band to a different arbitrary angle.
  return (
    `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) ` +
    `scale(${scale.toFixed(3)}) rotateY(${twist.toFixed(1)}deg) rotate(${lean.toFixed(1)}deg)`
  );
};

const brightnessAt = (depth: number) => 0.45 + 0.55 * (0.5 + 0.5 * depth);

/**
 * Generated, not hand-written: the keyframes have to trace the same path as
 * the resting pose, or the position a prefers-reduced-motion user sees —
 * animations are stripped globally — would not match the motion.
 */
const KEYFRAMES = (() => {
  const stops: string[] = [];
  const STEPS = 72;
  for (let i = 0; i <= STEPS; i++) {
    const p = i / STEPS;
    const { depth } = poseAt(p);
    stops.push(
      `${(p * 100).toFixed(2)}%{transform:${transformFor(p)};` +
        `filter:brightness(${brightnessAt(depth).toFixed(3)});` +
        `z-index:${depth >= 0 ? 2 : 1}}`,
    );
  }
  return `@keyframes gspiral{${stops.join("")}}`;
})();

/** One facet of the band's gentle bend, carrying its slab of the still. */
function Slice({ image, index }: { image: string; index: number }) {
  const deg = -ARC / 2 + (index + 0.5) * (ARC / SLICES);
  const facing = Math.cos((deg * Math.PI) / 180);
  return (
    <i
      className="gsslice"
      style={{
        width: SLICE_W + 1,
        marginLeft: -(SLICE_W + 1) / 2,
        transform: `rotateY(${deg.toFixed(2)}deg) translateZ(${BEND_R.toFixed(1)}px)`,
        backgroundImage: image,
        backgroundSize: `${ARC_LEN.toFixed(1)}px 100%`,
        backgroundPosition: `${(-index * SLICE_W).toFixed(1)}px center`,
        filter: `brightness(${(0.6 + 0.4 * facing ** 2).toFixed(3)})`,
      }}
    />
  );
}

export default function GenreSpiral({ speedSeconds = 70 }: { speedSeconds?: number }) {
  return (
    <div className="gspiral" aria-hidden="true">
      <style>{KEYFRAMES}</style>
      <div className="gsstage">
        {RINGS.map((g, i) => {
          const p = i / RINGS.length;
          const pose = poseAt(p);
          const image = HAS_STILLS
            ? `url(/genres/${g.slug}.webp), ${g.gradient}`
            : g.gradient;
          return (
            <span
              key={`${g.slug}-${i}`}
              className="gsband"
              style={{
                width: BAND_W,
                height: BAND_H,
                marginLeft: -BAND_W / 2,
                // The resting pose lives on the element as well as in the
                // keyframes — see KEYFRAMES.
                transform: transformFor(p),
                filter: `brightness(${brightnessAt(pose.depth).toFixed(3)})`,
                zIndex: pose.depth >= 0 ? 2 : 1,
                animationDelay: `${(-p * speedSeconds).toFixed(2)}s`,
                animationDuration: `${speedSeconds}s`,
              }}
            >
              {Array.from({ length: SLICES }, (_, k) => (
                <Slice key={k} image={image} index={k} />
              ))}
            </span>
          );
        })}
      </div>
    </div>
  );
}
