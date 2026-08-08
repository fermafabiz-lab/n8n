"use client";

import { useEffect, useRef } from "react";

/**
 * The genre strip — a column of film frames running the full height of the
 * screen, down the right of the page.
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
 * Every genre twice, so the column stays full on a tall screen and the wrap
 * point is always far off the bottom of the viewport.
 */
const FRAMES = [...GENRES, ...GENRES];

const TILE_W = 340; // px — wider than the rail; the overflow is clipped
const TILE_H = 78; // px
/** Frame to frame. The difference from TILE_H is the dark gap between them. */
const PITCH = 96;
const LOOP = FRAMES.length * PITCH; // the whole column, before it repeats
/** How far the column travels per pixel of page scroll. */
const SCROLL_RATE = 0.45;

/**
 * The barrel. Frames away from the middle of the screen tilt away and sink
 * back, so the column reads as wrapped around a very large cylinder lying
 * across the page rather than as a flat stack of rectangles. `t` is -1 at the
 * top of the viewport, 0 in the middle, +1 at the bottom.
 */
const TILT = 30; // deg of rotateX at the very top and bottom
const SINK = 150; // px the ends recede
/** A slow sway, so the column is never a perfectly straight ruler. */
const SWAY_X = 10; // px
const SWAY_DEG = 3.2; // deg of roll

function transformFor(y: number, viewportH: number) {
  const t = Math.max(-1.6, Math.min(1.6, (y - viewportH / 2) / (viewportH / 2)));
  // The sway is a function of the frame's position ON THE STRIP, not of where
  // it happens to be on screen — otherwise the whole column would ripple as
  // you scroll instead of the frames riding through a fixed shape.
  const phase = (y / LOOP) * Math.PI * 2;
  return (
    `translate3d(${(Math.sin(phase * 3) * SWAY_X).toFixed(1)}px, ${y.toFixed(1)}px, ` +
    `${(-Math.abs(t) * SINK).toFixed(1)}px) ` +
    `rotateX(${(-t * TILT).toFixed(2)}deg) ` +
    `rotate(${(Math.sin(phase * 3 + 1) * SWAY_DEG).toFixed(2)}deg)`
  );
}

/** Positive modulo — `%` alone hands back negatives and drops a frame. */
const wrap = (v: number, m: number) => ((v % m) + m) % m;

export default function GenreSpiral() {
  const tiles = useRef<(HTMLSpanElement | null)[]>([]);

  useEffect(() => {
    let raf = 0;
    const paint = () => {
      raf = 0;
      const vh = window.innerHeight;
      // Scroll drives the strip: the frames arrive as you read down the form,
      // which is the point — it is the page's own motion, not a loop playing
      // beside it. Nothing moves on its own, so there is no reduced-motion
      // case to answer here.
      const offset = window.scrollY * SCROLL_RATE;
      for (let i = 0; i < tiles.current.length; i++) {
        const el = tiles.current[i];
        if (!el) continue;
        // The modulus is the STRIP's own length, and only that: wrapping on
        // anything else (LOOP + vh was the first attempt) inserts a gap the
        // size of the difference and sends a hole travelling through the
        // column. The −vh shift only decides where the seam sits — a screen
        // above the top, so a frame is never seen appearing.
        const y = wrap(i * PITCH - offset + vh, LOOP) - vh;
        el.style.transform = transformFor(y, vh);
      }
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(paint);
    };
    paint();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div className="gspiral" aria-hidden="true">
      <div className="gsstage">
        {FRAMES.map((g, i) => (
          <span
            key={`${g.slug}-${i}`}
            ref={(el) => {
              tiles.current[i] = el;
            }}
            className="gsband"
            style={{
              width: TILE_W,
              height: TILE_H,
              marginLeft: -TILE_W / 2,
              marginTop: -TILE_H / 2,
              backgroundImage: HAS_STILLS
                ? `url(/genres/${g.slug}.webp), ${g.gradient}`
                : g.gradient,
              // A resting pose for the server render and the first paint,
              // against a nominal viewport. The effect above corrects it to
              // the real one on the same frame the page becomes interactive.
              transform: transformFor(i * PITCH, 900),
            }}
          />
        ))}
      </div>
    </div>
  );
}
