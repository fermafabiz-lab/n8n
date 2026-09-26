// One production run of a film — Media Generation's batch, stitched from the
// pure steps in setup.ts, gates.ts, images.ts and clips.ts in the order n8n
// runs them:
//
//   setup (photo, sheets, plates, copies on the other accounts)
//   → pass: Sort & Cap → Assign Accounts
//   → voices (queued as media_jobs, the same take the regen button makes)
//   → images, one at a time in pass order (the n-1 chain), with the refusal
//     ladder, the account failover and the consistency judge
//   → the asset gate → the clips (serial, or the three-account pool) → the
//     video gate → every scene Finalizat → another pass if one is owed
//   → the settings gate, which also sends a flagged clip back for a pass.
//
// What n8n kept in an execution is in the row's `state`, saved after every
// step, so a restart resumes where it stopped — including clips IN FLIGHT at
// Google, which n8n threw away. What n8n dispatched as webhooks from inside
// the batch (an image, voice or clip regeneration) is a media_job here.
//
// Waits, counters and ceilings are n8n's; tests shrink the waits.
import { setTimeout as sleepFor } from 'node:timers/promises';
import fs from 'node:fs';
import path from 'node:path';
import type pg from 'pg';
import type { AtRow } from '../assembly/types.ts';
import type { Config } from '../config.ts';
import { enqueueMedia, writeScene } from '../media/db.ts';
import type { Ingest } from '../media/ingest.ts';
import { NetworkError } from '../railway.ts';
import { type ClipServices, SubmitRefused } from '../clip/services.ts';
import { noSpeech } from '../voice/voice.ts';
import * as C from './clips.ts';
import * as D from './db.ts';
import * as G from './gates.ts';
import * as I from './images.ts';
import type { ProduceServices } from './services.ts';
import * as U from './setup.ts';

export interface ProduceDeps {
  db: pg.Pool;
  config: Config;
  services: ProduceServices;
  clip: ClipServices;
  ingest: Ingest;
  log?: (msg: string, extra?: Record<string, unknown>) => void;
  now?: () => number;
  /** n8n's waits, in ms. Tests shrink them. */
  waits?: Partial<Waits>;
}
export interface Waits {
  sheet: number; pace: number; betweenImages: number; gate: number; voicePoll: number;
  firstPoll: number; poll: number; pool: number; cooldown: number; vpImage: number; imgCooldownUnit: number;
}
const WAITS: Waits = {
  sheet: U.SHEET_INTERVAL_MS, pace: 8000, betweenImages: 2000, gate: 15000, voicePoll: 5000,
  firstPoll: C.WAITS.firstPoll * 1000, poll: C.WAITS.poll * 1000, pool: C.WAITS.pool * 1000, cooldown: C.WAITS.cooldown * 1000, vpImage: C.WAITS.imageWait * 1000,
  imgCooldownUnit: 1000,
};

class Dropped extends Error {}
/** Instance-wide in n8n (static data shared by every run): the end-frame pause and the flagged image accounts. */
const shared: { endFrameOffAt?: number; endFrameFailAt?: number; endFrameFails?: number; imgAvoid?: Record<string, number> } = {};

export async function driveProduction(job: D.ProductionJob, deps: ProduceDeps): Promise<'done' | 'failed' | 'dropped'> {
  const { db, config } = deps;
  const W: Waits = { ...WAITS, ...(deps.waits || {}) };
  const now = deps.now || Date.now;
  const log = (msg: string, extra: Record<string, unknown> = {}) =>
    (deps.log || ((m, e) => console.log(JSON.stringify({ at: new Date().toISOString(), msg: m, ...e }))))(msg, { productionJob: job.id, project: job.project_id, stage: job.stage, pass: job.pass, ...extra });
  const pid = job.project_id;
  const rb = { Voice_ID: job.trigger?.Voice_ID, Aspect_Ratio: job.trigger?.Aspect_Ratio || '16:9', Flow_Email: job.trigger?.Flow_Email };
  const st = job.state;
  st.latest = st.latest || {};

  const persist = async () => {
    Object.assign(st.clipState = st.clipState || {}, { endFrameOffAt: shared.endFrameOffAt ?? st.clipState?.endFrameOffAt, endFrameFailAt: shared.endFrameFailAt ?? st.clipState?.endFrameFailAt, endFrameFails: shared.endFrameFails ?? st.clipState?.endFrameFails });
    if (!(await D.saveProduction(db, job, config.workerId, config.leaseSeconds))) throw new Dropped('stopped or taken over');
  };
  const pause = async (ms: number) => { await sleepFor(ms); await persist(); };
  // A single call can outlast the lease (a Flow image may take 180 s): renew it on a timer meanwhile.
  const lease = setInterval(() => { D.heartbeatProduction(db, job, config.workerId, config.leaseSeconds).catch(() => {}); }, Math.max(1000, config.leaseSeconds * 1000 / 3));
  const shareClip = () => { const s = st.clipState; shared.endFrameOffAt = s.endFrameOffAt; shared.endFrameFailAt = s.endFrameFailAt; shared.endFrameFails = s.endFrameFails; };

  const project = async () => { const p = await D.loadProject(db, pid); if (!p) throw new Error('project ' + pid + ' not found'); return p; };

  try {
    for (;;) {
      if (job.stage === 'setup') { await setup(); job.stage = 'voices'; st.passBuilt = false; await persist(); }
      if (job.stage === 'voices') { if (!st.passBuilt) await startPass(); await voices(); job.stage = 'images'; st.imgIndex = 0; await persist(); }
      if (job.stage === 'images') { await images(); job.stage = 'asset_gate'; await persist(); }
      if (job.stage === 'asset_gate') { await assetGate(); job.stage = 'clips'; st.pool = null; st.serialIndex = 0; await persist(); }
      if (job.stage === 'clips') { await clips(); job.stage = 'video_gate'; await persist(); }
      if (job.stage === 'video_gate') { await videoGate(); job.stage = 'finalize'; await persist(); }
      if (job.stage === 'finalize') {
        const more = await finalize();
        if (more) { job.pass += 1; job.stage = 'voices'; st.passBuilt = false; await persist(); continue; }
        job.stage = 'settings_gate'; st.settingsMarked = false; await persist();
      }
      if (job.stage === 'settings_gate') {
        const again = await settingsGate();
        if (again) { job.pass += 1; job.stage = 'voices'; st.passBuilt = false; await persist(); continue; }
        break;
      }
      if (job.stage === 'done') break;
    }
    await D.finishProduction(db, job, config.workerId, 'done');
    log('production done');
    return 'done';
  } catch (e) {
    if (e instanceof Dropped) { log('production dropped', { reason: e.message }); return 'dropped'; }
    const message = (e as Error).message || String(e);
    log('production failed', { error: message });
    await D.finishProduction(db, job, config.workerId, 'failed', message.slice(0, 4000)).catch(() => {});
    return 'failed';
  } finally {
    clearInterval(lease);
  }

  // --- Setup ----------------------------------------------------------------------------------------
  async function setup() {
    let pf = (await project()).fields || {};
    let savedUserRefId: string | undefined;
    if (U.userRefNeeded(pf)) {
      const photo = await deps.services.download(U.userRefUrl(pf));
      const up = photo ? await deps.services.uploadAsset(U.USER_REF_ACCOUNT, photo.bytes, photo.contentType) : { error: { message: 'the photo could not be downloaded' } };
      if (up && !up.error) {
        savedUserRefId = U.extractAssetId(up).mediaId;
        await D.patchEditingOptions(db, pid, U.userRefPatch(savedUserRefId));
        log('user photo uploaded', { mediaId: savedUserRefId });
      } else log('user photo not uploaded', { error: up?.error });
    }
    const castWork = U.castSheetPrep({ projectFields: pf, scenes: await D.sceneCast(db, pid), flowEmail: rb.Flow_Email, aspectRatio: rb.Aspect_Ratio, savedUserRefId });
    if (!(castWork[0] as any).skip) {
      const work = castWork as U.SheetWork[];
      const answers = await drawEach(work);
      const c = U.collectCastRefs(work, answers, pf);
      await D.patchEditingOptions(db, pid, U.castPatch(c)).catch((e) => log('saving the sheets failed', { error: String(e) }));
      await keep(U.ingestPrep(work, answers, pid, false));
      log('sheets', { made: c.made, asked: work.map((w) => w.sheet + ':' + w.name) });
    }
    pf = (await project()).fields || {};
    const plateWork = U.setPlatePrep(pf, rb.Flow_Email, rb.Aspect_Ratio);
    if (!(plateWork[0] as any).skip) {
      const work = plateWork as U.PlateWork[];
      const answers = await drawEach(work);
      const c = U.collectSetPlates(work, answers, pf);
      await D.patchEditingOptions(db, pid, U.platePatch(c));
      await keep(U.ingestPrep(work, answers, pid, true));
      log('plates', { made: c.made });
    }
    pf = (await project()).fields || {};
    const media = await D.sheetMedia(db, pid, config.mediaBaseUrl);
    const local: Record<string, string> = {};
    for (const m of await db.query(`select flow_id, path from hov.sheet_media where project_id = $1`, [pid]).then((r) => r.rows)) local[m.flow_id] = m.path;
    const rep = U.replicatePrep(pf, media);
    log('replication plan', { stored: media.length, uploads: (rep[0] as any).skip ? 0 : rep.length });
    st.freshFlowRefs = {};
    if (!(rep[0] as any).skip) {
      const built: Record<string, Record<string, string>> = {};
      for (const w of rep as U.ReplicateWork[]) {
        const bytes = await readLocal(local[w.primaryId]) || await deps.services.download(w.url);
        const up = bytes ? await deps.services.uploadAsset(w.account, bytes.bytes, bytes.contentType) : { error: { message: 'could not read ' + w.url } };
        const r = U.collectReplicated(w, up, built);
        if (!r.newId) log('replication failed', { key: w.key, account: w.account, error: up?.error });
        await persist();
      }
      const b = U.buildFlowRefs(built);
      st.freshFlowRefs = b.flowRefs;
      if (U.refsToSave(b)) await D.patchEditingOptions(db, pid, U.flowRefsPatch(b, pf));
      log('replicated', { copies: b.count });
    }
  }
  async function drawEach(work: Array<{ requestBody: Record<string, unknown> }>) {
    const answers: any[] = [];
    for (let i = 0; i < work.length; i++) {
      if (i) await pause(W.sheet);
      answers.push(await deps.services.generateImage(U.sheetBody(work[i])));
    }
    return answers;
  }
  async function keep(prep: ReturnType<typeof U.ingestPrep>) {
    if (prep.skip) return;
    try { await deps.services.ingestSheets(prep.projectId, prep.items); } catch (e) { log('sheet ingest failed', { error: String(e) }); }
  }
  async function readLocal(rel: string | undefined) {
    if (!rel) return null;
    try { const p = path.join(config.mediaRoot, rel); return { bytes: await fs.promises.readFile(p), contentType: /\.jpe?g$/i.test(p) ? 'image/jpeg' : 'image/png' }; } catch { return null; }
  }

  // --- A pass: Sort & Cap Scenes → Assign Accounts ------------------------------------------------------
  async function startPass() {
    const pf = (await project()).fields || {};
    const sorted = G.sortAndCap(await D.approvedScenes(db, pid));
    const assigned = G.assignAccounts(sorted, pf, st.freshFlowRefs || {});
    st.expected = sorted.map((r) => r.id);
    st.snapshot = sorted;
    st.assignments = assigned.map((r: any) => ({ id: r.id, flowEmail: r.flowEmail }));
    // Sort & Cap resets every per-scene counter each pass; the flagged
    // accounts and the end-frame pause outlive it.
    st.imageState = { imgAvoid: shared.imgAvoid || st.imageState?.imgAvoid || {} };
    const cs = st.clipState || {};
    st.clipState = { imageWaits: cs.imageWaits || {}, endFrameOffAt: cs.endFrameOffAt, endFrameFailAt: cs.endFrameFailAt, endFrameFails: cs.endFrameFails };
    st.latest = {};
    st.passBuilt = true;
    log('pass', { scenes: sorted.length, accounts: [...new Set(st.assignments.map((a: any) => a.flowEmail))] });
    await persist();
  }

  // --- Voices -----------------------------------------------------------------------------------------------
  async function voices() {
    const pf = (await project()).fields || {};
    const rows = await D.scenesById(db, st.expected);
    const wanted = rows.filter((r) => String((r.fields || {})['Voiceover URL'] || '') === '' && !noSpeech(r, pf)).map((r) => r.id);
    for (const id of wanted) await enqueueMedia(db, id, 'voice', { batch: true }, 'production:' + job.id);
    if (wanted.length) log('voices queued', { scenes: wanted.length });
    for (;;) {
      const active = (await D.activeMedia(db, wanted)).filter((m) => m.kind === 'voice');
      if (!active.length) return;
      await pause(W.voicePoll);
    }
  }

  // --- Images: Loop Images, one scene at a time in pass order ---------------------------------------------------
  async function images() {
    const snapshot: AtRow[] = st.snapshot || [];
    st.imgIndex = st.imgIndex || 0;
    for (; st.imgIndex < snapshot.length; st.imgIndex++) {
      let scene: AtRow = (await D.sceneRow(db, snapshot[st.imgIndex].id)) || snapshot[st.imgIndex];
      if (!I.needsImage(scene)) continue;
      await oneImage(scene);
      await pause(W.betweenImages);
    }
  }
  async function oneImage(scene0: AtRow) {
    let scene = scene0;
    const imageState = st.imageState as I.ImageState;
    for (;;) {
      const pf = (await project()).fields || {};
      // The n-1 chain: the PREVIOUS build's prompt and place, and the picture
      // it decoded to, across the whole run as n8n's $runIndex is. n8n reads
      // the two from `$runIndex - 1` of two different nodes, which drift apart
      // once a Generate fails (Decode does not run) or a cooldown retries
      // (Decode runs twice); this takes what the code means, not the drift.
      const req = I.buildImageRequest({ scene, aspectRatio: rb.Aspect_Ratio, flowEmail: rb.Flow_Email, projectFields: pf, prev: st.lastBuild || null, state: imageState });
      st.lastBuild = { rawPrompt: req.rawPrompt, locTags: (req as any).locTags ?? null, mediaId: '' };
      let answer: any;
      // Flow Pace → IMG Account → Generate Scene Image, and the cooldown loop around them.
      for (;;) {
        await pause(W.pace);
        const chosen = I.imgAccount(scene.id, st.assignments, imageState, now());
        const stored = (() => { try { return JSON.parse(pf['Editing Options'] || '{}').flowRefs || {}; } catch { return {}; } })();
        const body = I.generateBody(req, st.assignments, chosen, { fresh: st.freshFlowRefs || {}, stored });
        answer = await deps.services.generateImage(body);
        let failure: any = null;
        if (answer && answer.error) failure = answer;
        else { try { answer = I.decodeSceneImage(answer, scene.id); } catch (e) { failure = { error: { message: (e as Error).message } }; } }
        if (!failure) break;
        const routed = I.routeImageError(failure); // throws when Flow is out of credits
        if (routed.imgRefusal) { answer = { refusal: routed }; break; }
        // IMG Cooldown Guard → Wait IMG Cooldown → IMG Retry Now?, until it says retry.
        for (;;) {
          const g = I.imgCooldown(scene.id, routed, chosen.imgAccount, st.assignments, imageState, now());
          shared.imgAvoid = imageState.imgAvoid;
          log('image cooldown', { scene: scene.id, n: g.cooldown, failover: g.failover, error: g.lastError });
          await pause((g.waitSeconds || 60) * W.imgCooldownUnit);
          if (g.retryNow) break;
        }
      }
      if (answer.refusal) {
        const p = I.prepFlowReject(scene, answer.refusal, req.rawPrompt, imageState);
        if (p.giveUp) { await writeScene(db, scene.id, I.rejectedFields(p)); log('image rejected', { scene: scene.id, reason: p.reason }); return; }
        const rewritten = await deps.services.chat(I.rewritePromptBody(p));
        await writeScene(db, scene.id, I.rewrittenFields(p, rewritten));
        log('image prompt rewritten', { scene: scene.id, attempt: p.attempt });
        scene = (await D.sceneRow(db, scene.id)) || scene;
        await persist();
        continue;
      }
      const dec = answer as { sceneId: string; url: string; mediaId: string };
      st.lastBuild.mediaId = dec.mediaId;
      const jp = I.judgePrep(dec, req, pf, undefined, now());
      const judged = jp.skip ? {} : await deps.services.chat((jp as any).body);
      const v = I.judgeVerdict(dec, jp, judged, imageState);
      if (v.reroll === true) {
        log('image re-roll', { scene: scene.id, problems: v.problems });
        scene = (await D.sceneRow(db, scene.id)) || scene;
        await persist();
        continue;
      }
      await deps.ingest.image(scene.id, dec.url, I.writtenImageFields(dec.mediaId));
      log('image', { scene: scene.id, verdict: (v as any).verdict, mediaId: dec.mediaId });
      await persist();
      return;
    }
  }

  // --- The asset gate ----------------------------------------------------------------------------------------------
  async function assetGate() {
    for (;;) {
      const pf = (await project()).fields || {};
      const rows = await D.scenesById(db, st.expected);
      const g = G.assetGate(st.expected, rows, pf);
      await dispatch(g.flagged, 'image');
      if (g.allApproved) { log('asset gate open', { scenes: g.total }); return; }
      await pause(W.gate);
    }
  }
  /** What the gates dispatched as webhooks from inside the batch: a regeneration nobody is doing yet. */
  async function dispatch(ids: string[], kind: 'image' | 'voice' | 'clip') {
    if (!ids.length) return;
    const busy = new Set((await D.activeMedia(db, ids)).filter((m) => m.kind === kind).map((m) => m.scene_id));
    for (const id of ids) if (!busy.has(id)) { const q = await enqueueMedia(db, id, kind, {}, 'production:' + job.id); if (q) log('regeneration queued', { scene: id, kind }); }
  }

  // --- Clips ---------------------------------------------------------------------------------------------------------
  async function clips() {
    const pf = (await project()).fields || {};
    const sorted = C.sortScenesForVideo(st.expected, await D.scenesById(db, st.expected));
    if (C.videoPoolOn(pf)) return poolLoop(sorted);
    st.serialIndex = st.serialIndex || 0;
    for (; st.serialIndex < sorted.length; st.serialIndex++) {
      const row = (await D.sceneRow(db, sorted[st.serialIndex].id)) || sorted[st.serialIndex];
      await serialScene(C.currentScene(row, rb, pf, st.clipState));
      await persist();
    }
  }
  const inPool = () => !!st.pool;

  /** Mark Generare Video → End Frame Prompt → (Generate / Attach End Frame) → Submit Video. */
  async function startClip(cs: any) {
    await writeScene(db, cs.id, C.generatingFields());
    const pf = (await project()).fields || {};
    const efp = C.endFramePrompt(cs, rb, pf, st.clipState, now());
    if (efp.ok) {
      const a = C.attachEndFrame(efp.sceneId, await deps.clip.drawEndFrame(C.endFrameBody(efp, st.assignments)));
      st.latest.attached = a;
      log('end frame', { scene: cs.id, endImage: a.endImage || null, error: a.reason || null });
    }
    return submit(cs);
  }
  /** One Submit Video; a refusal goes through Submit Cooldown Guard. Serially it waits and retries in place. */
  async function submit(cs: any): Promise<{ jobid: string } | { guard: any }> {
    for (;;) {
      const body = C.submitVideoBody(cs, { assignments: st.assignments, attached: st.latest.attached, guard: st.latest.guard, resubmit: st.latest.resubmit, tick: st.latest.tick });
      try {
        const jobid = await deps.clip.submitVideo(body);
        log('clip submitted', { scene: cs.id, email: body.email, model: body.model, seed: body.seed });
        return { jobid };
      } catch (e) {
        if (!(e instanceof SubmitRefused) && !(e instanceof NetworkError)) throw e;
        const item = e instanceof SubmitRefused ? e.item : { error: { message: (e as Error).message } };
        const g = C.submitCooldownGuard(cs.id, item, st.clipState, { inPool: inPool(), attached: st.latest.attached, now: now() });
        shareClip();
        st.latest.guard = g;
        log('clip submit refused', { scene: cs.id, n: g.cooldown, error: g.lastError });
        if (g.inPool) return { guard: g };
        await pause(W.cooldown);
      }
    }
  }
  type PollOutcome = { kind: 'running' } | { kind: 'kept' } | { kind: 'resubmit'; cs: any } | { kind: 'rejected' } | { kind: 'restart'; cs: any };
  /** Poll Video Job → Check Job Status → done (judge, keep or re-roll) / failed (the ladder, or a resubmit) / running. */
  async function pollOnce(cs: any, jobid: string): Promise<PollOutcome> {
    let item: any;
    try { item = await deps.clip.pollJob(jobid); }
    catch (e) { if (e instanceof NetworkError) return { kind: 'running' }; throw e; }
    const c = C.checkJobStatus(item, cs.id, st.clipState);
    if (c.done) {
      const ev = C.extractVideoUrl(c);
      const pf = (await project()).fields || {};
      const prep = C.motionPrep(ev, cs, pf, st.clipState);
      let judged: any = {};
      if (prep.ok) {
        const sheet = await deps.clip.contactSheet(prep.videoUrl);
        judged = sheet ? await deps.clip.judge(C.motionJudgeBody(prep, sheet)) : { error: 'no contact sheet' };
      }
      const v = C.motionVerdict(prep, judged, st.clipState);
      if (v.motionReroll === true) {
        st.latest.resubmit = C.motionResubmit(v, cs, st.clipState);
        log('motion re-roll', { scene: cs.id, problems: v.problems });
        return { kind: 'resubmit', cs };
      }
      const ingested = await deps.ingest.image(cs.id, ev.Video_Signed_URL, {}, 'video');
      const stored = ingested?.media?.url;
      if (!stored) throw new Error('the site stored the clip for ' + cs.id + ' but returned no URL');
      await writeScene(db, cs.id, C.clipWrittenFields(cs, stored, ev.Video_Media_Id));
      log('clip', { scene: cs.id, url: stored, verdict: v.motionVerdict });
      return { kind: 'kept' };
    }
    if (c.jobFailed) {
      if (C.isFilterFailure(c)) return vpLadder(cs, c);
      C.resubmitGuard(cs.id, c, st.clipState); // throws past 5, as n8n's batch dies
      log('clip job failed, resubmitting', { scene: cs.id, error: String(c.error || c.status).slice(0, 200) });
      return { kind: 'resubmit', cs };
    }
    return { kind: 'running' };
  }
  /** VP Prep → a new still (twice, steered) → resubmit; or Mark Video Prompt Rejected. */
  async function vpLadder(cs: any, failed: any): Promise<PollOutcome> {
    const vp = C.vpPrep(cs, failed, st.clipState);
    log('clip refused by the filter', { scene: cs.id, reason: vp.reason, attempt: vp.attempt });
    if (vp.giveUp) { await writeScene(db, vp.sceneId, C.vpRejectedFields(vp)); return { kind: 'rejected' }; }
    await writeScene(db, vp.sceneId, C.vpSteerFields(vp));
    await enqueueMedia(db, vp.sceneId, 'image', {}, 'production:' + job.id);
    for (;;) {
      await pause(W.vpImage);
      const r = C.vpImageReady(vp, await D.sceneImageState(db, C.vpCheckId(vp)), st.clipState);
      if (r.state === 'wait') continue;
      if (r.state === 'timeout') { await writeScene(db, vp.sceneId, C.vpRejectedFields(vp)); return { kind: 'rejected' }; }
      break;
    }
    if (C.vpPromptFix(vp)) await writeScene(db, vp.sceneId, C.vpApplyFields(vp, await deps.services.chat(C.vpRewriteBody(vp))));
    else await writeScene(db, vp.sceneId, C.vpNoteStillFields(vp));
    const reloaded = await D.sceneRow(db, vp.sceneId);
    const pf = (await project()).fields || {};
    return { kind: 'restart', cs: C.currentScene(reloaded, rb, pf, st.clipState) };
  }

  /** The serial loop's one scene, start to finish. */
  async function serialScene(cs0: any) {
    let cs = cs0;
    if (!C.needsClip(cs)) return;
    let r = await startClip(cs);
    for (;;) {
      if (!('jobid' in r)) throw new Error('unreachable: a serial submit always ends with a job');
      await pause(W.firstPoll);
      let out: PollOutcome;
      for (;;) {
        out = await pollOnce(cs, r.jobid);
        if (out.kind !== 'running') break;
        await pause(W.poll);
      }
      if (out.kind === 'kept' || out.kind === 'rejected') return;
      if (out.kind === 'resubmit') { r = await submit(cs); continue; }
      cs = out.cs;
      if (!C.needsClip(cs)) return;
      r = await startClip(cs);
    }
  }

  /** The pool: Pool Tick → one action → Pool Record, until Pool Tick says done. */
  async function poolLoop(sorted: AtRow[]) {
    const pf = (await project()).fields || {};
    const ctx = () => ({ input: sorted, sortRows: sorted, projectFields: pf, assignments: st.assignments, now: now() });
    for (;;) {
      const out = C.poolTick(st.pool || null, ctx());
      st.pool = out.pool;
      st.latest.tick = out;
      await persist();
      if (out.poolAction === 'done') { log('pool done', { ticks: out.pool.ticks }); return; }
      if (out.poolAction === 'wait') { await pause(W.pool); continue; }
      if (out.poolAction === 'steal') {
        const fresh = await deps.services.assetUrl(out.poolImageId);
        let up: any = fresh;
        if (fresh && !fresh.error) {
          const bytes = fresh.url ? await deps.services.download(fresh.url) : null;
          up = bytes ? await deps.services.uploadAsset(out.poolTo, bytes.bytes, bytes.contentType) : { error: { message: 'the still could not be downloaded' } };
        }
        st.pool = C.stealRecord(out, up).pool;
        log('pool steal', { scene: out.poolSceneId, to: out.poolTo, ok: !!(st.pool.stolen || {})[out.poolSceneId] });
        continue;
      }
      let cs = C.currentScene(out, rb, pf, st.clipState);
      let from: C.RecordFrom;
      let jobid: string | undefined;
      let guard: any;
      const submitted = (r: { jobid: string } | { guard: any }) => { if ('jobid' in r) { jobid = r.jobid; return 'Pool Submitted?'; } guard = r.guard; return 'Pool Cooldown?'; };
      if (out.poolAction === 'poll') {
        const o = await pollOnce(cs, out.poolJobid);
        if (o.kind === 'running') from = 'Pool Retry?';
        else if (o.kind === 'kept') from = 'Update Scene Record';
        else if (o.kind === 'rejected') from = 'Mark Video Prompt Rejected';
        else if (o.kind === 'resubmit') from = submitted(await submit(cs));
        else { cs = o.cs; from = C.needsClip(cs) ? submitted(await startClip(cs)) : 'Needs Clip?'; }
      } else if (!C.needsClip(cs)) from = 'Needs Clip?';
      else from = submitted(await startClip(cs));
      st.pool = C.poolRecord(st.pool, from, cs, { jobid, guard, now: now() })!.pool;
      await persist();
    }
  }

  // --- The video gate, Finalizat, another pass ------------------------------------------------------------------------------
  async function videoGate() {
    for (;;) {
      const rows = await D.scenesById(db, st.expected);
      const g = G.videoGate(st.expected, rows);
      await dispatch(g.flaggedVoice, 'voice');
      await dispatch(g.flaggedVideo, 'clip');
      if (g.allApproved) { log('video gate open', { scenes: g.total }); return; }
      await pause(W.gate);
    }
  }
  async function finalize() {
    for (const id of new Set(st.expected as string[])) await writeScene(db, id, { 'Status Producție Scenă': 'Finalizat' });
    const m = G.morePasses(await D.approvedScenes(db, pid), job.pass);
    log('pass finished', { remaining: m.remaining, more: m.more });
    return m.more;
  }
  async function settingsGate() {
    if (!st.settingsMarked) { await D.writeProject(db, pid, { 'Status General': G.SETTINGS_WAITING }); st.settingsMarked = true; await persist(); }
    const bounced = new Set<string>(st.bounced || []);
    for (;;) {
      await pause(W.gate);
      st.settingsChecks = (st.settingsChecks || 0) + 1;
      const pf = (await project()).fields || {};
      const r = G.settingsGate(pf, await D.approvedScenes(db, pid), st.settingsChecks - 1, bounced);
      st.bounced = [...bounced];
      if (r.confirmed) { log('settings confirmed', { status: r.status, timedOut: r.timedOut }); return false; }
      if (r.regenPending) { st.settingsMarked = false; log('settings gate: a clip was flagged, another pass'); return true; }
    }
  }
}

/** The production loop beside the render and media loops (src/main.ts). */
export async function runProductionWorker(deps: ProduceDeps, signal: AbortSignal): Promise<void> {
  const { db, config } = deps;
  const running = new Map<string, Promise<unknown>>();
  while (!signal.aborted) {
    try {
      while (running.size < config.productionConcurrency) {
        const job = await D.claimProduction(db, config.workerId, config.leaseSeconds, [...running.keys()]);
        if (!job) break;
        running.set(job.id, driveProduction(job, deps).finally(() => running.delete(job.id)));
      }
    } catch (e) {
      (deps.log || console.log)('production claim failed', { error: String(e) });
    }
    try { await sleepFor(Math.min(config.pollMs, 2000), undefined, { signal }); } catch {}
  }
  await Promise.allSettled([...running.values()]);
  await D.releaseProduction(db, config.workerId).catch(() => {});
}
