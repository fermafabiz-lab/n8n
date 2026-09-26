/**
 * Who produces this film — asked by n8n's Master Orchestrator at the moment it
 * would call Media Generation (after the script on a new film, on Resume, and
 * after "⟳ Restart writing"):
 *
 *     POST http://web:3000/api/ops/produce
 *     {"projectId": "rec…", "Voice_ID": "…", "Aspect_Ratio": "16:9", "engine"?: "code" | "n8n"}
 *     with the `HOV Media Ingest` credential (header x-hov-key)
 *
 * Answers `{engine: "code"}` after queueing the film's production run on the
 * engine (hov.production_job, lib/production-engine.ts) — the orchestrator
 * then stops there — or `{engine: "n8n"}`, and the orchestrator calls Media
 * Generation exactly as before. So `PRODUCTION_ENGINE` on the site is the
 * whole switch, and its rollback (docs/plans/engine-media-generation.md,
 * phase 6).
 *
 * `engine: "code"` is still answered when the film already has a run: the
 * orchestrator must not start an n8n batch beside it.
 */

import { isRecordId } from "@/lib/playlists";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const reply = (status: number, body: { ok: boolean; engine?: "code" | "n8n"; message: string }) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

export async function POST(req: Request) {
  const key = process.env.MEDIA_INGEST_KEY;
  if (!key) return reply(500, { ok: false, message: "MEDIA_INGEST_KEY is not set" });
  if (req.headers.get("x-hov-key") !== key) return reply(401, { ok: false, message: "bad key" });

  let body: { projectId?: unknown; engine?: unknown; Voice_ID?: unknown; Aspect_Ratio?: unknown } | null;
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return reply(400, { ok: false, message: "body must be JSON: {\"projectId\": \"rec…\"}" });
  }
  const projectId = body?.projectId;
  if (!isRecordId(projectId)) {
    return reply(400, { ok: false, message: "projectId must be a record id (rec + 14 letters and digits)" });
  }
  const asked = body?.engine;
  if (asked !== undefined && asked !== "code" && asked !== "n8n") {
    return reply(400, { ok: false, message: "engine must be \"code\" or \"n8n\"" });
  }
  const { productionEngine, queueProduction } = await import("@/lib/production-engine");
  const engine = (asked as "code" | "n8n" | undefined) ?? productionEngine();
  if (engine === "n8n") return reply(200, { ok: true, engine, message: "n8n produces this film" });

  const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
  const r = await queueProduction(projectId, "orchestrator", { Voice_ID: str(body?.Voice_ID), Aspect_Ratio: str(body?.Aspect_Ratio) });
  return reply(200, { ok: r.ok, engine: "code", message: r.message });
}
