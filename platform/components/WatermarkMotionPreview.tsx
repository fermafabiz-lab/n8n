"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/WatermarkPreview";
import {
  bandOpacityAt,
  markOpenAt,
  markSettleSeconds,
  planWatermarkBands,
  scaleWatermark,
  WATERMARK_LAYOUT,
  type VisualProvenance,
} from "@/lib/provenance";

/**
 * How the source watermark behaves on screen, before there is a film.
 *
 * `WatermarkPreview` answers "what will this film's badge look like" and needs
 * the film's scenes to do it. On the BRIEF there are no scenes yet — and the
 * brief is exactly where the size and the "when it opens" choice are made, so
 * it was the one screen where those two controls had no picture at all.
 *
 * So this shows a short SYNTHETIC sequence instead, and the choice of what to
 * put in it is the whole design:
 *
 * - **Three bands, and the first and third are the same kind of source.**
 *   One band cannot show what "once per source" does — the difference only
 *   exists on the SECOND appearance of a kind. A viewer who plays this with
 *   the switch on watches the third band stay a chip, which is the feature.
 * - **A different kind in between**, because `planWatermarkBands` merges
 *   consecutive scenes carrying the same badge; without it the two archive
 *   bands would be one and there would be no repeat to collapse.
 * - **Over a dark gradient**, not the panel's own ground: the badge's scrim is
 *   built for footage, and a white label on a 42%-black pill over a light
 *   panel would read as a bug rather than as what the film draws.
 *
 * It plays once per press. No loop — a settings panel with something moving in
 * it forever competes with the decision being made, which is the reasoning
 * that kept the other preview static, and it still holds. What changed is
 * that a producer asked to see the animation, and "once, on demand" answers
 * that without reintroducing the distraction.
 */

/** One scene per band. Unit durations, exactly as `WatermarkPreview` uses —
 *  `planWatermarkBands` then measures bands in scenes, and one scene is the
 *  shortest band a real film can have. */
const SEQUENCE: { visualOrigin: VisualProvenance["visualOrigin"]; provider?: string }[] = [
  { visualOrigin: "archival_footage", provider: "internet_archive" },
  { visualOrigin: "ai_generated" },
  { visualOrigin: "archival_footage", provider: "loc" },
];

/** How long each band is held before the next one is cut to, in seconds. Long
 *  enough to read the label after it has settled, short enough that the whole
 *  demonstration is over in about three seconds. */
const HOLD = 1.1;

export default function WatermarkMotionPreview({
  scale,
  openOncePerOrigin,
  portrait = false,
}: {
  /** The stored `watermarkScale`, live from the slider. */
  scale: number;
  /** The live state of the "when the badge opens" choice. */
  openOncePerOrigin: boolean;
  portrait?: boolean;
}) {
  const g = scaleWatermark(
    portrait ? WATERMARK_LAYOUT.portrait : WATERMARK_LAYOUT.landscape,
    scale,
  );
  const bands = planWatermarkBands(
    SEQUENCE.map((provenance, i) => ({
      startSeconds: i,
      durationSeconds: 1,
      provenance: provenance as VisualProvenance,
    })),
    { showLabel: true, openOncePerOrigin },
  );

  // Which band is on screen and how far into it we are. `null` = not playing,
  // which rests on the LAST band — the state the film settles into, and the
  // one worth leaving on screen when the animation is over.
  const [at, setAt] = useState<{ band: number; t: number } | null>(null);
  const raf = useRef(0);

  const play = useCallback(() => {
    cancelAnimationFrame(raf.current);
    const start = performance.now();
    const tick = (now: number) => {
      const elapsed = (now - start) / 1000;
      const band = Math.floor(elapsed / HOLD);
      if (band >= bands.length) {
        setAt(null);
        return;
      }
      setAt({ band, t: elapsed - band * HOLD });
      raf.current = requestAnimationFrame(tick);
    };
    setAt({ band: 0, t: 0 });
    raf.current = requestAnimationFrame(tick);
  }, [bands.length]);

  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const shown = at ? bands[at.band] : bands[bands.length - 1];
  const playing = at !== null && shown !== undefined;
  // Each band is held for HOLD, so that is its length as far as the animation
  // is concerned — the same number `markOpenAt` would get from a real band.
  const open = playing ? markOpenAt(at.t, HOLD, shown.expand) : undefined;
  const opacity = playing ? bandOpacityAt(at.t, HOLD) : undefined;

  if (!shown) return null;

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          fontSize: 12,
          color: "var(--dim)",
          marginBottom: 6,
        }}
      >
        <span>On screen</span>
        <button type="button" className="abtn" onClick={play}>
          {at ? "Playing…" : "▶ Play"}
        </button>
      </div>
      <div
        style={{
          padding: "16px 18px",
          borderRadius: 10,
          background: "linear-gradient(140deg, #3a4250 0%, #20262f 60%, #14171c 100%)",
          display: "flex",
          alignItems: "center",
          // Held at the tallest the sequence can be, so pressing play does not
          // make the panel below it jump as bands with and without a source
          // line follow each other.
          minHeight: g.mark.height + g.gap + g.source.fontSize * 2 + 30,
        }}
      >
        <Badge band={shown} g={g} open={open} opacity={opacity} />
      </div>
      <p style={{ margin: "8px 0 0", fontSize: 11.5 }}>
        {openOncePerOrigin
          ? "Three shots: an archive one, an AI one, then archive again — the third keeps just the mark, because that source has already been named."
          : "Three shots: an archive one, an AI one, then archive again — each one opens its own label."}
      </p>
    </div>
  );
}
