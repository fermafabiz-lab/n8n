/**
 * Transitions — how the picture hands over at the few cuts that get one
 * (remotion/src/transitions/). One family per film, chosen by THEME and for
 * every category (the producer, 2026-09-24/25: "they suit a theme, not
 * story, documentary, kids or cinematic").
 *
 * The producer picks one on the brief or in Final touches, or leaves it on
 * "AI picks": the graphic-plan workflow then chooses by theme once the scene
 * texts are approved and stores it as `graphicPlan.transition`. "None" is a
 * real choice (hard cuts only) and is stored as such.
 *
 * The same six ids live in remotion/src/transitions/families.ts, n8n's
 * Normalize Webhook Input and Final Assembly's Caption Colour, and
 * engine/src/assembly/graphicStyles.ts. `npm run check:normalize` pins this side.
 */

export type TransitionStyleId = "none" | "push" | "crossfade" | "blur" | "shutter" | "glitch";

export const TRANSITION_STYLES: { id: TransitionStyleId; label: string; hint: string }[] = [
  { id: "push", label: "Push", hint: "The next picture slides the last one out — sideways, then upward" },
  { id: "crossfade", label: "Crossfade", hint: "One picture dissolves into the next" },
  { id: "blur", label: "Blur", hint: "The picture blurs through to the next, or smears sideways into it" },
  { id: "shutter", label: "Shutter", hint: "Two black halves snap shut and open on the next picture" },
  { id: "glitch", label: "Glitch", hint: "A short digital jolt, or a ripple, between pictures" },
  { id: "none", label: "None", hint: "Plain cuts only, as before" },
];

/** A known id, or null. Refuses rather than guesses — a typo must not add movement to a film. */
export function normalizeTransitionStyle(value: unknown): TransitionStyleId | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  return TRANSITION_STYLES.some((s) => s.id === v) ? (v as TransitionStyleId) : null;
}

export const transitionStyleLabel = (id: TransitionStyleId | null | undefined): string =>
  TRANSITION_STYLES.find((s) => s.id === id)?.label ?? "";
