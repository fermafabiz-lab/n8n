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
 * The strand, as a barber's pole.
 *
 * The bands are a single ribbon wound around an invisible vertical cylinder:
 * each one covers the segment of the helix between its own angle and the
 * next, so they meet edge to edge, and the ribbon carries on around the BACK
 * of the cylinder instead of turning around at the sides. That is the whole
 * difference between a barber pole and a flat S drawn on the page — the
 * stripe never reverses, it just goes away from you and comes back.
 *
 * Because the turn per band and the rise per band are both constant, so is
 * the stripe's angle: every band is the same size and the same lean, exactly
 * like a real pole. Nothing per-band may scale — two neighbours at different
 * scales cannot share an edge, which is what used to leave the strand dotted.
 */
const RADIUS = 105; // px — the cylinder's radius
/** Vertical rise per radian of turn. Sets the stripe's angle. */
/* One full turn is 2π·RISE ≈ 190px of descent. That number is the whole
   difference between reading as a pole and reading as a cord: the strand
   only shows through a ~350px window above the fold, so a turn has to FIT in
   it. At the previous rise a turn took 750px and all anyone ever saw was one
   diagonal arc. */
const RISE = 30;
/* The stripe's width, and it is set against the PITCH (the ≈190px a full
   turn descends), not against the drop between neighbouring bands. A barber
   pole reads as alternating stripes: a thin ribbon on a wide pitch is a wire
   winding through the air, not a pole. At 92 against 190 the ribbon and the
   dark gap between its turns are about equal, which is the alternation the
   eye is looking for. */
const BAND_H = 92;
/** Fourteen bands per full turn of the pole. */
const TURN_PER_BAND = (2 * Math.PI) / 14;

const SPAN = RINGS.length * TURN_PER_BAND * RISE;
/** Straight-line distance across the face of the cylinder for one band. */
const CHORD = 2 * RADIUS * Math.sin(TURN_PER_BAND / 2);
const DROP = TURN_PER_BAND * RISE;
/** +1: a hairline of overlap beats a hairline of gap. */
const BAND_W = Math.ceil(Math.hypot(CHORD, DROP)) + 1;
/** The stripe's angle — constant, the way a barber pole's is. ≈50°. */
const LEAN = (Math.atan2(DROP, CHORD) * 180) / Math.PI;

/** Where the band starting at fraction p of the descent sits on the pole. */
function poseAt(p: number) {
  // Mid-angle of the segment this band covers, so its ends land on the
  // segment's ends rather than overshooting one side.
  const a = (p * RINGS.length + 0.5) * TURN_PER_BAND;
  return {
    y: -BAND_H + p * SPAN,
    turn: (a * 180) / Math.PI,
    depth: Math.cos(a), // +1 at the front of the pole, -1 behind it
  };
}

const transformFor = (p: number) => {
  const { y, turn } = poseAt(p);
  // Order is the whole trick: drop down the axis, turn around the axis, push
  // out to the surface — and only then lean the band within the tangent plane
  // it now lies in. Leaning earlier tilts the axis it is turned about and
  // scatters the bands.
  return (
    `translate3d(0px, ${y.toFixed(1)}px, 0) ` +
    `rotateY(${turn.toFixed(2)}deg) translateZ(${RADIUS}px) ` +
    `rotate(${LEAN.toFixed(2)}deg)`
  );
};

/* The far side of the pole must stay VISIBLE, only dimmer. Dropping it to
   0.4 on a black page hid it completely, and a barber pole with its back
   half missing reads as a thin cord winding through the air rather than as a
   cylinder. The range below is the shading that makes it look round. */
const brightnessAt = (depth: number) => 0.66 + 0.44 * (0.5 + 0.5 * depth);

/**
 * Generated, not hand-written: the keyframes have to trace the same path as
 * the resting pose, or the position a prefers-reduced-motion user sees —
 * animations are stripped globally — would not match the motion.
 *
 * The step count is a multiple of the band count on purpose. Between two
 * stops CSS interpolates linearly, and a rotation interpolated coarsely cuts
 * the corner off the circle, pulling the ribbon inward and apart.
 */
const KEYFRAMES = (() => {
  const stops: string[] = [];
  const STEPS = RINGS.length * 4;
  for (let i = 0; i <= STEPS; i++) {
    const p = i / STEPS;
    const { depth } = poseAt(p);
    stops.push(
      `${(p * 100).toFixed(3)}%{transform:${transformFor(p)};` +
        `filter:brightness(${brightnessAt(depth).toFixed(3)})}`,
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
