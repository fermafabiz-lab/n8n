/**
 * The site's sections — one owner, read by both things that draw them.
 *
 * There were two lists before, and they disagreed: `NavMenu` (the phone) had
 * four sections, the bar in `app/layout.tsx` had three hard-coded links, and
 * the one it was missing was Series. So a show was reachable on a phone and
 * unreachable on a laptop except from a film that already belonged to one —
 * which is how a whole section becomes "very hard to find" without anything
 * being broken. Same rule as `lib/deep-link.ts` and `lib/library-filters.ts`:
 * a destination gets ONE owner, and the pages read it rather than restate it.
 *
 * `note` is the second line the phone menu shows under each label. The bar has
 * no room for it and prints the label alone.
 */
export type Section = { href: string; label: string; note: string };

export const SECTIONS: Section[] = [
  { href: "/projects", label: "Projects", note: "the floor" },
  { href: "/series", label: "Series", note: "the shows" },
  { href: "/admin/footage", label: "Footage", note: "archive library" },
  { href: "/admin", label: "Settings", note: "account, appearance" },
];

/**
 * Which section the current path belongs to. Settings owns everything under
 * /admin EXCEPT the footage library, which has its own link — a plain prefix
 * test would light both for /admin/footage and neither for /admin/customize.
 *
 * The landing page (`/`) belongs to no section on purpose: it is the visitor's
 * page, it draws its own bar, and nothing should read as current there.
 */
export function isOn(href: string, path: string): boolean {
  if (href === "/admin") {
    return path === "/admin" || (path.startsWith("/admin/") && !path.startsWith("/admin/footage"));
  }
  return path === href || path.startsWith(href + "/");
}
