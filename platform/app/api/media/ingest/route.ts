/**
 * Takes a URL, keeps the bytes, and points a scene at them.
 *
 * This is the piece that replaces the only thing Airtable did that Postgres
 * cannot: **fetch**. fal and Flow hand back signed CDN links that die within
 * hours, and writing one into an Airtable attachment field made Airtable go
 * and download it, permanently. Every image and clip in the archive is alive
 * because of that. A database has no way to do it.
 *
 * n8n could have done the download itself — HTTP Request, write to disk,
 * insert a row — but that is three nodes of configuration per site, four times
 * over, with directory creation and content hashing expressed as node
 * parameters. One endpoint is less to get wrong, it can be tested, and it
 * reuses the media-store conventions the import already established.
 *
 * Called from inside the compose network as `http://web:3000/api/media/ingest`.
 * It is exempted from the site's password gate in middleware.ts — n8n has no
 * browser session — and authenticates with a shared secret instead.
 */

import { attachMedia } from "@/lib/data/postgres";
import { storeMediaBytes } from "@/lib/media-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const INGEST_KEY = process.env.MEDIA_INGEST_KEY;

const FIELDS = ["image", "video", "image_version"] as const;
type Field = (typeof FIELDS)[number];

const bad = (status: number, error: string) =>
  new Response(JSON.stringify({ ok: false, error }), {
    status,
    headers: { "Content-Type": "application/json" },
  });

export async function POST(req: Request) {
  // No key configured is a misconfiguration, not permission to skip the check:
  // this endpoint writes to disk and to the database.
  if (!INGEST_KEY) return bad(500, "MEDIA_INGEST_KEY is not set");
  if (req.headers.get("x-hov-key") !== INGEST_KEY) return bad(401, "bad key");

  let body: {
    sceneId?: string;
    field?: string;
    url?: string;
    fields?: Record<string, unknown>;
  };
  try {
    body = await req.json();
  } catch {
    return bad(400, "body is not JSON");
  }

  const { sceneId, url } = body;
  const field = body.field as Field;
  if (!sceneId || !/^rec[0-9A-Za-z]{14}$/.test(sceneId)) return bad(400, "bad sceneId");
  if (!FIELDS.includes(field)) return bad(400, `field must be one of ${FIELDS.join(", ")}`);
  if (!url || !/^https?:\/\//i.test(url)) return bad(400, "bad url");

  // Download first, write second, record third. An attachment row that names a
  // file which does not exist is worse than no row: the scene would render a
  // dead link and read as finished.
  let buf: Buffer;
  let contentType: string | null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
    if (!res.ok) return bad(502, `source answered HTTP ${res.status}`);
    buf = Buffer.from(await res.arrayBuffer());
    contentType = res.headers.get("content-type");
  } catch (e) {
    return bad(502, `download failed: ${(e as Error).message}`);
  }
  if (!buf.length) return bad(502, "source returned an empty body");

  // Content-addressed, exactly like the import: the same bytes always land at
  // the same path, so a retry overwrites nothing and Caddy's immutable cache
  // header stays true. The convention lives in lib/media-store.ts, shared
  // with the archive path that writes files of its own.
  let stored: Awaited<ReturnType<typeof storeMediaBytes>>;
  try {
    stored = await storeMediaBytes(sceneId, field, buf, { url, contentType });
  } catch (e) {
    return bad(500, `could not write the file: ${(e as Error).message}`);
  }
  const path = stored.path;

  let scene: Awaited<ReturnType<typeof attachMedia>>;
  try {
    scene = await attachMedia({
      sceneId,
      field,
      path,
      filename: stored.filename,
      contentType,
      sizeBytes: buf.length,
      sourceUrl: url,
      // The scene's other columns ride along in the same transaction, so a
      // scene never has a new image while still claiming to await the old one.
      fields: body.fields,
    });
  } catch (e) {
    return bad(500, `database write failed: ${(e as Error).message}`);
  }

  const base = (process.env.MEDIA_BASE_URL ?? "").replace(/\/+$/, "");
  // The scene is spread at the TOP level, not nested, so this is a drop-in for
  // the Airtable node it replaces: whatever follows reads $json.id and
  // $json.fields['…'] and never learns the difference. The ingest details ride
  // alongside for debugging.
  return Response.json({
    ...(scene ?? {}),
    ok: true,
    media: { path, url: `${base}/${path}`, bytes: buf.length },
  });
}
