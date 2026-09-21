/**
 * A series is a show — the same characters, places, look and voice, film
 * after film. This file is the pure half: how a Story Bible and a project's
 * Editing Options become a series, and how a series goes back OUT to Claude
 * Scripting on the next episode's brief.
 *
 * Nothing here talks to the database or to n8n. `lib/data` reads and writes
 * the rows; `app/actions.ts` decides when.
 */
import { normalizeVoiceTone, type VoiceTone } from "@/lib/data/derive";

export interface SeriesCharacter {
  name: string;
  role: string;
  description: string;
}

export interface SeriesPlace {
  name: string;
  description: string;
}

/** The Story Bible's shape, kept verbatim from the film the series came from. */
export interface SeriesBible {
  logline: string;
  characters: SeriesCharacter[];
  objects: SeriesPlace[];
  locations: SeriesPlace[];
  /** palette, lighting, camera, film_look — free strings from the bible. */
  visualStyle: Record<string, string>;
  continuityRules: string[];
}

export interface SheetRef {
  id: string;
  url: string;
  kind: string;
}

/**
 * The Editing Options keys the consistency chain writes (db/port/consistency),
 * copied as they are. `castRefs` is what the image assembler attaches;
 * `castSheets` carries the tier and a signed URL that is long dead by the
 * time a series reads it — the durable picture is in `sheet_media`.
 */
export interface SeriesRefs {
  castRefs: Record<string, string>;
  castSheets: Record<string, SheetRef>;
  objectRefs: Record<string, string>;
  locationRefs: Record<string, string>;
  locationPlates: Record<string, { id: string; url: string }>;
}

/** The brief's settings an episode inherits — the same keys as Editing Options. */
export interface SeriesSettings {
  categoryOptions: Record<string, string>;
  multiVoiceMode: string;
  cast: string[];
  voice: VoiceTone | null;
  hookStyle: string | null;
  videoModel: string | null;
  speed: number | null;
  // The rest of the brief. A show is a FORMAT — the same length, the same
  // look, the same overlays every week — so an episode that made the
  // producer re-pick all of it was not a series, it was a new film with a
  // borrowed cast. Every one of these is nullable and every reader falls
  // back to the form's own default: a series created before 2026-09-21 has
  // none of them stored, and must keep opening exactly as it did.
  /** Seconds. `project.length_seconds`, not an Editing Option. */
  lengthSeconds: number | null;
  /** `project.style` — the look line. */
  style: string | null;
  /** The overlay switches, by the FORM's field names, so the form can read them directly. */
  finishes: Record<string, boolean>;
  sfxLevel: number | null;
  musicLevel: number | null;
  /** `#RRGGBB`, or null for the white default. */
  captionColor: string | null;
  /** Hands-off mode. Stored, because a show the producer lets run is a property of the show. */
  autoApprove: boolean | null;
}

/**
 * The overlay switches a series remembers, as the pairs
 * `form field name` → `Editing Options key`. The form's names are the
 * contract with n8n (`createProject` posts exactly these), so they are what
 * gets stored — a series row can then be read straight into the form's own
 * `finishes` state with no translation at the other end.
 *
 * `captions` is the odd one: it lives on the project as `no_captions`, not
 * in Editing Options, so `createSeriesFromProject` passes it in by hand.
 */
export const SERIES_FINISHES: Record<string, string> = {
  captions: "captions",
  chapter_cards: "chapterCards",
  end_screen: "endScreen",
  sfx: "sfx",
  drawn_cards: "drawnCards",
  music: "music",
  source_watermark: "sourceWatermark",
};

export interface Series {
  id: string;
  name: string;
  premise: string;
  previously: string;
  channelName: string;
  category: string;
  tone: string | null;
  language: string;
  aspect: "16:9" | "9:16";
  voiceId: string;
  settings: SeriesSettings;
  bible: SeriesBible;
  refs: SeriesRefs;
  sourceProjectId: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  /** Filled by the list query; a detail read leaves it undefined. */
  episodeCount?: number;
}

export const SERIES_REF_KEYS = [
  "castRefs",
  "castSheets",
  "objectRefs",
  "locationRefs",
  "locationPlates",
] as const;

const str = (v: unknown, max = 2000): string =>
  typeof v === "string" ? v.trim().slice(0, max) : "";

const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

/** A map of name → string, junk dropped. */
const strMap = (v: unknown): Record<string, string> => {
  const out: Record<string, string> = {};
  if (!isObj(v)) return out;
  for (const [k, val] of Object.entries(v)) {
    const key = str(k, 200);
    const s = str(val, 400);
    if (key && s) out[key] = s;
  }
  return out;
};

/**
 * Read a Story Bible — the jsonb column, a JSON string, or an object —
 * into the shape the series keeps. Refuse-then-clamp like every other
 * reader of stored JSON: a character without a name is not a character,
 * a rule that is not a string is not a rule. Never throws.
 */
export function normalizeSeriesBible(raw: unknown): SeriesBible {
  let b: unknown = raw;
  if (typeof raw === "string") {
    try {
      b = JSON.parse(raw);
    } catch {
      b = null;
    }
  }
  const o = isObj(b) ? b : {};
  const people = (v: unknown): SeriesCharacter[] =>
    (Array.isArray(v) ? v : [])
      .map((c) => ({
        name: str(isObj(c) ? c.name : "", 120),
        role: str(isObj(c) ? c.role : "", 200),
        description: str(isObj(c) ? c.visual_description ?? c.description : "", 2000),
      }))
      .filter((c) => c.name);
  const places = (v: unknown): SeriesPlace[] =>
    (Array.isArray(v) ? v : [])
      .map((p) => ({
        name: str(isObj(p) ? p.name : "", 120),
        description: str(isObj(p) ? p.visual_description ?? p.description : "", 2000),
      }))
      .filter((p) => p.name);
  return {
    logline: str(o.logline, 600),
    characters: people(o.characters),
    objects: places(o.objects),
    locations: places(o.locations),
    visualStyle: strMap(o.visual_style ?? o.visualStyle),
    continuityRules: (Array.isArray(o.continuity_rules ?? o.continuityRules)
      ? (o.continuity_rules ?? o.continuityRules) as unknown[]
      : [])
      .map((r) => str(r, 400))
      .filter(Boolean)
      .slice(0, 20),
  };
}

/** The consistency references out of a project's Editing Options — or a series' refs column. */
export function normalizeSeriesRefs(raw: unknown): SeriesRefs {
  const o = isObj(raw) ? raw : {};
  const sheets: Record<string, SheetRef> = {};
  if (isObj(o.castSheets)) {
    for (const [name, v] of Object.entries(o.castSheets)) {
      if (!isObj(v) || !str(v.id, 200)) continue;
      sheets[str(name, 200)] = { id: str(v.id, 200), url: str(v.url, 2000), kind: str(v.kind, 40) || "portrait" };
    }
  }
  const plates: Record<string, { id: string; url: string }> = {};
  if (isObj(o.locationPlates)) {
    for (const [name, v] of Object.entries(o.locationPlates)) {
      if (!isObj(v) || !str(v.id, 200)) continue;
      plates[str(name, 200)] = { id: str(v.id, 200), url: str(v.url, 2000) };
    }
  }
  return {
    castRefs: strMap(o.castRefs),
    castSheets: sheets,
    objectRefs: strMap(o.objectRefs),
    locationRefs: strMap(o.locationRefs),
    locationPlates: plates,
  };
}

/** True when a project has anything the consistency chain could reuse. */
export function hasAnyRefs(refs: SeriesRefs): boolean {
  return (
    Object.keys(refs.castRefs).length > 0 ||
    Object.keys(refs.objectRefs).length > 0 ||
    Object.keys(refs.locationRefs).length > 0
  );
}

/** The brief's inheritable settings out of a project's Editing Options — or a series' settings column. */
export function normalizeSeriesSettings(raw: unknown): SeriesSettings {
  const o = isObj(raw) ? raw : {};
  const speed = Number(o.speed);
  return {
    categoryOptions: strMap(o.categoryOptions),
    multiVoiceMode: ["off", "characters", "chapters"].includes(String(o.multiVoiceMode))
      ? String(o.multiVoiceMode)
      : "off",
    cast: (Array.isArray(o.cast) ? o.cast : []).map((v) => str(v, 120)).filter(Boolean).slice(0, 8),
    voice: normalizeVoiceTone(o.voice),
    hookStyle: str(o.hookStyle, 40) || null,
    videoModel: str(o.videoModel, 60) || null,
    speed: Number.isFinite(speed) && speed >= 0.5 && speed <= 2 ? speed : null,
    lengthSeconds: lvl(o.lengthSeconds, 10, 900),
    style: str(o.style, 400) || null,
    // Only the seven known switches, and only real booleans: a key the form
    // does not render would be dead weight in the row, and a truthy string
    // would silently turn an overlay on.
    finishes: Object.fromEntries(
      Object.keys(SERIES_FINISHES)
        .filter((k) => typeof (isObj(o.finishes) ? o.finishes : {})[k] === "boolean")
        .map((k) => [k, Boolean((o.finishes as Record<string, unknown>)[k])]),
    ),
    sfxLevel: lvl(o.sfxLevel, 0.05, 1),
    musicLevel: lvl(o.musicLevel, 0.05, 1),
    captionColor: /^#[0-9a-f]{6}$/i.test(String(o.captionColor ?? "")) ? String(o.captionColor).toUpperCase() : null,
    autoApprove: typeof o.autoApprove === "boolean" ? o.autoApprove : null,
  };
}

/**
 * The settings a new series freezes from the film it is started from.
 *
 * Editing Options carries most of the brief, but three of its answers are
 * COLUMNS on the project — the length, the look and whether captions are
 * off — so they are passed in rather than dug out of the blob. The overlay
 * switches are translated here, once, from the Editing Options spelling to
 * the form's field names (`SERIES_FINISHES`): the series row is then in the
 * form's own currency, and `NewVideoForm` reads it with no mapping of its
 * own. An absent switch stays absent — the form's default is the right
 * answer for a film that never touched it.
 */
export function seriesSettingsFromProject(
  editingOptions: unknown,
  project: { lengthSeconds: number | null; style: string | null; noCaptions: boolean },
): SeriesSettings {
  const o = isObj(editingOptions) ? editingOptions : {};
  const finishes: Record<string, boolean> = {};
  for (const [field, key] of Object.entries(SERIES_FINISHES)) {
    if (field === "captions") continue;
    if (typeof o[key] === "boolean") finishes[field] = Boolean(o[key]);
  }
  // Captions are stored inverted and on the project, so they are always
  // known: `no_captions` is a NOT NULL boolean on every film.
  finishes.captions = !project.noCaptions;
  return normalizeSeriesSettings({
    ...o,
    finishes,
    lengthSeconds: project.lengthSeconds,
    style: project.style,
  });
}

/**
 * True when a series row carries the WHOLE brief, not just the third that
 * was frozen before 2026-09-21. The test is `lengthSeconds`, because it is
 * the one field every film has and no film can legitimately leave unset:
 * `project.length_seconds` is NOT NULL-checked `> 0` on every project, so a
 * series with none was frozen by the old code.
 */
export const hasFullSettings = (s: SeriesSettings): boolean => s.lengthSeconds != null;

/**
 * Fill what a series never froze, from what its first film answered — and
 * touch nothing else.
 *
 * A show created before the whole brief was carried holds the category, the
 * voice tone, the speed and the hook style, and NOTHING about length,
 * overlays, levels or hands-off. Re-deriving the missing half from the film
 * the show was started from is what makes an old series behave like a new
 * one, with no migration and no producer typing it in again.
 *
 * `stored` always wins where it has an answer. That is the whole safety of
 * this: it can only ever add, so a show whose settings someone edited is
 * never overwritten by the film it came from.
 */
export function fillSeriesSettings(stored: SeriesSettings, derived: SeriesSettings): SeriesSettings {
  const take = <T,>(a: T, b: T): T => (a === null || a === undefined ? b : a);
  return {
    ...stored,
    categoryOptions: Object.keys(stored.categoryOptions).length ? stored.categoryOptions : derived.categoryOptions,
    cast: stored.cast.length ? stored.cast : derived.cast,
    voice: take(stored.voice, derived.voice),
    hookStyle: take(stored.hookStyle, derived.hookStyle),
    videoModel: take(stored.videoModel, derived.videoModel),
    speed: take(stored.speed, derived.speed),
    lengthSeconds: take(stored.lengthSeconds, derived.lengthSeconds),
    style: take(stored.style, derived.style),
    // Per SWITCH, not per map: a show that somehow froze two of the seven
    // keeps those two and gains the other five.
    finishes: { ...derived.finishes, ...stored.finishes },
    sfxLevel: take(stored.sfxLevel, derived.sfxLevel),
    musicLevel: take(stored.musicLevel, derived.musicLevel),
    captionColor: take(stored.captionColor, derived.captionColor),
    autoApprove: take(stored.autoApprove, derived.autoApprove),
    // multiVoiceMode has no null: "off" is both the default and a real
    // answer, so the stored one is taken as said unless it is the default
    // and the film says otherwise.
    multiVoiceMode: stored.multiVoiceMode !== "off" ? stored.multiVoiceMode : derived.multiVoiceMode,
  };
}

/** A number inside its range, or null — the same refuse-rather-than-guess rule as derive.ts. */
const lvl = (v: unknown, min: number, max: number): number | null => {
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
};

/**
 * The series as CANON for the next episode's Story Bible.
 *
 * Lore is the mechanism Claude Scripting already has for this: `Generate
 * Story Bible` pastes it in as "CANON REFERENCE — treat every fact below as
 * GROUND TRUTH that overrides everything else". So the characters keep their
 * names and their looks, the places keep their geometry, and `Cast Sheet
 * Prep` finds the same names in the new bible and reuses the sheets it was
 * handed. Nothing in n8n knows what a series is.
 *
 * Normalize Webhook Input keeps 8000 characters of Lore; the sections are
 * ordered so what matters most survives a cut: the cast first, the recap
 * last.
 */
/** Normalize Webhook Input keeps the first 8000 characters of Lore — the same number, in the orchestrator. */
const LORE_CAP = 8000;

export function composeSeriesLore(s: Series, episodeNo: number, extra = ""): string {
  const lines: string[] = [];
  lines.push(
    `SERIES CANON — "${s.name}". This film is episode ${episodeNo} of an ongoing series. ` +
      `Keep everything below EXACTLY: the same characters with the same names, ages, outfits and looks; ` +
      `the same places with the same layout; the same visual style. Invent only what this episode needs, ` +
      `and give any NEW character or place a full description of its own.`,
  );
  if (s.bible.characters.length) {
    lines.push(
      `USE EXACTLY THESE NAMES, spelled exactly so, for the returning cast: ${s.bible.characters.map((c) => c.name).join("; ")}.` +
        (s.bible.locations.length ? ` And these places: ${s.bible.locations.map((l) => l.name).join("; ")}.` : ""),
    );
  }
  if (s.premise) lines.push(`\nTHE SHOW: ${s.premise}`);
  else if (s.bible.logline) lines.push(`\nTHE SHOW: ${s.bible.logline}`);
  if (s.bible.characters.length) {
    lines.push("\nCHARACTERS (fixed — same name, same appearance in every episode):");
    for (const c of s.bible.characters) {
      lines.push(`- ${c.name}${c.role ? ` (${c.role})` : ""}: ${c.description}`);
    }
  }
  if (s.bible.locations.length) {
    lines.push("\nPLACES (fixed — same layout, same materials, same landmarks):");
    for (const p of s.bible.locations) lines.push(`- ${p.name}: ${p.description}`);
  }
  if (s.bible.objects.length) {
    lines.push("\nOBJECTS (fixed):");
    for (const p of s.bible.objects) lines.push(`- ${p.name}: ${p.description}`);
  }
  const vs = Object.entries(s.bible.visualStyle);
  if (vs.length) {
    lines.push("\nVISUAL STYLE (fixed):");
    for (const [k, v] of vs) lines.push(`- ${k.replace(/_/g, " ")}: ${v}`);
  }
  if (s.bible.continuityRules.length) {
    lines.push("\nCONTINUITY RULES:");
    for (const r of s.bible.continuityRules) lines.push(`- ${r}`);
  }
  if (extra.trim()) lines.push(`\nMORE CANON FOR THIS EPISODE:\n${extra.trim()}`);
  // The recap grows by one line per episode (the series-recap webhook), and
  // Lore is cut at 8000 characters by Normalize Webhook Input. A cut from the
  // END would lose the NEWEST episodes, which are the ones the next film must
  // not contradict — so the recap is fitted into whatever room the canon
  // leaves, newest line first, and it is the OLDEST lines that fall off.
  const fixed = lines.join("\n");
  if (s.previously.trim()) {
    const header = "\nWHAT HAS HAPPENED IN EARLIER EPISODES (do not contradict it; do not retell it):\n";
    let room = LORE_CAP - fixed.length - header.length - 1;
    const kept: string[] = [];
    for (const line of s.previously.split("\n").map((l) => l.trim()).filter(Boolean).reverse()) {
      if (line.length + 1 > room) break;
      kept.unshift(line);
      room -= line.length + 1;
    }
    if (kept.length) return `${fixed}\n${header}${kept.join("\n")}`.slice(0, LORE_CAP);
  }
  return fixed.slice(0, LORE_CAP);
}

/** Two letters for a character without a portrait. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const a = parts[0]?.[0] ?? "?";
  const b = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (a + b).toUpperCase();
}

/**
 * What the brief needs to start the next episode — a plain, serialisable
 * subset of a series, built on the server and handed to the client form.
 */
export interface SeriesPrefill {
  id: string;
  name: string;
  episodeNo: number;
  category: string;
  categoryOptions: Record<string, string>;
  tone: string | null;
  /** The language NAME ("English", "Română") — what the project stores. */
  language: string;
  aspect: "16:9" | "9:16";
  voiceId: string;
  voice: VoiceTone | null;
  speed: number | null;
  hookStyle: string | null;
  videoModel: string | null;
  lengthSeconds: number | null;
  style: string | null;
  finishes: Record<string, boolean>;
  sfxLevel: number | null;
  musicLevel: number | null;
  captionColor: string | null;
  autoApprove: boolean | null;
  multiVoiceMode: string;
  cast: string[];
  // What makes the page read as an episode rather than an empty brief: who
  // is in it, where it happens, and what has happened so far. Shown on the
  // form; also what the "suggest the next episode" button sends.
  characters: string[];
  places: string[];
  premise: string;
  previously: string;
  /** The titles already used, newest last — so a suggestion does not repeat one. */
  episodeTitles: string[];
}

export function seriesPrefill(
  s: Series,
  episodeNo: number,
  episodeTitles: string[] = [],
): SeriesPrefill {
  return {
    id: s.id,
    name: s.name,
    episodeNo,
    category: s.category,
    categoryOptions: s.settings.categoryOptions,
    tone: s.tone,
    language: s.language,
    aspect: s.aspect,
    voiceId: s.voiceId,
    voice: s.settings.voice,
    speed: s.settings.speed,
    hookStyle: s.settings.hookStyle,
    videoModel: s.settings.videoModel,
    lengthSeconds: s.settings.lengthSeconds,
    style: s.settings.style,
    finishes: s.settings.finishes,
    sfxLevel: s.settings.sfxLevel,
    musicLevel: s.settings.musicLevel,
    captionColor: s.settings.captionColor,
    autoApprove: s.settings.autoApprove,
    multiVoiceMode: s.settings.multiVoiceMode,
    cast: s.settings.cast,
    characters: s.bible.characters.map((c) => c.name),
    places: s.bible.locations.map((l) => l.name),
    premise: s.premise || s.bible.logline,
    previously: s.previously,
    episodeTitles: episodeTitles.slice(-12),
  };
}

// ---------------------------------------------------------------------------
// Keeping a show in step with its episodes — the automatic half.
//
// Three things used to be the producer's to do by hand after every episode,
// and all three happen at ONE moment now: when the episode's script is
// approved (the bible exists, Media Generation has not started). See
// `onEpisodeScriptApproved` in app/actions.ts.
//   1. The writer may spell a name differently ("Pip the Fox" for "Pip").
//      The sheets are matched by name, so the episode's references are
//      re-keyed to the new bible's spelling where the match is unambiguous.
//   2. A character, place or object the episode invented is added to the
//      show, so the next episode keeps it too.
//   3. The recap is written by the pipeline (the `series-recap` webhook).
// ---------------------------------------------------------------------------

/** Diacritics off, case off, punctuation off — for comparing names, never for showing them. */
export const normName = (s: string): string =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");

/**
 * The one candidate a name means, or null. Exact first; then the name
 * contained in a candidate (or containing it) as whole words, if exactly one;
 * then the same given name, if unique on the candidate side. Anything
 * ambiguous is null on purpose — "Boyd" must not pick one of three Boyds.
 */
export function matchName(want: string, candidates: string[]): string | null {
  const w = normName(want);
  if (!w) return null;
  const exact = candidates.find((c) => normName(c) === w);
  if (exact) return exact;
  const contains = candidates.filter((c) => {
    const n = normName(c);
    return n.length > 2 && (` ${n} `.includes(` ${w} `) || ` ${w} `.includes(` ${n} `));
  });
  if (contains.length === 1) return contains[0];
  const given = w.split(" ")[0];
  if (given.length < 3) return null;
  const sameGiven = candidates.filter((c) => normName(c).split(" ")[0] === given);
  return sameGiven.length === 1 ? sameGiven[0] : null;
}

const rekey = <V,>(map: Record<string, V>, names: string[], renamed: Array<{ from: string; to: string }>): Record<string, V> => {
  const out: Record<string, V> = {};
  for (const [key, v] of Object.entries(map)) {
    const to = names.includes(key) ? key : matchName(key, names);
    // An unmatched name keeps its key: harmless (never attached) and honest.
    const k = to ?? key;
    if (k !== key && !(k in map)) renamed.push({ from: key, to: k });
    if (!(k in out)) out[k] = v;
  }
  return out;
};

/** The episode's references re-keyed to its own bible's spelling of the names. */
export function reconcileRefsToBible(
  refs: SeriesRefs,
  bible: SeriesBible,
): { refs: SeriesRefs; renamed: Array<{ from: string; to: string }> } {
  const renamed: Array<{ from: string; to: string }> = [];
  const chars = bible.characters.map((c) => c.name);
  const objs = bible.objects.map((o) => o.name);
  const locs = bible.locations.map((l) => l.name);
  const out: SeriesRefs = {
    castRefs: rekey(refs.castRefs, chars, renamed),
    castSheets: rekey(refs.castSheets, chars, []),
    objectRefs: rekey(refs.objectRefs, objs, renamed),
    locationRefs: rekey(refs.locationRefs, locs, renamed),
    locationPlates: rekey(refs.locationPlates, locs, []),
  };
  return { refs: out, renamed };
}

/** The show's bible plus whatever this episode's bible introduced. */
export function mergeBibles(
  base: SeriesBible,
  add: SeriesBible,
): { bible: SeriesBible; added: { characters: string[]; objects: string[]; locations: string[] } } {
  const added = { characters: [] as string[], objects: [] as string[], locations: [] as string[] };
  const characters = [...base.characters];
  for (const c of add.characters) {
    if (matchName(c.name, characters.map((x) => x.name))) continue;
    characters.push(c);
    added.characters.push(c.name);
  }
  const objects = [...base.objects];
  for (const o of add.objects) {
    if (matchName(o.name, objects.map((x) => x.name))) continue;
    objects.push(o);
    added.objects.push(o.name);
  }
  const locations = [...base.locations];
  for (const l of add.locations) {
    if (matchName(l.name, locations.map((x) => x.name))) continue;
    locations.push(l);
    added.locations.push(l.name);
  }
  return {
    bible: {
      logline: base.logline || add.logline,
      characters,
      objects,
      locations,
      visualStyle: Object.keys(base.visualStyle).length ? base.visualStyle : add.visualStyle,
      continuityRules: base.continuityRules.length ? base.continuityRules : add.continuityRules,
    },
    added,
  };
}

/** Earlier references win: the show's own, then each episode's in order. */
export function mergeRefs(base: SeriesRefs, add: SeriesRefs): SeriesRefs {
  const m = <V,>(a: Record<string, V>, b: Record<string, V>) => ({ ...b, ...a });
  return {
    castRefs: m(base.castRefs, add.castRefs),
    castSheets: m(base.castSheets, add.castSheets),
    objectRefs: m(base.objectRefs, add.objectRefs),
    locationRefs: m(base.locationRefs, add.locationRefs),
    locationPlates: m(base.locationPlates, add.locationPlates),
  };
}
