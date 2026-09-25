// Everything the engine reads from its environment, read once. In
// production these come from GitHub Secrets through the deploy workflow,
// exactly like the site's (CLAUDE.md, "The site's env").

export interface Config {
  databaseUrl: string;
  /** Railway render server, e.g. https://n8n-production-55dd.up.railway.app */
  renderUrl: string;
  renderApiKey: string;
  /** n8n's webhook base, for list-music / share-music (inside the box: http://n8n:5678/webhook). */
  n8nWebhookBase: string;
  /** The shared media volume and its public base (platform/lib/media-store.ts). */
  mediaRoot: string;
  mediaBaseUrl: string;
  /** Seconds between two polls of a Railway job. The poll ceilings in guards.ts assume 5. */
  pollMs: number;
  /** How long a claimed row stays ours without a heartbeat. */
  leaseSeconds: number;
  /** How many renders one worker drives at once. */
  concurrency: number;
  workerId: string;
  /** Consecutive network failures on a poll before the job is failed. */
  maxPollNetworkErrors: number;
  pgPoolMax: number;
  /** ElevenLabs, for voice takes. Empty = voice jobs fail with a clear message. */
  elevenLabsKey: string;
  /** Voice takes in flight at once. ElevenLabs allows 5 concurrent requests on this plan. */
  voiceConcurrency: number;
  /** useapi.net, for Google Flow images (and clips, later). */
  useapiToken: string;
  /** The site, from inside the compose network, and the key its ingest door takes. */
  siteUrl: string;
  mediaIngestKey: string;
  imageConcurrency: number;
  /** OpenAI, for the clip motion judge. Empty = the judge is skipped (the take is kept). */
  openaiKey: string;
  clipConcurrency: number;
}

const str = (env: NodeJS.ProcessEnv, k: string, fallback?: string): string => {
  const v = env[k];
  if (v !== undefined && v !== '') return v;
  if (fallback !== undefined) return fallback;
  throw new Error(`engine: ${k} is not set`);
};
const num = (env: NodeJS.ProcessEnv, k: string, fallback: number): number => {
  const v = env[k];
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`engine: ${k}=${v} is not a positive number`);
  return n;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    databaseUrl: str(env, 'DATABASE_URL'),
    renderUrl: str(env, 'RENDER_URL').replace(/\/+$/, ''),
    renderApiKey: str(env, 'RENDER_API_KEY', ''),
    n8nWebhookBase: str(env, 'N8N_WEBHOOK_BASE', 'http://n8n:5678/webhook').replace(/\/+$/, ''),
    mediaRoot: str(env, 'MEDIA_ROOT', '/media'),
    mediaBaseUrl: str(env, 'MEDIA_BASE_URL').replace(/\/+$/, ''),
    pollMs: num(env, 'POLL_MS', 5000),
    leaseSeconds: num(env, 'LEASE_SECONDS', 90),
    concurrency: num(env, 'CONCURRENCY', 2),
    workerId: str(env, 'WORKER_ID', `engine-${process.pid}`),
    maxPollNetworkErrors: num(env, 'MAX_POLL_NETWORK_ERRORS', 24),
    pgPoolMax: num(env, 'PG_POOL_MAX', 4),
    elevenLabsKey: str(env, 'ELEVENLABS_API_KEY', ''),
    voiceConcurrency: num(env, 'VOICE_CONCURRENCY', 3),
    useapiToken: str(env, 'USEAPI_TOKEN', ''),
    siteUrl: str(env, 'SITE_INTERNAL_URL', 'http://web:3000').replace(/\/+$/, ''),
    mediaIngestKey: str(env, 'MEDIA_INGEST_KEY', ''),
    imageConcurrency: num(env, 'IMAGE_CONCURRENCY', 2),
    openaiKey: str(env, 'OPENAI_API_KEY', ''),
    clipConcurrency: num(env, 'CLIP_CONCURRENCY', 3),
  };
}
