"use client";

/**
 * The project's switch: a drawn track with a mono ON/OFF readout, amber when
 * on. Replaces native checkboxes on settings surfaces — the browser control
 * was the one element no amount of surrounding design could dress.
 *
 * Purely visual: callers that need a value submitted render their own hidden
 * input, so the form contract stays explicit at the call site.
 */
export default function Toggle({
  checked,
  onChange,
  disabled = false,
  ariaLabel,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      className={`sw ${checked ? "on" : ""}`}
      onClick={() => onChange(!checked)}
    >
      <span className="swlab">{checked ? "ON" : "OFF"}</span>
      <span className="swtrack">
        <span className="swknob" />
      </span>
    </button>
  );
}
