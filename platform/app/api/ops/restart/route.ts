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
 * new executions it starts, not by whether the reply arrived.
 *
 * SEVERAL FILMS GO IN ONE CALL, never one call each (2026-09-26):
 *
 *     {"projectIds": ["rec…", "rec…"]}
 *
 * Two calls in a row cannot work — the second call's Pause kills the run the
 * first call's Resume started, and its Resume refuses because the first
 * film's run is alive. `restartProductions` pauses once and resumes each.
 */

import { isRecordId } from "@/lib/playlists";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const reply = (status: number, body: { ok: boolean; message: string; results?: unknown }) =>
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

  let body: { projectId?: unknown; projectIds?: unknown } | null;
  try {
    body = (await req.json()) as { projectId?: unknown; projectIds?: unknown } | null;
  } catch {
    return reply(400, { ok: false, message: "body must be JSON: {\"projectId\": \"rec…\"} or {\"projectIds\": [\"rec…\"]}" });
  }
  const ids = Array.isArray(body?.projectIds) ? body.projectIds : [body?.projectId];
  if (ids.length === 0 || ids.length > 10 || !ids.every(isRecordId)) {
    return reply(400, { ok: false, message: "projectId / projectIds must be record ids (rec + 14 letters and digits), at most 10" });
  }

  // Loaded only past the lock, so a request without the key never touches
  // the action module (or n8n).
  const { restartProduction, restartProductions } = await import("@/app/actions");
  // 409, not 500: "already running" or "not configured" is a state of the
  // world the caller can read and act on, not a crash.
  if (ids.length === 1) {
    const r = await restartProduction(ids[0]);
    return reply(r.ok ? 200 : 409, { ok: r.ok, message: r.message });
  }
  const r = await restartProductions(ids);
  return reply(r.ok ? 200 : 409, { ok: r.ok, message: r.message, results: r.results });
}
