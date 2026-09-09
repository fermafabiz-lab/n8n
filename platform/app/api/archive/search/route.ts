/**
 * Search the free archives for documentary footage.
 *
 *   GET /api/archive/search?q=Apollo+11+launch&type=video|image|any&limit=12
 *                          &providers=wikimedia,nasa&library=1
 *
 * Kept for callers written against it; the engine's own door is
 * /api/footage/search, which also takes a scene id and answers scored
 * best matches. This one delegates to the same engine through
 * `searchArchives()` and answers in the old shape.
 *
 * Two callers, two credentials. The producer's browser arrives with the site
 * cookie like every other page; n8n (a later slice — the scripting workflow
 * proposing archive shots per scene) arrives with the same `x-hov-key` it
 * already uses for /api/media/ingest and /api/at. middleware.ts lets the key
 * past the login redirect for this path; the check is repeated here so the
 * route is safe on its own.
 *
 * Every result is filed into hov.stock_media before it is returned, so the
 * library grows from searches — but filing is best-effort: a database hiccup
 * costs the `id` on each result, never the search itself.
 *
 * `library=1` answers from the library alone, without touching the archives:
 * what has already been seen, ranked by the library's own full-text index.
 */

import { NextRequest, NextResponse } from "next/server";
import { searchArchives, type ArchiveMediaType, type ArchiveProvider, ARCHIVE_PROVIDERS } from "@/lib/archive";
import { saveStockCandidates, searchStockLibrary } from "@/lib/data/stock";
import { isConfigured as pgConfigured } from "@/lib/data/postgres";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bad = (status: number, error: string) => NextResponse.json({ ok: false, error }, { status });

function authorized(req: NextRequest): boolean {
  const key = process.env.MEDIA_INGEST_KEY;
  if (key && req.headers.get("x-hov-key") === key) return true;
  const expected = process.env.SITE_PASSWORD;
  if (!expected) return true;
  return req.cookies.get("vf_auth")?.value === expected;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return bad(401, "unauthorized");

  const p = req.nextUrl.searchParams;
  const q = (p.get("q") ?? "").trim().replace(/\s+/g, " ");
  if (q.length < 2) return bad(400, "q must be at least 2 characters");
  if (q.length > 200) return bad(400, "q is too long");

  const typeRaw = p.get("type") ?? "any";
  const mediaType: ArchiveMediaType | "any" =
    typeRaw === "video" || typeRaw === "image" ? typeRaw : "any";
  const limit = Math.min(Math.max(Number(p.get("limit")) || 12, 1), 40);
  const providers = (p.get("providers") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is ArchiveProvider => (ARCHIVE_PROVIDERS as readonly string[]).includes(s));

  const useLibrary = p.get("library") === "1";
  const usePg = pgConfigured && process.env.DATA_BACKEND === "postgres";

  if (useLibrary) {
    if (!usePg) return bad(503, "the archive library needs the Postgres backend");
    const results = await searchStockLibrary(q, { mediaType, limit });
    return NextResponse.json({ ok: true, query: q, source: "library", results, providers: [] });
  }

  const { results, providers: report } = await searchArchives(q, {
    mediaType,
    limit,
    providers: providers.length ? providers : undefined,
    signal: AbortSignal.timeout(20_000),
  });

  // File them. Best-effort on purpose — see the header.
  let filed = new Map<string, { id: string; status: string; timesFound: number }>();
  let filingError: string | null = null;
  if (usePg && results.length) {
    try {
      filed = await saveStockCandidates(results, q);
    } catch (e) {
      filingError = (e as Error).message;
      console.warn(`archive search: could not file ${results.length} results — ${filingError}`);
    }
  }

  return NextResponse.json({
    ok: true,
    query: q,
    source: "archives",
    results: results.map((a) => {
      const row = filed.get(`${a.provider}:${a.providerAssetId}`);
      return {
        id: row?.id ?? null,
        status: row?.status ?? null,
        timesFound: row?.timesFound ?? null,
        ...a,
      };
    }),
    providers: report,
    ...(filingError ? { filingError } : {}),
  });
}
