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
 * one band having to travel a suspiciously long way.
 */
const RINGS = [...GENRES, ...GENRES];

/**
 * The coil, as real geometry.
 *
 * Each band is a film strip wrapped around an invisible vertical cylinder:
 * SLICES vertical facets, each rotated around the axis and pushed out to the
 * radius, with the still's horizontal offset stepped across them. That is
 * what gives the band actual curvature — the previous version faked depth on
 * a flat ellipse, and it read as a stack of lozenges rather than a coil.
 *
 * Only the near half is ever visible: the facets are opaque and the far ones
 * are turned away, exactly as a real cylinder behaves.
 */
const RADIUS = 116; // px — the coil is 232 wide, just past the 224px rail
const BAND_H = 46; // px, the height of one strip
const SLICES = 16;
/**
 * How much of the circle each strip covers.
 *
 * This is the number that decides whether the piece reads as a coil at all.
 * A CLOSED ring is the same silhouette from every angle, so spinning it
 * changes nothing on screen and the column reads as a stack of hoops — which
 * is exactly what the first attempt looked like. An open ribbon has ends, and
 * watching those ends sweep around is what the eye reads as rotation.
 */
const ARC = 155;
/**
 * Vertical gap between bands. It has to EXCEED the band height, or the coil
 * closes into a solid barrel: the dark between the turns is what makes a
 * helix read as a helix.
 */
const STEP = 74;
/** Turns the coil makes over one full loop. */
const TURNS = 6;
const SPAN = RINGS.length * STEP;

/** Arc length of the strip, and of one facet of it. */
const ARC_LEN = 2 * Math.PI * RADIUS * (ARC / 360);
const SLICE_W = ARC_LEN / SLICES;

/** Where a band sits at a given point of its descent, 0 → 1. */
const poseAt = (p: number) => ({
  y: -BAND_H * 1.5 + p * SPAN,
  spin: p * 360 * TURNS,
});

const transformFor = (p: number) => {
  const { y, spin } = poseAt(p);
  return `translateY(${y.toFixed(1)}px) rotateY(${spin.toFixed(2)}deg)`;
};

/**
 * Both ends of the loop describe the same pose, so two stops are enough and
 * the interpolation is honest: y and the spin are each linear in p. The
 * resting transform is also written onto every band inline, because
 * prefers-reduced-motion strips animations outright and without it the whole
 * coil would collapse onto one line.
 */
const KEYFRAMES =
  `@keyframes gspiral{` +
  `from{transform:${transformFor(0)}}` +
  `to{transform:${transformFor(1)}}}`;

/** One facet of the cylinder: its slab of the still, lit by its own angle. */
function Slice({ image, index }: { image: string; index: number }) {
  // Centred on the strip, so the band's own rotation carries its middle.
  const deg = -ARC / 2 + (index + 0.5) * (ARC / SLICES);
  const facing = Math.cos((deg * Math.PI) / 180);
  // Lambert-ish: a facet square to the viewer catches the most light, one
  // turning away catches least — that gradient across the facets is what
  // reads as roundness. Facets past 90° are the INSIDE of the strip, seen
  // through the open side, and are darker still.
  const light =
    facing >= 0 ? 0.42 + 0.58 * facing ** 0.75 : 0.2 + 0.14 * (1 + facing);
  return (
    <i
      className="gsslice"
      style={{
        width: SLICE_W + 1,
        marginLeft: -(SLICE_W + 1) / 2,
        transform: `rotateY(${deg.toFixed(2)}deg) translateZ(${RADIUS}px)`,
        backgroundImage: image,
        backgroundSize: `${ARC_LEN.toFixed(1)}px 100%`,
        backgroundPosition: `${(-index * SLICE_W).toFixed(1)}px center`,
        filter: `brightness(${light.toFixed(3)})`,
      }}
    />
  );
}

export default function GenreSpiral({ speedSeconds = 60 }: { speedSeconds?: number }) {
  return (
    <div className="gspiral" aria-hidden="true">
      <style>{KEYFRAMES}</style>
      {/* Tilted a little, so the coil is seen from slightly above the way the
          reference is, rather than dead level. */}
      <div className="gsstage">
        {RINGS.map((g, i) => {
          const p = i / RINGS.length;
          const image = HAS_STILLS
            ? `url(/genres/${g.slug}.webp), ${g.gradient}`
            : g.gradient;
          return (
            <span
              key={`${g.slug}-${i}`}
              className="gsband"
              style={{
                height: BAND_H,
                transform: transformFor(p),
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
