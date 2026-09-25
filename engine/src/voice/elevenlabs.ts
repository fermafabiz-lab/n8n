// ElevenLabs text-to-speech, spoken to directly — the same request n8n's
// `@elevenlabs/n8n-nodes-elevenlabs` node sends in `AB Speak` / `VR Speak`:
// the model and format pinned (voice.ts), voice settings only when the film
// set all three sliders.
import { NetworkError } from '../railway.ts';
import { MODEL, OUTPUT_FORMAT } from './voice.ts';

export interface Speaker {
  speak(voiceId: string, text: string, settings: object | null): Promise<Buffer>;
}

export function elevenLabs(apiKey: string, fetchImpl: typeof fetch = fetch, base = 'https://api.elevenlabs.io'): Speaker {
  return {
    async speak(voiceId, text, settings) {
      if (!apiKey) throw new Error('ELEVENLABS_API_KEY is not set on the engine');
      if (!text.trim()) throw new Error('this scene has no narration to speak');
      const id = voiceId.replace(/^elevenlabs_/, '');
      let res: Response;
      try {
        res = await fetchImpl(`${base}/v1/text-to-speech/${encodeURIComponent(id)}?output_format=${OUTPUT_FORMAT}`, {
          method: 'POST',
          headers: { 'xi-api-key': apiKey, 'content-type': 'application/json', accept: 'audio/mpeg' },
          body: JSON.stringify({ text, model_id: MODEL, ...(settings ? { voice_settings: settings } : {}) }),
          signal: AbortSignal.timeout(120_000),
        });
      } catch (e) {
        throw new NetworkError(`ElevenLabs: ${(e as Error).message}`);
      }
      if (!res.ok) {
        const body = (await res.text()).slice(0, 400);
        // A quota or voice error is the producer's to read, so it is kept whole.
        throw new Error(`ElevenLabs answered ${res.status}: ${body}`);
      }
      return Buffer.from(await res.arrayBuffer());
    },
  };
}
