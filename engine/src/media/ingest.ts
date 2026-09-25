// The site's /api/media/ingest — the door n8n's IR Write Image uses: the site
// downloads the signed Flow URL, stores it content-addressed in /media, makes
// the attachment row and writes the scene fields, all in one call. The engine
// uses the same door so there is one writer of scene images, not two.
import { NetworkError } from '../railway.ts';

export interface Ingest {
  image(sceneId: string, url: string, fields: Record<string, unknown>, field?: 'image' | 'video'): Promise<any>;
}

export function siteIngest(siteUrl: string, key: string, fetchImpl: typeof fetch = fetch): Ingest {
  return {
    async image(sceneId, url, fields, field = 'image') {
      if (!key) throw new Error('MEDIA_INGEST_KEY is not set on the engine');
      let res: Response;
      try {
        res = await fetchImpl(`${siteUrl}/api/media/ingest`, {
          method: 'POST',
          headers: { 'x-hov-key': key, 'content-type': 'application/json' },
          body: JSON.stringify({ sceneId, field, url, fields }),
          signal: AbortSignal.timeout(180_000),
        });
      } catch (e) {
        throw new NetworkError(`site ingest: ${(e as Error).message}`);
      }
      const text = await res.text();
      if (!res.ok) throw new Error(`site ingest answered ${res.status}: ${text.slice(0, 300)}`);
      try { return JSON.parse(text); } catch { return {}; }
    },
  };
}
