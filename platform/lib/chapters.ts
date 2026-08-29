/**
 * Which chapter a scene belongs to — the single owner of that rule.
 *
 * Scene order encodes it: 101/102 are chapter 1, 201 chapter 2, and anything
 * under 100 is the hook. That is the pipeline's own convention, not a display
 * choice — `AB Pick Voice` and `VR Pick Voice` in n8n derive the chapter with
 * the same arithmetic to decide which cast voice reads a scene.
 *
 * It lives here because it had been written out by hand three times (the
 * voice panel, the narration-bundle route, the scene board) and a fourth copy
 * was about to be added. A copy that disagrees is worse than no grouping at
 * all: the button labelled "Chapter 2" would show one set of scenes while the
 * download named "chapter 2" produced a different one, and nothing on screen
 * would explain the mismatch.
 */
export const chapterOf = (order: number): number =>
  Number.isFinite(order) ? Math.floor(order / 100) : 0;

/** `"hook"` for the opening scene, else the chapter number as a string. */
export const chapterKeyOf = (order: number): string => {
  const ch = chapterOf(order);
  return ch === 0 ? "hook" : String(ch);
};

/** How a chapter names itself in the interface. */
export const chapterLabel = (key: string): string =>
  key === "hook" ? "Hook" : `Ch. ${key}`;

/**
 * The long form, for a heading that stands on its own line.
 *
 * Same rule, two registers: `chapterLabel` is read inside a row of tabs where
 * everything around it is already saying "chapter", so "Ch. 2" is enough; a
 * heading with nothing beside it has to name itself in full.
 */
export const chapterTitle = (key: string): string =>
  key === "hook" ? "Hook" : `Chapter ${key}`;

/**
 * Every chapter present in a set of scene orders — the hook first when one
 * exists, then the numbered chapters in order.
 */
export function chapterKeys(orders: number[]): string[] {
  const numbered = [...new Set(orders.map(chapterOf).filter((c) => c > 0))].sort(
    (a, b) => a - b,
  );
  const keys = numbered.map(String);
  return orders.some((o) => chapterOf(o) === 0) ? ["hook", ...keys] : keys;
}

/**
 * Whether splitting this project by chapter tells the producer anything.
 *
 * Not every film's orders are chapter-encoded: a short one written as a
 * single chapter numbers its scenes 1, 2, 3 — all of which fall in the hook —
 * and `ceil(Lenght / 120)` means anything under two minutes is one chapter by
 * construction. One group is not a grouping, and a row holding a single
 * "Hook" button is pure noise, so callers fall back to their own layout.
 */
export const groupsByChapter = (orders: number[]): boolean =>
  chapterKeys(orders).length > 1;
