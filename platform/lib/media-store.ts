/**
 * Writing bytes into the media store — `/media` on the box, served by Caddy
 * at `MEDIA_BASE_URL`.
 *
 * One owner for the path convention. It started inline in
 * /api/media/ingest (the n8n door) and moved here the day the site itself
 * began producing files — archive stills and the clips cut from them — so
 * that a second writer could not drift into a second layout.
 *
 * Paths are content-addressed, `<scene>/<field>/<sha256-32>.<ext>`, exactly
 * like the import: the same bytes always land at the same path, a retry
 * overwrites nothing, and Caddy's `immutable` cache header stays true.
 */

import { createHash } from "node:crypto";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export const MEDIA_ROOT = process.env.MEDIA_ROOT || "/media";
export type MediaField = "image" | "video" | "image_version";

export interface StoredFile {
  /** Relative to the store; what attachment rows hold. */
  path: string;
  abs: string;
  filename: string;
  ext: string;
  hash: string;
  bytes: number;
}

/** Public URL for a stored path, or "" when the base is not configured. */
export function mediaPublicUrl(path: string): string {
  const base = (process.env.MEDIA_BASE_URL ?? "").replace(/\/+$/, "");
  return base ? `${base}/${path}` : "";
}

/** Extension from the URL's own filename, falling back to the MIME type. */
export function extensionFor(url: string, contentType: string | null): string {
  const fromUrl = safePathname(url).split("/").pop() ?? "";
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
export function filenameFor(url: string, hash: string, ext: string): string {
  const fromUrl = decodeURIComponent(safePathname(url).split("/").pop() ?? "");
  return fromUrl && fromUrl.includes(".") ? fromUrl : `${hash}.${ext}`;
}

function safePathname(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return "";
  }
}

/**
 * Put bytes in the store and say where they landed. Idempotent: the same
 * bytes for the same scene and field are written once.
 */
export async function storeMediaBytes(
  sceneId: string,
  field: MediaField,
  buf: Buffer,
  opts: { url?: string; contentType?: string | null; ext?: string; filename?: string },
): Promise<StoredFile> {
  if (!buf.length) throw new Error("refusing to store an empty file");
  const hash = createHash("sha256").update(buf).digest("hex").slice(0, 32);
  const ext = (opts.ext ?? extensionFor(opts.url ?? "", opts.contentType ?? null)).toLowerCase();
  const path = `${sceneId}/${field}/${hash}.${ext}`;
  const abs = join(MEDIA_ROOT, path);
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
  return {
    path,
    abs,
    filename: opts.filename ?? filenameFor(opts.url ?? "", hash, ext),
    ext,
    hash,
    bytes: buf.length,
  };
}
