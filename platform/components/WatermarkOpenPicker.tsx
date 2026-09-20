"use client";

/**
 * How often the source badge opens into its full label.
 *
 * The badge is a small chip holding the origin's glyph that opens sideways
 * into a capsule carrying the words — AI GENERATED, ARCHIVAL FOOTAGE. This
 * control decides whether it does that on every run of shots, or only the
 * first time a given KIND of source appears, after which that kind keeps just
 * the chip. A documentary that runs twenty archive shots can say ARCHIVAL
 * FOOTAGE once and then keep a quiet mark in the corner.
 *
 * One component because it appears twice — on the brief, where the film is
 * being specified, and at Final touches, where it can still be changed until
 * the render. A control that meant one thing in one place and something
 * slightly different in the other would read as two features, and the two
 * sentences under it are the part most likely to drift.
 *
 * Two named choices rather than an on/off switch, because neither of them is
 * an absence. "Off" would have to mean "announce every time", which is a
 * positive behaviour and the busier of the two — a switch would leave the
 * producer working out which way round it goes every time they meet it.
 *
 * `false` is the default and must stay so: a film that quietly stops naming
 * its sources is the failure this whole overlay exists to prevent, so absence
 * everywhere down the chain — the brief, `Normalize Webhook Input`,
 * `derive.ts`, the render props — resolves to "every time".
 */
export const WATERMARK_OPEN_CHOICES: {
  /** `watermarkOpenOnce` — the stored key is the ONCE side. */
  once: boolean;
  label: string;
  note: string;
}[] = [
  {
    once: false,
    label: "Every time",
    note: "Every run of shots opens the full label, however often the same kind of source comes back",
  },
  {
    once: true,
    label: "Once per source",
    note: "The first archival shot says ARCHIVAL FOOTAGE in full; after that the same kind keeps just its small mark",
  },
];

export default function WatermarkOpenPicker({
  value,
  onChange,
  disabled,
}: {
  /** The stored `watermarkOpenOnce`. */
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  const active = WATERMARK_OPEN_CHOICES.find((c) => c.once === value) ?? WATERMARK_OPEN_CHOICES[0];

  return (
    <div>
      <div
        style={{
          fontSize: 12,
          color: "var(--dim)",
          marginBottom: 6,
        }}
      >
        When the badge opens
      </div>
      <div className="seg" role="group" aria-label="When the source badge opens">
        {WATERMARK_OPEN_CHOICES.map((c) => (
          <button
            type="button"
            key={String(c.once)}
            disabled={disabled}
            className={c.once === value ? "on" : ""}
            onClick={() => onChange(c.once)}
          >
            {c.label}
          </button>
        ))}
      </div>
      {/* The sentence for the choice that is SELECTED, not both: this sits
          inside a switch row that is already explaining itself, and two more
          lines of prose would bury the row above it. */}
      <p style={{ margin: "8px 0 0", fontSize: 11.5 }}>{active.note}</p>
    </div>
  );
}
