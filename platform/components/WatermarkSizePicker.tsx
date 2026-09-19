"use client";

import { Badge } from "@/components/WatermarkPreview";
import {
  WATERMARK_LAYOUT,
  WATERMARK_SCALE,
  normalizeWatermarkScale,
  scaleWatermark,
  type WatermarkBand,
} from "@/lib/provenance";

/**
 * How big the provenance badge is drawn.
 *
 * A slider rather than three named sizes, because there is no natural set of
 * steps here: "small" and "large" would be two numbers somebody picked, and
 * the honest answer to "how big should it be" depends on the film, the
 * footage under it and where it will be watched. The ends are the real
 * constraint — under 0.7 the glyph's thin strokes drop out at 1080p, over 1.6
 * the longest capsule reads as a banner — and between them every value is as
 * defensible as its neighbour.
 *
 * It is shown WITH A SAMPLE, at the render's real pixel size, for the same
 * reason `WatermarkPreview` shows the badge at 1:1 underneath its frame: a
 * percentage is not a size. 110% means nothing until you can see that it is
 * the difference between a mark you notice and one you do not, and the
 * producer is choosing the second thing, never the first.
 *
 * One component because it appears twice — on the brief and at Final touches
 * — beside `WatermarkOpenPicker`, which is the other half of the same row.
 */

/** The sample band. ARCHIVAL FOOTAGE is a middle-length label of the eight,
 *  so the capsule it draws is neither the shortest nor the widest — a sample
 *  on "REAL FOOTAGE" would understate how much width the longest one takes. */
const SAMPLE: WatermarkBand = {
  startSeconds: 0,
  endSeconds: 1,
  origin: "archival_footage",
  label: "ARCHIVAL FOOTAGE",
  source: null,
  credit: null,
  expand: true,
};

export default function WatermarkSizePicker({
  value,
  onChange,
  portrait = false,
  disabled,
}: {
  /** The stored `watermarkScale`. */
  value: number;
  onChange: (v: number) => void;
  /** 9:16 films have their own base geometry, so the sample follows it. */
  portrait?: boolean;
  disabled?: boolean;
}) {
  const scale = normalizeWatermarkScale(value);
  const base = portrait ? WATERMARK_LAYOUT.portrait : WATERMARK_LAYOUT.landscape;
  const g = scaleWatermark(base, scale);
  const pct = Math.round(scale * 100);
  const fill =
    ((scale - WATERMARK_SCALE.min) / (WATERMARK_SCALE.max - WATERMARK_SCALE.min)) * 100;

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          fontSize: 12,
          color: "var(--dim)",
        }}
      >
        <label htmlFor="wm_scale">Badge size</label>
        <b
          style={{
            color: "var(--ink)",
            fontFamily: "var(--f-mono), ui-monospace, monospace",
          }}
        >
          {pct}%
        </b>
      </div>
      <input
        id="wm_scale"
        type="range"
        className="lenslider"
        min={WATERMARK_SCALE.min}
        max={WATERMARK_SCALE.max}
        step={WATERMARK_SCALE.step}
        value={scale}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ margin: "8px 0 2px", ["--fill" as string]: `${fill}%` }}
        aria-label="Badge size"
      />
      {/* The sample, on a dark strip because the badge is drawn over footage
          and its scrim is built for that — on the panel's own light ground a
          white label on a 42%-black pill would look like a bug rather than
          like what the film draws. */}
      <div
        style={{
          marginTop: 8,
          padding: "14px 16px",
          borderRadius: 10,
          background: "linear-gradient(140deg, #3a4250 0%, #20262f 60%, #14171c 100%)",
          display: "flex",
          alignItems: "center",
          minHeight: g.mark.height + 28,
        }}
      >
        <Badge band={SAMPLE} g={g} />
      </div>
      <p style={{ margin: "8px 0 0", fontSize: 11.5 }}>
        {g.mark.height}px tall on the {base.frame.width}×{base.frame.height} frame the film is
        rendered at
        {scale === WATERMARK_SCALE.default ? " — the standard size" : ""}
      </p>
    </div>
  );
}
