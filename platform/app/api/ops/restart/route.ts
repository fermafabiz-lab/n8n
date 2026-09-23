/**
 * Restart one film's production without a browser — the SAME
 * `restartProduction` the ⟳ Restart button runs, nothing more.
 *
 * Why it exists (2026-09-23): the producer asked a Claude session, twice, to
 * "restart the projects that are being worked on" after a deploy, and a
 * session could not. Stopping an n8n execution needs the n8n public API key,
 * which only this site holds; the n8n MCP connector has no stop tool and
 * n8n keeps no API credential of its own. So the restart has to be the
 * site's — and this is the door to it for anything that is not a browser: a
 * throwaway n8n workflow, from inside the compose network, as
 *
 *     POST http://web:3000/api/ops/restart   {"projectId": "rec…"}
 *     with the `HOV Media Ingest` credential (header x-hov-key)
 *
 * Same shared secret as /api/media/ingest and /api/at — n8n already holds it
 * and can already write the whole database, so this hands it nothing new.
 * Exempted from the password gate in middleware.ts only when the key is
 * right (the door); checked again here (the lock).
 *
 * What the caller should know, because the button does it too: Pause stops
 * EVERY running execution on the instance except a single scene's re-shoot
 * — including the caller's own, if it is still waiting for this answer. The
 * restart finishes regardless (it runs here, not there), so judge it by the
 * new executions it starts, not by whether the reply arrived. And Resume
 * refuses while anything is alive, so this restarts ONE film per call: the
 * site has never run two films' production at once from its buttons either.
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
  // Read per request, as middleware.ts does, rather than frozen at load.
  const key = process.env.MEDIA_INGEST_KEY;
  // No key configured is a misconfiguration, not permission to skip the
  // check: this stops and starts production.
  if (!key) return reply(500, { ok: false, message: "MEDIA_INGEST_KEY is not set" });
  if (req.headers.get("x-hov-key") !== key) return reply(401, { ok: false, message: "bad key" });

  let projectId: unknown;
  try {
    projectId = ((await req.json()) as { projectId?: unknown } | null)?.projectId;
  } catch {
    return reply(400, { ok: false, message: "body must be JSON: {\"projectId\": \"rec…\"}" });
  }
  if (!isRecordId(projectId)) {
    return reply(400, { ok: false, message: "projectId must be a record id (rec + 14 letters and digits)" });
  }

  // Loaded only past the lock, so a request without the key never touches
  // the action module (or n8n).
  const { restartProduction } = await import("@/app/actions");
  const r = await restartProduction(projectId);
  // 409, not 500: "already running" or "not configured" is a state of the
  // world the caller can read and act on, not a crash.
  return reply(r.ok ? 200 : 409, { ok: r.ok, message: r.message });
}
