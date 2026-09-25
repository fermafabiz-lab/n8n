// Google Flow through useapi.net: one image, answered synchronously.
// POST /v1/google-flow/images with the request IR Build Request built.
import { NetworkError } from '../railway.ts';

export class FlowRefusal extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

export interface FlowImages {
  generate(body: Record<string, unknown>): Promise<unknown>;
}

export function flowImages(token: string, fetchImpl: typeof fetch = fetch, base = 'https://api.useapi.net'): FlowImages {
  return {
    async generate(body) {
      if (!token) throw new Error('USEAPI_TOKEN is not set on the engine');
      let res: Response;
      try {
        res = await fetchImpl(`${base}/v1/google-flow/images`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(180_000), // IR Generate Image's own timeout
        });
      } catch (e) {
        throw new NetworkError(`useapi images: ${(e as Error).message}`);
      }
      const text = await res.text();
      let json: any = null;
      try { json = JSON.parse(text); } catch {}
      if (res.status === 429 || res.status >= 500) throw new NetworkError(`useapi images answered ${res.status}: ${text.slice(0, 300)}`);
      if (!res.ok) {
        // What n8n's error output carried as description: the API's own words.
        const reason = (json && (json.error?.message || json.error || json.message)) || `HTTP ${res.status}`;
        throw new FlowRefusal(typeof reason === 'string' ? reason : JSON.stringify(reason), res.status);
      }
      return json;
    },
  };
}
