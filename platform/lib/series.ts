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
}

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
  };
}

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
export function composeSeriesLore(s: Series, episodeNo: number, extra = ""): string {
  const lines: string[] = [];
  lines.push(
    `SERIES CANON — "${s.name}". This film is episode ${episodeNo} of an ongoing series. ` +
      `Keep everything below EXACTLY: the same characters with the same names, ages, outfits and looks; ` +
      `the same places with the same layout; the same visual style. Invent only what this episode needs, ` +
      `and give any NEW character or place a full description of its own.`,
  );
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
  if (s.previously) lines.push(`\nWHAT HAS HAPPENED IN EARLIER EPISODES (do not contradict it; do not retell it):\n${s.previously}`);
  if (extra.trim()) lines.push(`\nMORE CANON FOR THIS EPISODE:\n${extra.trim()}`);
  return lines.join("\n").slice(0, 8000);
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
}

export function seriesPrefill(s: Series, episodeNo: number): SeriesPrefill {
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
  };
}
