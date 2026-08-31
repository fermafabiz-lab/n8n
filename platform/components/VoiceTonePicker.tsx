"use client";

import { useState } from "react";
import type { VoiceTone } from "@/lib/data/derive";

/**
 * How the narrator reads — ElevenLabs' generation settings, as a choice a
 * producer can actually make.
 *
 * One component because it appears twice: on the brief, where the film's
 * character is decided before a word has been spoken, and at the audio step,
 * where it can be judged against real takes. A control that meant "Expressive"
 * on one screen and four raw numbers on the other would read as two features.
 *
 * PRESETS FIRST, sliders behind a disclosure. Four unlabelled 0–1 sliders are
 * an invitation to blind tuning, and this is the one control in the pipeline
 * that cannot be auditioned for free — hearing a change costs a synthesis, so
 * the starting points have to be worth something on their own.
 *
 * What is STORED is always the four values, never the preset's name. n8n and
 * the render server both have to send these numbers to ElevenLabs, and a name
 * would mean this table existed in three languages in three places — exactly
 * the four-copies problem the speed rule already carries.
 */

/** Named starting points. `null` is its own choice — see LEAVE_ALONE.
 *
 * The row reads as a spectrum, flattest to biggest, so each preset sits where
 * it sounds. Under the words there are really two knobs — stability and style
 * — and the original four presets all sat on one diagonal (stability falling
 * as style rises). The three later additions fill the empty corners of that
 * square instead of crowding the diagonal, where a new preset would be
 * inaudible next to its neighbours and the control would be lying:
 * Calm is "more constant than Steady" (0.9/0), Broadcast is "constant AND
 * coloured" (0.65/0.25 — off the diagonal on the high side), Conversational
 * is "varied but never exaggerated" (0.25/0 — Expressive minus the style).
 * Similarity stays ~0.75 everywhere on purpose: lowering it makes the voice
 * resemble itself less, which is a degradation, not a character. */
const PRESETS: { key: string; label: string; note: string; tone: VoiceTone | null }[] = [
  {
    key: "default",
    label: "Voice default",
    note: "whatever this voice was tuned to — nothing is overridden",
    tone: null,
  },
  {
    key: "calm",
    label: "Calm",
    note: "nearly flat, hypnotic — made for sleep stories and meditation",
    tone: { stability: 0.9, similarity: 0.75, style: 0, speakerBoost: true },
  },
  {
    key: "steady",
    label: "Steady",
    note: "even and unhurried; the safest read for long narration",
    tone: { stability: 0.75, similarity: 0.75, style: 0, speakerBoost: true },
  },
  {
    key: "broadcast",
    label: "Broadcast",
    note: "disciplined, with weight on the words that matter — the classic documentary read",
    tone: { stability: 0.65, similarity: 0.75, style: 0.25, speakerBoost: true },
  },
  {
    key: "natural",
    label: "Natural",
    note: "ElevenLabs' own middle — some variation line to line",
    tone: { stability: 0.5, similarity: 0.75, style: 0, speakerBoost: true },
  },
  {
    key: "conversational",
    label: "Conversational",
    note: "loose and spontaneous, told rather than read — varies line to line",
    tone: { stability: 0.25, similarity: 0.75, style: 0, speakerBoost: true },
  },
  {
    key: "expressive",
    label: "Expressive",
    note: "more colour and movement; occasional surprises",
    tone: { stability: 0.3, similarity: 0.75, style: 0.35, speakerBoost: true },
  },
  {
    key: "theatrical",
    label: "Theatrical",
    note: "big and dramatic — it can wander, so listen to every line",
    tone: { stability: 0.15, similarity: 0.8, style: 0.7, speakerBoost: true },
  },
];

/**
 * Sending nothing is a real option and the DEFAULT one.
 *
 * Every voice carries its own settings at ElevenLabs, so an object we invent
 * replaces that voice's own tuning on every line. "Voice default" is the only
 * choice here that leaves it alone, and it is what every film made before this
 * control existed is already doing.
 */
const LEAVE_ALONE = PRESETS[0];

const same = (a: VoiceTone, b: VoiceTone) =>
  Math.abs(a.stability - b.stability) < 0.001 &&
  Math.abs(a.similarity - b.similarity) < 0.001 &&
  Math.abs(a.style - b.style) < 0.001 &&
  a.speakerBoost === b.speakerBoost;

/** Which preset a stored tone matches, or "custom" once a slider has moved. */
function presetOf(tone: VoiceTone | null): string {
  if (!tone) return LEAVE_ALONE.key;
  const hit = PRESETS.find((p) => p.tone && same(p.tone, tone));
  return hit ? hit.key : "custom";
}

/** What Advanced opens on when the producer has chosen nothing yet: the
 *  voice's own published defaults, so the first drag is a small change from
 *  where the film already is rather than a jump. */
const NEUTRAL: VoiceTone = {
  stability: 0.5,
  similarity: 0.75,
  style: 0,
  speakerBoost: true,
};

const SLIDERS: {
  key: "stability" | "similarity" | "style";
  label: string;
  low: string;
  high: string;
}[] = [
  { key: "stability", label: "Stability", low: "varied", high: "consistent" },
  { key: "similarity", label: "Similarity", low: "looser", high: "closer to the voice" },
  { key: "style", label: "Style", low: "plain", high: "exaggerated" },
];

export default function VoiceTonePicker({
  value,
  onChange,
  disabled,
  /** Shown under the control. The brief and the audio step owe the producer
   *  different warnings, and the difference is not cosmetic — see each call
   *  site. */
  footnote,
}: {
  value: VoiceTone | null;
  onChange: (v: VoiceTone | null) => void;
  disabled?: boolean;
  footnote?: string;
}) {
  const active = presetOf(value);
  // Opens by itself on a custom tone, or the sliders that produced it would be
  // hidden behind a chip reading "Custom" with nothing to explain it.
  const [open, setOpen] = useState(active === "custom");
  const shown = value ?? NEUTRAL;
  const note = PRESETS.find((p) => p.key === active)?.note;

  const set = (patch: Partial<VoiceTone>) => onChange({ ...shown, ...patch });

  return (
    <div className="vtone">
      <div className="seg" role="group" aria-label="Voice character">
        {PRESETS.map((p) => (
          <button
            type="button"
            key={p.key}
            disabled={disabled}
            className={active === p.key ? "on" : ""}
            onClick={() => onChange(p.tone)}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="vtnote">
        {active === "custom" ? "Your own settings." : note}{" "}
        <button
          type="button"
          className="linkish"
          disabled={disabled}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? "Hide the detail" : "Adjust in detail"}
        </button>
      </div>

      {open && (
        <div className="vtadv">
          {SLIDERS.map((s) => (
            <label key={s.key} className="vtrow">
              <span className="vtlabel">{s.label}</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={shown[s.key]}
                disabled={disabled}
                onChange={(e) => set({ [s.key]: Number(e.target.value) } as Partial<VoiceTone>)}
              />
              <span className="vtval">{Math.round(shown[s.key] * 100)}</span>
              <span className="vtends">
                {s.low} → {s.high}
              </span>
            </label>
          ))}
          <label className="vtrow vtcheck">
            <input
              type="checkbox"
              checked={shown.speakerBoost}
              disabled={disabled}
              onChange={(e) => set({ speakerBoost: e.target.checked })}
            />
            <span>Speaker boost — holds the resemblance to the voice</span>
          </label>
          {value !== null && (
            <button
              type="button"
              className="linkish"
              disabled={disabled}
              onClick={() => onChange(null)}
            >
              Back to the voice&apos;s own settings
            </button>
          )}
        </div>
      )}

      {footnote && <p className="vtfoot">{footnote}</p>}
    </div>
  );
}
