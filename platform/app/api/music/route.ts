// The music library, readable by the site (lib/music.ts, db/019).
//
// GET  -> { tracks: [{id, name, group, url}] }
// POST { id } -> { url }
//
// It lived in n8n ("Music Library", webhooks list-music / share-music)
// because the Google Drive credential lives there. Since 2026-09-26 the
// library is on the box: listing is one query and every track already has a
// public URL, so there is nothing to share any more — POST is kept so an
// older open tab keeps working.
import { listTracks, trackUrl } from "@/lib/music";
import { MusicShareBody } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ tracks: await listTracks() });
}

export async function POST(req: Request) {
  // Soft-fail on purpose: a bad body answers {url:null}, never a 400.
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {}
  const parsed = MusicShareBody.safeParse(raw);
  if (!parsed.success) return Response.json({ url: null, error: "bad id" });
  return Response.json({ url: await trackUrl(parsed.data.id) });
}
