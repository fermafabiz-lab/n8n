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

import { useMemo, useState } from "react";
import {
  DASHED_ORIGINS,
  GLYPH_STROKE,
  GLYPH_VIEWBOX,
  ORIGIN_GLYPHS,
} from "@/lib/provenance-glyphs";
import {
  planWatermarkBands,
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
function Badge({ band, g }: { band: WatermarkBand; g: WatermarkGeometry }) {
  return (
    <div
      style={{
        maxWidth: g.maxWidth,
        opacity: WATERMARK_STYLE.peakOpacity,
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
           Static here on purpose: the preview answers "what will be on
           screen", and a looping animation in a settings panel competes with
           the decision being made. */
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            boxSizing: "border-box",
            height: g.mark.height,
            paddingLeft: band.expand ? g.mark.padX : (g.mark.height - g.mark.glyph) / 2,
            paddingRight: band.expand ? g.mark.padX * 1.15 : 0,
            width: band.expand ? undefined : g.mark.height,
            borderRadius: band.expand
              ? g.mark.height / 2
              : g.mark.height * WATERMARK_STYLE.chipRadiusRatio,
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
          {band.expand ? (
            <span
              style={{
                marginLeft: g.mark.gap,
                fontFamily: KICKER_STACK,
                fontSize: g.label.fontSize,
                fontWeight: WATERMARK_STYLE.labelWeight,
                letterSpacing: WATERMARK_STYLE.labelLetterSpacing,
                lineHeight: WATERMARK_STYLE.labelLineHeight,
                textShadow: WATERMARK_STYLE.textShadow,
              }}
            >
              {band.label}
            </span>
          ) : null}
        </span>
      ) : null}
      {band.source && band.expand ? (
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

export default function WatermarkPreview({
  scenes,
  aspectRatio,
  showLabel,
  openOncePerOrigin = false,
}: {
  scenes: readonly PreviewScene[];
  /** The project's Format. Anything but "9:16" is drawn landscape. */
  aspectRatio: string | null | undefined;
  /** The live state of the Source watermark toggle. */
  showLabel: boolean;
  /** Mirror of the Editing Options switch, so the preview collapses the
   *  repeats exactly as the film will. */
  openOncePerOrigin?: boolean;
}) {
  const [at, setAt] = useState(0);
  const portrait = String(aspectRatio ?? "").trim() === "9:16";
  const g = portrait ? WATERMARK_LAYOUT.portrait : WATERMARK_LAYOUT.landscape;

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
  const scale = Math.min(MAX_W / g.frame.width, MAX_H / g.frame.height);
  const boxW = Math.round(g.frame.width * scale);
  const boxH = Math.round(g.frame.height * scale);

  return (
    <div className={styles.wrap}>
      <div className={styles.viewport} style={{ width: boxW, height: boxH }}>
        {/* The real frame, at real size. Scaled as one piece — see the note at
            the top of this file on why nothing here is multiplied by hand. */}
        <div
          className={styles.frame}
          style={{ width: g.frame.width, height: g.frame.height, transform: `scale(${scale})` }}
        >
          {still ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={still} alt="" className={styles.still} />
          ) : (
            <div className={styles.noStill}>
              <span>no picture generated yet</span>
            </div>
          )}
          <div style={{ position: "absolute", left: g.left, bottom: g.bottom }}>
            <Badge band={band} g={g} />
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
        <span className={styles.count}>
          {bands.length === 1 ? "One label" : `Label ${index + 1} of ${bands.length}`}
          {" · "}
          {covered.length === 1
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
          <Badge band={band} g={g} />
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
