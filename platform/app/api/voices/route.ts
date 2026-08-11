import { NextRequest, NextResponse } from "next/server";
import {
  languageByCode,
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
  if (ids) return NextResponse.json({ names: await resolveNames(ids, key) });

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

  const lang: Language | null = languageByCode(sp.get("lang") || "");

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
 * Resolve prefixed voice ids to display names.
 *
 * ai33's library endpoint has no lookup-by-id, so this walks the pages of
 * each provider the ids mention until every one is found. Pages are bounded
 * and individually cached for an hour, so the walk happens once per provider
 * and then costs nothing. An id that never turns up is simply omitted — the
 * caller falls back to showing the short code rather than an empty label.
 */
async function resolveNames(
  idList: string,
  key: string,
): Promise<Record<string, string>> {
  const wanted = new Set(
    idList.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 40),
  );
  const names: Record<string, string> = {};
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
        if (wanted.has(id) && typeof v.name === "string") names[id] = v.name;
      }
      if (!data.pagination?.has_more) break;
    }
  }
  return names;
}
