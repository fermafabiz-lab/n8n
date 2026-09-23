/**
 * Playlists — the producer's own way of organising the library.
 *
 * A playlist is a NAMED SET OF FILMS, and a film can be in any number of
 * them: the way a YouTube playlist works, which is where these films end up.
 * Stored in `hov.playlist` + `hov.playlist_project` (db/013_playlists.sql);
 * nothing in n8n reads either table.
 *
 * This file is the one owner of the rules that more than one place applies —
 * the name rule (the brief-free inline inputs on the library AND every server
 * action that writes a name), the id rule (anything trusted from a URL) and
 * the order the chips are drawn in. It imports nothing, so a check script can
 * load it as it is.
 */

export interface Playlist {
  id: string;
  name: string;
  /** The films in it, oldest addition first. A film can be in several. */
  projectIds: string[];
}

/**
 * The longest name a playlist can carry. Counted in CHARACTERS (code
 * points), which is what Postgres' `length()` counts in the table's check —
 * a JS `.length` would count an emoji twice and refuse a name the database
 * would take. 60 fits "Google Maps documentaries — season two" with room to
 * spare; past that it is a description, and the chip would only show the
 * first half of it.
 */
export const PLAYLIST_NAME_MAX = 60;

export type NameCheck = { ok: true; name: string } | { ok: false; message: string };

/**
 * What a typed name becomes before it is stored, or why it is refused.
 *
 * Refuse, never clamp — the same rule as every Editing Options field. A name
 * cut at 60 characters is a name the producer did not type, and they would
 * find out only when the chip said something else. So an over-long name comes
 * back with a reason instead of being shortened behind their back.
 *
 * What IS cleaned is what nobody means: whitespace at the ends, runs of it in
 * the middle (a double space makes "Google  Maps" a different playlist from
 * "Google Maps" in every way except the one a person can see), and invisible
 * characters — Postgres refuses a NUL outright, a tab or a newline in a chip
 * is a layout bug, and a name made of zero-width spaces is an empty name that
 * passes for a real one. The zero-width JOINER is kept: it is what holds a
 * family or a flag emoji together. NFC first, so an "ș" typed as s + a
 * combining comma and one typed as a single character are the same name: the
 * table's unique index compares bytes, and the producer writes Romanian.
 *
 * The order matters. Whitespace becomes spaces BEFORE control characters are
 * dropped, or "Google\nMaps" would glue into "GoogleMaps"; and the runs of
 * spaces are collapsed AFTER, or a dropped character between two spaces would
 * leave a double one behind.
 */
export function normalizePlaylistName(input: unknown): NameCheck {
  const name = String(input ?? "")
    .normalize("NFC")
    .replace(/\s/gu, " ")
    .replace(/(?!‍)[\p{Cc}\p{Cf}]/gu, "")
    .replace(/ {2,}/g, " ")
    .trim();
  if (!name) return { ok: false, message: "Give the playlist a name." };
  const chars = [...name].length;
  if (chars > PLAYLIST_NAME_MAX) {
    return {
      ok: false,
      message: `A playlist name can be at most ${PLAYLIST_NAME_MAX} characters — this one is ${chars}.`,
    };
  }
  return { ok: true, name };
}

/**
 * Is this a record id this site minted? Playlists and projects both carry
 * Airtable-shaped ids (`gen_rec_id()`, db/001: `rec` + 14 letters and
 * digits). Anything that arrives from a URL or from the browser is checked
 * against this before it reaches a query — a malformed `?playlist=` must read
 * as "no such playlist", not as a database error.
 */
export function isRecordId(v: unknown): v is string {
  return typeof v === "string" && /^rec[0-9A-Za-z]{14}$/.test(v);
}

/**
 * The films a server action was asked to act on: record ids only, each once,
 * in the order given, and no more than a library could plausibly select at
 * once. Anything else in the list is dropped rather than failing the batch —
 * the grid only ever sends ids it was handed, so a bad entry is a stale page,
 * and the right answer to a stale page is to act on the part that still means
 * something.
 */
export function cleanProjectIds(v: unknown, max = 1000): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of v) {
    if (!isRecordId(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * The order the chips are drawn in: by name, the way a person looks for one,
 * ignoring case and accents — so "Ăla" sits with the A's rather than after Z.
 * Ties (impossible in the database, which refuses them) fall back to the id so
 * the order never depends on how the rows happened to arrive.
 */
export function sortPlaylists<T extends { id: string; name: string }>(list: readonly T[]): T[] {
  return [...list].sort(
    (a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true }) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

/** "1 film" / "3 films" — the one count every playlist message carries. */
export function films(n: number): string {
  return `${n} ${n === 1 ? "film" : "films"}`;
}
