/**
 * A notification, and the place the notification is about.
 *
 * The chime used to be a dead end. It said the right thing — "Images · 10/71
 * · S10 finished" — and then the producer clicked it and nothing happened:
 * the toast was a plain `div` with no handler, and the system notification's
 * `onclick` only focused the tab, landing them wherever they already were.
 * Hearing which scene is ready and still having to hunt for it is the same
 * complaint the words were added to fix, one step further along.
 *
 * This module is the single owner of the link between the two halves: the
 * two `StageChime` callers BUILD a destination here (on the server), and the
 * three review panels READ one here (in the browser). One owner because the
 * param's name is a string in five files otherwise, and a deep link that
 * spells it differently at one end fails silently — it just lands on the
 * page and selects nothing, which is indistinguishable from the bug being
 * back.
 */

/**
 * The steps the project page can be asked to show — the `?stage=` vocabulary,
 * and the stepper's own.
 *
 * It lives here rather than in the page because `GATE_STEP` below has to
 * name these and nothing else: a map entry pointing at a step that does not
 * exist fails the way deep links always fail, by landing on the page and
 * doing nothing. `npm run check:deeplink` asserts the two agree.
 */
export const STAGE_KEYS = [
  "script",
  "scenes",
  "audio",
  "images",
  "video",
  "final",
  "assembly",
] as const;
export type StageKey = (typeof STAGE_KEYS)[number];

/**
 * The project page's gate vocabulary → the `?stage=` key that shows it.
 *
 * Two different vocabularies, and they are not the same words: the page
 * derives a gate name ("image-review") for the chime, while the stepper
 * navigates by step key ("images"). `null` means the bare page, which lands
 * on whatever step is live — the right answer for a project that is merely
 * working, and the only safe one for an error, where the step that failed is
 * not knowable from the status alone.
 */
export const GATE_STEP: Record<string, StageKey | null> = {
  "script-review": "script",
  "scene-review": "scenes",
  "voice-review": "audio",
  "image-review": "images",
  "video-review": "video",
  "final-settings": "final",
  finished: "assembly",
  error: null,
  "needs-review": null,
  working: null,
};

/** `/projects/<id>`, plus the step and the scene when there is one to name. */
export function projectHref(
  projectId: string,
  stage?: string | null,
  scene?: string | null,
): string {
  const p = new URLSearchParams();
  if (stage) p.set("stage", stage);
  if (scene) p.set("scene", scene);
  const q = p.toString();
  return `/projects/${projectId}${q ? `?${q}` : ""}`;
}

/**
 * Add the scene to a destination that already names its step.
 *
 * An empty `href` stays empty rather than becoming `?scene=S3`. That string
 * is the dangerous kind of wrong: it is truthy, so a caller's `|| undefined`
 * fallback does not fire, and it navigates — to the CURRENT path with a
 * scene param on it, which on the library page means reloading the library.
 * An item with no destination has to stay unclickable.
 */
export function withScene(href: string, scene?: string | null): string {
  if (!href || !scene) return href;
  return `${href}${href.includes("?") ? "&" : "?"}scene=${encodeURIComponent(scene)}`;
}

/**
 * Read the `?scene=` a link arrived with — once, and then remove it.
 *
 * It is an INSTRUCTION, not state, and the difference is load-bearing here:
 * the project page re-renders itself every 10s, and a param that stayed in
 * the URL would drag the producer back to scene 10 every time that fired,
 * however many other scenes they had clicked meanwhile.
 *
 * `history.replaceState` rather than `router.replace`, because the page is
 * `force-dynamic`: a router navigation would re-read Postgres and ask n8n
 * what is running, all to change nothing on screen.
 */
export function takeSceneParam(): string | null {
  try {
    const url = new URL(window.location.href);
    const want = url.searchParams.get("scene");
    if (!want) return null;
    url.searchParams.delete("scene");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    return want;
  } catch {
    // No window (the server pass), or a browser refusing history writes.
    return null;
  }
}

/**
 * Does this scene answer to the name the link used?
 *
 * Links are built from `label` ("S10") because that is the word the
 * notification itself said, and a producer who copies the URL to a colleague
 * should be sending something readable. Ids still match, so a link built from
 * one keeps working.
 */
export function matchesScene(s: { id: string; label: string }, want: string): boolean {
  return s.id === want || s.label.toLowerCase() === want.toLowerCase();
}
