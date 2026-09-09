// The Muzica folder, readable by the site.
//
// GET  -> { tracks: [{id, name, group}] }   (n8n webhook `list-music`)
// POST { id } -> { url }                     (n8n webhook `share-music`)
//
// Both live in n8n (workflow "Music Library") because that is where the
// Google Drive credential lives — same shape as expand-brief and
// yt-scene-titles. The share step makes the file link-readable (idempotent)
// and answers its uc?export=download URL, which `mediaSrc()` then routes
// through /api/media so the browser can actually play it: Drive's direct
// links answer redirects/HTML without a session.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The library changes when someone drops a file in Drive, i.e. rarely, and
// listing it costs three Drive calls — cache for ten minutes per instance.
let cached: { at: number; tracks: unknown[] } | null = null;
const CACHE_MS = 10 * 60 * 1000;

function webhookFor(name: string): string | null {
  const newProject = process.env.N8N_NEW_PROJECT_WEBHOOK_URL;
  const url = newProject?.replace(/new-project\/?$/, name);
  return url?.includes(name) ? url : null;
}

export async function GET() {
  if (cached && Date.now() - cached.at < CACHE_MS) {
    return Response.json({ tracks: cached.tracks });
  }
  const webhook = webhookFor("list-music");
  if (!webhook) return Response.json({ tracks: [], error: "n8n not configured" });
  try {
    const res = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(30_000),
      cache: "no-store",
    });
    const out = (await res.json()) as { tracks?: unknown };
    const tracks = Array.isArray(out.tracks)
      ? out.tracks.filter(
          (t): t is { id: string; name: string; group: string } =>
            !!t && typeof t === "object" &&
            typeof (t as { id?: unknown }).id === "string" &&
            typeof (t as { name?: unknown }).name === "string",
        )
      : [];
    if (tracks.length) cached = { at: Date.now(), tracks };
    return Response.json({ tracks });
  } catch {
    return Response.json({ tracks: [], error: "unreachable" });
  }
}

export async function POST(req: Request) {
  const webhook = webhookFor("share-music");
  if (!webhook) return Response.json({ url: null, error: "n8n not configured" });
  let id = "";
  try {
    const body = (await req.json()) as { id?: unknown };
    id = typeof body.id === "string" ? body.id.trim() : "";
  } catch {}
  if (!id || /[\s"'<>]/.test(id)) return Response.json({ url: null, error: "bad id" });
  try {
    const res = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
      signal: AbortSignal.timeout(30_000),
      cache: "no-store",
    });
    const out = (await res.json()) as { url?: unknown };
    const url = typeof out.url === "string" && out.url.startsWith("http") ? out.url : null;
    return Response.json({ url });
  } catch {
    return Response.json({ url: null, error: "unreachable" });
  }
}
