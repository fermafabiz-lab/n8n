import { NextRequest, NextResponse } from "next/server";
import {
  languageByCode,
  narrowsUsefully,
  normLang,
  voiceMatchesLanguage,
  voiceMentionsLanguage,
  type Language,
} from "@/lib/languages";

/**
 * The voice library, read straight from ElevenLabs.
 *
 * This used to go through ai33, an ElevenLabs reseller — same `xi-api-key`
 * header, same voices, an id wearing an `elevenlabs_` prefix. Going direct
 * changes two things and keeps everything else: pagination is cursor-based
 * rather than numbered, and a voice can finally be looked up BY ID.
 *
 * The prefix stays on every id this route emits. It is not decoration: five
 * places in the site and the workflows use `id.includes("_")` as the test for
 * "is this a real voice id", and every project already stores it that way.
 * Stripping it would be a data migration to buy nothing.
 */

interface VoiceRow {
  voice_id: string;
  name: string;
  gender: string | null;
  language: string | null;
  accent: string | null;
  description: string | null;
  preview_url: unknown;
}

const ELEVEN = "https://api.elevenlabs.io";
const PREFIX = "elevenlabs_";

/**
 * ElevenLabs nests the descriptive fields under `labels`, where ai33 had
 * flattened them. The language filter reads `language`/`accent` off the row,
 * so they are lifted back up here rather than teaching the filter two shapes.
 */
const shape = (v: Record<string, unknown>): VoiceRow => {
  const labels = (v.labels ?? {}) as Record<string, unknown>;
  const pick = (k: string) => {
    const val = labels[k] ?? v[k];
    return typeof val === "string" && val ? val : null;
  };
  return {
    voice_id: PREFIX + String(v.voice_id ?? ""),
    name: String(v.name ?? ""),
    gender: pick("gender"),
    language: pick("language"),
    accent: pick("accent"),
    description: typeof v.description === "string" ? v.description.slice(0, 140) : null,
    preview_url: v.preview_url ?? null,
  };
};

/**
 * How a language search reaches the voices that are actually there.
 *
 * The first version scanned pages with an empty query and kept only voices
 * whose metadata NAMED the language. It surfaced two Romanian voices on a
 * library that visibly holds more, because a metadata scan over the first few
 * hundred entries is not the same search a human does. Typing "romanian" into
 * the box found them, so the provider's own search reaches deeper and reads
 * fields we cannot see.
 *
 * So both are used and merged: the upstream search for the language name, plus
 * the metadata scan. Metadata-confirmed voices rank above ones that only came
 * back from the name search, but neither is thrown away.
 */
const NAME_PAGES = 4;
const SCAN_PAGES = 6;
const PAGE = 100;
const MAX_RESULTS = 120;

export async function GET(req: NextRequest) {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) {
    return NextResponse.json(
      { error: "ELEVENLABS_API_KEY is not set in the environment." },
      { status: 503 },
    );
  }
  const sp = req.nextUrl.searchParams;
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

  /**
   * One upstream page. Cursor-based: `next_page_token` rather than a number,
   * which is why `walk` below carries the token instead of counting.
   */
  const fetchPage = async (size: number, query: string, token?: string) => {
    const url = new URL(`${ELEVEN}/v2/voices`);
    url.searchParams.set("page_size", String(Math.min(100, size)));
    if (query) url.searchParams.set("search", query);
    if (token) url.searchParams.set("next_page_token", token);
    const res = await fetch(url, {
      headers: { "xi-api-key": key },
      next: { revalidate: 3600 },
    });
    if (!res.ok) throw new Error(`ElevenLabs API: HTTP ${res.status}`);
    return (await res.json()) as {
      voices?: Array<Record<string, unknown>>;
      has_more?: boolean;
      next_page_token?: string | null;
    };
  };

  /** Walk pages of one upstream query, collecting rows. */
  const walk = async (query: string, pages: number): Promise<VoiceRow[]> => {
    const out: VoiceRow[] = [];
    let token: string | undefined;
    for (let p = 0; p < pages; p++) {
      const data = await fetchPage(PAGE, query, token);
      const rows = data.voices ?? [];
      out.push(...rows.map(shape));
      token = data.next_page_token ?? undefined;
      if (!data.has_more || !token || rows.length === 0) break;
    }
    return out;
  };

  /**
   * The plain list, still addressed by page NUMBER because that is what the
   * picker sends. Upstream is cursor-based, so the window is reached by
   * walking — bounded, and only as far as the page actually asked for.
   */
  const listPage = async (n: number, size: number, query: string) => {
    let token: string | undefined;
    let rows: Array<Record<string, unknown>> = [];
    let more = false;
    for (let p = 1; p <= Math.min(n, 8); p++) {
      const data = await fetchPage(size, query, token);
      rows = data.voices ?? [];
      more = Boolean(data.has_more);
      token = data.next_page_token ?? undefined;
      if (p === n || !more || !token) break;
    }
    return { voices: rows.map(shape), has_more: more };
  };

  // The picker already omits the filter for a baseline language; this guards
  // the same rule for anything calling the route directly. See narrowsUsefully.
  const asked: Language | null = languageByCode(sp.get("lang") || "");
  const lang: Language | null = asked && narrowsUsefully(asked.code) ? asked : null;

  if (lang) {
    try {
      // The upstream search AND the metadata scan, then merged. Run together —
      // both are cached for an hour, so this costs one round of requests per
      // language per hour, not one per keystroke.
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
      // the upstream search is already spent on the language name.
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
      const plain = await listPage(1, 24, q);
      return NextResponse.json({
        ...plain,
        language: { applied: false, code: lang.code, label: lang.name, confirmed: 0, total: 0 },
      });
    } catch (e) {
      return NextResponse.json({ error: String((e as Error).message) }, { status: 502 });
    }
  }

  try {
    return NextResponse.json(await listPage(Number(page) || 1, 24, q));
  } catch (e) {
    return NextResponse.json({ error: String((e as Error).message) }, { status: 502 });
  }
}

/**
 * Ids -> name + gender.
 *
 * This is now one request per id, and that is the whole story: ai33 had no
 * lookup-by-id (`/v3/voices/<id>` answered 404), so the old version scanned
 * eight pages hoping the voice was in the first eight hundred, then fell back
 * to abusing the free-text search with the id as the needle. A cast picked
 * from a large library routinely sat past that scan — three of one project's
 * four voices came back unresolved, and the audio panel printed
 * "elevenlabs · …oKomo" at the producer, from which no one can tell ZaTurk
 * from Roxana, let alone a man from a woman. That is the state in which a
 * Romanian male character was given Bella and nobody could see it.
 *
 * `GET /v1/voices/{id}` answers directly, so a miss now means the voice is
 * genuinely gone rather than merely far down a list.
 *
 * Gender rides along for the same reason as before: it is the one field that
 * makes a wrong pairing obvious at a glance, and the API already returns it.
 */
async function resolveNames(
  idList: string,
  key: string,
): Promise<Record<string, { name: string; gender: string | null }>> {
  const wanted = [...new Set(
    idList.split(",").map((s) => s.trim()).filter(Boolean),
  )].slice(0, 40);
  const names: Record<string, { name: string; gender: string | null }> = {};

  // Sequential and bounded by the cap above. A miss stays a miss rather than
  // failing the batch, because a truncated code is still better than no panel.
  for (const id of wanted) {
    const bare = id.startsWith(PREFIX) ? id.slice(PREFIX.length) : id.split("_").slice(1).join("_");
    if (!bare) continue;
    try {
      const res = await fetch(`${ELEVEN}/v1/voices/${encodeURIComponent(bare)}`, {
        headers: { "xi-api-key": key },
        next: { revalidate: 3600 },
      });
      if (!res.ok) continue;
      const v = (await res.json()) as Record<string, unknown>;
      const labels = (v.labels ?? {}) as Record<string, unknown>;
      if (typeof v.name === "string" && v.name) {
        names[id] = {
          name: v.name,
          gender: typeof labels.gender === "string" ? labels.gender : null,
        };
      }
    } catch {
      // Leave it unresolved; shortVoiceId still renders something.
    }
  }

  return names;
}
