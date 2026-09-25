// One scene's clip regeneration as a media_job — the `scene-video-regen`
// chain, stitched from the pure steps in regen.ts in the order and with the
// waits n8n uses: submit → wait 30 s → poll every 15 s (20 polls) → a failed
// job is either the content filter (the scene is told what to do) or a
// resubmit (at most 4); a refused submit cools down 60 s (at most 20); a
// finished clip is judged once and re-rolled at most once; the take lands in
// /media through the site's ingest door.
//
// What it does that n8n could not: any failure — too many resubmits, a lost
// job, a crash — releases `Regenerează Video` and says why on the scene,
// instead of dying with the flag stranded.
import { setTimeout as sleepFor } from 'node:timers/promises';
import type pg from 'pg';
import type { Config } from '../config.ts';
import { type MediaJob, finishMedia, heartbeat, loadSceneContext, writeScene } from '../media/db.ts';
import type { Ingest } from '../media/ingest.ts';
import { NetworkError } from '../railway.ts';
import * as R from './regen.ts';
import { type ClipServices, SubmitRefused } from './services.ts';

export interface ClipDeps {
  db: pg.Pool;
  config: Config;
  clip: ClipServices;
  ingest: Ingest;
  log?: (msg: string, extra?: Record<string, unknown>) => void;
  /** n8n's waits; tests shrink them. */
  waits?: { firstPollMs: number; pollMs: number; cooldownMs: number };
  now?: () => number;
}

class Dropped extends Error {}
/** End-frame pauses are instance-wide in n8n (static data shared by every run); one per engine process here. */
const shared: R.ClipState = {};

export async function driveClip(job: MediaJob, deps: ClipDeps): Promise<'done' | 'failed' | 'dropped'> {
  const { db, config } = deps;
  const waits = deps.waits || { firstPollMs: 30_000, pollMs: 15_000, cooldownMs: 60_000 };
  const now = deps.now || Date.now;
  const log = (msg: string, extra: Record<string, unknown> = {}) =>
    (deps.log || ((m, e) => console.log(JSON.stringify({ at: new Date().toISOString(), msg: m, ...e }))))(msg, { mediaJob: job.id, scene: job.scene_id, kind: 'clip', ...extra });
  const alive = async () => { if (!(await heartbeat(db, job, config.workerId, config.leaseSeconds))) throw new Dropped('stopped or taken over'); };
  const pause = async (ms: number) => { await sleepFor(ms); await alive(); };
  const state: R.ClipState = { endFrameOffAt: shared.endFrameOffAt, endFrameFailAt: shared.endFrameFailAt, endFrameFails: shared.endFrameFails };
  const share = () => { shared.endFrameOffAt = state.endFrameOffAt; shared.endFrameFailAt = state.endFrameFailAt; shared.endFrameFails = state.endFrameFails; };

  try {
    const { scene, project } = await loadSceneContext(db, job.scene_id);
    const built = R.buildVideoRegen(job.scene_id, scene && project ? { scene: scene.fields || {}, project: project.fields || {}, project_id: project.id } : null);
    if (!built.ok) {
      if (built.write) await writeScene(db, job.scene_id, R.refusalFields(built.reason));
      await finishMedia(db, job, config.workerId, 'failed', { error: 'refused: ' + built.reason });
      log('clip refused', { reason: built.reason });
      return 'failed';
    }
    const p = R.prepVideoRegen(built, now());
    log('clip request', { model: p.model, seed: p.seed, takes: p.takes });

    // The optional end frame (opt-in; off by default since 2026-09-14).
    let attached: { sceneId: string; endImage: string } | null = null;
    const ef = R.endFramePlan(p, state, now());
    if (ef.efOk) {
      const a = R.attachEndFrame(await deps.clip.drawEndFrame(R.endFrameBody(ef.efRequest)));
      if (a.endImage) attached = { sceneId: p.id, endImage: a.endImage };
      log('end frame', { endImage: a.endImage || null, error: a.efError || null });
    }

    let payload: R.Prepared = p;
    let resubmit: ReturnType<typeof R.motionResubmit> | null = null;
    let cooldown: { sceneId: string; dropEndFrame?: boolean } | null = null;
    for (;;) {
      // Submit, cooling down on a refused submit exactly as Regen Cooldown Guard does.
      let jobId: string;
      for (;;) {
        try { jobId = await deps.clip.submitVideo(R.submitBody({ p: payload, resubmit, attached, cooldown })); break; }
        catch (e) {
          if (!(e instanceof SubmitRefused) && !(e instanceof NetworkError)) throw e;
          const item = e instanceof SubmitRefused ? e.item : { error: { message: (e as Error).message } };
          const g = R.cooldownGuard(p, item, state, now(), !!(attached && attached.sceneId === p.id));
          share();
          cooldown = { sceneId: p.id, dropEndFrame: g.dropEndFrame };
          payload = p;
          log('submit refused, cooling down', { n: g.n, reason: g.last });
          await pause(waits.cooldownMs);
        }
      }
      log('submitted', { jobId });
      await pause(waits.firstPollMs);

      // Poll until done or failed.
      let result: any;
      for (;;) {
        let item: any;
        try { item = await deps.clip.pollJob(jobId); }
        catch (e) { if (e instanceof NetworkError) { await pause(waits.pollMs); continue; } throw e; }
        const c = R.checkPoll(item, p.id, state);
        if (c.done) { result = c; break; }
        if (c.jobFailed) { result = c; break; }
        await pause(waits.pollMs);
      }

      if (result.jobFailed) {
        if (R.isFilterFailure(result)) {
          await writeScene(db, job.scene_id, R.filteredFields(result));
          await finishMedia(db, job, config.workerId, 'failed', { error: 'refused by the video filter: ' + JSON.stringify(result).slice(0, 400) });
          log('clip filtered', {});
          return 'failed';
        }
        payload = R.resubmitGuard(p, state); // throws past MAX_RESUBMITS
        resubmit = null; cooldown = null;
        log('clip job failed, resubmitting', { error: String(result.error || result.status).slice(0, 200) });
        continue;
      }

      const ev = R.extractVideo(result);
      // The motion judge: a contact sheet, one question, at most one re-roll.
      const prep = R.motionPrep(p, ev, state);
      let judgeAnswer: any = {};
      if (prep.ok) {
        const sheet = await deps.clip.contactSheet(prep.videoUrl);
        judgeAnswer = sheet ? await deps.clip.judge(R.motionJudgeBody(prep, sheet)) : { error: 'no contact sheet' };
      }
      const verdict = R.motionVerdict(prep, judgeAnswer, state);
      if (verdict.motionReroll === true) {
        resubmit = R.motionResubmit(verdict, p, state);
        payload = resubmit;
        cooldown = null;
        log('motion re-roll', { problems: verdict.problems, correction: resubmit.correction || null });
        continue;
      }
      log('motion verdict', { verdict: (verdict as any).motionVerdict });

      // Stored through the site's door (no Drive), then the scene points at it.
      await alive();
      const ingested = await deps.ingest.image(job.scene_id, ev.Video_Signed_URL, {}, 'video');
      const stored = ingested?.media?.url;
      if (!stored) throw new Error('the site stored the clip but returned no URL');
      await writeScene(db, job.scene_id, R.writtenFields(stored, ev.Video_Media_Id));
      await finishMedia(db, job, config.workerId, 'done', { result: { url: stored, mediaId: ev.Video_Media_Id, model: p.model, seed: (payload as any).seed, verdict: (verdict as any).motionVerdict } });
      log('clip done', { url: stored });
      return 'done';
    }
  } catch (e) {
    if (e instanceof Dropped) { log('clip dropped', { reason: e.message }); return 'dropped'; }
    const message = (e as Error).message || String(e);
    log('clip failed', { error: message });
    // Worded to start with REJECTED on purpose: every reader of this field
    // (VRW Build Regen, IR Build Request) skips a note that does, so a failure
    // is never mistaken for the producer's correction on the next attempt.
    await writeScene(db, job.scene_id, R.refusalFields('the regeneration failed: ' + message.slice(0, 300))).catch(() => {});
    await finishMedia(db, job, config.workerId, 'failed', { error: message.slice(0, 4000) }).catch(() => {});
    return 'failed';
  }
}
