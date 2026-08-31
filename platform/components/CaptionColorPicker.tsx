"use client";

/**
 * What colour the spoken caption word is painted, per film.
 *
 * White is not one option among several — it is the default, and the only one
 * that is right on every kind of footage: the spoken word is marked by
 * BRIGHTNESS rather than hue, which reads on a night dock and on snow alike.
 * So the row starts on "White" and a colour is something the producer opts
 * into, which is why the swatch list leads with it rather than burying it.
 *
 * Every film used to come out amber (`#E8B84B`) because the accent defaulted
 * to `palette.primary` and nothing upstream ever set it — with the keyword
 * rule counting any capitalised word, and Romanian capitalising the first
 * word of every sentence, about half the words on screen were yellow. That
 * default is gone; this control is what replaces it with a decision.
 *
 * The value posted is a hex or the empty string. `resolveCaptionAccent()` in
 * remotion/src/captionColor.ts has the final say and lifts anything too dark
 * toward white until it clears a luminance floor — captions sit under a heavy
 * drop shadow, so a deep accent disappears into its own shadow.
 */

const SWATCHES: Array<{ hex: string; name: string }> = [
  { hex: "", name: "White" },
  { hex: "#7FD1FF", name: "Sky" },
  { hex: "#7FE3B0", name: "Mint" },
  { hex: "#FFC46B", name: "Amber" },
  { hex: "#FF9AA8", name: "Rose" },
  { hex: "#C4A7FF", name: "Violet" },
];

/** The swatch a stored value corresponds to, or null when it is a custom hex. */
function named(value: string): string | null {
  const v = value.trim().toUpperCase();
  const hit = SWATCHES.find((s) => s.hex.toUpperCase() === v);
  return hit ? hit.name : null;
}

export default function CaptionColorPicker({
  value,
  onChange,
}: {
  /** Hex, or "" for the white default. */
  value: string;
  onChange: (v: string) => void;
}) {
  const label = named(value) ?? (value ? value.toUpperCase() : "White");
  return (
    <div style={{ marginTop: 10 }}>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          fontSize: 12,
          color: "var(--dim)",
        }}
      >
        <span>Highlight colour</span>
        <b
          style={{
            color: "var(--ink)",
            fontFamily: "var(--f-mono), ui-monospace, monospace",
          }}
        >
          {label}
        </b>
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", margin: "8px 0 2px", flexWrap: "wrap" }}>
        {SWATCHES.map((s) => {
          const on = (value || "").trim().toUpperCase() === s.hex.toUpperCase();
          return (
            <button
              key={s.name}
              type="button"
              title={s.name}
              aria-label={s.name}
              aria-pressed={on}
              onClick={() => onChange(s.hex)}
              style={{
                width: 26,
                height: 26,
                padding: 0,
                borderRadius: "50%",
                cursor: "pointer",
                // White needs a visible edge or it is a hole in the row.
                background: s.hex || "#FFFFFF",
                border: on
                  ? "2px solid var(--accent)"
                  : "1px solid rgba(24,20,40,0.18)",
                outline: on ? "2px solid var(--accent)" : "none",
                outlineOffset: 2,
              }}
            />
          );
        })}
        {/* Anything the six do not cover. A native colour input, because a
            hand-built wheel would be a worse version of the one the browser
            already has — and it can only produce a hex, which is exactly the
            vocabulary the render accepts. */}
        <label
          title="Custom colour"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontSize: 11.5,
            color: "var(--dim)",
            cursor: "pointer",
          }}
        >
          <input
            type="color"
            value={value || "#FFFFFF"}
            onChange={(e) => onChange(e.target.value.toUpperCase())}
            style={{
              width: 26,
              height: 26,
              padding: 0,
              border: "1px dashed rgba(24,20,40,0.28)",
              borderRadius: "50%",
              background: "transparent",
              cursor: "pointer",
            }}
          />
          custom
        </label>
      </div>
      <p style={{ margin: 0, fontSize: 11.5, color: "var(--dim)" }}>
        {value
          ? "The spoken word is painted in this colour. Too dark a shade is lifted automatically so it stays readable over the footage."
          : "White captions, the spoken word marked by brightness — right on any footage."}
      </p>
    </div>
  );
}
