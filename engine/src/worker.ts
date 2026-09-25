// The worker: drives each hov.render_job row through Final Assembly's steps,
// writing every step down so a restart resumes where it stopped.
//
//   queued    load the inputs (the same hov.at_* views n8n read), choose the
//             music, build the /assemble request, submit it
//   assemble  poll every POLL_MS; a 404 means the Railway container was
//             replaced mid-job, so the same request is resubmitted
//   graphics  build the /render request from the assemble job's measurement,
//             add `speed` (D2), submit, poll the same way
//   store     download the drawn film into /media (D1) and mark the project
//             Finalizat with its URL, as `Update Project Status` did
//
// Every save both records progress and renews the lease, and refuses when the
// row is no longer ours or no longer active: that is how a Stop from the site
// reaches a running job (phase = 'stopped'), within one poll.
import { setTimeout as sleepFor } from 'node:timers/promises';
import type pg from 'pg';
import {
  editingOptions, judgeAssemblePoll, judgeGraphicsPoll, matchToneFolder, normalizeInput,
  pickMusicTrack, planAssemble, planRender, playbackSpeed,
} from './assembly/index.ts';
import type { AtRow, MusicPick, PollStatus, Triggers } from './assembly/types.ts';
import type { Config } from './config.ts';
import { claim, fail, loadInputs, markFinished, release, save, type RenderJob } from './db.ts';
import type { MusicSource } from './musicSource.ts';
import { NetworkError, type RenderServer } from './railway.ts';
import { storeFinalFilm } from './store.ts';

export interface Deps {
  db: pg.Pool;
  config: Config;
  render: RenderServer;
  music: MusicSource;
  fetchImpl?: typeof fetch;
  random?: () => number;
  log?: (msg: string, extra?: Record<string, unknown>) => void;
}

export type Outcome = 'done' | 'failed' | 'dropped';

/** What a job renders from, frozen when it starts. */
interface Inputs {
  triggers: Triggers;
  sceneRows: AtRow[];
  project: AtRow;
  script: AtRow | null;
  music: MusicPick | null;
}

/** Thrown to leave a job alone: stopped by the site, taken by another worker, or this worker shutting down. */
class Dropped extends Error {}

export async function drive(job: RenderJob, deps: Deps, signal?: AbortSignal): Promise<Outcome> {
  const { db, config } = deps;
  const log = (msg: string, extra: Record<string, unknown> = {}) =>
    (deps.log || defaultLog)(msg, { job: job.id, project: job.project_id, phase: job.phase, ...extra });
  const put = async (patch: Record<string, unknown>) => {
    if (!(await save(db, job, config.workerId, config.leaseSeconds, patch))) throw new Dropped('no longer ours or no longer active');
  };
  const wait = async () => {
    try { await sleepFor(config.pollMs, undefined, { signal }); } catch { throw new Dropped('shutting down'); }
  };
  // A poll that cannot reach Railway is weather, not a verdict: tolerated for
  // MAX_POLL_NETWORK_ERRORS polls in a row (two minutes at 5 s), then fatal.
  // n8n's HTTP node failed the whole execution on the first one.
  let networkErrors = 0;
  const poll = async (kind: 'assemble' | 'render', id: string): Promise<PollStatus | null> => {
    try {
      const s = await deps.render.status(kind, id);
      networkErrors = 0;
      return s;
    } catch (e) {
      if (!(e instanceof NetworkError)) throw e;
      if (++networkErrors >= config.maxPollNetworkErrors) throw new Error(`${kind} status unreachable ${networkErrors} times in a row: ${e.message}`);
      log('poll failed, retrying', { error: e.message, networkErrors });
      return null;
    }
  };

  try {
    if (job.phase === 'queued') await start(job, deps, put, log);
    if (job.phase === 'assemble') {
      for (;;) {
        await wait();
        const status = await poll('assemble', job.assemble_job_id as string);
        if (!status) { await put({}); continue; }
        const verdict = judgeAssemblePoll(status, job.assemble_polls);
        const polls = job.assemble_polls + 1;
        if (verdict.lost) {
          const id = await deps.render.submitAssemble(job.assemble_body);
          log('assemble job lost (Railway restarted), resubmitted', { was: job.assemble_job_id, now: id });
          await put({ assemble_job_id: id, assemble_polls: polls, progress: 0 });
          continue;
        }
        if (status.status !== 'done') { await put({ assemble_polls: polls, progress: num(status.progress) }); continue; }
        const inputs = job.inputs as Inputs;
        const assembly = planAssemble(inputs);
        const body = {
          ...planRender({ ...inputs, assembly, assembled: verdict }).body,
          // D2: the playback speed n8n stopped sending in August. /render strips
          // it before the composition sees it, so the props stay identical.
          speed: playbackSpeed(inputs.project.fields),
        };
        const id = await deps.render.submitRender(body);
        log('assembled; graphics submitted', { graphicsJob: id, videoSeconds: verdict.verify?.videoSeconds });
        await put({ phase: 'graphics', assembled: verdict, verify: verdict.verify ?? null, render_body: body, graphics_job_id: id, assemble_polls: polls, progress: 0 });
        break;
      }
    }
    if (job.phase === 'graphics') {
      const resolution = (job.assemble_body && job.assemble_body.resolution) || '720p';
      for (;;) {
        await wait();
        const status = await poll('render', job.graphics_job_id as string);
        if (!status) { await put({}); continue; }
        const verdict = judgeGraphicsPoll(status, job.graphics_polls, resolution);
        const polls = job.graphics_polls + 1;
        if (verdict.lost) {
          const id = await deps.render.submitRender(job.render_body);
          log('graphics job lost (Railway restarted), resubmitted', { was: job.graphics_job_id, now: id });
          await put({ graphics_job_id: id, graphics_polls: polls, progress: 0 });
          continue;
        }
        if (status.status !== 'done') { await put({ graphics_polls: polls, progress: num(status.progress) }); continue; }
        if (!status.outputUrl) throw new Error('graphics finished without an outputUrl');
        log('graphics done', { engine: status.engine ?? null, speed: status.speed ?? null });
        if (status.speedError) log('the speed pass failed; the film ships at its natural rate', { speedError: status.speedError });
        await put({ phase: 'store', graphics_output_url: status.outputUrl, graphics_polls: polls, progress: 1 });
        break;
      }
    }
    if (job.phase === 'store') {
      const film = await storeFinalFilm({
        sourceUrl: job.graphics_output_url as string, projectId: job.project_id,
        mediaRoot: config.mediaRoot, mediaBaseUrl: config.mediaBaseUrl, fetchImpl: deps.fetchImpl,
      });
      if (!film.url) throw new Error('MEDIA_BASE_URL is not set: the film was stored but has no public URL');
      await put({ final_url: film.url });
      await markFinished(db, job.project_id, film.url);
      await put({ phase: 'done', finished_at: new Date(), progress: 1 });
      log('done', { url: film.url, bytes: film.bytes });
    }
    return 'done';
  } catch (e) {
    if (e instanceof Dropped) { log('dropped', { reason: e.message }); return 'dropped'; }
    const message = (e as Error).message || String(e);
    log('failed', { error: message });
    await fail(db, job, config.workerId, message).catch((err) => log('could not record the failure', { error: String(err) }));
    return 'failed';
  }
}

/** queued → assemble: freeze the inputs, choose the music, submit /assemble. */
async function start(job: RenderJob, deps: Deps, put: (p: Record<string, unknown>) => Promise<void>, log: (m: string, e?: Record<string, unknown>) => void) {
  const { sceneRows, project, script } = await loadInputs(deps.db, job.project_id);
  if (!project) throw new Error(`project ${job.project_id} not found`);
  // The site's request goes through the same normalisation as the
  // `assemble` webhook's body did, so both paths hand the modules one shape.
  const triggers: Triggers = { normalize: normalizeInput({ Project_ID: job.project_id, ...(job.trigger || {}) }) };
  const music = await chooseMusic(project.fields, deps, log);
  const inputs: Inputs = { triggers, sceneRows, project, script, music };
  const { timeline } = planAssemble(inputs);
  const id = await deps.render.submitAssemble(timeline.body);
  log('assemble submitted', { assembleJob: id, scenes: timeline.sceneCount, music: music?.name ?? null });
  await put({ phase: 'assemble', inputs, assemble_body: timeline.body, assemble_job_id: id, assemble_polls: 0, progress: 0 });
}

/**
 * Only a film with music on needs a track (Build Timeline ignores the pick
 * otherwise), and a pinned track needs no listing. The share step makes the
 * file readable through the render server's media proxy; the Muzica folder is
 * shared by inheritance anyway, so a failed share is logged, not fatal.
 */
async function chooseMusic(fields: AtRow['fields'], deps: Deps, log: (m: string, e?: Record<string, unknown>) => void): Promise<MusicPick | null> {
  if (editingOptions(fields).music !== true) return null;
  const random = deps.random || Math.random;
  let pick = pickMusicTrack(fields, [], [], random);
  if (pick.matched !== 'pinned') {
    const lib = await deps.music.list();
    const folder = matchToneFolder(fields, lib.rootFiles);
    pick = pickMusicTrack(fields, lib.rootFiles, folder.folderId ? lib.folders[folder.folderId] || [] : [], random);
  }
  if (pick.id) await deps.music.share(pick.id).catch((e) => log('share-music failed; relying on the folder share', { error: String(e) }));
  return pick;
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function defaultLog(msg: string, extra: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ at: new Date().toISOString(), msg, ...extra }));
}

/**
 * The loop: keep up to CONCURRENCY jobs in flight, claim more whenever there
 * is room, and on shutdown finish the current poll and give the leases back
 * so the next worker resumes at once instead of waiting them out.
 */
export async function runWorker(deps: Deps, signal: AbortSignal): Promise<void> {
  const { db, config } = deps;
  const running = new Map<string, Promise<Outcome>>();
  while (!signal.aborted) {
    try {
      while (running.size < config.concurrency) {
        const job = await claim(db, config.workerId, config.leaseSeconds, [...running.keys()]);
        if (!job) break;
        running.set(job.id, drive(job, deps, signal).finally(() => running.delete(job.id)));
      }
    } catch (e) {
      (deps.log || defaultLog)('claim failed', { error: String(e) });
    }
    try { await sleepFor(config.pollMs, undefined, { signal }); } catch {}
  }
  await Promise.allSettled(running.values());
  await release(db, config.workerId).catch(() => {});
}
