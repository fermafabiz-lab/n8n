/**
 * Hands-off by step — which gates sign themselves off.
 *
 * Hands-off used to be one switch: every gate or none. The producer asked
 * (2026-09-24) to choose — "Script / Scene / Imagini / Audio / Video / Tot" —
 * on the brief, and to be able to switch a step on from the project page
 * when they forgot to on the brief ("Auto accept this step").
 *
 * The vocabulary is the project page's own step keys (`STAGE_KEYS` in
 * lib/deep-link.ts), so the button on a step and the chip on the brief name
 * the same thing. `final` is Final touches: its automatic form is the render
 * press with the settings chosen on the brief — what hands-off has always
 * done at the end, now a choice of its own rather than a hidden sixth step of
 * "All".
 *
 * Stored as `Editing Options.autoApproveSteps`, a list. The old
 * `autoApprove` boolean stays beside it, true whenever the list is not empty,
 * and a film that has only the boolean — every hands-off film made before
 * this — reads as every step, which is exactly what it was promised.
 *
 * The one owner of the list, its order and its reading. It imports nothing,
 * so the check scripts load it as it is; the orchestrator's `Normalize
 * Webhook Input` carries the same whitelist in JavaScript
 * (db/port/hands-off-steps/, whose check asserts the two agree).
 */

/** Pipeline order — the order the chips are drawn and the list is stored in. */
export const AUTO_STEPS = ["script", "scenes", "audio", "images", "video", "final"] as const;
export type AutoStep = (typeof AUTO_STEPS)[number];

export const AUTO_STEP_LABELS: Record<AutoStep, string> = {
  script: "Script",
  scenes: "Scenes",
  audio: "Audio",
  images: "Images",
  video: "Video",
  final: "Final render",
};

export function isAutoStep(v: unknown): v is AutoStep {
  return typeof v === "string" && (AUTO_STEPS as readonly string[]).includes(v);
}

/**
 * A step list as it arrives — an array from Editing Options, or the brief's
 * comma-separated field — as the steps it names: known keys only, each once,
 * in pipeline order. An unknown entry is dropped rather than failing the
 * list: a step renamed one day must not switch the others off with it.
 *
 * `null` when the value is not a list at all, which is different from an
 * empty one: absent means "this film predates the choice, read the old
 * switch", empty means "chosen: nothing".
 */
export function normalizeAutoSteps(v: unknown): AutoStep[] | null {
  const items = Array.isArray(v)
    ? v
    : typeof v === "string"
      ? v.split(",").map((s) => s.trim()).filter(Boolean)
      : null;
  if (!items) return null;
  const want = new Set(items.filter(isAutoStep));
  return AUTO_STEPS.filter((s) => want.has(s));
}

/**
 * What a film's Editing Options mean: the explicit list when there is one,
 * otherwise the old switch — `autoApprove === true` is every step, anything
 * else is none. Strict on the switch for the reason it always was: hands-off
 * is a real trade (nothing gets a human look) and must never turn itself on
 * by absence.
 */
export function autoStepsOf(opts: { autoApproveSteps?: unknown; autoApprove?: unknown } | null | undefined): AutoStep[] {
  const explicit = normalizeAutoSteps(opts?.autoApproveSteps);
  if (explicit) return explicit;
  return opts?.autoApprove === true ? [...AUTO_STEPS] : [];
}

export function isEveryStep(steps: readonly AutoStep[]): boolean {
  return AUTO_STEPS.every((s) => steps.includes(s));
}

/** "Images and Video" / "Script, Images and Video" / "every step". */
export function describeAutoSteps(steps: readonly AutoStep[]): string {
  if (isEveryStep(steps)) return "every step";
  const names = AUTO_STEPS.filter((s) => steps.includes(s)).map((s) => AUTO_STEP_LABELS[s]);
  if (names.length <= 1) return names[0] ?? "no step";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** The list with one step switched on or off, still in pipeline order. */
export function withAutoStep(steps: readonly AutoStep[], step: AutoStep, on: boolean): AutoStep[] {
  const next = new Set(steps);
  if (on) next.add(step);
  else next.delete(step);
  return AUTO_STEPS.filter((s) => next.has(s));
}
