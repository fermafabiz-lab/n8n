import { NextRequest, NextResponse } from "next/server";
import {
  languageByCode,
  narrowsUsefully,
  normLang,
  voiceMatchesLanguage,
  voiceMentionsLanguage,
  type Language,
} from "@/lib/languages";

interface VoiceRow {
  voice_id: string;
  name: string;
  gender: string | null;
  language: string | null;
  accent: string | null;
  description: string | null;
  preview_url: unknown;
}

const shape = (v: Record<string, unknown>): VoiceRow => ({
  voice_id: String(v.voice_id ?? ""),
  name: String(v.name ?? ""),
  gender: (v.gender as string) ?? null,
  language: (v.language as string) ?? null,
  accent: (v.accent as string) ?? null,
  description: typeof v.description === "string" ? v.description.slice(0, 140) : null,
  preview_url: v.preview_url ?? null,
});

/**
 * How a language search reaches the voices that are actually there.
 *
 * The first version scanned pages with an empty query and kept only voices
 * whose metadata named the language. It surfaced TWO Romanian voices on a
 * library that visibly holds many, because a metadata-only test over the
 * first few hundred entries is not the same search a human does. Typing
 * "romanian" into the box found them, so ai33's own search reaches deeper
 * than the scan and reads more fields than we can.
 *
 * So both are used and merged: ai33's search for the language name, plus the
 * metadata scan. A voice the metadata confirms ranks above one that merely
 * came back from the name search, but neither is thrown away.
 */
const NAME_PAGES = 4;
const SCAN_PAGES = 6;
const PAGE = 100;
const MAX_RESULTS = 120;

export async function GET(req: NextRequest) {
  const key = process.env.AI33_API_KEY;
  if (!key) {
    return NextResponse.json(
      { error: "AI33_API_KEY is not set in the environment." },
      { status: 503 },
    );
  }
  const sp = req.nextUrl.searchParams;
  const provider = sp.get("provider") || "elevenlabs";
  const q = sp.get("q") || "";
  const page = sp.get("page") || "1";

  // Name lookup: ?ids=elevenlabs_abc,elevenlabs_def -> {id: "Charlie"}.
  const ids = sp.get("ids");
  if (ids) {
    const resolved = await resolveNames(ids, key);
    return NextResponse.json({
      names: Object.fromEntries(Object.entries(resolved).map(([k, v]) => [k, v.name])),
      genders: Object.fromEntries(Object.entries(resolved).map(([k, v]) => [k, v.gender])),
    });
  }

  const fetchPage = async (p: number, size: number, query: string) => {
    const url = new URL("https://api.ai33.pro/v3/voices");
    url.searchParams.set("provider", provider);
    url.searchParams.set("page", String(p));
    url.searchParams.set("page_size", String(size));
    if (query) url.searchParams.set("q", query);
    const res = await fetch(url, {
      headers: { "xi-api-key": key },
      next: { revalidate: 3600 },
    });
    if (!res.ok) throw new Error(`ai33 API: HTTP ${res.status}`);
    return (await res.json()) as {
      data?: Array<Record<string, unknown>>;
      pagination?: { has_more?: boolean };
    };
  };

  /** Walk pages of one upstream query, collecting rows. */
  const walk = async (query: string, pages: number): Promise<VoiceRow[]> => {
    const out: VoiceRow[] = [];
    for (let p = 1; p <= pages; p++) {
      const data = await fetchPage(p, PAGE, query);
      const rows = data.data ?? [];
      out.push(...rows.map(shape));
      if (!data.pagination?.has_more || rows.length === 0) break;
    }
    return out;
  };

  // The picker already omits the filter for a baseline language; this guards
  // the same rule for anything calling the route directly. See narrowsUsefully.
  const asked: Language | null = languageByCode(sp.get("lang") || "");
  const lang: Language | null = asked && narrowsUsefully(asked.code) ? asked : null;

  if (lang) {
    try {
      // ai33's own search AND the metadata scan, then merged. Run together —
      // both are cached upstream for an hour, so this costs one round of
      // requests per language per hour, not one per keystroke.
      const [byName, scanned] = await Promise.all([
        walk(lang.name, NAME_PAGES).catch(() => [] as VoiceRow[]),
        walk("", SCAN_PAGES).catch(() => [] as VoiceRow[]),
      ]);

      const seen = new Set<string>();
      const confirmed: VoiceRow[] = [];
      const likely: VoiceRow[] = [];
      for (const v of [...byName, ...scanned]) {
        if (!v.voice_id || seen.has(v.voice_id)) continue;
        seen.add(v.voice_id);
        if (voiceMatchesLanguage(v, lang)) confirmed.push(v);
        else if (voiceMentionsLanguage(v, lang)) likely.push(v);
      }

      // The producer's own search narrows WITHIN the language, locally —
      // the upstream q is already spent on the language name.
      const needle = normLang(q);
      const keep = (v: VoiceRow) =>
        !needle ||
        normLang(`${v.name} ${v.description ?? ""} ${v.accent ?? ""}`).includes(needle);

      const voices = [...confirmed, ...likely].filter(keep).slice(0, MAX_RESULTS);
      if (voices.length > 0) {
        return NextResponse.json({
          voices,
          has_more: false,
          language: {
            applied: true,
            code: lang.code,
            label: lang.name,
            confirmed: confirmed.filter(keep).length,
            total: voices.length,
          },
        });
      }
      // Nothing at all for this language. Falling back to the plain list is
      // deliberate: an empty picker reads as a broken feature, and a
      // multilingual voice does read the language — only the accent changes.
      const data = await fetchPage(1, 24, q);
      return NextResponse.json({
        voices: (data.data ?? []).map(shape),
        has_more: Boolean(data.pagination?.has_more),
        language: { applied: false, code: lang.code, label: lang.name, confirmed: 0, total: 0 },
      });
    } catch (e) {
      return NextResponse.json({ error: String((e as Error).message) }, { status: 502 });
    }
  }

  try {
    const data = await fetchPage(Number(page) || 1, 24, q);
    return NextResponse.json({
      voices: (data.data ?? []).map(shape),
      has_more: Boolean(data.pagination?.has_more),
    });
  } catch (e) {
    return NextResponse.json({ error: String((e as Error).message) }, { status: 502 });
  }
}

/**
 * Ids -> name + gender.
 *
 * The paged scan alone was not enough, and the gap was invisible: it walks
 * the first 800 voices, and a cast picked from a large library routinely
 * sits past that. Three of one project's four voices came back unresolved,
 * so the audio panel printed "elevenlabs · …oKomo" at the producer — from
 * which no one can tell ZaTurk from Roxana, let alone a man from a woman.
 * That is the state in which a Romanian male character was given Bella and
 * nobody could see it. There is no lookup-by-id endpoint — /v3/voices/<id>
 * answers 404 — but ai33's own `q` search matches the id and returns the one
 * row, which is the same trick the language filter uses. The scan stays
 * ahead of it: one page covers a whole cast of common voices in one
 * request, and only what it misses costs an extra call.
 *
 * Gender rides along for the same reason: it is the one field that makes a
 * wrong pairing obvious at a glance, and the API already returns it.
 */
async function resolveNames(
  idList: string,
  key: string,
): Promise<Record<string, { name: string; gender: string | null }>> {
  const wanted = new Set(
    idList.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 40),
  );
  const names: Record<string, { name: string; gender: string | null }> = {};
  const providers = new Set(
    [...wanted].map((id) => id.split("_")[0]).filter(Boolean),
  );

  for (const provider of providers) {
    for (let p = 1; p <= 8; p++) {
      if (![...wanted].some((id) => !names[id])) break;
      const url = new URL("https://api.ai33.pro/v3/voices");
      url.searchParams.set("provider", provider);
      url.searchParams.set("page", String(p));
      url.searchParams.set("page_size", "100");
      let data: { data?: Array<Record<string, unknown>>; pagination?: { has_more?: boolean } };
      try {
        const res = await fetch(url, {
          headers: { "xi-api-key": key },
          next: { revalidate: 3600 },
        });
        if (!res.ok) break;
        data = await res.json();
      } catch {
        break;
      }
      for (const v of data.data ?? []) {
        const id = String(v.voice_id ?? "");
        if (wanted.has(id) && typeof v.name === "string") {
          names[id] = { name: v.name, gender: (v.gender as string) ?? null };
        }
      }
      if (!data.pagination?.has_more) break;
    }
  }

  // Whatever the scan did not reach, asked for by name. Sequential and
  // bounded by the 40-id cap above; a miss stays a miss rather than failing
  // the batch, because a truncated code is still better than no panel.
  for (const id of wanted) {
    if (names[id]) continue;
    const [provider, ...rest] = id.split("_");
    const bare = rest.join("_");
    if (!provider || !bare) continue;
    try {
      const url = new URL("https://api.ai33.pro/v3/voices");
      url.searchParams.set("provider", provider);
      url.searchParams.set("q", bare);
      const res = await fetch(url, {
        headers: { "xi-api-key": key },
        next: { revalidate: 3600 },
      });
      if (!res.ok) continue;
      const j = (await res.json()) as { data?: Array<Record<string, unknown>> };
      // The row carries the PREFIXED id, so match on it rather than assuming
      // the single result is the one asked for.
      for (const v of j.data ?? []) {
        const got = String(v.voice_id ?? "");
        if (got === id && typeof v.name === "string" && v.name) {
          names[id] = { name: v.name, gender: (v.gender as string) ?? null };
        }
      }
    } catch {
      // Leave it unresolved; shortVoiceId still renders something.
    }
  }

  return names;
}
