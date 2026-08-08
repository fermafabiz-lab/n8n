"use client";

/**
 * The genre strip — a barber's pole made of videos, turning beside the form.
 *
 * It is a real cylinder: the frames are laid on its surface as a multi-start
 * helix, joined end to end along each thread and edge to edge across the
 * threads, so the whole pole is covered in film. The pole spins about its own
 * axis, and because the threads are helical the stripes appear to climb —
 * which is exactly what a barber's pole does. Nothing translates.
 *
 * It is a shop window: every frame is a genre the factory can make, so the
 * page shows the range of the thing you are about to commission while you
 * commission it.
 *
 * Each frame carries `public/genres/<slug>.webp` when that file exists and
 * falls back to a gradient built from the genre's own palette when it does
 * not — so the strip is complete from the first render and gets photographic
 * the moment the stills are dropped in, with no code change.
 */

/**
 * Flip to true once `public/genres/<slug>.webp` exists for every genre
 * below. Until then the frames use their gradients — asking for images that
 * aren't there would mean a failed request each on every page load, and the
 * fallback is what would render anyway.
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
 * The pole.
 *
 * `LEAN` is the angle the stripe makes with the horizontal, and everything
 * follows from it: the rise per radian of turn is `R · tan(LEAN)`, so one
 * thread descends `2π · rise` in a full turn. At 60° that pitch is six poles
 * wide — far too much for a single thread to cover the surface, which is why
 * a real barber's pole carries several stripes side by side. So does this
 * one: `STARTS` threads, each offset down the axis by a share of the pitch,
 * landing edge to edge.
 */
const LEAN = 30; // degrees off horizontal
const R = 120; // px, the pole's radius
const RISE = R * Math.tan((LEAN * Math.PI) / 180); // px of descent per radian
const PITCH_Y = 2 * Math.PI * RISE; // one turn of one thread
/**
 * Frames around the pole, per turn of one thread. It is the only lever on how
 * BIG each video is: fewer frames around means each one covers more of the
 * circumference, so it is wider. It is also the pole's roundness, since every
 * frame is flat and the silhouette is a polygon with this many sides — so it
 * trades one against the other, and the shading on the container makes up the
 * difference.
 */
const AROUND = 6;
const STEP = (2 * Math.PI) / AROUND;

/**
 * The frame's own size, measured on the UNROLLED surface — arc length, not
 * chord. The projection below does the foreshortening; building it into the
 * size as well would count it twice and leave the frames short of each other.
 */
const ARC_LEN = R * STEP;
const DROP = STEP * RISE;
/** The spacing between two frames along their thread. */
const PATH_STEP = Math.hypot(ARC_LEN, DROP);
/**
 * Frames overlap along the thread by this much at each end, and the overlap
 * is what the cross-fade is made of: each frame's mask ramps from clear to
 * solid across exactly the overlap, so where two meet, one ramps down while
 * the other ramps up and the two alphas sum to one. Linear ramps are what
 * make that sum exact — an eased fade would dip and leave a dark seam.
 */
const OVERLAP = Math.round(PATH_STEP * 0.22);
const TILE_W = Math.ceil(PATH_STEP) + 2 * OVERLAP;
/** Where the ramp ends, as a share of the frame's width. */
const FADE_PCT = ((2 * OVERLAP) / TILE_W) * 100;
const SEAM_MASK =
  `linear-gradient(90deg, rgba(0,0,0,0) 0%, #000 ${FADE_PCT.toFixed(2)}%, ` +
  `#000 ${(100 - FADE_PCT).toFixed(2)}%, rgba(0,0,0,0) 100%)`;

const STARTS = 3;
const THREAD_GAP = PITCH_Y / STARTS;
/**
 * Across the stripe. The bare minimum is the axial gap between threads times
 * cos(lean) — at which two neighbours meet on exactly one line and any
 * rounding anywhere opens a seam. The overlap factor buys that margin back;
 * overlapping frames simply layer, which costs nothing.
 */
const TILE_H = Math.ceil(THREAD_GAP * Math.cos((LEAN * Math.PI) / 180) * 1.2);

/**
 * Frames down each thread — enough to run the length of a long form. Derived
 * rather than guessed: at 45° the pole descends much more slowly per frame
 * than at 60°, so a fixed count that covered the form before would now stop
 * a third of the way down it.
 */
const COVER = 3800; // px of form the pole must reach
const PER_THREAD = Math.ceil(COVER / DROP) + 1;

/**
 * The pole is projected by hand rather than with CSS `perspective`, and that
 * is the whole reason this version works where the last one did not: a
 * perspective is measured from ITS OWN box, and this box is as tall as the
 * form — thousands of pixels — so every frame near the top was projected
 * from a vanishing point a screen and a half below it and came out stretched
 * and scattered. Orthographic projection has no such origin: x is
 * `R·sin(a)`, the frame is squeezed by `cos(a)`, and the far half is simply
 * not drawn. The squeeze is applied AFTER the frame's own lean, which is
 * what makes the stripe steepen toward the edges the way a real one does.
 *
 * All of it lives in one shared keyframe walk, because every frame follows
 * the same path and differs only in where it starts — so the pole spins for
 * the cost of one animation, and `animation-delay` places each frame on it.
 */
const TURN = (() => {
  const stops: string[] = [];
  const STEPS = 48;
  for (let i = 0; i <= STEPS; i++) {
    const p = i / STEPS;
    const a = p * 2 * Math.PI;
    const c = Math.cos(a);
    const front = c > 0.02;
    stops.push(
      `${(p * 100).toFixed(2)}%{transform:translateX(${(Math.sin(a) * R).toFixed(1)}px) ` +
        `scaleX(${Math.max(c, 0.02).toFixed(4)}) rotate(${LEAN}deg);` +
        `filter:brightness(${(0.34 + 0.66 * Math.max(c, 0)).toFixed(3)});` +
        `opacity:${front ? 1 : 0}}`,
    );
  }
  return `@keyframes gspole{${stops.join("")}}`;
})();

/** Fold any phase into one turn. `%` alone hands back negatives. */
const wrap01 = (v: number) => ((v % 1) + 1) % 1;

export default function GenreSpiral({ speedSeconds = 34 }: { speedSeconds?: number }) {
  const rows: React.ReactElement[] = [];
  for (let s = 0; s < STARTS; s++) {
    for (let k = 0; k < PER_THREAD; k++) {
      const g = GENRES[(s * PER_THREAD + k) % GENRES.length];
      // Mid-angle and mid-height of the segment this frame covers, so its
      // ends land on the segment's ends instead of overshooting one side.
      //
      // The `- lift` is what makes the pole SOLID, and leaving it out is the
      // bug this cost the longest: a thread's height is tied to its angle, so
      // starting every thread at the same frame index starts each one lower
      // than the last, and the top of the pole ends up with only one or two
      // of the seven threads present — black holes between them. Each thread
      // is wound back by whole frames until it starts at the top like the
      // first. Winding back by WHOLE frames matters: the angle moves with it,
      // so the frame stays a genuine frame of that same thread.
      const lift = Math.round((s * THREAD_GAP) / DROP);
      const a = (k - lift + 0.5) * STEP;
      const y = a * RISE + s * THREAD_GAP;
      rows.push(
        <span key={`${s}-${k}`} className="gsrow" style={{ top: y }}>
          <i
            className="gsband"
            style={{
              width: TILE_W,
              height: TILE_H,
              marginLeft: -TILE_W / 2,
              marginTop: -TILE_H / 2,
              WebkitMaskImage: SEAM_MASK,
              maskImage: SEAM_MASK,
              backgroundImage: HAS_STILLS
                ? `url(/genres/${g.slug}.webp), ${g.gradient}`
                : g.gradient,
              // Where on the turn this frame starts. The phase is folded
              // into one turn FIRST: a wound-back thread has a negative
              // angle, which would make the delay positive — and a positive
              // delay means the frame simply sits untransformed, unrotated
              // and at full brightness, until its turn comes round. That is
              // what a flat stack of rectangles down one side of the pole
              // was.
              animationDelay: `${(-wrap01(a / (2 * Math.PI)) * speedSeconds).toFixed(3)}s`,
              animationDuration: `${speedSeconds}s`,
            }}
          />
        </span>,
      );
    }
  }

  return (
    <div className="gspiral" aria-hidden="true">
      <style>{TURN}</style>
      <div className="gsstage" style={{ height: PER_THREAD * DROP }}>
        {rows}
      </div>
    </div>
  );
}
