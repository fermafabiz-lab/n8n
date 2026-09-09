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
 *   POST /api/archive/suggest  { stage: "search", scenes: [{id, request | queries}] }
 *        → runs each scene's request through the Universal Footage Engine
 *          (library first, then the routed providers), files every hit, and
 *          answers up to 12 candidates per scene ranked best first with the
 *          engine's own score and provenance — the model then only has to
 *          judge relevance, not rediscover it.
 *   POST /api/archive/suggest  { stage: "store", project, processed, scenes: [{id, picks}] }
 *        → writes the ranked picks and stamps every processed scene.
 *
 * The search stage accepts both shapes the workflow has sent: the original
 * `queries: []` (turned into a request from the scene's own text) and the
 * structured `request: {…}` the current prompt produces.
 *
 * Same key as every other n8n→site call. The browser cookie is accepted too,
 * so the stages can be exercised by hand.
 */

import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { buildFootageRequest, searchFootage, usableAutomatically, type RankedFootage } from "@/lib/footage";
import { footageAuthorized, footageUsable } from "@/lib/footage/auth";
import { claimScenesForSuggestion, getSceneForFootage, storeArchiveSuggestions } from "@/lib/data/stock";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

const bad = (status: number, error: string) => NextResponse.json({ ok: false, error }, { status });
const REC = /^rec[0-9A-Za-z]{14}$/;

export async function GET(req: NextRequest) {
  if (!footageAuthorized(req)) return bad(401, "unauthorized");
  if (!footageUsable()) return bad(503, "archive suggestions need the Postgres backend");
  const project = req.nextUrl.searchParams.get("project") ?? "";
  if (!REC.test(project)) return bad(400, "bad project");
  const out = await claimScenesForSuggestion(project);
  if (!out.project) return bad(404, "project not found");
  return NextResponse.json({ ok: true, ...out });
}

/** What the ranking model gets to read about a candidate. Short on purpose. */
function candidateOf(c: RankedFootage & { asset: { id: string } }) {
  const a = c.asset;
  return {
    id: a.id,
    provider: a.provider,
    title: a.title.slice(0, 160),
    description: (a.description ?? "").slice(0, 240),
    mediaType: a.mediaType,
    footageFormat: a.footageFormat ?? "unknown",
    durationSeconds: a.durationSeconds === null ? null : Math.round(a.durationSeconds),
    yearsMentioned: a.yearsMentioned.slice(0, 6),
    filmingDate: a.filmingDate ?? null,
    dateOriginal: a.dateOriginal,
    location: a.location ?? null,
    eventName: a.eventName ?? null,
    creator: a.creator ? a.creator.slice(0, 80) : null,
    license: a.licenseOriginal,
    usage: c.rights.status,
    score: c.score,
    provenance: c.provenance,
    categories: a.categories.slice(0, 5),
  };
}

export async function POST(req: NextRequest) {
  if (!footageAuthorized(req)) return bad(401, "unauthorized");
  if (!footageUsable()) return bad(503, "archive suggestions need the Postgres backend");
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
    const out: Array<{ id: string; candidates: ReturnType<typeof candidateOf>[]; source: string; providers: string[] }> = [];
    let requests = 0;
    for (const s of scenes) {
      const id = String(s.id ?? "");
      if (!REC.test(id)) continue;
      const queries = (Array.isArray(s.queries) ? s.queries : [])
        .map((q) => String(q ?? "").replace(/\s+/g, " ").trim())
        .filter((q) => q.length >= 2 && q.length <= 120)
        .slice(0, 4);
      const structured = (s.request && typeof s.request === "object" ? s.request : {}) as Record<string, unknown>;
      const scene = await getSceneForFootage(id).catch(() => null);
      const request = buildFootageRequest({
        id,
        narration: String(structured.narration ?? scene?.narration ?? ""),
        visual: scene?.visual ?? null,
        queries,
        topic: structured.topic as string | undefined,
        event: structured.event as string | undefined,
        location: structured.location as string | undefined,
        country: structured.country as string | undefined,
        dateFrom: structured.dateFrom as string | undefined,
        dateTo: structured.dateTo as string | undefined,
        people: structured.people as string[] | undefined,
        organizations: structured.organizations as string[] | undefined,
        keywords: structured.keywords as string[] | undefined,
        preferredMediaType: structured.preferredMediaType === "image" ? "image" : "video",
        preferredFootageType: structured.preferredFootageType as never,
        requireExactEvent: structured.requireExactEvent === true,
      });
      // A breath between scenes: a ninety-scene film is a few hundred
      // provider calls, against archives that ask clients to be polite.
      if (requests > 0) await new Promise((r) => setTimeout(r, 300));
      requests += 1;
      try {
        const r = await searchFootage(request, { limit: 6, top: 12, signal: AbortSignal.timeout(60_000) });
        // Never offer what a run could not place on its own: an automatic
        // path may not pass a review class, so those wait for the picker.
        const usable = r.candidates.filter(
          (c): c is RankedFootage & { asset: { id: string } } =>
            Boolean(c.asset.id) && (usableAutomatically(c.rights) || c.asset.status === "approved" || c.asset.status === "used"),
        );
        out.push({
          id,
          candidates: usable.slice(0, 12).map(candidateOf),
          source: r.source,
          providers: r.providers.filter((p) => p.routed && !p.reason).map((p) => p.provider),
        });
      } catch (e) {
        console.warn(`archive suggest: scene ${id} failed — ${(e as Error).message}`);
        out.push({ id, candidates: [], source: "error", providers: [] });
      }
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
