import { NextRequest, NextResponse } from "next/server";
import { languageQuery, voiceMatchesLanguage } from "@/lib/languages";

interface VoiceRow {
  voice_id: unknown;
  name: unknown;
  gender: string | null;
  language: string | null;
  accent: string | null;
  description: string | null;
  preview_url: unknown;
}

const shape = (v: Record<string, unknown>): VoiceRow => ({
  voice_id: v.voice_id,
  name: v.name,
  gender: (v.gender as string) ?? null,
  language: (v.language as string) ?? null,
  accent: (v.accent as string) ?? null,
  description: typeof v.description === "string" ? v.description.slice(0, 140) : null,
  preview_url: v.preview_url ?? null,
});

/**
 * How far to look for voices in a given language.
 *
 * A language filter applied to ONE page of 24 is close to useless: a library
 * that is mostly English can easily have no Romanian voice in its first page
 * while holding a dozen further in. So a language search scans wide pages
 * instead — the same bounded walk `resolveNames` does, and cached for an hour
 * upstream, so it costs nothing after the first producer asks.
 */
const SCAN_PAGES = 6;
const SCAN_SIZE = 100;
const MAX_MATCHES = 60;

// Proxies the ai33.pro voice library so the browser never sees the API key.
// GET /api/voices?provider=elevenlabs&q=warm&page=1&language=Rom%C3%A2n%C4%83
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
  // Everything downstream of the picker stores only the prefixed id, so the
  // review screens have no way to say "Charlie" without asking back.
  const ids = sp.get("ids");
  if (ids) return NextResponse.json({ names: await resolveNames(ids, key) });

  const fetchPage = async (p: number, size: number) => {
    const url = new URL("https://api.ai33.pro/v3/voices");
    url.searchParams.set("provider", provider);
    url.searchParams.set("page", String(p));
    url.searchParams.set("page_size", String(size));
    if (q) url.searchParams.set("q", q);
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

  const wanted = languageQuery(sp.get("language") || "");

  if (wanted) {
    // Scan wide, keep what speaks the language.
    let scanned = 0;
    const matches: VoiceRow[] = [];
    try {
      for (let p = 1; p <= SCAN_PAGES && matches.length < MAX_MATCHES; p++) {
        const data = await fetchPage(p, SCAN_SIZE);
        const rows = data.data ?? [];
        scanned += rows.length;
        for (const v of rows) {
          const row = shape(v);
          if (voiceMatchesLanguage(row, wanted)) matches.push(row);
          if (matches.length >= MAX_MATCHES) break;
        }
        if (!data.pagination?.has_more) break;
      }
    } catch (e) {
      return NextResponse.json({ error: String((e as Error).message) }, { status: 502 });
    }
    if (matches.length > 0) {
      return NextResponse.json({
        voices: matches,
        has_more: false,
        language: { applied: true, label: wanted.label, matched: matches.length, scanned },
      });
    }
    // Nothing in this library is tagged with that language. Falling through
    // to the unfiltered list is deliberate: an empty picker would read as a
    // broken feature, and a multilingual voice can still read the language —
    // only the accent changes. The flag lets the UI say exactly that.
    try {
      const data = await fetchPage(1, 24);
      return NextResponse.json({
        voices: (data.data ?? []).map(shape),
        has_more: Boolean(data.pagination?.has_more),
        language: { applied: false, label: wanted.label, matched: 0, scanned },
      });
    } catch (e) {
      return NextResponse.json({ error: String((e as Error).message) }, { status: 502 });
    }
  }

  try {
    const data = await fetchPage(Number(page) || 1, 24);
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
