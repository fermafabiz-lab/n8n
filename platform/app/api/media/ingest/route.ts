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

import { createHash } from "node:crypto";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { attachMedia } from "@/lib/data/postgres";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MEDIA_ROOT = process.env.MEDIA_ROOT || "/media";
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
  // header stays true.
  const hash = createHash("sha256").update(buf).digest("hex").slice(0, 32);
  const ext = extensionFor(url, contentType);
  const path = `${sceneId}/${field}/${hash}.${ext}`;
  const abs = join(MEDIA_ROOT, path);

  try {
    let exists = false;
    try {
      exists = (await stat(abs)).size === buf.length;
    } catch {
      /* not there yet */
    }
    if (!exists) {
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, buf);
    }
  } catch (e) {
    return bad(500, `could not write ${path}: ${(e as Error).message}`);
  }

  let scene: Awaited<ReturnType<typeof attachMedia>>;
  try {
    scene = await attachMedia({
      sceneId,
      field,
      path,
      filename: filenameFor(url, hash, ext),
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

/** Extension from the URL's own filename, falling back to the MIME type. */
function extensionFor(url: string, contentType: string | null): string {
  const fromUrl = new URL(url).pathname.split("/").pop() ?? "";
  if (fromUrl.includes(".")) {
    const e = fromUrl.split(".").pop()!.toLowerCase();
    if (/^[a-z0-9]{2,5}$/.test(e)) return e;
  }
  const mime = (contentType ?? "").split(";")[0].trim().split("/").pop() ?? "";
  return (mime.replace("jpeg", "jpg") || "bin").toLowerCase();
}

/**
 * A human-readable name for the file.
 *
 * It matters more than it looks: saved image drafts are matched to their
 * metadata BY FILENAME (see buildVersions), so this is the join key, not
 * decoration.
 */
function filenameFor(url: string, hash: string, ext: string): string {
  const fromUrl = new URL(url).pathname.split("/").pop() ?? "";
  return fromUrl && fromUrl.includes(".") ? fromUrl : `${hash}.${ext}`;
}
