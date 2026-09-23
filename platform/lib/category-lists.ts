/**
 * Category playlists — one per kind of film, kept by the site itself.
 *
 * The producer's ask (2026-09-23): as soon as a category has at least one
 * film, a button that shows every film of that category — Story,
 * Documentary, Cinematic, Kids story. They sit in the playlist row next to
 * the producer's own playlists and open the same way (`?playlist=`), but
 * nobody makes, fills, renames or deletes them: they are a VIEW of the
 * library, derived on every render from what each film was filed as, so a
 * new film is in its category the moment it exists and there is nothing to
 * keep in step. No table, no action, no n8n.
 *
 * Which category a film is in is `getCategory`'s answer, not a second rule
 * written here: a film that carries none (everything made before categories
 * existed) or one this site no longer knows is filed under the FIRST
 * category — Story, the reference pipeline those films were made by — which
 * is what `getCategory` and the brief's default already say. The categories
 * are passed in rather than imported so a check script can load this file as
 * it is.
 *
 * Note what a category is: the kind of film the producer ASKED for, not a
 * description of it (CLAUDE.md, "`category` is a REQUEST"). The Burj Al Arab
 * documentary was filed as Story and appears under Story here — which is the
 * truth about how it was made, and one click in its brief away from changing.
 */

/** The ids these lists live under in `?playlist=` — never a record id, so
 *  they can never collide with a playlist the producer made. */
export const CATEGORY_LIST_PREFIX = "category:";

export interface CategoryList {
  /** `category:<id>` — what the playlist row and the address carry. */
  id: string;
  categoryId: string;
  /** The category's own label, as the brief shows it. */
  name: string;
  icon: string;
  /** Every film filed under it, in the order the library was given. */
  projectIds: string[];
}

type CategoryLike = { id: string; label: string; icon: string };
type FilmLike = { id: string; category: string | null };

export function categoryListId(categoryId: string): string {
  return `${CATEGORY_LIST_PREFIX}${categoryId}`;
}

export function isCategoryListId(id: unknown): id is string {
  return typeof id === "string" && id.startsWith(CATEGORY_LIST_PREFIX);
}

/** The category a film is filed under — getCategory's rule, over a list. */
function filedUnder(film: FilmLike, categories: readonly CategoryLike[]): CategoryLike | undefined {
  return categories.find((c) => c.id === film.category) ?? categories[0];
}

function listFor(cat: CategoryLike, films: readonly FilmLike[], categories: readonly CategoryLike[]): CategoryList {
  return {
    id: categoryListId(cat.id),
    categoryId: cat.id,
    name: cat.label,
    icon: cat.icon,
    projectIds: films.filter((f) => filedUnder(f, categories)?.id === cat.id).map((f) => f.id),
  };
}

/**
 * One list per category that has at least one film, in the categories' own
 * order (the order the brief offers them in). A category with no films has
 * no chip: a button that opens onto nothing is a button the producer has to
 * learn to ignore.
 */
export function categoryLists(films: readonly FilmLike[], categories: readonly CategoryLike[]): CategoryList[] {
  return categories.map((c) => listFor(c, films, categories)).filter((l) => l.projectIds.length > 0);
}

/**
 * The list an address names — EVEN WHEN it is empty, so a link to Cinematic
 * after the last Cinematic film was deleted says "no Cinematic films" rather
 * than "that playlist no longer exists". Null only for a category this site
 * does not know.
 */
export function resolveCategoryList(
  id: string,
  films: readonly FilmLike[],
  categories: readonly CategoryLike[],
): CategoryList | null {
  if (!isCategoryListId(id)) return null;
  const cat = categories.find((c) => c.id === id.slice(CATEGORY_LIST_PREFIX.length));
  return cat ? listFor(cat, films, categories) : null;
}
