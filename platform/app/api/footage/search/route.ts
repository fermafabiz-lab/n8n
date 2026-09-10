/**
 * Search for real footage — by what a scene NEEDS, not by where it lives.
 *
 *   GET  /api/footage/search?q=Ceuta+migrants&type=video|image|any
 *                            &providers=eu_av,wikimedia&scene=rec…&limit=12
 *   POST /api/footage/search  { request: FootageSearchRequest, providers?, top?, localOnly? }
 *
 * The GET is the picker's free-text search; the POST is the structured one
 * the suggestion run and any future caller use. Both answer BEST MATCHES —
 * every provider's results ranked together, each with its score, its rights
 * class and its provenance for THIS request — plus a per-provider report so
 * the screen can say which archive was asked, which answered, and which was
 * held back.
 *
 * Two callers, two credentials (see lib/footage/auth.ts).
 */

import { NextRequest, NextResponse } from "next/server";
import { footageAuthorized, footageUsable } from "@/lib/footage/auth";
import { requestFromQuery } from "@/lib/archive";
import { buildFootageRequest, searchFootage, type FootageSearchRequest } from "@/lib/footage";
import { providerFilterOptions } from "@/lib/footage/registry";
import { getSceneForFootage } from "@/lib/data/stock";
import type { ArchiveProvider } from "@/lib/archive/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const bad = (status: number, error: string) => NextResponse.json({ ok: false, error }, { status });
const REC = /^rec[0-9A-Za-z]{14}$/;

function providerList(raw: string | null | undefined): ArchiveProvider[] | undefined {
  const known = new Set(providerFilterOptions().map((p) => p.id));
  const list = String(raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => known.has(s));
  return list.length ? list : undefined;
}

function serialize(r: Awaited<ReturnType<typeof searchFootage>>, request: FootageSearchRequest) {
  return {
    ok: true,
    request,
    source: r.source,
    queries: r.queries,
    ms: r.ms,
    results: r.candidates.map((c) => ({
      ...c.asset,
      score: c.score,
      reasons: c.reasons,
      usage: c.rights.status,
      usageReason: c.rights.reason ?? null,
      attribution: c.rights.attribution ?? null,
      matchProvenance: c.provenance,
      matchConfidence: c.provenanceConfidence,
    })),
    providers: r.providers,
  };
}

export async function GET(req: NextRequest) {
  if (!footageAuthorized(req)) return bad(401, "unauthorized");
  if (!footageUsable()) return bad(503, "the footage engine needs the Postgres backend");
  const p = req.nextUrl.searchParams;
  const q = (p.get("q") ?? "").trim().replace(/\s+/g, " ");
  const sceneId = p.get("scene") ?? "";
  if (q.length < 2 && !REC.test(sceneId)) return bad(400, "q must be at least 2 characters (or pass scene=)");
  if (q.length > 200) return bad(400, "q is too long");
  const typeRaw = p.get("type") ?? "any";
  const mediaType = typeRaw === "image" ? "image" : "video";
  const limit = Math.min(Math.max(Number(p.get("limit")) || 12, 1), 40);

  // A scene id turns the free text into a request WITH the scene's own
  // context — its narration and visual note — so the ranker has something
  // to match against beyond the words typed.
  let request: FootageSearchRequest;
  if (REC.test(sceneId)) {
    const scene = await getSceneForFootage(sceneId);
    if (!scene) return bad(404, "scene not found");
    request = buildFootageRequest({
      id: scene.id,
      narration: scene.narration,
      visual: scene.visual,
      preferredMediaType: mediaType,
      queries: q.length >= 2 ? [q] : undefined,
    });
    if (q.length >= 2) request.keywords = [...new Set([...q.split(" ").filter((w) => w.length >= 3), ...request.keywords])].slice(0, 12);
  } else {
    request = requestFromQuery(q, typeRaw === "image" ? "image" : typeRaw === "video" ? "video" : "any");
  }

  const r = await searchFootage(request, {
    providers: providerList(p.get("providers")),
    limit,
    top: Math.max(limit, 12),
    localOnly: p.get("library") === "1",
    forceProviders: p.get("fresh") === "1" || q.length >= 2,
    signal: AbortSignal.timeout(60_000),
  });
  const out = serialize(r, request);
  if (typeRaw === "video" || typeRaw === "image") out.results = out.results.filter((a) => a.mediaType === typeRaw);
  return NextResponse.json(out);
}

export async function POST(req: NextRequest) {
  if (!footageAuthorized(req)) return bad(401, "unauthorized");
  if (!footageUsable()) return bad(503, "the footage engine needs the Postgres backend");
  let body: { request?: Partial<FootageSearchRequest>; providers?: string; top?: number; localOnly?: boolean; fresh?: boolean };
  try {
    body = await req.json();
  } catch {
    return bad(400, "body is not JSON");
  }
  const raw = body.request ?? {};
  if (!raw.narration && !(raw.keywords?.length) && !(raw.queries?.length)) return bad(400, "request needs narration, keywords or queries");
  const request = buildFootageRequest({
    id: String(raw.sceneId ?? "adhoc"),
    narration: String(raw.narration ?? ""),
    queries: raw.queries,
    topic: raw.topic,
    event: raw.event,
    location: raw.location,
    country: raw.country,
    dateFrom: raw.dateFrom,
    dateTo: raw.dateTo,
    people: raw.people,
    organizations: raw.organizations,
    keywords: raw.keywords,
    preferredMediaType: raw.preferredMediaType,
    preferredFootageType: raw.preferredFootageType,
    requireExactEvent: raw.requireExactEvent,
  });
  const r = await searchFootage(request, {
    providers: providerList(body.providers),
    top: Math.min(Math.max(Number(body.top) || 12, 1), 40),
    localOnly: body.localOnly === true,
    forceProviders: body.fresh === true,
    signal: AbortSignal.timeout(90_000),
  });
  return NextResponse.json(serialize(r, request));
}
