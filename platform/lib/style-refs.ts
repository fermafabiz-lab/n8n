/**
 * Which library scripts a film is written against — and what the writer is
 * actually shown from them.
 *
 * Two things went wrong on the Burj Al Arab film, and both were invisible from
 * the site:
 *
 * 1. `Fetch Style Card` in Claude Scripting matched the library on
 *    `Tone = <Tonalitate> OR Category = <Tonalitate>` and took the FIRST three
 *    rows by insertion order. The producer's own reference transcript for that
 *    exact film sat in the library as tone "Corporate" / category
 *    "Educational" — and the film's tone was "Educativ", so it never matched,
 *    while a Moroccan McDonald's vlog and a YouTube Shorts tutorial did.
 * 2. Every one of the 63 active transcripts is an SRT file, and nothing ever
 *    stripped the cue numbers and timecodes, so the "REAL EXCERPT" the writer
 *    was told to imitate read «67 00:02:39,360 --> 00:02:41,670 Marrakesh…».
 *
 * This module owns both answers. `pickStyleRefs` is pure so it can be checked
 * without a database (`npm run check:style-refs`); `/api/style-refs` is the
 * one caller in production, and Claude Scripting's `Fetch Style Card` reads
 * that route instead of the raw table.
 */

export interface StyleRow {
  id: string;
  title: string;
  tone: string | null;
  category: string | null;
  active: boolean;
  /** Raw transcript as stored — SRT or plain. `cleanTranscript` decides. */
  transcript: string | null;
  styleCard: string | null;
  pacingWpm: number | null;
  hookWpm: number | null;
  createdAt?: string | null;
}

/** How many references a film may carry. Three is what the prompt already read. */
export const MAX_STYLE_REFS = 3;

const REC_ID = /^rec[A-Za-z0-9]{14}$/;

/** `styleRefs` as stored in Editing Options: a list of library record ids. */
export function normalizeStyleRefs(raw: unknown): string[] {
  let list: unknown = raw;
  if (typeof raw === "string") {
    const s = raw.trim();
    if (!s) return [];
    try {
      list = JSON.parse(s);
    } catch {
      list = s.split(/[\s,]+/);
    }
  }
  if (!Array.isArray(list)) return [];
  const out: string[] = [];
  for (const v of list) {
    const id = String(v ?? "").trim();
    if (REC_ID.test(id) && !out.includes(id)) out.push(id);
    if (out.length >= MAX_STYLE_REFS) break;
  }
  return out;
}

/**
 * The form's tone vocabulary and the library's tone/category vocabulary were
 * never the same list: the brief says "Educativ", the library says
 * "Educational"; "Funny" rows sit under category "Fun". One key per family,
 * diacritics folded, so a match is decided by meaning rather than spelling.
 */
const TONE_FAMILIES: Record<string, string[]> = {
  educativ: ["educativ", "educational", "education", "explainer", "tutorial", "educatie"],
  documentary: ["documentary", "documentar", "doc"],
  history: ["history", "istorie", "historical"],
  storytelling: ["storytelling", "story", "poveste"],
  funny: ["funny", "fun", "comedy", "comic", "amuzant"],
  motivational: ["motivational", "motivation", "motivațional", "motivational piece"],
  horror: ["horror", "scary", "groaza"],
  dark: ["dark", "intunecat"],
  epic: ["epic", "epica"],
  emotional: ["emotional", "emotionant"],
  dramatic: ["dramatic", "drama"],
  cinematic: ["cinematic", "film"],
  conspiracy: ["conspiracy", "conspiratie", "investigative"],
  corporate: ["corporate", "brand", "business"],
};

const ALIAS: Record<string, string> = {};
for (const [family, names] of Object.entries(TONE_FAMILIES)) {
  for (const n of names) ALIAS[fold(n)] = family;
}

function fold(s: unknown): string {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim();
}

/** "Educativ", "Educational" and "explainer" all answer "educativ". */
export function toneFamily(value: unknown): string {
  const f = fold(value);
  return ALIAS[f] ?? f;
}

/**
 * SRT and WebVTT cues out, prose in. Cue numbers, timecode lines, `[music]`
 * style markers, `>>` speaker changes and the `\h` no-break escape are all
 * caption plumbing; what is left joins into one paragraph. A transcript that
 * was already prose comes back unchanged apart from whitespace.
 */
export function cleanTranscript(raw: unknown): string {
  return String(raw ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/^WEBVTT[^\n]*\n/, "")
    // A cue's number line and its timecode line, wherever they sit — also
    // when the whole file was flattened onto one line.
    // Cue settings (`line:0 position:50%`) ride the timecode line in WebVTT
    // and are eaten with it; the text after them is NOT, because a flattened
    // file puts the caption on the same line.
    .replace(/(?:^|\n|\s)\d{1,5}\s*\n?\s*\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}\s*-->\s*\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}(?:[ \t]+(?:X1|X2|Y1|Y2|line|position|align|size|vertical):\S+)*/g, " ")
    .replace(/\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}\s*-->\s*\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}(?:[ \t]+(?:X1|X2|Y1|Y2|line|position|align|size|vertical):\S+)*/g, " ")
    .replace(/\[(?:music|applause|laughter|laughs|sighs|inaudible|silence|noise|cheering)\]/gi, " ")
    .replace(/(?:^|\s)>>\s?/g, " ")
    .replace(/\\h/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const SENTENCE = /(?<=[.!?…])\s+/;

/** How many sentences a cleaned transcript holds — the excerpt needs 20+. */
export function sentenceCount(text: string): number {
  return text ? text.split(SENTENCE).filter((s) => s.trim()).length : 0;
}

export interface PickInput {
  /** Editing Options.styleRefs — the producer's own choice, in order. */
  pinned: string[];
  /** The project's Tonalitate. */
  tone: string;
  /** The project's Look / Style field ("Documentary", "History"…), if any. */
  look?: string | null;
  limit?: number;
}

/**
 * Which rows the writer sees, in order:
 *
 *   1. what the producer pinned, in the order they pinned it;
 *   2. rows whose TONE is the film's tone (family-matched);
 *   3. rows whose CATEGORY is the film's tone, or the film's Look;
 *
 * within a tier, a transcript long enough to excerpt (20+ sentences after
 * cleaning) beats one that is not, and newer beats older. Inactive rows never
 * qualify — not even when pinned: the library's Active switch is how a bad
 * transcript is retired, and a pin must not resurrect it.
 */
export function pickStyleRefs(rows: StyleRow[], input: PickInput): StyleRow[] {
  const limit = Math.max(1, Math.min(input.limit ?? MAX_STYLE_REFS, MAX_STYLE_REFS));
  const active = rows.filter((r) => r.active);
  const byId = new Map(active.map((r) => [r.id, r]));
  const out: StyleRow[] = [];
  for (const id of input.pinned) {
    const r = byId.get(id);
    if (r && !out.includes(r)) out.push(r);
    if (out.length >= limit) return out;
  }
  const want = toneFamily(input.tone);
  const look = input.look ? toneFamily(input.look) : "";
  const tier = (r: StyleRow): number => {
    if (want && toneFamily(r.tone) === want) return 1;
    if (want && toneFamily(r.category) === want) return 2;
    if (look && (toneFamily(r.category) === look || toneFamily(r.tone) === look)) return 3;
    return 0;
  };
  const scored = active
    .filter((r) => !out.includes(r))
    .map((r) => ({ r, tier: tier(r), long: sentenceCount(cleanTranscript(r.transcript)) >= 20 ? 1 : 0 }))
    .filter((x) => x.tier > 0)
    .sort(
      (a, b) =>
        a.tier - b.tier ||
        b.long - a.long ||
        String(b.r.createdAt ?? "").localeCompare(String(a.r.createdAt ?? "")) ||
        a.r.title.localeCompare(b.r.title),
    );
  for (const x of scored) {
    out.push(x.r);
    if (out.length >= limit) break;
  }
  return out;
}
