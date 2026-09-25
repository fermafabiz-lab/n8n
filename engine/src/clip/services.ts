// The four services a clip regeneration talks to, each as small as n8n's
// HTTP node for it: Veo through useapi (submit, poll), the render server's
// /inspect contact sheet, and OpenAI for the motion judge.
import { NetworkError } from '../railway.ts';

/** A refused submit, shaped like the error item n8n's HTTP node hands `Regen Cooldown Guard`. */
export class SubmitRefused extends Error {
  item: { error: { message: string; description?: string } };
  constructor(status: number, text: string) {
    super(`${status} - ${text.slice(0, 300)}`);
    this.item = { error: { message: `${status} - ${text.slice(0, 1000)}` } };
  }
}

export interface ClipServices {
  submitVideo(body: Record<string, unknown>): Promise<string>;
  pollJob(jobId: string): Promise<any>;
  drawEndFrame(body: Record<string, unknown>): Promise<any>;
  contactSheet(videoUrl: string): Promise<string | null>;
  judge(body: Record<string, unknown>): Promise<any>;
}

export function clipServices(o: { useapiToken: string; renderUrl: string; renderApiKey: string; openaiKey: string; fetchImpl?: typeof fetch; useapiBase?: string; openaiBase?: string }): ClipServices {
  const f = o.fetchImpl || fetch;
  const useapi = o.useapiBase || 'https://api.useapi.net';
  const auth = { Authorization: `Bearer ${o.useapiToken}`, 'content-type': 'application/json' };
  const call = async (url: string, init: RequestInit, timeout: number) => {
    try { return await f(url, { ...init, signal: AbortSignal.timeout(timeout) }); }
    catch (e) { throw new NetworkError(`${new URL(url).host}: ${(e as Error).message}`); }
  };
  return {
    async submitVideo(body) {
      if (!o.useapiToken) throw new Error('USEAPI_TOKEN is not set on the engine');
      const res = await call(`${useapi}/v1/google-flow/videos`, { method: 'POST', headers: auth, body: JSON.stringify(body) }, 60_000);
      const text = await res.text();
      if (!res.ok) throw new SubmitRefused(res.status, text);
      const json = JSON.parse(text);
      if (!json.jobid) throw new SubmitRefused(res.status, 'no jobid in answer: ' + text);
      return String(json.jobid);
    },
    async pollJob(jobId) {
      const res = await call(`${useapi}/v1/google-flow/jobs/${encodeURIComponent(jobId)}`, { headers: auth }, 30_000);
      const text = await res.text();
      if (res.status === 429 || res.status >= 500) throw new NetworkError(`useapi job poll answered ${res.status}`);
      try { return JSON.parse(text); } catch { return { status: 'unknown', raw: text.slice(0, 500) }; }
    },
    // onError continueRegularOutput in n8n: an error becomes the answer, never a throw.
    async drawEndFrame(body) {
      try {
        const res = await call(`${useapi}/v1/google-flow/images`, { method: 'POST', headers: auth, body: JSON.stringify(body) }, 180_000);
        const text = await res.text();
        let json: any = null;
        try { json = JSON.parse(text); } catch {}
        return res.ok ? json : { error: { message: `${res.status} - ${text.slice(0, 300)}` } };
      } catch (e) { return { error: { message: (e as Error).message } }; }
    },
    async contactSheet(videoUrl) {
      try {
        const res = await call(`${o.renderUrl}/inspect?mode=sheet&interval=0.5&save=1&url=${encodeURIComponent(videoUrl)}`, { headers: { 'x-api-key': o.renderApiKey } }, 180_000);
        if (!res.ok) return null;
        const json: any = await res.json();
        return typeof json.url === 'string' ? json.url : null;
      } catch { return null; }
    },
    async judge(body) {
      if (!o.openaiKey) return { error: 'OPENAI_API_KEY is not set on the engine' };
      try {
        const res = await call(`${o.openaiBase || 'https://api.openai.com'}/v1/chat/completions`, { method: 'POST', headers: { Authorization: `Bearer ${o.openaiKey}`, 'content-type': 'application/json' }, body: JSON.stringify(body) }, 90_000);
        return await res.json();
      } catch (e) { return { error: (e as Error).message }; }
    },
  };
}
