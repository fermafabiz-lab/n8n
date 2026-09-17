/**
 * Which windows are lit on the house, and in what colour.
 *
 * The façade on /login is a readout before you have typed anything: each lit
 * window is a project, blue working, amber waiting on you, red failed. It is
 * the one screen outside the password gate, so it shows COUNTS and nothing
 * else — no titles, no ids, no totals. How many films are in production is
 * roughly what the front of a building tells you anyway; which films they are
 * is not.
 *
 * Kept apart from the drawing because it is drawn twice — once in WebGL, once
 * as a plain CSS grid for anyone without it — and two renderers agreeing on
 * the lighting matters more than either of them individually.
 */

export type WindowState = "run" | "wait" | "err" | "dark";

/** Windows on the elevation. Four floors of six. */
export const WINDOWS = 24;

/**
 * A fixed stride for scattering the lit windows.
 *
 * Filling in index order lights the building like a progress bar, which reads
 * as a chart rather than as a house. Stepping by a number coprime with the
 * grid visits every window exactly once in a scattered order, and being fixed
 * rather than random it survives server and client rendering the same — a
 * random scatter here would be a hydration mismatch.
 */
const STRIDE = 7;

/**
 * @param counts  what the database says, or null when it could not be reached
 * @param total   windows on the elevation
 *
 * Failures are placed first and running projects last, so that when there are
 * more projects than windows it is never the failure that goes unlit.
 */
export function windowStates(
  counts: { run: number; wait: number; err: number } | null,
  total: number = WINDOWS,
): WindowState[] {
  const lights: WindowState[] = new Array(total).fill("dark");

  // A dark house is the honest answer when the count is unknown: better than
  // an invented one, and the form below it still works.
  if (!counts) return lights;

  const order: WindowState[] = [
    ...new Array(Math.max(0, Math.floor(counts.err))).fill("err"),
    ...new Array(Math.max(0, Math.floor(counts.wait))).fill("wait"),
    ...new Array(Math.max(0, Math.floor(counts.run))).fill("run"),
  ];

  for (let i = 0; i < Math.min(order.length, total); i++) {
    lights[(i * STRIDE) % total] = order[i];
  }
  return lights;
}
