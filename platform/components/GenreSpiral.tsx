"use client";

/**
 * The genre strip — a column of film frames beside the form, turning like a
 * barber's pole.
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
 * Enough frames to fill the column AND to have a whole spare set below it,
 * so the roll can travel one full set and snap back without anything
 * appearing to jump. The set length is what the animation translates by.
 */
const SETS = 3;
const FRAMES = Array.from({ length: SETS }, () => GENRES).flat();

const TILE_W = 330; // px — a little wider than the rail; the rest is clipped
/* The reference's frames are far wider than they are tall — about 7:1 —
   which is what makes a column of them read as film rather than as a stack
   of postcards. */
const TILE_H = 66;
/** Frame to frame. The difference from TILE_H is the dark slot between them. */
const PITCH = 80;
/** One set of genres — the distance the roll travels before it repeats. */
const SET_SPAN = GENRES.length * PITCH;

/**
 * The bow. Each frame is wrapped around an invisible vertical cylinder, so
 * its long edges are arcs and its middle stands closer to you than its ends.
 * That curve is the single most recognisable thing about the reference — a
 * flat rectangle, however tilted, does not read like a strip of film at all.
 * It costs one element per facet, which is why the count is small.
 */
const ARC = 30; // degrees the frame bends through
const SLICES = 10;
const SLICE_W = TILE_W / SLICES;
const BEND_R = TILE_W / ((ARC * Math.PI) / 180);

/**
 * The frames do not sit level: each is rolled a few degrees, and the roll
 * alternates down the strip so the dark slots between them read as slanted
 * slivers rather than as ruled lines. Keyed off the index, so a frame keeps
 * its own angle for the whole roll instead of wobbling as it travels.
 */
const rollFor = (i: number) => Math.sin(i * 1.1) * 4.6;

/** One facet of the frame's bend, carrying its slab of the still. */
function Slice({ image, index }: { image: string; index: number }) {
  const deg = -ARC / 2 + (index + 0.5) * (ARC / SLICES);
  const facing = Math.cos((deg * Math.PI) / 180);
  return (
    <i
      className="gsslice"
      style={{
        width: SLICE_W + 1,
        // Every facet starts at the frame's centre and is swung out from
        // there — that IS the bend. Offsetting it by its index as well
        // double-counts the position and fans the facets across the page.
        left: "50%",
        marginLeft: -(SLICE_W + 1) / 2,
        transform: `rotateY(${deg.toFixed(2)}deg) translateZ(${BEND_R.toFixed(1)}px)`,
        backgroundImage: image,
        // The still is laid across the WHOLE frame and each facet shows its
        // own slab of it, so the picture is continuous over the bend rather
        // than repeated ten times.
        backgroundSize: `${TILE_W}px 100%`,
        backgroundPosition: `${(-index * SLICE_W).toFixed(1)}px center`,
        filter: `brightness(${(0.88 + 0.12 * facing ** 2).toFixed(3)})`,
      }}
    />
  );
}

/**
 * `speedSeconds` is one genre set: the whole strip rolls by in that time and
 * repeats. The roll is a CSS animation on the stage, not per-frame work — it
 * is one composited transform however many frames are on screen.
 */
export default function GenreSpiral({ speedSeconds = 90 }: { speedSeconds?: number }) {
  return (
    <div className="gspiral" aria-hidden="true">
      <style>{`@keyframes gsroll{from{transform:translate3d(0,${-SET_SPAN}px,0)}to{transform:translate3d(0,0,0)}}`}</style>
      <div
        className="gsstage"
        style={{ animationDuration: `${speedSeconds}s`, height: FRAMES.length * PITCH }}
      >
        {FRAMES.map((g, i) => {
          const image = HAS_STILLS
            ? `url(/genres/${g.slug}.webp), ${g.gradient}`
            : g.gradient;
          return (
            <span
              key={`${g.slug}-${i}`}
              className="gsband"
              style={{
                width: TILE_W,
                height: TILE_H,
                marginLeft: -TILE_W / 2,
                top: i * PITCH,
                // Pulled back by the bend radius: the facets are pushed
                // OUT by that much, so without this the whole frame flies
                // toward the viewer and perspective blows it up to a
                // full-screen slab. The two cancel and the arc sits in the
                // frame's own plane.
                transform: `translateZ(${(-BEND_R).toFixed(1)}px) rotate(${rollFor(i).toFixed(2)}deg)`,
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
