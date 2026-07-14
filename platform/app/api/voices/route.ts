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
