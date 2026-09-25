import { editingOptions } from './editingOptions.ts';
import type { Fields } from './types.ts';

// D2 (docs/plans/engine-final-assembly.md): the film's playback speed, which
// `Build Remotion Props` stopped sending in August — so PACE and "re-render
// with speed" have been inert since. It is NOT part of the props: /render
// strips `speed` off the body before the composition sees it, and re-times the
// drawn film (remotion/server/speed.mjs). The engine adds it to the /render
// request beside `resolution`.
//
// Mirrors normalizeSpeed() in remotion/server/speed.mjs and in
// platform/lib/data/derive.ts; engine/check.mjs asserts all three agree.

/** The three PACE words, as speeds. */
export const SPEED_BY_PACE: Record<string, number> = { slow: 0.9, normal: 1, fast: 1.1 };
const SPEED_MIN = 0.5;
const SPEED_MAX = 2;

/** Exactly 1 for anything absent, unparseable or out of range: an unrecognised speed must leave the film untouched. */
export function normalizeSpeed(value: unknown): number {
  if (typeof value === 'string') {
    const byName = SPEED_BY_PACE[value.trim().toLowerCase()];
    if (byName !== undefined) return byName;
  }
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 1;
  if (n < SPEED_MIN || n > SPEED_MAX) return 1;
  if (Math.abs(n - 1) < 0.01) return 1;
  return n;
}

/**
 * Editing Options.speed is the override, the project's Pace the default —
 * the order the site resolves it in (platform/lib/data/derive.ts, `speed:`),
 * so the control never shows a rate the render is not using.
 */
export function playbackSpeed(projectFields: Fields | undefined): number {
  const opts = editingOptions(projectFields);
  return opts.speed === undefined || opts.speed === null
    ? normalizeSpeed((projectFields || {})['Pace'])
    : normalizeSpeed(opts.speed);
}
