"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The examples section: three finished films, each playing itself.
 *
 * Playback: nothing is fetched until a clip is on screen. `preload="none"`
 * keeps the browser from touching the files at page open, and ONE
 * IntersectionObserver plays a clip when it comes into view and pauses it when
 * it leaves. There is deliberately no `autoplay` ATTRIBUTE: it means "start as
 * soon as you can", which makes the browser begin loading immediately and
 * throws away the whole point of `preload="none"`. Autoplay here is the
 * observer's job, and the clips are muted + playsInline so a browser will
 * grant it without a click.
 *
 * Caption: theme · duration · platform. The duration is the film's real one,
 * read off the element at `loadedmetadata`; EXAMPLES carries the measured
 * value so the line is right before the clip has loaded, and the file is the
 * final word if the two ever disagree.
 *
 * Reduced motion: a looping video is the thing `prefers-reduced-motion` is
 * about, so nothing plays by itself there. The clips get their controls back
 * instead — without them a reader who opts out would have no way to watch.
 */

export type Example = {
  /** Path as it is on disk, spaces and all. Encoded at render, not here. */
  src: string;
  theme: string;
  platform: string;
  /** Measured off the file on the box; the element overrides it once loaded. */
  seconds: number;
  /** Written on the element, so a browser can size the box before loading. */
  width: number;
  height: number;
};

// The three films, and the only place to edit what the caption says. THEME and
// PLATFORM are placeholders — they were taken from the file names, which is
// all this prototype knows about the films. The durations are not guesses:
// they were read out of the mp4 headers on the box (1:39, 0:08, 6:41).
export const EXAMPLES: Example[] = [
  {
    src: "/media/kidsstory.mp4",
    theme: "Poveste pentru copii",
    platform: "YouTube",
    seconds: 98.88,
    width: 1920,
    height: 1080,
  },
  {
    // The space before `.mp4` is not a typo — it is the file's real name.
    src: "/media/m8 .mp4",
    theme: "Auto",
    platform: "Instagram",
    seconds: 8,
    width: 1920,
    height: 1080,
  },
  {
    src: "/media/roman empire.mp4",
    theme: "Imperiul Roman",
    platform: "YouTube",
    seconds: 400.9,
    width: 1920,
    height: 1080,
  },
];

// A clip counts as "on screen" at a quarter visible. Lower and a clip plays
// while it is still a sliver at the edge; higher and a tall clip on a short
// window can never qualify at all.
const VISIBLE_RATIO = 0.25;

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "—";
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

// The files genuinely have spaces in their names, so the path has to be
// encoded or the request is malformed. encodeURI leaves the slashes alone.
const mediaUrl = (src: string): string => encodeURI(src);

export default function ExampleReel() {
  const videosRef = useRef<(HTMLVideoElement | null)[]>([]);
  // Seeded from the measured values so the line reads right immediately, then
  // replaced by whatever the file actually says.
  const [durations, setDurations] = useState<number[]>(() => EXAMPLES.map((e) => e.seconds));
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduced(motion.matches);
    apply();
    motion.addEventListener("change", apply);
    return () => motion.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    if (reduced) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const video = entry.target as HTMLVideoElement;
          if (entry.isIntersecting) {
            // Rejects when a browser refuses the autoplay; there is nothing to
            // recover, and an unhandled rejection would be noise in the console.
            void video.play().catch(() => {});
          } else if (!video.paused) {
            video.pause();
          }
        }
      },
      { threshold: VISIBLE_RATIO },
    );

    const videos = videosRef.current.filter((v): v is HTMLVideoElement => v !== null);
    for (const video of videos) observer.observe(video);
    return () => {
      observer.disconnect();
      // Leaving the section should not leave three clips decoding.
      for (const video of videos) video.pause();
    };
  }, [reduced]);

  return (
    <section className="examples" data-testid="examples" aria-label="Exemple">
      <h2 className="examples__heading">Exemple</h2>
      <div className="examples__list">
        {EXAMPLES.map((example, i) => (
          <figure className="example" key={example.src}>
            <video
              className="example__video"
              ref={(el) => {
                videosRef.current[i] = el;
              }}
              src={mediaUrl(example.src)}
              width={example.width}
              height={example.height}
              preload="none"
              muted
              loop
              playsInline
              controls={reduced}
              // Not decorative: the caption below names the film, so the clip
              // itself does not need repeating to a screen reader.
              aria-label={example.theme}
              onLoadedMetadata={(e) => {
                const real = e.currentTarget.duration;
                setDurations((prev) => {
                  if (!Number.isFinite(real) || Math.abs(prev[i] - real) < 0.5) return prev;
                  const next = [...prev];
                  next[i] = real;
                  return next;
                });
              }}
            />
            <figcaption className="example__caption">
              <span className="example__theme">{example.theme}</span>
              <span className="example__dot" aria-hidden="true">
                ·
              </span>
              <span className="example__meta">{formatDuration(durations[i])}</span>
              <span className="example__dot" aria-hidden="true">
                ·
              </span>
              <span className="example__meta">{example.platform}</span>
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}
