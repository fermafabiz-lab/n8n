/**
 * From a scene to a `FootageSearchRequest`, and from a request to the handful
 * of queries the providers actually run.
 *
 * Two rules, both about not inventing things:
 *
 * - **Only what the script supports.** A place, a year or an event lands in
 *   the request when the narration (or the segmenter's own visual note)
 *   names it. Nothing is inferred from the film's title or from a model's
 *   guess about what the scene "probably" shows — every field here becomes a
 *   filter and a scoring signal, and a guessed date would silently promote
 *   the wrong clip to ACTUAL FOOTAGE.
 * - **Three to six queries, not thirty.** Providers are rate-limited and the
 *   archive asks clients to be polite. The queries are built from the most
 *   specific terms first (event, place, people) and pad out with keywords,
 *   and a request that carries authored queries (from the model in n8n, or
 *   the producer's own typing) keeps them at the front.
 */

import type { FootageSearchRequest, PreferredFootageType } from "./types";
import type { ArchiveMediaType } from "@/lib/archive/types";

const STOP = new Set(
  (
    "a an the and or of to in on at by for with from into over under about after before " +
    "as is was were be been being it its this that these those there their they them he she his her " +
    "we our you your i my me not no yes but so than then when where which who whom whose why how " +
    "un o si sau de la in pe cu din pentru catre despre dupa ca este era sunt fi fost acest aceasta " +
    "acesti aceste lor lui ei el ea noi voi nu da dar deci decat atunci unde care cine cui ce cum"
  ).split(/\s+/),
);

const fold = (s: string): string =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

/** Words worth searching: 3+ letters, not a stop word, diacritics folded. */
export function significantWords(text: string, max = 12): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of fold(text).split(/[^\p{L}\p{N}-]+/u)) {
    const w = raw.replace(/^-+|-+$/g, "");
    if (w.length < 3 || STOP.has(w) || /^\d+$/.test(w)) continue;
    if (seen.has(w)) continue;
    seen.add(w);
    out.push(w);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Capitalised runs in the ORIGINAL text — the names of people, places and
 * institutions. Sentence-initial words are kept too (a scene often opens on
 * its subject) and the STOP list removes the ones that were only capitals
 * because they began a sentence.
 */
export function properNouns(text: string, max = 8): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const re = /\b(\p{Lu}[\p{L}\p{N}'’.-]*(?:\s+(?:of|de|la|the|von|van|der|el|al)\s+)?(?:\s+\p{Lu}[\p{L}\p{N}'’.-]*){0,3})/gu;
  for (const m of text.matchAll(re)) {
    const phrase = m[1].replace(/[.,;:]+$/, "").trim();
    const key = fold(phrase);
    if (STOP.has(key) || key.length < 3 || seen.has(key)) continue;
    seen.add(key);
    out.push(phrase);
    if (out.length >= max) break;
  }
  return out;
}

/** Four-digit years the text names, ascending. The script's own dates only. */
export function yearsNamed(text: string): number[] {
  const max = new Date().getUTCFullYear() + 1;
  const ys = new Set<number>();
  for (const m of text.matchAll(/(?<!\d)(1[6-9]\d\d|20\d\d)(?!\d)/g)) {
    const y = Number(m[1]);
    if (y >= 1600 && y <= max) ys.add(y);
  }
  return [...ys].sort((a, b) => a - b);
}

/** A few words that decide whether the scene wants a talking head or pictures. */
const SPEECH_HINTS =
  /\b(said|says|declared|announced|statement|speech|address|press conference|briefing|interview|told reporters|remarks|a declarat|a spus|a anuntat|discurs|conferinta de presa|interviu)\b/i;

export interface SceneContext {
  id: string;
  narration: string;
  /** The segmenter's `visual_scene_description`, when there is one. */
  visual?: string | null;
  /** Authored by a model or a person; kept ahead of the generated ones. */
  queries?: string[];
  /** Explicit structure from the model in n8n, when it produced one. */
  topic?: string | null;
  event?: string | null;
  location?: string | null;
  country?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  people?: string[] | null;
  organizations?: string[] | null;
  keywords?: string[] | null;
  preferredMediaType?: ArchiveMediaType | null;
  preferredFootageType?: PreferredFootageType | null;
  requireExactEvent?: boolean | null;
}

const str = (v: unknown, cap = 200): string | undefined => {
  const s = typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
  return s ? s.slice(0, cap) : undefined;
};
const list = (v: unknown, cap = 12): string[] =>
  Array.isArray(v)
    ? [...new Set(v.map((x) => str(x, 80)).filter((x): x is string => Boolean(x)))].slice(0, cap)
    : [];

/**
 * Build the request. Explicit structure (from the model) wins; the text is
 * only mined for what it does not supply. The narration is always kept whole
 * — the ranker's semantic score reads it, and it is the one thing the script
 * definitely says.
 */
export function buildFootageRequest(scene: SceneContext): FootageSearchRequest {
  const narration = (scene.narration ?? "").replace(/\[[^\]]{0,60}\]\s*/g, " ").replace(/\s+/g, " ").trim();
  const text = [narration, scene.visual ?? ""].filter(Boolean).join(" ");
  const nouns = properNouns(text);
  const years = yearsNamed(text);
  const explicitKeywords = list(scene.keywords);
  const keywords = explicitKeywords.length
    ? explicitKeywords
    : [...new Set([...nouns.map(fold), ...significantWords(text, 10)])].slice(0, 12);

  const wantsSpeech = SPEECH_HINTS.test(narration);
  const preferredFootageType: PreferredFootageType =
    scene.preferredFootageType ?? (wantsSpeech ? "speech" : "broll");

  return {
    sceneId: scene.id,
    narration,
    ...(str(scene.topic) ? { topic: str(scene.topic) } : {}),
    ...(str(scene.event) ? { event: str(scene.event) } : {}),
    ...(str(scene.location) ? { location: str(scene.location) } : {}),
    ...(str(scene.country, 80) ? { country: str(scene.country, 80) } : {}),
    // Dates come from the model's structure or from years the SCRIPT names.
    // A scene that names none gets none — not the film's era, not "now".
    ...(str(scene.dateFrom, 20)
      ? { dateFrom: str(scene.dateFrom, 20) }
      : years.length
        ? { dateFrom: String(years[0]) }
        : {}),
    ...(str(scene.dateTo, 20)
      ? { dateTo: str(scene.dateTo, 20) }
      : years.length
        ? { dateTo: String(years[years.length - 1]) }
        : {}),
    ...(list(scene.people).length ? { people: list(scene.people) } : {}),
    ...(list(scene.organizations).length ? { organizations: list(scene.organizations) } : {}),
    keywords,
    preferredMediaType: scene.preferredMediaType ?? "video",
    preferredFootageType,
    ...(scene.requireExactEvent === true ? { requireExactEvent: true } : {}),
    ...(list(scene.queries, 6).length ? { queries: list(scene.queries, 6) } : {}),
  };
}

/**
 * Three to six focused queries. Most specific first: the event as the model
 * named it, the event with its place, the people with the place, then
 * keyword pairs. Authored queries lead. Never more than six — a provider is
 * asked the top three, and the rest exist for the library search.
 */
export function generateSearchQueries(r: FootageSearchRequest, max = 6): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (parts: Array<string | undefined>) => {
    const q = parts
      .filter((p): p is string => Boolean(p && p.trim()))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    const key = fold(q);
    if (q.length < 3 || seen.has(key) || out.length >= max) return;
    // A query is a handful of catalogue terms, not a sentence.
    if (q.split(" ").length > 8) return;
    seen.add(key);
    out.push(q);
  };

  for (const q of r.queries ?? []) push([q]);
  push([r.event]);
  push([r.event, r.location ?? r.country]);
  const year = r.dateFrom && /^\d{4}/.test(r.dateFrom) ? r.dateFrom.slice(0, 4) : undefined;
  push([r.event, year]);
  for (const p of r.people ?? []) push([p, r.location ?? r.country ?? r.event]);
  for (const o of r.organizations ?? []) push([o, r.event ?? r.topic]);
  push([r.topic, r.location ?? r.country]);
  push([r.location, r.country]);
  // Keyword pairs, most specific (the first, which came from proper nouns) first.
  const kw = r.keywords.filter((k) => k.length >= 3);
  for (let i = 0; i < kw.length && out.length < max; i += 1) {
    push([kw[i], kw[i + 1]]);
  }
  if (!out.length && kw.length) push(kw.slice(0, 3));
  return out.slice(0, max);
}
