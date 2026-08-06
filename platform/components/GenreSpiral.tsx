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
 * Every genre twice, so the column stays full on a tall screen without any
 * one ring having to travel a suspiciously long way. The two copies sit at
 * opposite depths, which reads as a denser weave rather than a repeat.
 */
const RINGS = [...GENRES, ...GENRES];

/**
 * Vertical distance between consecutive rings, in px. A ring's projected
 * height is ~58px, so this has to be well under that: rings that merely
 * touch read as a stack of lozenges, and it is the overlap that traces the
 * coil.
 */
const STEP = 33;
/** Turns the helix makes over the whole loop. */
const TURNS = 4;
/** Total travel of one ring before it recycles. */
const SPAN = RINGS.length * STEP;

/** Where a ring sits at a given point of its journey, 0 → 1. */
function poseAt(p: number) {
  const a = p * Math.PI * 2 * TURNS;
  const depth = Math.cos(a); // +1 nearest the viewer, -1 furthest
  const near = 0.5 + 0.5 * depth;
  return {
    y: -STEP * 2 + p * SPAN,
    // Wider than the rail on purpose: the rings run past the edges and get
    // clipped, the way the reference strip does.
    x: Math.sin(a) * 46,
    scale: 0.74 + 0.26 * near,
    brightness: 0.5 + 0.5 * near,
    front: depth >= 0,
  };
}

const transformFor = (p: number) => {
  const { y, x, scale } = poseAt(p);
  return `translate3d(${x.toFixed(2)}px, ${y.toFixed(1)}px, 0) scale(${scale.toFixed(3)})`;
};

/**
 * The keyframes are generated rather than hand-written: they have to trace
 * the same sine the static pose does, or the resting position (which is all
 * a prefers-reduced-motion user ever sees) would not match the motion.
 */
const KEYFRAMES = (() => {
  const stops: string[] = [];
  const STEPS = 36;
  for (let i = 0; i <= STEPS; i++) {
    const p = i / STEPS;
    const { brightness, front } = poseAt(p);
    stops.push(
      `${((p * 100)).toFixed(2)}%{transform:${transformFor(p)};` +
        `filter:brightness(${brightness.toFixed(3)});z-index:${front ? 2 : 1}}`,
    );
  }
  return `@keyframes gspiral{${stops.join("")}}`;
})();

export default function GenreSpiral({ speedSeconds = 44 }: { speedSeconds?: number }) {
  return (
    <div className="gspiral" aria-hidden="true">
      {/* Generated here so the animation and the resting pose can never drift
          apart — see KEYFRAMES. */}
      <style>{KEYFRAMES}</style>
      {RINGS.map((g, i) => {
        const p = i / RINGS.length;
        const pose = poseAt(p);
        return (
          <span
            key={`${g.slug}-${i}`}
            className="gsband"
            style={{
              // The resting pose lives on the element, not only in the
              // keyframes: prefers-reduced-motion strips animations outright,
              // and without this every ring would collapse onto the same spot.
              transform: transformFor(p),
              filter: `brightness(${pose.brightness.toFixed(3)})`,
              zIndex: pose.front ? 2 : 1,
              animationDelay: `${(-p * speedSeconds).toFixed(2)}s`,
              animationDuration: `${speedSeconds}s`,
            }}
          >
            <i
              className="gsdisc"
              style={{
                backgroundImage: HAS_STILLS
                  ? `url(/genres/${g.slug}.webp), ${g.gradient}`
                  : g.gradient,
              }}
            />
          </span>
        );
      })}
    </div>
  );
}
