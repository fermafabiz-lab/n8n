/**
 * Start one film's final render without a browser — the SAME
 * `startAssembly` the render button runs, on the engine the caller names.
 *
 *     POST http://web:3000/api/ops/assemble   {"projectId": "rec…", "engine": "code" | "n8n"}
 *     with the `HOV Media Ingest` credential (header x-hov-key)
 *
 * Why it exists (2026-09-24, docs/plans/engine-final-assembly.md phase 4):
 * the first real film on the new render engine has to be started without
 * switching every film over (FINAL_ASSEMBLY_ENGINE stays `n8n`), and a
 * session has no browser. It is also where the `upscale-film` workflow is
 * meant to be repointed in phase 5. `engine` absent means "whatever the
 * button would choose" (lib/assembly-engine.ts, engineFor).
 *
 * It starts a render and nothing else: it does not write the project's
 * status, exactly like Restart render. Same lock as /api/ops/restart — the
 * shared key n8n already holds, checked in middleware.ts (the door) and
 * again here (the lock).
 */

import { isRecordId } from "@/lib/playlists";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const reply = (status: number, body: { ok: boolean; message: string }) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

export async function POST(req: Request) {
  const key = process.env.MEDIA_INGEST_KEY;
  if (!key) return reply(500, { ok: false, message: "MEDIA_INGEST_KEY is not set" });
  if (req.headers.get("x-hov-key") !== key) return reply(401, { ok: false, message: "bad key" });

  let body: { projectId?: unknown; engine?: unknown } | null;
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return reply(400, { ok: false, message: "body must be JSON: {\"projectId\": \"rec…\", \"engine\": \"code\"}" });
  }
  const projectId = body?.projectId;
  if (!isRecordId(projectId)) {
    return reply(400, { ok: false, message: "projectId must be a record id (rec + 14 letters and digits)" });
  }
  const engine = body?.engine;
  if (engine !== undefined && engine !== "code" && engine !== "n8n") {
    return reply(400, { ok: false, message: "engine must be \"code\" or \"n8n\"" });
  }

  const { startAssembly } = await import("@/app/actions");
  const r = await startAssembly(projectId, engine, "ops");
  return reply(r.ok ? 200 : 409, { ok: r.ok, message: r.message });
}
