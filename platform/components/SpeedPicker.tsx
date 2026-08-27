"use client";

import { SPEED_BY_PACE } from "@/lib/data/derive";

/**
 * The film's playback speed: the three words the brief already uses, and — for
 * Slow and Fast — a choice of how far to take it.
 *
 * One component because it appears twice (Final touches before the render,
 * under the finished video afterwards), and a control that means "0.9×" in one
 * place and "Slow" in the other would read as two features.
 *
 * TWO LEVELS, because one number could not be both safe and noticeable. 0.9 /
 * 1.1 is a real change but a modest one — roughly a podcast at 1.1× — while
 * 0.8 / 1.25 is unmistakably a different film. Picking one for everybody meant
 * either a control that gets called inert again or one that overshoots, so the
 * word is the decision and the multiplier is the degree.
 *
 * Nothing downstream had to change for the wider range: the refusal rule in
 * speed.mjs, derive.ts and `Build Remotion Props` takes any rate inside
 * [0.5, 2] that is not within 0.01 of 1, so these four all pass as they are.
 * Adding a fifth rate is a change to this file alone — as long as it stays
 * inside that window.
 */
type Group = "slow" | "normal" | "fast";

const RATES: Record<Group, { value: number; label: string; note: string }[]> = {
  slow: [
    { value: 0.9, label: "0.9×", note: "11% longer — the gentler slow" },
    { value: 0.8, label: "0.8×", note: "25% longer — clearly slower" },
  ],
  normal: [{ value: 1, label: "1×", note: "as recorded" }],
  fast: [
    { value: 1.1, label: "1.1×", note: "9% shorter — the gentler fast" },
    { value: 1.25, label: "1.25×", note: "20% shorter — clearly faster" },
  ],
};

const GROUPS: { key: Group; label: string }[] = [
  { key: "slow", label: "Slow" },
  { key: "normal", label: "Normal" },
  { key: "fast", label: "Fast" },
];

/**
 * The rate a group lands on when it is first picked.
 *
 * Read off SPEED_BY_PACE rather than written out again, because that map is
 * also the fallback for a project whose only stored signal is the WORD from
 * the brief ("Slow" -> 0.9). If the two disagreed, clicking Slow and storing
 * nothing else would give a different film from a project that arrived with
 * Pace: Slow and never touched this control.
 */
const DEFAULT_OF: Record<Group, number> = {
  slow: SPEED_BY_PACE.slow,
  normal: SPEED_BY_PACE.normal,
  fast: SPEED_BY_PACE.fast,
};

/** Which group a stored rate belongs to — 1 (and anything unusable, which
 *  normalizeSpeed has already turned into 1) is Normal. */
function groupOf(speed: number): Group {
  if (speed < 1) return "slow";
  if (speed > 1) return "fast";
  return "normal";
}

/** The chip to light up, so a rate saved before these steps existed (or typed
 *  straight into the database) still highlights the nearest one. */
function nearest(group: Group, speed: number) {
  return RATES[group].reduce((best, r) =>
    Math.abs(r.value - speed) < Math.abs(best.value - speed) ? r : best,
  );
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
  const group = groupOf(value);
  const rates = RATES[group];
  const active = nearest(group, value);

  return (
    <div>
      {/* Both rows on one line when there is room. They are two `.seg` blocks,
          which are inline-flex — as bare siblings in JSX they would touch,
          because JSX drops the whitespace-only line between them, so the gap
          has to be declared here rather than inherited from the markup. */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          alignItems: "center",
        }}
      >
      <div className="seg" role="group" aria-label="Playback speed">
        {GROUPS.map((g) => (
          <button
            type="button"
            key={g.key}
            disabled={disabled}
            className={group === g.key ? "on" : ""}
            /* Switching group jumps to that group's default rather than
               keeping a rate from the other side of 1 — there is no sensible
               translation from "1.25× fast" to a slow speed. */
            onClick={() => onChange(DEFAULT_OF[g.key])}
          >
            {g.label}
          </button>
        ))}
      </div>

      {/* Only Slow and Fast have a degree to choose. Normal is one thing, and
          a single-chip row under it would look like a control with a missing
          option. */}
      {rates.length > 1 && (
        <div className="seg speedrates" role="group" aria-label={`How ${group}`}>
          {rates.map((r) => (
            <button
              type="button"
              key={r.value}
              disabled={disabled}
              className={active.value === r.value ? "on" : ""}
              onClick={() => onChange(r.value)}
            >
              {r.label}
            </button>
          ))}
        </div>
      )}
      </div>

      <span
        style={{
          display: "block",
          marginTop: 6,
          fontSize: 11.5,
          color: "var(--dim)",
        }}
      >
        {active.note}
        {/* Said once, here, because it is the part that surprises: the speed is
            applied to the finished film, so the narrator slows down too — at
            the same pitch, not deeper. */}
        {active.value !== 1 && " · picture and narration together, pitch unchanged"}
      </span>
    </div>
  );
}
