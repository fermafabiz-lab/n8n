// The media worker loop: claims hov.media_job rows and drives them, beside
// the render loop in the same container (src/main.ts). Voice only for now;
// each kind gets its own concurrency, because each is its own provider's
// limit (ElevenLabs: 5 concurrent requests on this plan).
import { setTimeout as sleepFor } from 'node:timers/promises';
import { driveVoice, type VoiceDeps } from '../voice/worker.ts';
import { claimMedia, releaseMedia } from './db.ts';

export async function runMediaWorker(deps: VoiceDeps, signal: AbortSignal): Promise<void> {
  const { db, config } = deps;
  const running = new Map<string, Promise<unknown>>();
  while (!signal.aborted) {
    try {
      while (running.size < config.voiceConcurrency) {
        const job = await claimMedia(db, config.workerId, config.leaseSeconds, ['voice'], [...running.keys()]);
        if (!job) break;
        running.set(job.id, driveVoice(job, deps).finally(() => running.delete(job.id)));
      }
    } catch (e) {
      (deps.log || console.log)('media claim failed', { error: String(e) });
    }
    try { await sleepFor(Math.min(config.pollMs, 2000), undefined, { signal }); } catch {}
  }
  await Promise.allSettled(running.values());
  await releaseMedia(db, config.workerId).catch(() => {});
}
