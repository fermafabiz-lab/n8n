// The finished film goes into the site's own media store (D1), never Drive:
// `/media` on the box, served by Caddy at MEDIA_BASE_URL. Content-addressed,
// `films/<project>/<sha256-32>.mp4`, so the same bytes always land at the
// same path and Caddy's `immutable` header stays true.
//
// NOT `<project>/final/…` beside the site's own files, which is what the
// media-store layout would suggest and what the first real run used: the
// site creates `<project>/` itself (reference sheets, `<project>/sheet/`) as
// its own user with 755, so the engine — another user in the same group —
// could not make a folder inside it (EACCES, render_job 1, 2026-09-25). The
// engine writes only under `films/` and `.incoming/`, which it creates
// itself, so it never depends on permissions someone else chose.
//
// Streamed, not buffered: a 12-minute film is hundreds of MB, which
// storeMediaBytes() (built for stills and clips) would hold in memory.
import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export interface StoredFilm {
  path: string;
  url: string;
  bytes: number;
}

export async function storeFinalFilm(opts: {
  sourceUrl: string;
  projectId: string;
  mediaRoot: string;
  mediaBaseUrl: string;
  fetchImpl?: typeof fetch;
}): Promise<StoredFilm> {
  const { sourceUrl, projectId, mediaRoot, mediaBaseUrl } = opts;
  const res = await (opts.fetchImpl || fetch)(sourceUrl, { signal: AbortSignal.timeout(30 * 60_000) });
  if (!res.ok || !res.body) throw new Error(`download of the finished film answered ${res.status}`);

  const tmpDir = join(mediaRoot, '.incoming');
  await mkdir(tmpDir, { recursive: true });
  const tmp = join(tmpDir, `${projectId}-${randomUUID()}.part`);
  const hash = createHash('sha256');
  let bytes = 0;
  const tap = new Transform({ transform(chunk, _enc, cb) { hash.update(chunk); bytes += chunk.length; cb(null, chunk); } });
  try {
    await pipeline(Readable.fromWeb(res.body as any), tap, createWriteStream(tmp));
    if (!bytes) throw new Error('refusing to store an empty film');
    const path = `films/${projectId}/${hash.digest('hex').slice(0, 32)}.mp4`;
    const abs = join(mediaRoot, path);
    await mkdir(dirname(abs), { recursive: true });
    let exists = false;
    try { exists = (await stat(abs)).size === bytes; } catch {}
    if (exists) await rm(tmp, { force: true });
    else await rename(tmp, abs);
    return { path, url: mediaBaseUrl ? `${mediaBaseUrl}/${path}` : '', bytes };
  } catch (e) {
    await rm(tmp, { force: true });
    throw e;
  }
}

/**
 * Small media (a voice take) already in memory, into the same store:
 * `<dir>/<sha256-32>.<ext>` under a folder the engine creates itself, never
 * one the site owns (the EACCES lesson of render_job 1).
 */
export async function storeBytes(opts: { buf: Buffer; dir: string; ext: string; mediaRoot: string; mediaBaseUrl: string }): Promise<StoredFilm> {
  if (!opts.buf.length) throw new Error('refusing to store an empty file');
  const hash = createHash('sha256').update(opts.buf).digest('hex').slice(0, 32);
  const path = `${opts.dir}/${hash}.${opts.ext}`;
  const abs = join(opts.mediaRoot, path);
  await mkdir(dirname(abs), { recursive: true });
  let exists = false;
  try { exists = (await stat(abs)).size === opts.buf.length; } catch {}
  if (!exists) {
    const tmp = join(opts.mediaRoot, '.incoming', `${randomUUID()}.part`);
    await mkdir(dirname(tmp), { recursive: true });
    await writeFile(tmp, opts.buf);
    await rename(tmp, abs);
  }
  return { path, url: opts.mediaBaseUrl ? `${opts.mediaBaseUrl}/${path}` : '', bytes: opts.buf.length };
}
