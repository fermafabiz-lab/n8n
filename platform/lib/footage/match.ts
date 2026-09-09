/**
 * How well an asset matches what a scene asked for — the signals the
 * provenance engine and the ranker both read.
 *
 * One module because the two consumers must agree: an asset the ranker
 * scores as "wrong location" cannot be one the provenance engine calls
 * ACTUAL FOOTAGE. Every signal here is three-valued — matched, mismatched,
 * or UNKNOWN — and unknown is never treated as either of the others. An
 * asset with no date is not "the wrong date"; it is an asset whose date
 * nobody stated, and that difference is the whole reason a mismatch can
 * carry a penalty while an absence cannot.
 */

import type { FootageSearchRequest, NormalizedFootageAsset } from "./types";

export type Tri = "yes" | "no" | "unknown";

const fold = (s: string): string =>
  String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

const tokens = (s: string): string[] => fold(s).split(" ").filter((w) => w.length >= 3);

/** Share of `needle`'s significant words found in `hay`. 0..1, or null when either is empty. */
function overlap(needle: string, hay: string): number | null {
  const n = [...new Set(tokens(needle))];
  if (!n.length) return null;
  const h = new Set(tokens(hay));
  if (!h.size) return null;
  let hit = 0;
  for (const w of n) if (h.has(w)) hit += 1;
  return hit / n.length;
}

/** The text an asset offers to be matched against, once. */
export function assetText(a: NormalizedFootageAsset): string {
  return [
    a.title,
    a.description ?? "",
    a.eventName ?? "",
    a.location ?? "",
    a.country ?? "",
    (a.people ?? []).join(" "),
    (a.organizations ?? []).join(" "),
    (a.categories ?? []).join(" "),
  ].join(" ");
}

/** Years an asset claims for ITSELF: filming date first, then what its text mentions. */
export function assetYears(a: NormalizedFootageAsset): number[] {
  const ys = new Set<number>();
  const take = (s: string | null | undefined) => {
    for (const m of String(s ?? "").matchAll(/(?<!\d)(1[6-9]\d\d|20\d\d)(?!\d)/g)) ys.add(Number(m[1]));
  };
  take(a.filmingDate);
  if (!ys.size) take(a.publicationDate);
  if (!ys.size) for (const y of a.yearsMentioned ?? []) ys.add(y);
  return [...ys].sort((x, y) => x - y);
}

function requestYears(r: FootageSearchRequest): [number, number] | null {
  const y = (s?: string) => {
    const m = /(1[6-9]\d\d|20\d\d)/.exec(s ?? "");
    return m ? Number(m[1]) : null;
  };
  const a = y(r.dateFrom);
  const b = y(r.dateTo) ?? a;
  if (a === null && b === null) return null;
  const lo = a ?? b!;
  const hi = b ?? a!;
  return [Math.min(lo, hi), Math.max(lo, hi)];
}

export interface MatchSignals {
  /** Does the asset's own event name (or title) name the request's event? */
  event: Tri;
  /** Is the asset's stated or mentioned date inside the request's window (±1 year)? */
  date: Tri;
  /** Does the asset name the request's place or country? */
  location: Tri;
  /** Any of the request's people or organisations appear on the asset? */
  peopleOrgs: Tri;
  /** 0..1 — how much of the request's vocabulary the asset's text shares. */
  topic: number;
  /** 0..1 — how much the provider actually told us (date, place, creator, description). */
  metadataQuality: number;
}

export function matchSignals(r: FootageSearchRequest, a: NormalizedFootageAsset): MatchSignals {
  const text = assetText(a);

  // Event: the asset's own event field is the strong signal; the title is the
  // weak one. A title that repeats most of the event's words counts, a title
  // that shares one word does not.
  let event: Tri = "unknown";
  if (r.event) {
    if (a.eventName) {
      const o = overlap(r.event, a.eventName) ?? 0;
      event = o >= 0.6 ? "yes" : o === 0 ? "no" : "unknown";
    } else {
      const o = overlap(r.event, `${a.title} ${a.description ?? ""}`) ?? 0;
      event = o >= 0.75 ? "yes" : "unknown";
    }
  }

  // Date: only against what the ASSET states about itself. `dateOriginal`
  // (the catalogue's upload date) is deliberately not read here.
  let date: Tri = "unknown";
  const window = requestYears(r);
  const years = assetYears(a);
  if (window && years.length) {
    const [lo, hi] = window;
    const inside = years.some((y) => y >= lo - 1 && y <= hi + 1);
    date = inside ? "yes" : "no";
  }

  // Location: the request's place or country, as a whole word, anywhere the
  // asset describes itself. A mismatch only when the asset NAMES a different
  // country — "Spain" asked, "Morocco" stated.
  let location: Tri = "unknown";
  const wantPlace = [r.location, r.country].filter((v): v is string => Boolean(v));
  if (wantPlace.length) {
    const hay = fold(text);
    const hit = wantPlace.some((p) => {
      const f = fold(p);
      return f && new RegExp(`(^|\\s)${f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`).test(hay);
    });
    if (hit) location = "yes";
    else if (a.country && r.country && fold(a.country) !== fold(r.country)) location = "no";
  }

  let peopleOrgs: Tri = "unknown";
  const names = [...(r.people ?? []), ...(r.organizations ?? [])];
  if (names.length) {
    const hay = fold(text);
    peopleOrgs = names.some((n) => {
      const f = fold(n);
      return f.length >= 3 && hay.includes(f);
    })
      ? "yes"
      : "unknown";
  }

  const topic =
    overlap([r.topic ?? "", r.keywords.join(" "), r.narration].join(" "), text) ?? 0;

  let q = 0;
  if (a.filmingDate || a.publicationDate) q += 0.3;
  if (a.location || a.country) q += 0.25;
  if (a.creator || a.credit) q += 0.15;
  if ((a.description ?? "").length >= 40) q += 0.2;
  if (a.eventName || (a.people?.length ?? 0) > 0 || (a.organizations?.length ?? 0) > 0) q += 0.1;

  return { event, date, location, peopleOrgs, topic: Math.min(1, topic), metadataQuality: Math.min(1, q) };
}
