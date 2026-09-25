// The media worker loop: claims hov.media_job rows and drives them, beside
// the render loop in the same container (src/main.ts). Each kind has its own
// concurrency, because each is its own provider's limit (ElevenLabs: 5
// concurrent requests on this plan; Flow images: captcha-bound, keep it low).
import { setTimeout as sleepFor } from 'node:timers/promises';
import { driveClip, type ClipDeps } from '../clip/worker.ts';
import { driveImage, type ImageDeps } from '../image/worker.ts';
import { driveVoice, type VoiceDeps } from '../voice/worker.ts';
import { claimMedia, releaseMedia, type MediaKind } from './db.ts';

export type MediaDeps = VoiceDeps & Partial<Omit<ImageDeps, keyof VoiceDeps>> & Partial<Pick<ClipDeps, 'clip' | 'waits'>>;

export async function runMediaWorker(deps: MediaDeps, signal: AbortSignal): Promise<void> {
  const { db, config } = deps;
  const limits: Partial<Record<MediaKind, number>> = { voice: config.voiceConcurrency };
  if (deps.flow && deps.ingest) limits.image = config.imageConcurrency;
  if (deps.clip && deps.ingest) limits.clip = config.clipConcurrency;
  const running = new Map<string, { kind: MediaKind; run: Promise<unknown> }>();
  const count = (k: MediaKind) => [...running.values()].filter((r) => r.kind === k).length;
  while (!signal.aborted) {
    try {
      for (;;) {
        const kinds = (Object.keys(limits) as MediaKind[]).filter((k) => count(k) < (limits[k] || 0));
        if (!kinds.length) break;
        const job = await claimMedia(db, config.workerId, config.leaseSeconds, kinds, [...running.keys()]);
        if (!job) break;
        const run = job.kind === 'image' ? driveImage(job, deps as unknown as ImageDeps)
          : job.kind === 'clip' ? driveClip(job, deps as unknown as ClipDeps)
          : driveVoice(job, deps);
        running.set(job.id, { kind: job.kind, run: run.finally(() => running.delete(job.id)) });
      }
    } catch (e) {
      (deps.log || console.log)('media claim failed', { error: String(e) });
    }
    try { await sleepFor(Math.min(config.pollMs, 2000), undefined, { signal }); } catch {}
  }
  await Promise.allSettled([...running.values()].map((r) => r.run));
  await releaseMedia(db, config.workerId).catch(() => {});
}
