/**
 * The one-time copy of the Drive music library onto the box (db/019), driven
 * by an n8n throwaway that still holds the Drive credential:
 *
 *     POST http://web:3000/api/music/import   {"id": "<drive file id>", "name", "group", "url"}
 *     with the `HOV Media Ingest` credential (header x-hov-key)
 *
 * The site downloads `url` (Railway's /media?id= proxy, which streams a
 * shared Drive file), stores it and files it under the DRIVE id, so a film
 * that pins a track by that id finds it after the move. Re-runnable.
 */
import { storeTrack } from "@/lib/music";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const key = process.env.MEDIA_INGEST_KEY;
  if (!key) return Response.json({ ok: false, message: "MEDIA_INGEST_KEY is not set" }, { status: 500 });
  if (req.headers.get("x-hov-key") !== key) return Response.json({ ok: false, message: "bad key" }, { status: 401 });
  let b: { id?: unknown; name?: unknown; group?: unknown; url?: unknown };
  try {
    b = await req.json();
  } catch {
    return Response.json({ ok: false, message: "body must be JSON" }, { status: 400 });
  }
  const id = typeof b.id === "string" && /^[\w-]{10,100}$/.test(b.id) ? b.id : null;
  const url = typeof b.url === "string" && /^https?:\/\//.test(b.url) ? b.url : null;
  if (!id || !url || typeof b.name !== "string") return Response.json({ ok: false, message: "id, name and url are required" }, { status: 400 });
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
    if (!res.ok) throw new Error(`download answered ${res.status}`);
    const type = res.headers.get("content-type");
    if (type && /text\/html/.test(type)) throw new Error("download answered an HTML page, not audio");
    const track = await storeTrack({ id, name: b.name, group: String(b.group ?? ""), buf: Buffer.from(await res.arrayBuffer()), contentType: type, source: "drive" });
    return Response.json({ ok: true, track });
  } catch (e) {
    return Response.json({ ok: false, id, message: (e as Error).message }, { status: 502 });
  }
}
