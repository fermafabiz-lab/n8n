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
 * thread descends `2π · rise` in a full turn. That pitch is wider than the
 * pole, so a single thread cannot cover it — which is why a real barber's
 * pole carries several stripes side by side, and why this one does too.
 */
const LEAN = 30; // degrees off horizontal
const R = 120; // px, the pole's radius
const RISE = R * Math.tan((LEAN * Math.PI) / 180); // px of descent per radian
const PITCH_Y = 2 * Math.PI * RISE; // one turn of one thread

/**
 * A frame is NOT one element. It is a run of narrow vertical slabs, each
 * standing at its own angle on the cylinder — and that is the only way a
 * picture can actually wrap around the pole instead of being a flat card
 * turning inside a cylindrical arrangement. Each slab is squeezed by the
 * cosine of ITS OWN angle, so a frame near the edge of the pole compresses
 * across its width exactly as a real one would.
 *
 * The slab count around the pole is therefore its roundness, and the cost:
 * sixteen is a step of 22.5°, small enough that the surface reads as curved.
 */
const SLABS_AROUND = 16;
const dA = (2 * Math.PI) / SLABS_AROUND;
/**
 * Unrolled width of one slab — the true arc length, kept unrounded. The
 * element is drawn a little wider so neighbours overlap by a hairline, but
 * the PICTURE is laid out against the true width: round the two together and
 * each slab shows the picture about two pixels off from the last, which
 * accumulates into visible vertical banding across every frame.
 */
const SLAB_U = R * dA;
const SLAB_W = SLAB_U + 1.2;
/** How far one slab descends along its thread. */
const SLAB_DROP = dA * RISE;

/** Slabs per picture — four covers 90° of the pole, so the frames stay big. */
const FRAME_SLABS = 4;
/**
 * The picture is laid across one slab MORE than its frame owns. That spare
 * column is what the next frame fades in over: without it the bridging slab
 * would have to repeat the picture's last strip, which shows as a stutter.
 */
const IMG_SPAN = FRAME_SLABS + 1;

const STARTS = 3;
const THREAD_GAP = PITCH_Y / STARTS;
/**
 * The stripe's width across itself, and it is deliberately LESS than the
 * space between threads: the leftover is a dark gap between the rows, which
 * is what a barber's pole has. It also removes the need to fade the top and
 * bottom of every picture — nothing butts against anything there any more,
 * so there is no seam to hide, and the pictures keep their full height.
 */
const BAND_W = (THREAD_GAP * Math.cos((LEAN * Math.PI) / 180)) * 0.82;
/** Measured up the screen rather than across the stripe. */
const SLAB_H = Math.ceil(BAND_W / Math.cos((LEAN * Math.PI) / 180));

/** Slabs down each thread — enough to run the length of a long form. */
const COVER = 3200; // px of form the pole must reach
const PER_THREAD = Math.ceil(COVER / SLAB_DROP) + 1;

/**
 * The projection is done here rather than with CSS `perspective`, which is
 * measured from its own box — and this box is as tall as the form, so a
 * perspective would project the top of the pole from a vanishing point a
 * screen and a half below it. Orthographic has no such origin: x is
 * `R·sin(a)`, the slab is squeezed by `cos(a)`, and the far half is not
 * drawn.
 *
 * `skewY` is what replaced the old whole-frame `rotate`. A slab must keep
 * VERTICAL sides — the boundary between two angular slices of a cylinder is
 * a vertical line — while its top and bottom follow the stripe's lean. That
 * is exactly what a skew does and what a rotation cannot: rotating a slab
 * tilts its sides too, and the sides then cross their neighbours.
 *
 * It is one shared keyframe walk: every slab follows the same path and
 * differs only in where it starts, so the pole spins for the cost of a
 * single animation and `animation-delay` places each slab on it.
 */
const TURN = (() => {
  const stops: string[] = [];
  const STEPS = 48;
  for (let i = 0; i <= STEPS; i++) {
    const p = i / STEPS;
    const a = p * 2 * Math.PI;
    const c = Math.cos(a);
    stops.push(
      `${(p * 100).toFixed(2)}%{transform:translateX(${(Math.sin(a) * R).toFixed(1)}px) ` +
        `scaleX(${Math.max(c, 0.02).toFixed(4)}) skewY(${LEAN}deg);` +
        // Shading per slab is a STEP: it is constant across a slab and jumps at
        // the next one, so a wide range draws a visible line at every slab
        // boundary — sixteen hairlines down each stripe. Most of the roundness
        // is the container's fixed gradient instead, which is continuous;
        // this only has to carry the part that must travel with the surface.
        `filter:brightness(${(0.66 + 0.34 * Math.max(c, 0)).toFixed(3)});` +
        `opacity:${c > 0.02 ? 1 : 0}}`,
    );
  }
  return `@keyframes gspole{${stops.join("")}}`;
})();

/** The bridge slab's ramp: the outgoing picture thins out across it. */
const BRIDGE_MASK =
  "linear-gradient(90deg, #000 0%, rgba(0,0,0,0.55) 45%, rgba(0,0,0,0) 100%)";

/** Fold any phase into one turn. `%` alone hands back negatives. */
const wrap01 = (v: number) => ((v % 1) + 1) % 1;

export default function GenreSpiral({ speedSeconds = 40 }: { speedSeconds?: number }) {
  const rows: React.ReactElement[] = [];

  const imageFor = (i: number) => {
    const g = GENRES[((i % GENRES.length) + GENRES.length) % GENRES.length];
    return HAS_STILLS ? `url(/genres/${g.slug}.webp), ${g.gradient}` : g.gradient;
  };

  for (let s = 0; s < STARTS; s++) {
    // Wound back by whole slabs so every thread starts level with the first.
    // A thread's height is tied to its angle, so without this each one starts
    // lower than the last and the top of the pole is missing rows.
    const lift = Math.round(THREAD_GAP / SLAB_DROP) * s;
    for (let k = 0; k < PER_THREAD; k++) {
      const j = k - lift;
      const a = (j + 0.5) * dA;
      const y = a * RISE + s * THREAD_GAP;
      const frame = Math.floor(j / FRAME_SLABS) + s * 5;
      const within = ((j % FRAME_SLABS) + FRAME_SLABS) % FRAME_SLABS;
      const common = {
        width: SLAB_W,
        height: SLAB_H,
        marginLeft: -SLAB_W / 2,
        marginTop: -SLAB_H / 2,
        backgroundSize: `${(IMG_SPAN * SLAB_U).toFixed(2)}px 100%`,
        animationDelay: `${(-wrap01(a / (2 * Math.PI)) * speedSeconds).toFixed(3)}s`,
        animationDuration: `${speedSeconds}s`,
      };
      rows.push(
        <span key={`${s}-${k}`} className="gsrow" style={{ top: y }}>
          <i
            className="gsband"
            style={{
              ...common,
              backgroundImage: imageFor(frame),
              backgroundPosition: `${(-within * SLAB_U).toFixed(2)}px center`,
            }}
          />
          {/* At every picture boundary, the OUTGOING one carries on over the
              first slab of the next and thins out across it, so one dissolves
              into the other instead of cutting. */}
          {within === 0 && (
            <i
              className="gsband gsbridge"
              style={{
                ...common,
                backgroundImage: imageFor(frame - 1),
                backgroundPosition: `${(-FRAME_SLABS * SLAB_U).toFixed(2)}px center`,
                WebkitMaskImage: BRIDGE_MASK,
                maskImage: BRIDGE_MASK,
              }}
            />
          )}
        </span>,
      );
    }
  }

  return (
    <div className="gspiral" aria-hidden="true">
      <style>{TURN}</style>
      <div className="gsstage" style={{ height: PER_THREAD * SLAB_DROP }}>
        {rows}
      </div>
    </div>
  );
}
