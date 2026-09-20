"use client";

/**
 * What the source watermark will actually look like on this film.
 *
 * The watermark is the one overlay whose entire job is telling the truth about
 * the picture, and until now the producer decided whether to keep it from a
 * toggle and one sentence of prose — the first sight of it was the finished
 * render, an hour of Remotion later. This is that sight, before the render.
 *
 * It shows the badge TWICE, and that is the design rather than an accident:
 *
 * - **In the frame**, drawn at the render's real pixel sizes inside a
 *   real-sized 1280×720 box which is then scaled down as one piece. Every
 *   proportion — the 90px inset, the padding, the gap — is preserved by
 *   construction instead of by a dozen multiplications that would each be a
 *   chance to be subtly wrong. This answers WHERE it sits and how much of the
 *   picture it takes.
 * - **At actual size**, unscaled, underneath. Because the honest answer to the
 *   first question is that the badge is small — 16px in a 1280px frame — and a
 *   faithful thumbnail of it is four pixels tall and unreadable. Scaling the
 *   badge up inside the frame to make it legible would be a preview that lies
 *   about the one thing it is for. So the frame stays true and the text is
 *   shown separately, at 1:1, where it can be read.
 *
 * It shows this film's OWN bands, through `planWatermarkBands`, the same
 * merging the render does: a documentary that runs six archive shots together
 * shows one steady label, not six, so the preview steps through three bands
 * where the film has three and says which scenes each covers.
 *
 * It honours the toggle live, which is the cheapest way to show the thing the
 * prose has to work hardest to explain: switching the label off does NOT
 * remove a credit a licence demands. Toggle it off with a CC BY-SA shot on
 * screen and the label goes while the credit stays.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  DASHED_ORIGINS,
  GLYPH_STROKE,
  GLYPH_VIEWBOX,
  ORIGIN_GLYPHS,
} from "@/lib/provenance-glyphs";
import {
  labelInkDrop,
  labelTrailingSpace,
  markChipPadX,
  bandOpacityAt,
  markOpenAt,
  markPillWidth,
  markRevealAt,
  markSettleSeconds,
  planWatermarkBands,
  scaleWatermark,
  WATERMARK_LAYOUT,
  WATERMARK_STYLE,
  type WatermarkBand,
  type WatermarkGeometry,
  type VisualProvenance,
} from "@/lib/provenance";
import styles from "./WatermarkPreview.module.css";

/** Only what a band needs. Structural, so a caller need not hand over a Scene. */
export interface PreviewScene {
  order: number;
  label: string;
  imageUrl: string | null;
  provenance: VisualProvenance;
}

/**
 * Three shots to demonstrate the badge on, for a screen that has no film yet.
 *
 * The choice is the whole design: the first and third are the SAME kind of
 * source, because one band cannot show what "announce each source once" does —
 * the difference only exists on a kind's second appearance. The AI shot in
 * between is not decoration either: `planWatermarkBands` merges consecutive
 * scenes carrying the same badge, so without it the two archive shots would be
 * one band and there would be no repeat left to collapse.
 *
 * No `imageUrl` on any of them, which is what makes the frame draw blank —
 * the brief is specifying a film that does not exist, and inventing a picture
 * for it would be the kind of small lie that makes the rest untrustworthy.
 */
export const SAMPLE_SCENES: PreviewScene[] = [
  {
    order: 1,
    label: "1",
    imageUrl: null,
    provenance: { visualOrigin: "archival_footage", provider: "internet_archive" },
  },
  { order: 2, label: "2", imageUrl: null, provenance: { visualOrigin: "ai_generated" } },
  {
    order: 3,
    label: "3",
    imageUrl: null,
    provenance: { visualOrigin: "archival_footage", provider: "loc" },
  },
];

/** The box the scaled frame has to fit inside. Portrait is bound by height. */
const MAX_W = 440;
const MAX_H = 300;

/**
 * IBM Plex Mono is the render's `kickerFont` for every preset. Named here
 * rather than loaded: the producer's browser almost certainly lacks it, and a
 * monospace fallback keeps the letter-spacing and the block shape honest,
 * which is what this preview is about. Claiming the exact typeface would be
 * the kind of small lie that makes the rest of it untrustworthy.
 */
const KICKER_STACK = '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

/**
 * The badge itself, at frame pixel sizes.
 *
 * One component for both places it appears, so the scaled frame and the
 * actual-size strip cannot drift from each other — which would defeat the
 * point of showing both.
 */
/**
 * Where to nudge this label so its INK sits on the pill's midline, rather than
 * the line box that holds it — the same correction the film makes, run
 * against the font this browser actually resolved. `labelInkDrop` owns the
 * arithmetic and every reason to refuse; this is the canvas plumbing and the
 * span's laid-out width, which only the drawing can supply.
 *
 * 0 until measured, which is one paint, and 0 again if anything is off — the
 * badge simply centres the old way, a pixel and a half high.
 */
function useLabelMetrics(
  label: string,
  fontSize: number,
  ref: React.RefObject<HTMLSpanElement | null>,
) {
  const [m, setM] = useState({ drop: 0, advance: 0 });
  useEffect(() => {
    let live = true;
    const read = () => {
      const el = ref.current;
      if (!live || !el) return;
      const advance = el.offsetWidth;
      let drop = 0;
      try {
        const ctx = document.createElement("canvas").getContext("2d");
        if (ctx) {
          ctx.font = `${WATERMARK_STYLE.labelWeight} ${fontSize}px ${KICKER_STACK}`;
          drop = labelInkDrop(ctx.measureText(label), label, fontSize, advance);
        }
      } catch {
        /* leave it centred the old way */
      }
      setM({ drop, advance });
    };
    read();
    // A web font still loading lays the label out in the fallback face, which
    // is a different width and a different ink box.
    document.fonts?.ready?.then(read).catch(() => undefined);
    return () => {
      live = false;
    };
  }, [label, fontSize, ref]);
  return m;
}

export function Badge({
  band,
  g,
  open,
  opacity,
}: {
  band: WatermarkBand;
  g: WatermarkGeometry;
  /**
   * How open the mark is, 0 (chip) to 1 (pill). Omitted means STILL — the
   * band's resting state, which is what a preview that is not playing shows
   * and what every caller wanted before this could animate.
   */
  open?: number;
  /** The band's own fade. Omitted means fully up, at the badge's peak. */
  opacity?: number;
}) {
  const labelRef = useRef<HTMLSpanElement>(null);
  const { drop, advance } = useLabelMetrics(band.label ?? "", g.label.fontSize, labelRef);
  // The resting state is the band's own: an expanding band sits open, a
  // collapsed one sits as a chip. That is what "announce each source once"
  // looks like from the second band on, animated or not.
  const o = open ?? (band.expand ? 1 : 0);
  const reveal = markRevealAt(o);
  const lerp = (from: number, to: number) => from + (to - from) * o;

  return (
    <div
      style={{
        maxWidth: g.maxWidth,
        opacity: opacity ?? WATERMARK_STYLE.peakOpacity,
        display: "flex",
        flexDirection: "column",
        gap: g.gap,
        alignItems: "flex-start",
      }}
    >
      {band.label ? (
        /* The mark as the film draws it: the glyph in a chip, opened into a
           capsule — or left as a chip when the band does not expand, which is
           what "announce each source once" looks like from the second band on.

           It used to be static on purpose, on the reasoning that a looping
           animation in a settings panel competes with the decision being
           made. That reasoning survives; the conclusion did not, because the
           producer asked to SEE the animation and a preview that cannot show
           the one moving part of the overlay is answering a smaller question
           than it looks like it is. It therefore plays ONCE — on open, and on
           each band change — and then rests. No loop. */
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            boxSizing: "border-box",
            height: g.mark.height,
            // Equal on both sides — the right used to carry a 1.15 fudge that
            // was really compensating for the trailing letter-space cancelled
            // on the label below. See `markPillWidth`.
            paddingLeft: lerp(markChipPadX(g.mark), g.mark.padX),
            // An explicit width at every moment, exactly as the render does
            // it: the capsule GROWS from the chip and clips the label as it
            // goes, which is what reads as one mark opening rather than as a
            // second element arriving. Until the label has been measured the
            // width is the chip's, and no frame is ever seen at that state.
            width: lerp(g.mark.height, markPillWidth(g.mark, g.label.fontSize, advance)),
            borderRadius: lerp(
              g.mark.height * WATERMARK_STYLE.chipRadiusRatio,
              g.mark.height / 2,
            ),
            background: WATERMARK_STYLE.labelBackground,
            border: `${WATERMARK_STYLE.markBorderWidth}px ${
              DASHED_ORIGINS.has(band.origin) ? "dashed" : "solid"
            } ${WATERMARK_STYLE.markBorderColor}`,
            color: WATERMARK_STYLE.labelColor,
            overflow: "hidden",
            whiteSpace: "nowrap",
          }}
        >
          <svg
            width={g.mark.glyph}
            height={g.mark.glyph}
            viewBox={`0 0 ${GLYPH_VIEWBOX} ${GLYPH_VIEWBOX}`}
            fill="none"
            stroke="currentColor"
            strokeWidth={GLYPH_STROKE}
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ flex: "none", display: "block" }}
          >
            {ORIGIN_GLYPHS[band.origin].map((d, i) =>
              d.filled ? (
                <path key={i} d={d.d} fill="currentColor" stroke="none" />
              ) : (
                <path key={i} d={d.d} />
              ),
            )}
          </svg>
          {band.label ? (
            <span
              ref={labelRef}
              style={{
                marginLeft: g.mark.gap,
                // Pull the trailing letter-space back out of the layout, so
                // the content really does end at the last letter and the
                // capsule's own padding is the only thing after it.
                marginRight: -labelTrailingSpace(g.label.fontSize),
                // Measured, not guessed — see `useInkDrop`.
                position: "relative",
                top: drop,
                fontFamily: KICKER_STACK,
                fontSize: g.label.fontSize,
                fontWeight: WATERMARK_STYLE.labelWeight,
                letterSpacing: WATERMARK_STYLE.labelLetterSpacing,
                lineHeight: WATERMARK_STYLE.labelLineHeight,
                textShadow: WATERMARK_STYLE.textShadow,
                opacity: reveal,
              }}
            >
              {band.label}
            </span>
          ) : null}
        </span>
      ) : null}
      {band.source && o > 0.99 ? (
        <span
          style={{
            fontFamily: KICKER_STACK,
            fontSize: g.source.fontSize,
            letterSpacing: WATERMARK_STYLE.sourceLetterSpacing,
            color: WATERMARK_STYLE.sourceColor,
            background: WATERMARK_STYLE.lineBackground,
            borderRadius: WATERMARK_STYLE.lineRadius,
            padding: WATERMARK_STYLE.linePadding,
            textShadow: WATERMARK_STYLE.textShadow,
            lineHeight: WATERMARK_STYLE.lineLineHeight,
          }}
        >
          {band.source}
        </span>
      ) : null}
      {band.credit ? (
        <span
          style={{
            fontFamily: KICKER_STACK,
            fontSize: g.credit.fontSize,
            letterSpacing: WATERMARK_STYLE.creditLetterSpacing,
            color: WATERMARK_STYLE.creditColor,
            background: WATERMARK_STYLE.lineBackground,
            borderRadius: WATERMARK_STYLE.lineRadius,
            padding: WATERMARK_STYLE.linePadding,
            textShadow: WATERMARK_STYLE.textShadow,
            lineHeight: WATERMARK_STYLE.lineLineHeight,
          }}
        >
          {band.credit}
        </span>
      ) : null}
    </div>
  );
}

/**
 * Plays the badge's opening ONCE and then stops, on the film's own clock.
 *
 * `null` means settled — the Badge then draws its resting state, which is
 * exactly what it drew before this existed. Restarting is a nonce rather than
 * a boolean so that pressing "play again" on an already-settled preview is
 * still an event.
 *
 * requestAnimationFrame rather than a CSS transition, and the timing comes
 * from `markOpenAt` / `bandOpacityAt` rather than from a duration written
 * here, because those are the render's own functions: a preview animating on
 * its own curve would be showing a different overlay, which is the one thing
 * this whole file exists not to do.
 */
function usePlayOnce(key: string, bandLength: number) {
  const [t, setT] = useState<number | null>(null);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    const settle = markSettleSeconds(bandLength);
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const s = (now - start) / 1000;
      if (s >= settle) {
        setT(null);
        return;
      }
      setT(s);
      raf = requestAnimationFrame(tick);
    };
    setT(0);
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [key, nonce, bandLength]);
  return { t, replay: () => setNonce((n) => n + 1) };
}

export default function WatermarkPreview({
  scenes,
  aspectRatio,
  showLabel,
  openOncePerOrigin = false,
  scale,
  sample = false,
}: {
  scenes: readonly PreviewScene[];
  /** The project's Format. Anything but "9:16" is drawn landscape. */
  aspectRatio: string | null | undefined;
  /** The live state of the Source watermark toggle. */
  showLabel: boolean;
  /** Mirror of the Editing Options switch, so the preview collapses the
   *  repeats exactly as the film will. */
  openOncePerOrigin?: boolean;
  /** And of the size slider. A preview at a size the film will not use is
   *  worse than no preview: the whole claim of this panel is that the frame
   *  is true, and how much of it the badge takes is the first thing anyone
   *  looks at. */
  scale?: number;
  /**
   * These scenes are a DEMONSTRATION, not a film — the brief showing what the
   * badge will do before anything has been written. Only the wording changes:
   * "no picture generated yet" would be wrong on a project that does not
   * exist, and counting scenes that were never made would be worse.
   */
  sample?: boolean;
}) {
  const [at, setAt] = useState(0);
  const portrait = String(aspectRatio ?? "").trim() === "9:16";
  const g = scaleWatermark(
    portrait ? WATERMARK_LAYOUT.portrait : WATERMARK_LAYOUT.landscape,
    scale,
  );

  // Unit durations: a preview cares about the ORDER of the bands and which
  // scenes merged, never about seconds. Band boundaries then read directly as
  // indices into `scenes`.
  const bands = useMemo(
    () =>
      planWatermarkBands(
        scenes.map((s, i) => ({ startSeconds: i, durationSeconds: 1, provenance: s.provenance })),
        { showLabel, openOncePerOrigin },
      ),
    [scenes, showLabel, openOncePerOrigin],
  );

  // The toggle changes how many bands there are, so a held index can point
  // past the end — clamp on read rather than reaching for an effect.
  const index = bands.length ? Math.min(at, bands.length - 1) : 0;
  const band = bands[index];

  // BEFORE the guards below: a hook cannot sit after an early return, and both
  // returns here are reachable (a film with no scenes, a film whose label is
  // off and owes no credit). The band length is the count of scenes it covers,
  // which is what `planWatermarkBands` produces on unit durations — and on any
  // real band that is >= 1, so the opening runs at its full length exactly as
  // it does in the film.
  const bandLength = band ? band.endSeconds - band.startSeconds : 1;
  const { t, replay } = usePlayOnce(`${index}:${showLabel}:${openOncePerOrigin}`, bandLength);
  const playing = t !== null && band !== undefined;
  const open = playing ? markOpenAt(t as number, bandLength, band.expand) : undefined;
  const opacity = playing ? bandOpacityAt(t as number, bandLength) : undefined;

  if (!scenes.length) {
    return <p className={styles.quiet}>No scenes yet — there is nothing to label.</p>;
  }

  if (!band) {
    return (
      <p className={styles.quiet}>
        With the label off, nothing at all is drawn on this film: no shot in it carries a licence
        that demands a credit.
      </p>
    );
  }

  // The scenes this band covers, and a frame to show it over. The still is the
  // first covered scene's picture when one exists — a film mid-production may
  // have none, and a neutral frame is honest about that.
  const from = Math.round(band.startSeconds);
  const to = Math.round(band.endSeconds) - 1;
  const covered = scenes.slice(from, to + 1);
  const still = covered.find((s) => s.imageUrl)?.imageUrl ?? null;
  const fit = Math.min(MAX_W / g.frame.width, MAX_H / g.frame.height);
  const boxW = Math.round(g.frame.width * fit);
  const boxH = Math.round(g.frame.height * fit);

  return (
    <div className={styles.wrap}>
      <div className={styles.viewport} style={{ width: boxW, height: boxH }}>
        {/* The real frame, at real size. Scaled as one piece — see the note at
            the top of this file on why nothing here is multiplied by hand. */}
        <div
          className={styles.frame}
          style={{ width: g.frame.width, height: g.frame.height, transform: `scale(${fit})` }}
        >
          {still ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={still} alt="" className={styles.still} />
          ) : (
            <div className={styles.noStill}>
              <span>{sample ? "your footage goes here" : "no picture generated yet"}</span>
            </div>
          )}
          <div style={{ position: "absolute", left: g.left, bottom: g.bottom }}>
            <Badge band={band} g={g} open={open} opacity={opacity} />
          </div>
        </div>
      </div>

      <div className={styles.bar}>
        <button
          type="button"
          className="abtn"
          disabled={index === 0}
          onClick={() => setAt(Math.max(0, index - 1))}
          aria-label="Previous label"
        >
          ‹
        </button>
        <button
          type="button"
          className="abtn"
          onClick={replay}
          aria-label="Play the animation again"
          title="Play the animation again"
        >
          ↻
        </button>
        <span className={styles.count}>
          {bands.length === 1 ? "One label" : `Label ${index + 1} of ${bands.length}`}
          {" · "}
          {sample
            ? covered.length === 1
              ? `example shot ${covered[0]?.label ?? from + 1}`
              : `example shots ${covered[0]?.label ?? from + 1}–${covered[covered.length - 1]?.label ?? to + 1}`
            : covered.length === 1
              ? `scene ${covered[0]?.label ?? from + 1}`
              : `scenes ${covered[0]?.label ?? from + 1}–${covered[covered.length - 1]?.label ?? to + 1}`}
        </span>
        <button
          type="button"
          className="abtn"
          disabled={index >= bands.length - 1}
          onClick={() => setAt(Math.min(bands.length - 1, index + 1))}
          aria-label="Next label"
        >
          ›
        </button>
      </div>

      {/* Actual size. The frame above is honest about how small the badge is,
          which makes it too small to read — so the text itself is shown at 1:1
          rather than enlarged in place, where enlarging would misrepresent it. */}
      <div className={styles.actual}>
        <span className={styles.actualCap}>Actual size on a {g.frame.width}×{g.frame.height} frame</span>
        <div className={styles.actualBox}>
          <Badge band={band} g={g} open={open} opacity={opacity} />
        </div>
      </div>

      {/* The one thing about this overlay that surprises people. Shown only
          when this film actually has an obligation to point at. */}
      {!showLabel && band.credit ? (
        <p className={styles.note}>
          The label is off and this credit is still drawn — a licence requires it.
        </p>
      ) : null}
    </div>
  );
}
