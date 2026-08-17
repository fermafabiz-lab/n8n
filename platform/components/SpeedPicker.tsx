"use client";

import { SPEED_BY_PACE } from "@/lib/data/derive";

/**
 * The film's playback speed, as the three words the creation form already
 * uses. One component because it appears twice — in Final touches before the
 * render, and under the finished video afterwards — and a control that means
 * "0.9×" in one place and "Slow" in the other would read as two features.
 *
 * Deliberately three fixed steps rather than a slider: the render server
 * refuses anything outside [0.5, 2] and rounds a near-1 value back to 1, so a
 * free number would let the producer set a rate the film would not be given.
 * The labels carry the multiplier because "Slow" alone does not tell you the
 * film gets 11% longer.
 */
const STEPS: { label: string; value: number; note: string }[] = [
  { label: "Slow", value: SPEED_BY_PACE.slow, note: "0.9× — 11% longer" },
  { label: "Normal", value: SPEED_BY_PACE.normal, note: "as recorded" },
  { label: "Fast", value: SPEED_BY_PACE.fast, note: "1.1× — 9% shorter" },
];

/** Which step a stored rate belongs to, so an older value still highlights. */
function closest(speed: number): number {
  return STEPS.reduce((best, s) =>
    Math.abs(s.value - speed) < Math.abs(best.value - speed) ? s : best,
  ).value;
}

export default function SpeedPicker({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  const active = closest(value);
  const note = STEPS.find((s) => s.value === active)?.note;
  return (
    <div>
      <div className="seg" role="group" aria-label="Playback speed">
        {STEPS.map((s) => (
          <button
            type="button"
            key={s.label}
            disabled={disabled}
            className={active === s.value ? "on" : ""}
            onClick={() => onChange(s.value)}
          >
            {s.label}
          </button>
        ))}
      </div>
      <span
        style={{
          display: "block",
          marginTop: 6,
          fontSize: 11.5,
          color: "var(--dim)",
        }}
      >
        {note}
        {/* Said once, here, because it is the part that surprises: the speed is
            applied to the finished film, so the narrator slows down too — at
            the same pitch, not deeper. */}
        {active !== 1 && " · picture and narration together, pitch unchanged"}
      </span>
    </div>
  );
}
