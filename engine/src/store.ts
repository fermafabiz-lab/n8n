// The finished film goes into the site's own media store (D1), never Drive:
// `/media` on the box, served by Caddy at MEDIA_BASE_URL. Same layout as
// platform/lib/media-store.ts — content-addressed `<owner>/<field>/<sha256-32>.<ext>`,
// so the same bytes always land at the same path and Caddy's `immutable`
// header stays true. The owner is the PROJECT id and the field is `final`.
//
// Streamed, not buffered: a 12-minute film is hundreds of MB, which
// storeMediaBytes() (built for stills and clips) would hold in memory.
import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
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
    const path = `${projectId}/final/${hash.digest('hex').slice(0, 32)}.mp4`;
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
