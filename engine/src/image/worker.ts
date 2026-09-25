// One scene's image regeneration as a media_job — what `scene-image-regen`
// (Claude Scripting's `IR *` tail) did, with three things it could not:
// - a transient failure (network, 429, 5xx) is retried, not reported to the
//   producer as a refusal;
// - every failure releases `Regenerează Imagine` and says why (a missing
//   prompt or an empty answer used to throw and strand the flag);
// - captchaRetry is 5 (request.ts, REGEN_CAPTCHA_RETRY).
import { setTimeout as sleepFor } from 'node:timers/promises';
import type pg from 'pg';
import type { Config } from '../config.ts';
import { type MediaJob, finishMedia, heartbeat, loadSceneContext, writeScene } from '../media/db.ts';
import type { Ingest } from '../media/ingest.ts';
import { NetworkError } from '../railway.ts';
import { FlowRefusal, type FlowImages } from './flow.ts';
import { REGEN_CAPTCHA_RETRY, buildRegenRequest, decodeFlowImage, rejectionNote } from './request.ts';

export interface ImageDeps {
  db: pg.Pool;
  config: Config;
  flow: FlowImages;
  ingest: Ingest;
  log?: (msg: string, extra?: Record<string, unknown>) => void;
  /** Back-off between attempts after a transient failure. */
  retryMs?: number;
}

class Dropped extends Error {}
const ATTEMPTS = 3;

export async function driveImage(job: MediaJob, deps: ImageDeps): Promise<'done' | 'failed' | 'dropped'> {
  const { db, config } = deps;
  const log = (msg: string, extra: Record<string, unknown> = {}) =>
    (deps.log || ((m, e) => console.log(JSON.stringify({ at: new Date().toISOString(), msg: m, ...e }))))(msg, { mediaJob: job.id, scene: job.scene_id, kind: 'image', ...extra });
  const alive = async () => { if (!(await heartbeat(db, job, config.workerId, config.leaseSeconds))) throw new Dropped('stopped or taken over'); };
  try {
    const { scene, project, allScenes } = await loadSceneContext(db, job.scene_id);
    if (!scene || !project) throw new Error('scene or project not found');
    const req = buildRegenRequest({ scene, siblings: allScenes, projectFields: project.fields, captchaRetry: REGEN_CAPTCHA_RETRY });
    log('image request', { refs: req.refs.map((r) => r.role + (r.name ? '=' + r.name : '')), aspect: req.aspect });

    let answer: unknown;
    for (let attempt = 1; ; attempt++) {
      try { answer = await deps.flow.generate(req.requestBody); break; }
      catch (e) {
        if (!(e instanceof NetworkError) || attempt >= ATTEMPTS) throw e;
        log('image attempt failed, retrying', { attempt, error: (e as Error).message });
        await sleepFor(deps.retryMs ?? 15_000);
        await alive();
      }
    }
    await alive();
    const img = decodeFlowImage(answer);
    // IR Write Image's fields, through the same door.
    const ingested = await deps.ingest.image(job.scene_id, img.url, {
      'Image Media ID': img.mediaId,
      'Aprobare Imagine': false,
      'Regenerează Imagine': false,
      'Observații Scenă': '',
    });
    const stored = ingested?.media?.url || ingested?.url || null;
    await finishMedia(db, job, config.workerId, 'done', { result: { mediaId: img.mediaId, url: stored, refs: req.refs, aspect: req.aspect } });
    log('image done', { mediaId: img.mediaId, url: stored });
    return 'done';
  } catch (e) {
    if (e instanceof Dropped) { log('image dropped', { reason: e.message }); return 'dropped'; }
    const message = (e as Error).message || String(e);
    // A refusal is worded exactly as IR Mark Rejected words it (the next
    // build reads REJECTED and attaches nothing); anything else says FAILED,
    // which the next build also knows not to treat as an adjustment.
    const note = e instanceof FlowRefusal ? rejectionNote(message) : `Image regeneration FAILED: ${message}`.slice(0, 1000);
    log('image failed', { error: message, refused: e instanceof FlowRefusal });
    await writeScene(db, job.scene_id, { 'Regenerează Imagine': false, 'Observații Scenă': note }).catch(() => {});
    await finishMedia(db, job, config.workerId, 'failed', { error: message.slice(0, 4000) }).catch(() => {});
    return 'failed';
  }
}
