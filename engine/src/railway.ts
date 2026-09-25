// The render server on Railway (remotion/server/), spoken to exactly as n8n's
// HTTP nodes speak to it: POST /assemble or /render → {jobId}, then
// GET /<kind>/:jobId/status every few seconds.
import type { PollStatus } from './assembly/types.ts';

export class NetworkError extends Error {}

export interface RenderServer {
  submitAssemble(body: unknown): Promise<string>;
  submitRender(body: unknown): Promise<string>;
  /** Multi-voice synthesis: several speakers, one take (remotion/server tts). */
  submitTtsMulti(body: unknown): Promise<string>;
  status(kind: 'assemble' | 'render' | 'tts-multi', jobId: string): Promise<PollStatus>;
}

export function railway(baseUrl: string, apiKey: string, fetchImpl: typeof fetch = fetch): RenderServer {
  const headers = (json: boolean): Record<string, string> => ({
    ...(apiKey ? { 'x-api-key': apiKey } : {}),
    ...(json ? { 'content-type': 'application/json' } : {}),
  });

  async function submit(path: string, body: unknown): Promise<string> {
    let res: Response;
    try {
      res = await fetchImpl(baseUrl + path, { method: 'POST', headers: headers(true), body: JSON.stringify(body), signal: AbortSignal.timeout(60_000) });
    } catch (e) {
      throw new NetworkError(`POST ${path}: ${(e as Error).message}`);
    }
    const text = await res.text();
    if (!res.ok) throw new Error(`POST ${path} answered ${res.status}: ${text.slice(0, 500)}`);
    const jobId = (JSON.parse(text) as { jobId?: string }).jobId;
    if (!jobId) throw new Error(`POST ${path} answered no jobId: ${text.slice(0, 500)}`);
    return jobId;
  }

  return {
    submitAssemble: (body) => submit('/assemble', body),
    submitRender: (body) => submit('/render', body),
    submitTtsMulti: (body) => submit('/tts-multi', body),
    // A 404 comes back as a STATUS, not a throw, in the shape n8n's HTTP node
    // gave the guards: `{error: {message: '...404...'}}`. It means the
    // container was replaced mid-job, and the guard turns it into `lost`.
    async status(kind, jobId) {
      let res: Response;
      try {
        res = await fetchImpl(`${baseUrl}/${kind}/${encodeURIComponent(jobId)}/status`, { headers: headers(false), signal: AbortSignal.timeout(30_000) });
      } catch (e) {
        throw new NetworkError(`GET ${kind} status: ${(e as Error).message}`);
      }
      const text = await res.text();
      if (res.status === 404) return { error: { message: `Request failed with status code 404: ${text.slice(0, 200)}` } };
      if (res.status >= 500 || res.status === 429) throw new NetworkError(`GET ${kind} status answered ${res.status}`);
      if (!res.ok) throw new Error(`GET ${kind} status answered ${res.status}: ${text.slice(0, 500)}`);
      return JSON.parse(text) as PollStatus;
    },
  };
}
