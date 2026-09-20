/**
 * The library's filter tabs — the vocabulary of `?filter=` on /projects.
 *
 * It lives here, out of the component, because a LINK can name one of these
 * and a link is checkable only against a list something else can read. That
 * is not hypothetical: the hero's "Everything waiting on me" pointed at
 * `/projects?filter=wait` for weeks while `ProjectsGrid` kept the tab in
 * `useState("all")` and read no param at all, so the button changed the
 * address bar and nothing else. `npm run check:deeplink` now asserts both
 * halves — that every `?filter=` link in the app names a key here, and that
 * the grid still reads the param.
 *
 * The keys that are not "all" or "topost" are `StatusKind` values; the
 * compile-time assertion in ProjectsGrid keeps that true if a kind is ever
 * added.
 */
export const LIBRARY_FILTERS = [
  { key: "all", label: "All" },
  { key: "wait", label: "Needs you" },
  { key: "run", label: "Rendering" },
  { key: "done", label: "Finished" },
  // Finished films marked "Ready to post" in the Publishing panel — the tab
  // that answers "what is left to upload". Appears only when non-empty, like
  // every other tab.
  { key: "topost", label: "To post" },
  { key: "err", label: "Failed" },
  // Anything whose status the map does not recognise. Without this tab those
  // projects were counted in "All" and reachable from no tab at all, so the
  // numbers across the top could not be made to add up — and a project you
  // cannot open is a project you cannot delete either. The label stays vague
  // because the bucket is: every card in it shows its own status text.
  { key: "idle", label: "Other" },
] as const;

export type FilterKey = (typeof LIBRARY_FILTERS)[number]["key"];

/** Is this string one of the tabs? Used wherever a URL is trusted. */
export function isFilterKey(v: string | null | undefined): v is FilterKey {
  return !!v && LIBRARY_FILTERS.some((f) => f.key === v);
}
