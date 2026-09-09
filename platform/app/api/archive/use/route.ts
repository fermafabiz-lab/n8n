/**
 * Put an archive asset on a scene — the HTTP twin of the `useArchiveAsset`
 * server action, for callers without a browser.
 *
 *   POST /api/archive/use   { sceneId, stockId, offsetSeconds?, seconds? }
 *
 * Two reasons it exists beside the action. Scripting will one day propose an
 * archive shot per scene and want to place it from inside n8n, which cannot
 * call a server action. And the ffmpeg recipes in lib/archive/attach.ts can
 * only be exercised on the box that has ffmpeg — which a Claude Code session
 * reaches solely through an n8n HTTP node pointed at `web:3000`. Same key as
 * /api/media/ingest; the browser cookie is accepted too.
 */

import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { attachArchiveAsset, DEFAULT_SECONDS } from "@/lib/archive/attach";
import { getSceneCanvas } from "@/lib/data/stock";
import { saveVersionOfScene } from "@/lib/data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Cutting a segment from a remote reel can take a while; the default would
// cut the request off under the ffmpeg.
export const maxDuration = 300;

const bad = (status: number, error: string) => NextResponse.json({ ok: false, error }, { status });

function authorized(req: NextRequest): boolean {
  const key = process.env.MEDIA_INGEST_KEY;
  if (key && req.headers.get("x-hov-key") === key) return true;
  const expected = process.env.SITE_PASSWORD;
  if (!expected) return true;
  return req.cookies.get("vf_auth")?.value === expected;
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return bad(401, "unauthorized");
  if (process.env.DATA_BACKEND !== "postgres") return bad(503, "archive footage needs the Postgres backend");

  let body: { sceneId?: string; stockId?: string; offsetSeconds?: unknown; seconds?: unknown };
  try {
    body = await req.json();
  } catch {
    return bad(400, "body is not JSON");
  }
  const { sceneId, stockId } = body;
  if (!sceneId || !/^rec[0-9A-Za-z]{14}$/.test(sceneId)) return bad(400, "bad sceneId");
  if (!stockId || !/^rec[0-9A-Za-z]{14}$/.test(stockId)) return bad(400, "bad stockId");

  const canvas = await getSceneCanvas(sceneId);
  if (!canvas) return bad(404, "scene not found");

  // Same courtesy as every replacing path: the outgoing assets are filed as
  // drafts first, and a failure to file must not block the replacement.
  await saveVersionOfScene(sceneId, "image", { auto: true }).catch(() => {});
  await saveVersionOfScene(sceneId, "video", { auto: true }).catch(() => {});

  const started = Date.now();
  try {
    const r = await attachArchiveAsset({
      sceneId,
      stockId,
      portrait: canvas.portrait,
      offsetSeconds: Number(body.offsetSeconds) || 0,
      seconds: Number(body.seconds) || DEFAULT_SECONDS,
      sceneOrder: canvas.order,
    });
    revalidatePath(`/projects/${canvas.projectId}`);
    return NextResponse.json({ ok: true, projectId: canvas.projectId, ms: Date.now() - started, ...r });
  } catch (e) {
    return bad(500, (e as Error).message);
  }
}
