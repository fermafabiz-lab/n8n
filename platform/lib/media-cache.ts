/**
 * A local copy of the Drive assets the players actually stream.
 *
 * WHY THIS EXISTS (2026-09-20). Scene review had become unusable — press play
 * and the clip either froze or "loaded slower than it played". Measured on the
 * box: a byte range from the local media store answers in ~25 ms, the same
 * range from Google Drive in 593-1383 ms. Twenty to fifty times slower, on
 * every request, forever, because `/api/media` marked each 206 `no-store`.
 *
 * Scene clips and stills were never affected: `/api/media/ingest` has kept
 * them on disk since the cutover, and the board prefers that copy. VOICEOVERS
 * were never ingested — `hov.attachment` has 850 `image` rows and 775 `video`
 * rows and no audio field at all — so every take of every film is still
 * fetched from Drive, and the overlaid narration is exactly what the producer
 * was waiting on.
 *
 * This is the cheapest thing that fixes it for films that ALREADY exist: the
 * first request pays Drive once, writes the bytes here, and every request
 * after it — including every seek — is served from disk. It needs no n8n
 * change, no backfill and no new field; giving voiceovers a real attachment
 * row upstream is the tidier answer and remains worth doing, but it would
 * heal nothing already recorded.
 *
 * Content-addressed by the Drive id, which is what makes it safe to keep
 * forever: a Drive file id names one immutable set of bytes. `id` reaches
 * here having matched `^[\w-]{10,}$` (MediaQuery), so it cannot escape the
 * directory.
 */

import { createHash } from "node:crypto";
import { mkdir, rename, stat, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { MEDIA_ROOT } from "@/lib/media-store";

/** Kept apart from the scene tree: this is a cache, not the archive. */
const CACHE_DIR = join(MEDIA_ROOT, "_drive");

/**
 * Above this, stream through and cache nothing.
 *
 * A voiceover is tens of kilobytes and a scene clip a couple of megabytes —
 * the things reviewed over and over. A finished film is hundreds of megabytes
 * and watched once or twice, so buffering it to disk would spend the media
 * volume on the one case that does not benefit.
 */
export const MAX_CACHE_BYTES = 96 * 1024 * 1024;

export interface CachedMedia {
  abs: string;
  bytes: number;
  contentType: string;
  etag: string;
}

const binPath = (id: string) => join(CACHE_DIR, `${id}.bin`);
const metaPath = (id: string) => join(CACHE_DIR, `${id}.json`);

/** The cached file, or null when it is not there (or is half-written). */
export async function readCached(id: string): Promise<CachedMedia | null> {
  try {
    const abs = binPath(id);
    const s = await stat(abs);
    if (!s.isFile() || s.size === 0) return null;
    const meta = JSON.parse(await readFile(metaPath(id), "utf8")) as {
      contentType?: string;
      bytes?: number;
      etag?: string;
    };
    // A size that disagrees with the sidecar means a write was interrupted.
    // Treat it as a miss; the next fetch rewrites both.
    if (typeof meta.bytes === "number" && meta.bytes !== s.size) return null;
    return {
      abs,
      bytes: s.size,
      contentType: meta.contentType || "application/octet-stream",
      etag: meta.etag || `"${s.size}"`,
    };
  } catch {
    return null;
  }
}

/**
 * Put the bytes on disk, atomically.
 *
 * Written to a unique temporary name and renamed, so a second request landing
 * mid-write never reads a partial file: rename is atomic within a filesystem,
 * and two requests racing simply write the same bytes twice and the last
 * rename wins. The sidecar is written BEFORE the rename for the same reason —
 * `readCached` requires both, and the bin file appearing is what makes the
 * entry live.
 */
export async function writeCached(
  id: string,
  buf: Buffer,
  contentType: string,
): Promise<CachedMedia | null> {
  if (!buf.length || buf.length > MAX_CACHE_BYTES) return null;
  const etag = `"${createHash("sha256").update(buf).digest("hex").slice(0, 32)}"`;
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    const tmp = `${binPath(id)}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, buf);
    await writeFile(metaPath(id), JSON.stringify({ contentType, bytes: buf.length, etag }));
    await rename(tmp, binPath(id));
  } catch {
    // A full or read-only media volume must not break playback — the caller
    // still has the bytes in hand and serves them from memory this once.
    return null;
  }
  return { abs: binPath(id), bytes: buf.length, contentType, etag };
}

export interface ParsedRange {
  start: number;
  end: number;
}

/**
 * `Range: bytes=…` against a known length.
 *
 * Returns null for "no range asked" and "unsatisfiable" alike — the caller
 * distinguishes them by whether a header was sent, because a 416 and a 200
 * are different answers and only one of them is a bug.
 */
export function parseRange(header: string | null, size: number): ParsedRange | null {
  if (!header) return null;
  // Spaces and tabs only. A CR or LF inside a header value is the signature of
  // a smuggling attempt, never a real client, and `trim()` would have quietly
  // accepted one — so the control characters are rejected rather than eaten.
  const value = header.replace(/^[ \t]+|[ \t]+$/g, "");
  if (/[\u0000-\u001f\u007f]/.test(value)) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!m) return null;
  const [, rawStart, rawEnd] = m;
  if (rawStart === "" && rawEnd === "") return null;
  let start: number;
  let end: number;
  if (rawStart === "") {
    // `bytes=-N` — the last N bytes.
    const n = Number(rawEnd);
    if (!Number.isFinite(n) || n <= 0) return null;
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd === "" ? size - 1 : Number(rawEnd);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start < 0 || start >= size) return null;
  // A client may ask past the end; serving what exists is correct and is what
  // every static server does.
  if (end >= size) end = size - 1;
  if (end < start) return null;
  return { start, end };
}
