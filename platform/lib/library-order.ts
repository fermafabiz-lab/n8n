/**
 * How the library lists films — the one owner of the choice, its cookie, and
 * the ordering itself.
 *
 * "activity" — Recently worked on, the default since 2026-09-23: the film
 * something last happened to comes first. What counts was the producer's
 * call, asked before it was built: anything a person does on the site, what
 * the pipeline does by itself, hands-off approvals, pause/resume/restart —
 * but NOT the Publishing panel, NOT playlists, and never merely opening a
 * film. The timestamp is Project.activityAt; db/014_project_activity.sql is
 * where those rules are enforced.
 *
 * "created" — Newest first: the library exactly as it was before, in the
 * server's own creation order, untouched by anything here.
 *
 * A COOKIE, per device, like the theme (lib/theme.ts) and for the same two
 * reasons: the server renders the grid, so the order must be known before
 * the first paint or every load would visibly re-sort; and the site has one
 * shared password and no user, so "my" setting can only mean this browser's.
 * The default is the new order — no cookie means Recently worked on.
 */
export type LibraryOrder = "activity" | "created";

export const LIBRARY_ORDER_COOKIE = "hov-library-order";

export const LIBRARY_ORDERS: readonly LibraryOrder[] = ["activity", "created"];

export function parseLibraryOrder(value: unknown): LibraryOrder {
  return value === "created" ? "created" : "activity";
}

/** Client only: remember the choice on this device — a year, whole site,
 *  Lax; Secure only where it can be honoured (see applyTheme). */
export function applyLibraryOrder(order: LibraryOrder): void {
  const secure = location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${LIBRARY_ORDER_COOKIE}=${order}; Path=/; Max-Age=${60 * 60 * 24 * 365}; SameSite=Lax${secure}`;
}

export interface Orderable {
  id: string;
  activityAt: string | null;
  createdAt: string | null;
}

const at = (iso: string | null): number => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : -Infinity;
};

/**
 * The library in the chosen order.
 *
 * `list` arrives in the server's creation order, newest first, and for
 * "created" it is returned as it came — the old library, byte for byte.
 *
 * For "activity" the sort is stable, so two films with the same moment keep
 * their creation order (newer first). A film with no activity falls back to
 * its creation time; one with neither sorts last.
 *
 * `hold` is the order last put on screen, passed while the producer is
 * pointing at the cards or selecting them. With the pipeline counting as
 * activity, a film can rise at any 15-second refresh — and a card that moves
 * between the mouse arriving and the click landing opens (or ticks) the WRONG
 * film. While held, every film keeps the place it had; a film the list did
 * not have yet goes to the END, so nothing already on screen shifts. The real
 * order returns the moment the pointer leaves or Select is closed.
 */
export function orderLibrary<T extends Orderable>(
  list: readonly T[],
  order: LibraryOrder,
  hold?: readonly string[] | null,
): T[] {
  if (order === "created") return [...list];
  const key = (p: T) => {
    const a = at(p.activityAt);
    return a === -Infinity ? at(p.createdAt) : a;
  };
  const fresh = list
    .map((p, i) => ({ p, i, k: key(p) }))
    .sort((a, b) => (b.k === a.k ? a.i - b.i : b.k > a.k ? 1 : -1))
    .map((x) => x.p);
  if (!hold || hold.length === 0) return fresh;
  const place = new Map(hold.map((id, i) => [id, i] as const));
  const kept = fresh.filter((p) => place.has(p.id)).sort((a, b) => place.get(a.id)! - place.get(b.id)!);
  const arrived = fresh.filter((p) => !place.has(p.id));
  return [...kept, ...arrived];
}
