import { NextRequest, NextResponse } from "next/server";

// Proxies the ai33.pro voice library so the browser never sees the API key.
// GET /api/voices?provider=elevenlabs&q=warm&page=1
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

  const url = new URL("https://api.ai33.pro/v3/voices");
  url.searchParams.set("provider", provider);
  url.searchParams.set("page", page);
  url.searchParams.set("page_size", "24");
  if (q) url.searchParams.set("q", q);

  const res = await fetch(url, {
    headers: { "xi-api-key": key },
    next: { revalidate: 3600 },
  });
  if (!res.ok) {
    return NextResponse.json(
      { error: `ai33 API: HTTP ${res.status}` },
      { status: 502 },
    );
  }
  const data = (await res.json()) as {
    data?: Array<Record<string, unknown>>;
    pagination?: { has_more?: boolean };
  };
  const voices = (data.data ?? []).map((v) => ({
    voice_id: v.voice_id,
    name: v.name,
    gender: v.gender ?? null,
    language: v.language ?? null,
    accent: v.accent ?? null,
    description: typeof v.description === "string" ? v.description.slice(0, 140) : null,
    preview_url: v.preview_url ?? null,
  }));
  return NextResponse.json({ voices, has_more: Boolean(data.pagination?.has_more) });
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
