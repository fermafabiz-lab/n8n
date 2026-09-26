// What the production run talks to beyond the clip services (../clip/services.ts):
// Flow images and assets through useapi, OpenAI chat, and the site's ingest
// door for sheets. Every call answers the way n8n's HTTP node does with
// `onError: continueRegularOutput` / `continueErrorOutput` — an error becomes
// an item `{error: {message, httpCode}}`, never a throw — because every node
// downstream in n8n was written against that shape (IMG Error Router reads
// `httpCode` out of it, Collect Replicated and Steal Record read `error`).
import { NetworkError } from '../railway.ts';

export interface ProduceServices {
  /** POST /v1/google-flow/images. */
  generateImage(body: Record<string, unknown>): Promise<any>;
  /** POST /v1/google-flow/assets/{email} with the bytes: a copy of a picture on that account. */
  uploadAsset(email: string, bytes: Buffer, contentType?: string): Promise<any>;
  /** GET /v1/google-flow/assets/{mediaGenerationId}: a fresh signed URL for an asset. */
  assetUrl(mediaId: string): Promise<any>;
  /** Download bytes (a sheet from /media, a fresh Flow URL, the producer's photo). Null on failure. */
  download(url: string): Promise<{ bytes: Buffer; contentType: string } | null>;
  /** OpenAI chat completions; an error comes back as `{error}`. */
  chat(body: Record<string, unknown>): Promise<any>;
  /** The site's /api/media/ingest with `field: "sheets"`. */
  ingestSheets(projectId: string, items: Array<{ kind: string; name: string; flowId: string; url: string }>): Promise<any>;
}

export function produceServices(o: { useapiToken: string; openaiKey: string; siteUrl: string; ingestKey: string; fetchImpl?: typeof fetch; useapiBase?: string; openaiBase?: string }): ProduceServices {
  const f = o.fetchImpl || fetch;
  const useapi = o.useapiBase || 'https://api.useapi.net';
  const auth = { Authorization: `Bearer ${o.useapiToken}` };
  const asItem = async (res: Response) => {
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch {}
    if (res.ok) return json ?? {};
    const msg = (json && (json.error?.message || (typeof json.error === 'string' ? json.error : '') || json.message)) || text.slice(0, 1000);
    return { error: { message: `${res.status} - ${String(msg).slice(0, 1000)}`, httpCode: String(res.status), description: text.slice(0, 2000) } };
  };
  const guarded = async (url: string, init: RequestInit, timeout: number) => {
    try { return await asItem(await f(url, { ...init, signal: AbortSignal.timeout(timeout) })); }
    catch (e) { return { error: { message: `${new URL(url).host}: ${(e as Error).message}` } }; }
  };
  return {
    async generateImage(body) {
      if (!o.useapiToken) throw new Error('USEAPI_TOKEN is not set on the engine');
      return guarded(`${useapi}/v1/google-flow/images`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify(body) }, 180_000);
    },
    async uploadAsset(email, bytes, contentType = 'image/png') {
      // The account is a PATH segment, encoded. As a query parameter useapi
      // reads it as no account and load-balances (CLAUDE.md, 2026-09-17).
      return guarded(`${useapi}/v1/google-flow/assets/${encodeURIComponent(email)}`, { method: 'POST', headers: { ...auth, 'content-type': contentType }, body: new Uint8Array(bytes) }, 120_000);
    },
    async assetUrl(mediaId) {
      return guarded(`${useapi}/v1/google-flow/assets/${mediaId}`, { headers: auth }, 60_000);
    },
    async download(url) {
      try {
        const res = await f(url, { signal: AbortSignal.timeout(120_000) });
        if (!res.ok) return null;
        return { bytes: Buffer.from(await res.arrayBuffer()), contentType: res.headers.get('content-type') || 'image/png' };
      } catch { return null; }
    },
    async chat(body) {
      if (!o.openaiKey) return { error: { message: 'OPENAI_API_KEY is not set on the engine' } };
      return guarded(`${o.openaiBase || 'https://api.openai.com'}/v1/chat/completions`, { method: 'POST', headers: { Authorization: `Bearer ${o.openaiKey}`, 'content-type': 'application/json' }, body: JSON.stringify(body) }, 90_000);
    },
    async ingestSheets(projectId, items) {
      if (!o.ingestKey) throw new Error('MEDIA_INGEST_KEY is not set on the engine');
      try {
        const res = await f(`${o.siteUrl}/api/media/ingest`, { method: 'POST', headers: { 'x-hov-key': o.ingestKey, 'content-type': 'application/json' }, body: JSON.stringify({ field: 'sheets', projectId, items }), signal: AbortSignal.timeout(180_000) });
        return await asItem(res);
      } catch (e) { throw new NetworkError(`site ingest: ${(e as Error).message}`); }
    },
  };
}
