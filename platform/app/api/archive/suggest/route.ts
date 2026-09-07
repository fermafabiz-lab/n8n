/**
 * The site's half of the archive-suggestion run.
 *
 * The producer's ask: when the scenes are approved, an AI should already have
 * looked for real footage for the scenes where it makes sense, and offer a
 * few options in a bar — leaving the rest to be generated. The MODEL half of
 * that lives in n8n (workflow `Archive Suggestions`, webhook
 * `archive-suggest`), because the OpenAI key lives there; this route is
 * everything else, in three calls the workflow makes in order:
 *
 *   GET  /api/archive/suggest?project=rec…
 *        → the scenes to look at (approved, still AI, no clip, not yet
 *          looked at), CLAIMED for ten minutes so overlapping runs do not
 *          double-spend, plus the film's name, language and brief.
 *   POST /api/archive/suggest  { stage: "search", scenes: [{id, queries}] }
 *        → runs the model's queries against the archives, files every hit
 *          in the library, answers up to 12 usable candidates per scene.
 *   POST /api/archive/suggest  { stage: "store", project, processed, scenes: [{id, picks}] }
 *        → writes the ranked picks and stamps every processed scene.
 *
 * Same key as every other n8n→site call. The browser cookie is accepted too,
 * so the stages can be exercised by hand.
 */

import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { searchArchives, type NormalizedArchiveAsset } from "@/lib/archive";
import {
  claimScenesForSuggestion,
  saveStockCandidates,
  storeArchiveSuggestions,
} from "@/lib/data/stock";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

const bad = (status: number, error: string) => NextResponse.json({ ok: false, error }, { status });
const REC = /^rec[0-9A-Za-z]{14}$/;

function authorized(req: NextRequest): boolean {
  const key = process.env.MEDIA_INGEST_KEY;
  if (key && req.headers.get("x-hov-key") === key) return true;
  const expected = process.env.SITE_PASSWORD;
  if (!expected) return true;
  return req.cookies.get("vf_auth")?.value === expected;
}

const usable = () => process.env.DATA_BACKEND === "postgres";

export async function GET(req: NextRequest) {
  if (!authorized(req)) return bad(401, "unauthorized");
  if (!usable()) return bad(503, "archive suggestions need the Postgres backend");
  const project = req.nextUrl.searchParams.get("project") ?? "";
  if (!REC.test(project)) return bad(400, "bad project");
  const out = await claimScenesForSuggestion(project);
  if (!out.project) return bad(404, "project not found");
  return NextResponse.json({ ok: true, ...out });
}

/** What the ranking model gets to read about a candidate. Short on purpose. */
function candidateOf(a: NormalizedArchiveAsset & { id: string }) {
  return {
    id: a.id,
    title: a.title.slice(0, 160),
    description: (a.description ?? "").slice(0, 240),
    mediaType: a.mediaType,
    durationSeconds: a.durationSeconds === null ? null : Math.round(a.durationSeconds),
    yearsMentioned: a.yearsMentioned.slice(0, 6),
    dateOriginal: a.dateOriginal,
    creator: a.creator ? a.creator.slice(0, 80) : null,
    license: a.licenseOriginal,
    reviewStatus: a.reviewStatus,
    categories: a.categories.slice(0, 5),
  };
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return bad(401, "unauthorized");
  if (!usable()) return bad(503, "archive suggestions need the Postgres backend");
  let body: {
    stage?: string;
    project?: string;
    processed?: unknown;
    scenes?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return bad(400, "body is not JSON");
  }

  if (body.stage === "search") {
    const scenes = Array.isArray(body.scenes) ? (body.scenes as Array<Record<string, unknown>>) : [];
    const out: Array<{ id: string; candidates: ReturnType<typeof candidateOf>[] }> = [];
    let requests = 0;
    for (const s of scenes) {
      const id = String(s.id ?? "");
      if (!REC.test(id)) continue;
      const queries = (Array.isArray(s.queries) ? s.queries : [])
        .map((q) => String(q ?? "").replace(/\s+/g, " ").trim())
        .filter((q) => q.length >= 2 && q.length <= 120)
        .slice(0, 2);
      const seen = new Map<string, NormalizedArchiveAsset & { id: string }>();
      for (const q of queries) {
        // A breath between requests: this loop can run a hundred queries for
        // one film, against an archive that asks clients to be polite.
        if (requests > 0) await new Promise((r) => setTimeout(r, 300));
        requests += 1;
        try {
          const { results } = await searchArchives(q, {
            mediaType: "any",
            limit: 6,
            signal: AbortSignal.timeout(25_000),
          });
          const filed = await saveStockCandidates(results, q);
          for (const a of results) {
            const row = filed.get(`${a.provider}:${a.providerAssetId}`);
            // Never offer what cannot be used: the licence said no.
            if (!row || a.reviewStatus === "rejected") continue;
            if (!seen.has(row.id)) seen.set(row.id, { ...a, id: row.id });
          }
        } catch (e) {
          console.warn(`archive suggest: search "${q}" failed — ${(e as Error).message}`);
        }
      }
      // Videos first — the producer asked for footage — then stills, each in
      // the archive's own relevance order.
      const list = [...seen.values()];
      const ordered = [...list.filter((a) => a.mediaType === "video"), ...list.filter((a) => a.mediaType === "image")];
      out.push({ id, candidates: ordered.slice(0, 12).map(candidateOf) });
    }
    return NextResponse.json({ ok: true, scenes: out, requests });
  }

  if (body.stage === "store") {
    const processed = (Array.isArray(body.processed) ? body.processed : [])
      .map((x) => String(x))
      .filter((x) => REC.test(x));
    const scenes = (Array.isArray(body.scenes) ? (body.scenes as Array<Record<string, unknown>>) : [])
      .filter((s) => REC.test(String(s.id ?? "")))
      .map((s) => ({
        id: String(s.id),
        picks: (Array.isArray(s.picks) ? (s.picks as Array<Record<string, unknown>>) : [])
          .filter((p) => REC.test(String(p.id ?? "")))
          .slice(0, 4)
          .map((p) => ({
            stockId: String(p.id),
            relevance: typeof p.relevance === "number" ? p.relevance : null,
            reason: typeof p.reason === "string" ? p.reason : null,
            query: typeof p.query === "string" ? p.query : null,
          })),
      }));
    const result = await storeArchiveSuggestions({ processed, scenes });
    const project = String(body.project ?? "");
    if (REC.test(project)) revalidatePath(`/projects/${project}`);
    return NextResponse.json({ ok: true, ...result });
  }

  return bad(400, "stage must be search or store");
}
