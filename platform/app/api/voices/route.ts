import { NextRequest, NextResponse } from "next/server";
import {
  languageByCode,
  narrowsUsefully,
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
 * Two earlier attempts got this wrong in the same way — by searching a set
 * that did not contain the answer. The first scanned pages of metadata and
 * surfaced two Romanian voices on a library holding thousands. The second, the
 * ElevenLabs migration, pointed the whole thing at `/v2/voices`, which is the
 * ACCOUNT's own voices: 21 English premades, so the count went to zero and the
 * filter silently gave up and showed everything.
 *
 * The library has a language filter of its own. Use it — see `fetchShared`.
 */
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
   * One page of the ACCOUNT's own voices. Cursor-based: `next_page_token`
   * rather than a number, which is why `listPage` carries the token instead
   * of counting. This set is small and entirely English — it is the familiar
   * default list, never the place to look for a language.
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

  /**
   * The SHARED voice library — what a person means by "the ElevenLabs voices",
   * and the endpoint the language filter HAS to use.
   *
   * Reading the wrong one is exactly what broke this feature. `/v2/voices`
   * lists only the ACCOUNT's own voices: here that is 21 English premades and
   * nothing else — measured against the live API, `has_more: false` and every
   * single label `en`. No search and no scan over that set can ever surface a
   * Romanian voice, so the filter below always fell through to "nothing
   * mentions Romanian, so every voice is shown", with those same 21 English
   * voices underneath it. The producer read that, correctly, as the language
   * selector not working.
   *
   * `/v1/shared-voices` takes `language` as an ISO code NATIVELY, so upstream
   * does the narrowing and the old scan-and-merge guesswork is not needed for
   * it at all. Verified live: `language=ro` returns Mihai (transylvanian),
   * Cornel, Roxana, Razvan — 4811 in total.
   *
   * Its rows are FLAT where `/v2/voices` nests under `labels`, which `shape()`
   * already tolerates: it reads `labels[k] ?? v[k]`.
   *
   * A shared voice is directly usable — no "add to library" step. Verified by
   * synthesizing a Romanian line with one: HTTP 200, audio/mpeg, billed. That
   * check mattered, because offering a voice the pipeline then cannot speak
   * would fail at the take rather than at the click.
   */
  const fetchShared = async (opts: {
    language?: string;
    search?: string;
    size: number;
  }) => {
    const url = new URL(`${ELEVEN}/v1/shared-voices`);
    url.searchParams.set("page_size", String(Math.min(100, opts.size)));
    if (opts.language) url.searchParams.set("language", opts.language);
    if (opts.search) url.searchParams.set("search", opts.search);
    const res = await fetch(url, {
      headers: { "xi-api-key": key },
      next: { revalidate: 3600 },
    });
    if (!res.ok) throw new Error(`ElevenLabs library: HTTP ${res.status}`);
    const data = (await res.json()) as {
      voices?: Array<Record<string, unknown>>;
      has_more?: boolean;
    };
    return {
      voices: (data.voices ?? []).map(shape),
      has_more: Boolean(data.has_more),
    };
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
      // The library, narrowed upstream on the ISO code it thinks in. The
      // producer's own words go up as `search` in the same request rather than
      // being applied afterwards — filtering locally would only ever search
      // the 100 rows that happened to come back.
      const lib = await fetchShared({ language: lang.code, search: q, size: PAGE });

      // Upstream's filter is FUZZY, and that is measured rather than assumed:
      // `language=ro` came back 68 Romanian out of 100, and `language=ro` plus
      // `search=warm` only 33 — a multilingual voice labelled `en` is offered
      // for `ro` because it is verified to read it. Good enough as a SET,
      // wrong as an ORDER, so the same two metadata tests the pre-migration
      // version used still rank the result: labelled with the language first,
      // merely mentioning it second, nothing thrown away. That also keeps the
      // picker's "N labelled with the language, the rest matched by name or
      // description" line true, which a blanket `confirmed = count` would have
      // quietly turned into a lie.
      const confirmed: VoiceRow[] = [];
      const likely: VoiceRow[] = [];
      const seen = new Set<string>();
      for (const v of lib.voices) {
        if (!v.voice_id || seen.has(v.voice_id)) continue;
        seen.add(v.voice_id);
        if (voiceMatchesLanguage(v, lang)) confirmed.push(v);
        else if (voiceMentionsLanguage(v, lang)) likely.push(v);
      }

      const voices = [...confirmed, ...likely].slice(0, MAX_RESULTS);
      if (voices.length > 0) {
        return NextResponse.json({
          voices,
          has_more: lib.has_more,
          language: {
            applied: true,
            code: lang.code,
            label: lang.name,
            confirmed: confirmed.length,
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

  /**
   * Keep a voice unless it NAMES a different language.
   *
   * The baseline list is the account's own voices, and that set is not static:
   * using a shared voice COPIES it into the account, so every language the
   * pipeline has ever spoken accumulates there. One Romanian film puts its
   * narrator into the English picker of every film after it — seen the moment
   * a Romanian voice was auditioned, which added Mihai to a list of 21 English
   * premades and sorted him to the top.
   *
   * Only an EXPLICIT mismatch is dropped. An unlabelled voice stays, which is
   * the safe direction and the whole reason a baseline language was never
   * narrowed on metadata: most of a library does not say what it speaks, and
   * dropping the silent ones costs far more than it saves. Here the rows do
   * say — the premades are all `en` and a copied voice carries its real
   * label — so this removes exactly the intruders and nothing else.
   *
   * `asked` rather than `lang`: `lang` is null for a baseline language by
   * design, and null is also what "show me every language" sends. Those two
   * must not behave the same, and only `asked` tells them apart.
   */
  const sameLanguage = (v: VoiceRow) =>
    !asked || !v.language || voiceMatchesLanguage(v, asked);

  try {
    const own = await listPage(Number(page) || 1, 24, q);
    const mine = own.voices.filter(sameLanguage);
    // A SEARCH has to reach the library, not just the account's own voices.
    // Under ai33 typing "romanian" found Romanian voices; against the 21
    // premades alone it finds nothing at all. Own voices stay first because
    // they are the familiar default list this baseline case exists to show —
    // and the historical default narrator is among them.
    if (q) {
      const lib = await fetchShared({ search: q, size: PAGE }).catch(() => null);
      if (lib) {
        const seen = new Set(mine.map((v) => v.voice_id));
        const extra = lib.voices.filter((v) => !seen.has(v.voice_id) && sameLanguage(v));
        if (extra.length > 0) {
          return NextResponse.json({
            voices: [...mine, ...extra].slice(0, MAX_RESULTS),
            has_more: false,
          });
        }
      }
    }
    return NextResponse.json({ ...own, voices: mine });
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
