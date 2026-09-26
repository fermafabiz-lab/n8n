// The production pass's CLIP stage (Media Generation's `Loop Scenes` chain and
// the three-account pool beside it), ported node by node. Pure functions: what
// n8n keeps in workflow static data is an explicit `ClipBatchState`, what a node
// reads out of another node's LATEST run is passed in, and `now` is a parameter.
// engine/check-produce-clips.mjs holds each one to its live node.
//
// The regeneration chain (`RG *`, src/clip/regen.ts) is a near-copy of this one
// and is deliberately NOT shared: the two differ in keys (`regen:<id>`), seeds
// (`:rgmotion:`), ceilings (4 resubmits against 5) and in where the motion comes
// from, and each is pinned to its own node.
import type { AtRow, Fields } from '../assembly/types.ts';
import { isFilterFailure } from '../clip/regen.ts';
import { MANAGER } from './accounts.ts';

export { isFilterFailure };
export const FREE_MODEL = 'veo-3.1-lite-low-priority';
export const PAID_MODEL = 'veo-3.1-quality';
export const HOOK_MODEL = 'veo-3.1-fast';
/** 20 polls × 30 s: the measured ten-minute ceiling (Check Job Status). */
export const MAX_POLLS = 20;
export const MAX_RESUBMITS = 5;
export const MAX_COOLDOWNS = 20;
export const MAX_REROLLS = 1;
export const MAX_VP_ATTEMPTS = 2;
export const MAX_IMAGE_WAITS = 16;
export const END_FRAME_OFF_MS = 6 * 60 * 60 * 1000;
/** The pool's own poll cadence and ceiling (Pool Tick). */
export const POOL_POLL_EVERY_MS = 20000;
export const POOL_MAX_POLLS = 90;
export const POOL_REST_MS = 60 * 1000;
/** n8n's waits, in seconds (Wait Video, Wait Retry, Pool Wait, Wait Submit Cooldown, VP Image Wait). */
export const WAITS = { firstPoll: 30, poll: 15, pool: 20, cooldown: 60, imageWait: 15 };

/**
 * What the clip stage kept in `$getWorkflowStaticData('global')`. Everything
 * but `imageWaits` and the three end-frame keys is reset per pass by Sort & Cap
 * Scenes; the worker starts a pass with a fresh object for those.
 */
export interface ClipBatchState {
  polls?: Record<string, number>;
  resubmits?: Record<string, number>;
  submitCooldowns?: Record<string, number>;
  rewrites?: Record<string, number>;
  motionRerolls?: Record<string, number>;
  motionNotes?: Record<string, string>;
  imageWaits?: Record<string, number>;
  endFrameOffAt?: number;
  endFrameFailAt?: number;
  endFrameFails?: number;
}
/** Receive Batch Input, the two keys this stage reads. */
export interface BatchInput { Flow_Email?: string; Aspect_Ratio?: string }
export interface Assignment { id: string; flowEmail?: string }

const opts = (projectFields: Fields | undefined): any => {
  try { return JSON.parse(((projectFields || {})['Editing Options']) || '{}') || {}; } catch (e) { return {}; }
};
const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const decodeOwner = (id: unknown) => {
  let owner = '';
  const hx = String(id || '').match(/-email:([0-9a-f]+)-/i);
  if (hx) { for (let k = 0; k < hx[1].length; k += 2) owner += String.fromCharCode(parseInt(hx[1].substr(k, 2), 16)); }
  return owner;
};

// --- Sort Scenes For Video / Video Pool? / Needs Clip? -------------------------------------------
/** The pass's scenes, once each, in the pass's order; every one must have its image. */
export function sortScenesForVideo(expected: string[], rows: AtRow[]): AtRow[] {
  const order: Record<string, number> = {};
  expected.forEach((id, i) => { order[id] = i; });
  const seen = new Set<string>();
  const recs = rows
    .filter((r) => order[r.id] !== undefined)
    .filter((r) => { if (seen.has(r.id)) return false; seen.add(r.id); return true; })
    .slice()
    .sort((a, b) => order[a.id] - order[b.id]);
  const missing = recs.filter((r) => { const a = (r.fields || {})['Imagine Scenă']; return !(Array.isArray(a) && a[0] && a[0].url); });
  if (missing.length) throw new Error('Scenes missing approved image: ' + missing.map((r) => r.id).join(', '));
  return recs;
}
export const videoPoolOn = (projectFields: Fields | undefined) => { try { return JSON.parse((projectFields || {})['Editing Options'] || '{}').videoPool === true; } catch (e) { return false; } };
export const needsClip = (row: AtRow) => String(((row.fields || {})['Scene Final URL']) || '') === '';

// --- The pool -----------------------------------------------------------------------------------------
export interface QueueEntry { id: string; account: string; noSteal?: boolean }
export interface InflightEntry { id: string; account: string; jobid: string; polls: number; lastPollAt: number }
export interface Pool {
  per: number; queue: QueueEntry[]; inflight: InflightEntry[]; done: string[]; ticks: number; accounts: string[];
  stolen: Record<string, { image: string; account: string; from: string; original: string }>;
  cooldownUntil?: Record<string, number>;
  freshImage?: Record<string, string>;
}
export interface TickContext {
  /** The rows the pool starts from (Sort Scenes For Video's output, on the first tick). */
  input: AtRow[];
  /** Sort Scenes For Video's output, which every scene row is read back from. */
  sortRows: AtRow[];
  projectFields: Fields | undefined;
  assignments: Assignment[];
  now: number;
}

/**
 * Pool Tick: ONE tick = ONE action on ONE scene — poll the stalest clip in
 * flight, else submit the next queued scene on an account with room, else steal
 * a still for an idle account, else wait or finish. Mutates `pool` as n8n does.
 */
export function poolTick(pool: Pool | null, c: TickContext): any {
  if (!pool) {
    const o = opts(c.projectFields);
    let per = 1;
    const rawPer = o.videoPoolPerAccount;
    if (typeof rawPer === 'number' && Number.isInteger(rawPer) && rawPer >= 1 && rawPer <= 4) per = rawPer;
    const acct: Record<string, string> = {};
    (c.assignments || []).forEach((x) => { if (x && x.id) acct[x.id] = String(x.flowEmail || ''); });
    const queue: QueueEntry[] = [];
    c.input.forEach((r) => {
      const id = r && r.id;
      if (!id) return;
      const f = r.fields || {};
      if (String(f['Scene Final URL'] || '') !== '') return;
      let owner = decodeOwner(f['Image Media ID']);
      if (owner.indexOf('@') < 0) owner = '';
      queue.push({ id: String(id), account: owner || acct[id] || '' });
    });
    const accounts: string[] = [];
    queue.forEach((q) => { if (accounts.indexOf(q.account) < 0) accounts.push(q.account); });
    pool = { per, queue, inflight: [], done: [], ticks: 0, accounts, stolen: {} };
  }
  const P = pool;
  P.ticks = (P.ticks || 0) + 1;
  const now = c.now;
  let action: any = null;
  const due = P.inflight
    .filter((j) => now - Number(j.lastPollAt || 0) >= POOL_POLL_EVERY_MS)
    .sort((a, b) => Number(a.lastPollAt || 0) - Number(b.lastPollAt || 0));
  const used: Record<string, number> = {};
  P.inflight.forEach((j) => { used[j.account] = (used[j.account] || 0) + 1; });
  const cooling = (a: string) => Number((P.cooldownUntil || {})[a] || 0) > now;
  const pickSteal = () => {
    const accounts = P.accounts || [];
    if (accounts.length < 2) return null;
    const idle = accounts.filter((a) => (used[a] || 0) < P.per && !cooling(a));
    if (!idle.length) return null;
    const byAcct: Record<string, QueueEntry[]> = {};
    P.queue.forEach((q) => { if (q.noSteal) return; (byAcct[q.account] = byAcct[q.account] || []).push(q); });
    let donor = '';
    let best = 1;
    Object.keys(byAcct).forEach((a) => { if (byAcct[a].length > best) { best = byAcct[a].length; donor = a; } });
    if (!donor || byAcct[donor].length < 2) return null;
    const to = idle.filter((a) => a !== donor)[0];
    if (to === undefined) return null;
    const victim = byAcct[donor][byAcct[donor].length - 1];
    return { id: victim.id, from: donor, to, entry: victim };
  };
  if (due.length) {
    const j = due[0];
    action = { kind: 'poll', id: j.id, account: j.account, jobid: j.jobid };
  } else {
    const next = P.queue.find((q) => (used[q.account] || 0) < P.per && !cooling(q.account));
    if (next) action = { kind: 'submit', id: next.id, account: next.account };
    else {
      const steal = pickSteal();
      if (steal) action = { kind: 'steal', id: steal.id, from: steal.from, to: steal.to, entry: steal.entry };
      else if (P.inflight.length || P.queue.length) action = { kind: 'wait' };
      else action = { kind: 'done' };
    }
  }
  if (action.kind === 'poll') {
    const j = P.inflight.find((x) => x.id === action.id);
    if (j && Number(j.polls || 0) >= POOL_MAX_POLLS) {
      P.inflight = P.inflight.filter((x) => x.id !== j.id);
      P.done.push(j.id);
      action = { kind: 'wait' };
    }
  }
  if (action.kind === 'done') return { pool: P, poolAction: 'done' };
  if (action.kind === 'wait') return { pool: P, poolAction: 'wait' };
  const row = c.sortRows.find((r) => r && String(r.id) === String(action.id));
  if (!row) throw new Error('Pool Tick: scene ' + action.id + ' is not in Sort Scenes For Video output');
  const fresh = (P.freshImage || {})[action.id] || '';
  const rowFields: Fields = Object.assign({}, row.fields || {});
  if (fresh) rowFields['Image Media ID'] = fresh;
  if (action.kind === 'steal') {
    const imageId = String(rowFields['Image Media ID'] || '');
    if (!imageId) { action.entry.noSteal = true; return { pool: P, poolAction: 'wait' }; }
    return { poolAction: 'steal', poolSceneId: action.id, poolFrom: action.from, poolTo: action.to, poolImageId: imageId, pool: P };
  }
  return Object.assign({}, row, { fields: rowFields, poolAction: action.kind, poolSceneId: action.id, poolAccount: action.account, poolJobid: action.jobid || '', pool: P });
}

/** Which edge reached Pool Record — n8n tells them apart by `$prevNode.name`. */
export type RecordFrom = 'Pool Submitted?' | 'Pool Cooldown?' | 'Pool Retry?' | 'Update Scene Record' | 'Mark Video Prompt Rejected' | 'Needs Clip?' | string;

/**
 * Pool Record: fold one tick's outcome back into the pool. `scene` is Current
 * Scene's latest output; `jobid` Submit Video's; `guard` Submit Cooldown Guard's.
 * Returns null for the pool-off pass-through.
 */
export function poolRecord(pool: Pool | null, from: RecordFrom, scene: any, x: { jobid?: string; guard?: any; now: number }) {
  if (!pool) return null;
  const P = pool;
  const sceneId = String((scene && scene.id) || '');
  const inflight = P.inflight || [];
  const queue = P.queue || [];
  const done = P.done || [];
  const drop = (id: string) => { P.inflight = inflight.filter((j) => j.id !== id); };
  const unqueue = (id: string) => { P.queue = queue.filter((q) => q.id !== id); };
  if (from === 'Pool Submitted?') {
    const jobid = String(x.jobid || '');
    const q = queue.find((e) => e.id === sceneId);
    const prev = inflight.find((e) => e.id === sceneId);
    const account = (q && q.account) || (scene && scene.poolAccount) || (prev && prev.account) || '';
    drop(sceneId);
    unqueue(sceneId);
    if (jobid) P.inflight.push({ id: sceneId, account, jobid, polls: 0, lastPollAt: x.now });
    else { done.push(sceneId); P.done = done; }
  } else if (from === 'Pool Cooldown?') {
    const g = x.guard || {};
    const prev = inflight.find((e) => e.id === sceneId);
    const q = queue.find((e) => e.id === sceneId);
    const stolen = (P.stolen || {})[sceneId] || null;
    let img = '';
    try { img = String(((scene && scene.videoRequest) || {}).startImage || ((scene && scene.fields) || {})['Image Media ID'] || ''); } catch (e) { img = ''; }
    let owner = decodeOwner(img);
    if (owner.indexOf('@') < 0) owner = '';
    const account = (stolen && stolen.account) || (prev && prev.account) || (q && q.account) || (scene && scene.poolAccount) || owner || '';
    drop(sceneId);
    unqueue(sceneId);
    if (g.giveUp) {
      if (done.indexOf(sceneId) < 0) done.push(sceneId);
      P.done = done;
    } else {
      P.cooldownUntil = P.cooldownUntil || {};
      P.cooldownUntil[account] = x.now + POOL_REST_MS;
      if (img) { P.freshImage = P.freshImage || {}; P.freshImage[sceneId] = img; }
      P.queue.unshift({ id: sceneId, account });
    }
  } else if (from === 'Pool Retry?') {
    const j = inflight.find((e) => e.id === sceneId);
    if (j) { j.polls = Number(j.polls || 0) + 1; j.lastPollAt = x.now; }
  } else {
    drop(sceneId);
    unqueue(sceneId);
    if (done.indexOf(sceneId) < 0) done.push(sceneId);
    P.done = done;
  }
  return { pool: P };
}

/** Steal Record: the copied still's id, believed only when its encoded owner is the target account. */
export function stealRecord(tick: any, upload: any) {
  const pool: Pool | null = (tick && tick.pool) || null;
  if (!pool) throw new Error('Steal Record: no pool state on Pool Tick — this node is only reachable from a steal tick.');
  const id = String(tick.poolSceneId || '');
  const to = String(tick.poolTo || '');
  const from = String(tick.poolFrom || '');
  const item = upload || {};
  let newId = '';
  const raw = item.mediaGenerationId;
  if (typeof raw === 'string') newId = raw;
  else if (raw && typeof raw.mediaGenerationId === 'string') newId = raw.mediaGenerationId;
  const owner = decodeOwner(newId);
  if (newId && owner !== to) newId = '';
  pool.stolen = pool.stolen || {};
  const q = (pool.queue || []).find((e) => e.id === id);
  if (newId && q) {
    pool.stolen[id] = { image: newId, account: to, from, original: String(tick.poolImageId || '') };
    q.account = to;
  } else if (q) q.noSteal = true;
  return { pool };
}

// --- Current Scene ----------------------------------------------------------------------------------
/** The scene, unchanged, plus the video request built for it (model, seed, the composed prompt). */
export function currentScene(row: any, rb: BatchInput, projectFields: Fields | undefined, state: ClipBatchState) {
  const f = row.fields || {};
  const o = opts(projectFields);
  const base = String(o.videoModel || FREE_MODEL);
  let takes = 0;
  try {
    const v = f['Versiuni Media'];
    const list = Array.isArray(v) ? v : JSON.parse(String(v || '[]'));
    takes = list.filter((e: any) => e && e.kind === 'video').length;
  } catch (e) { takes = 0; }
  const ORD = Number(f['Ordine Scenă']);
  const isHook = Number.isFinite(ORD) && ORD >= 1 && ORD < 100;
  const hookModel = o.hookVideoModel === undefined ? HOOK_MODEL : String(o.hookVideoModel);
  let model = base;
  if (base === FREE_MODEL && isHook && hookModel && hookModel !== FREE_MODEL) model = hookModel;
  let refused = 0;
  try { refused = Number(((state.rewrites) || {})[String(row.id || '')] || 0) || 0; } catch (e) { refused = 0; }
  const seed = hash(String(row.id || '') + ':' + takes + (refused ? ':refused:' + refused : '')) % 2147483647;
  const storedMotion = String(f['Video Scenă URL'] || '').split(/\s*Negative:\s*/i)[0].trim();
  return Object.assign({}, row, { videoRequest: {
    email: rb.Flow_Email || MANAGER,
    model,
    prompt: SHOT_RULES + storedMotion + WORLD_RULES,
    startImage: f['Image Media ID'],
    aspectRatio: (rb.Aspect_Ratio === '9:16' ? 'portrait' : 'landscape'),
    seed,
    count: 1,
    async: true,
    captchaRetry: 1,
  } });
}
export const SHOT_RULES = 'One continuous take, filmed in a single unbroken shot. Begin exactly on the given frame and play the action below as written, in the direction written. ';
export const WORLD_RULES = ' Keep the world consistent for the whole take: every person, vehicle and object holds its shape, size, colour and identity from first frame to last, and each one stays whole and solid, resting on the ground and passing around other things rather than through them. Whatever the subject is holding stays in their hands until the end of the shot, and anything they pick up stays picked up. Everything the subject does not touch holds still exactly as the first frame shows it — doors, drawers, lids, windows and taped-up paper move only when a hand moves them, and indoors the air is still. Every moving vehicle has its driver. The background moves only as the camera moves, so parallax reads correctly. Audio: quiet natural room tone plus the sounds the action itself makes. Negative: speech, voices, dialogue, singing, narration, music, soundtrack, on-screen text, subtitles, captions, watermark, logos, extra people, duplicated subject, morphing, warping, reversed playback.';

/** Mark Generare Video's fields. */
export const generatingFields = () => ({ 'Status Producție Scenă': 'Generare Video' });

// --- The end frame (opt-in) ---------------------------------------------------------------------------
export function endFramePrompt(cs: any, rb: BatchInput, projectFields: Fields | undefined, state: ClipBatchState, now: number) {
  const f = cs.fields || {};
  const offUntil = Number(state.endFrameOffAt || 0) + END_FRAME_OFF_MS;
  const off = now < offUntil;
  const o = opts(projectFields);
  const optedIn = o.endFrame === true;
  const wanted = optedIn && !off;
  const startImage = f['Image Media ID'] || '';
  const motion = String(f['Video Scenă URL'] || '').split(/\s*Negative:\s*/i)[0].trim();
  if (!wanted || !startImage || !motion) {
    const seen = JSON.stringify(o.endFrame);
    const why = !wanted ? (!optedIn ? 'end frames are opt-in since 2026-09-14 — Editing Options has endFrame=' + seen + ', needs the boolean true' : 'end frames paused until ' + new Date(offUntil).toISOString() + ' after a Flow rejection') : (!startImage ? 'no start frame' : 'no motion prompt');
    return { ok: false as const, sceneId: cs.id, reason: why };
  }
  const aspect = rb.Aspect_Ratio === '9:16' ? '9:16' : '16:9';
  const prompt = [
    'This is the FINAL FRAME of a single continuous shot: the same camera, the same subject and the same place as the reference image, a few seconds later, after the following motion has fully completed:',
    motion,
    'Draw the world exactly as the reference image shows it — same characters, same faces, same wardrobe, same vehicles and objects, same setting, same lighting and time of day, same lens and framing style. The ONLY thing that may differ is where the moving subjects have got to: every fixed part of the set — walls, furniture, fittings, doors, signage, parked vehicles, anything nobody touches — stays in exactly the position, size and angle the reference shows it in, and the frame stays exactly where the reference put it. Do not restage the shot, do not change the angle for effect, do not add or remove anyone, and do not put any text on the image.',
  ].filter(Boolean).join(' ');
  return { ok: true as const, sceneId: cs.id, requestBody: { email: rb.Flow_Email || MANAGER, model: 'nano-banana-2', prompt, aspectRatio: aspect, count: 1, captchaRetry: 1, reference_1: startImage } as Record<string, unknown> };
}

/** Generate End Frame's body: the scene's block account, then the start image's owner, captchaRetry 5. */
export function endFrameBody(src: { sceneId: string; requestBody: Record<string, unknown> }, assignments: Assignment[]) {
  const r: Record<string, unknown> = Object.assign({}, src.requestBody);
  const m = (assignments || []).find((x) => x.id === src.sceneId);
  if (m && m.flowEmail) r.email = m.flowEmail;
  const o = decodeOwner(r.reference_1);
  if (o.indexOf('@') > 0) r.email = o;
  r.captchaRetry = 5;
  return r;
}

/** Attach End Frame: the end frame's id out of the Flow answer, or why there is none. Never throws. */
export function attachEndFrame(efpSceneId: string, resp: any) {
  let endImage = '';
  let why = '';
  try {
    const r = resp || {};
    if (r.error) why = String(r.error.message || r.error.description || r.error).slice(0, 200);
    else {
      const gi = (((r.media || [])[0] || {}).image || {}).generatedImage || {};
      endImage = gi.mediaGenerationId || '';
      if (!endImage) why = 'no mediaGenerationId in response: ' + JSON.stringify(r).slice(0, 200);
    }
  } catch (e) { why = 'unreadable response: ' + String(((e as Error) && (e as Error).message) || e).slice(0, 200); }
  return { sceneId: efpSceneId || '', endImage, reason: why };
}

// --- Submit Video -----------------------------------------------------------------------------------------
export interface SubmitInputs {
  assignments: Assignment[];
  /** Attach End Frame's latest output. */
  attached?: { sceneId: string; endImage: string } | null;
  /** Submit Cooldown Guard's latest output. */
  guard?: { sceneId: string; dropEndFrame?: boolean } | null;
  /** Motion Resubmit's latest output. */
  resubmit?: { sceneId: string; seed?: number; dropEndFrame?: boolean; prompt?: string; basePrompt?: string } | null;
  /** Pool Tick's latest output (for a stolen still). */
  tick?: any;
}
/** Submit Video's body, override for override as the live expression applies them. */
export function submitVideoBody(cs: any, x: SubmitInputs): Record<string, unknown> {
  const r: Record<string, unknown> = Object.assign({}, cs.videoRequest);
  const m = (x.assignments || []).find((a) => a.id === cs.id);
  if (m && m.flowEmail) r.email = m.flowEmail;
  const o = decodeOwner(r.startImage);
  if (o.indexOf('@') > 0) r.email = o;
  const a = x.attached;
  if (a && a.endImage && a.sceneId === cs.id) r.endImage = a.endImage;
  const g = x.guard;
  if (g && g.dropEndFrame && g.sceneId === cs.id) delete r.endImage;
  const mr = x.resubmit;
  if (mr && mr.sceneId === cs.id) { if (mr.seed) r.seed = mr.seed; if (mr.dropEndFrame) delete r.endImage; if (mr.prompt && mr.basePrompt === r.prompt) r.prompt = mr.prompt; }
  const pt = x.tick;
  const st = (pt && pt.pool && pt.pool.stolen) ? pt.pool.stolen[cs.id] : null;
  if (st && st.image) { r.startImage = st.image; r.email = st.account; delete r.endImage; }
  if (r.email && r.email !== MANAGER && r.model === FREE_MODEL) r.model = 'veo-3.1-lite';
  r.captchaRetry = 5;
  return r;
}

/**
 * Submit Cooldown Guard: a refused submit. In the pool it only decides (give
 * up past MAX, else the account rests); serially it throws past MAX. Trips the
 * six-hour end-frame pause when the refusal looks systematic.
 */
export function submitCooldownGuard(sceneId: string, err: any, state: ClipBatchState, x: { inPool: boolean; attached?: { sceneId: string; endImage: string } | null; now: number }) {
  state.submitCooldowns = state.submitCooldowns || {};
  const key = sceneId;
  const n = (state.submitCooldowns[key] || 0) + 1;
  state.submitCooldowns[key] = n;
  const j = err || {};
  const last = String((j.error && (j.error.message || j.error.description)) || j.message || JSON.stringify(j)).slice(0, 300);
  const inPool = !!x.inPool;
  if (n > MAX_COOLDOWNS) {
    if (inPool) return { cooldown: n, lastError: last, sceneId: key, dropEndFrame: false, inPool: true, giveUp: true };
    throw new Error('Submit Video kept failing after ' + MAX_COOLDOWNS + ' cooldowns of 60s — last reason: ' + last);
  }
  const a = x.attached;
  const attached = !!(a && a.endImage && a.sceneId === key);
  if (attached) {
    const FAIL_WINDOW_MS = 60 * 60 * 1000;
    if (x.now - Number(state.endFrameFailAt || 0) > FAIL_WINDOW_MS) state.endFrameFails = 0;
    state.endFrameFailAt = x.now;
    state.endFrameFails = (state.endFrameFails || 0) + 1;
    if (/end.?image|i2v|final frame/i.test(last) || state.endFrameFails >= 3) state.endFrameOffAt = x.now;
  }
  return { cooldown: n, lastError: last, sceneId: key, dropEndFrame: attached, inPool, giveUp: false };
}

// --- Polling ---------------------------------------------------------------------------------------------------
/** Check Job Status: done, failed, or still going — a job past MAX_POLLS counts as failed. */
export function checkJobStatus(item: any, sceneId: string, state: ClipBatchState) {
  const status = (item.status || '').toLowerCase();
  state.polls = state.polls || {};
  state.polls[sceneId] = (state.polls[sceneId] || 0) + 1;
  const raw = JSON.stringify(item);
  const done = status === 'completed' || raw.includes('flow-content.google/video');
  let failed = status === 'failed' || status === 'error' || status === 'cancelled';
  if (!done && !failed && state.polls[sceneId] > MAX_POLLS) {
    failed = true;
    item.error = 'polling timed out after ' + MAX_POLLS + ' polls';
  }
  return Object.assign({}, item, { done: done && !failed, jobFailed: failed });
}

/** Extract Video URL (the batch's: a media id alone is enough). */
export function extractVideoUrl(item: any): { Video_Signed_URL: string; Video_Media_Id: string } {
  const find = (obj: any, pred: (s: string) => boolean) => {
    let f: string | null = null;
    (function w(o: any) { if (f) return;
      if (typeof o === 'string') { if (pred(o)) f = o; return; }
      if (Array.isArray(o)) { for (const v of o) { if (f) return; w(v); } return; }
      if (o && typeof o === 'object') { for (const k of Object.keys(o)) { if (f) return; w(o[k]); } }
    })(obj);
    return f as string | null;
  };
  let url: string | null = null, mediaId: string | null = null;
  try { const gv = item.response && item.response.media && item.response.media[0] && item.response.media[0].video && item.response.media[0].video.generatedVideo; if (gv) { if (typeof gv.fifeUrl === 'string') url = gv.fifeUrl; if (typeof gv.mediaGenerationId === 'string') mediaId = gv.mediaGenerationId; } } catch (e) {}
  if (!url) url = find(item, (s) => s.startsWith('http') && s.includes('flow-content.google') && s.includes('/video'));
  if (!mediaId) mediaId = find(item, (s) => s.includes('-video:'));
  if (!url && !mediaId) throw new Error('No video url or mediaId in completed job. Head: ' + JSON.stringify(item).slice(0, 800));
  return { Video_Signed_URL: url || '', Video_Media_Id: mediaId || '' };
}

/** Resubmit Guard: a failed job is re-shot, at most MAX_RESUBMITS per scene per pass, with a fresh poll budget. */
export function resubmitGuard(sceneId: string, failed: any, state: ClipBatchState) {
  state.resubmits = state.resubmits || {};
  state.polls = state.polls || {};
  const n = (state.resubmits[sceneId] || 0) + 1;
  state.resubmits[sceneId] = n;
  if (n > MAX_RESUBMITS) {
    const err = (failed.error || failed.status || 'unknown');
    throw new Error('Scene ' + sceneId + ': too many failed video generations (' + n + '). Last job status/error: ' + String(err).slice(0, 200));
  }
  state.polls[sceneId] = 0;
  return { resubmit: true, attempt: n };
}

// --- The motion judge ------------------------------------------------------------------------------------------
export function motionPrep(ev: { Video_Signed_URL: string; Video_Media_Id: string }, cs: any, projectFields: Fields | undefined, state: ClipBatchState) {
  const f = cs.fields || {};
  state.motionRerolls = state.motionRerolls || {};
  const o = opts(projectFields);
  const motion = String(f['Video Scenă URL'] || '').split(/\s*Negative:\s*/i)[0].trim();
  const done = (state.motionRerolls[cs.id] || 0) >= MAX_REROLLS;
  const skip = o.motionJudge === false ? 'motionJudge: false'
    : (!ev.Video_Signed_URL ? 'no signed clip URL to inspect'
    : (!motion ? 'no motion prompt to judge against'
    : (done ? 'already re-rolled ' + MAX_REROLLS + ' time(s)' : '')));
  const base = { sceneId: cs.id, ord: f['Ordine Scenă'], videoUrl: ev.Video_Signed_URL || '', mediaId: ev.Video_Media_Id || '', passthrough: ev };
  if (skip) return Object.assign({}, base, { ok: false as const, reason: skip });
  const ask = [
    'The brief for this shot was:',
    '"' + motion.slice(0, 700) + '"',
    'Score each 0 to 1.',
    ...MOTION_QUESTIONS,
  ].join(' ');
  return Object.assign({}, base, { ok: true as const, system: MOTION_SYSTEM, ask, motion });
}
export type MotionPrep = ReturnType<typeof motionPrep>;
export const MOTION_SYSTEM = 'You are a film editor checking whether a generated shot does what its brief said. You are shown a contact sheet: frames sampled at a fixed interval across a single 8-second clip, in time order, left to right and then top to bottom. The frames are samples, not the whole clip: a fault shorter than the gap between two of them is invisible here, so judge what you can actually see and do not infer what happened in between. Judge only what the brief claims and whether the world holds together. Do not judge taste, style, beauty, lighting or composition. Answer only the JSON object requested.';
const MOTION_QUESTIONS = [
  '"direction": does the movement across the frames match what the brief says, including which way things travel and whether they approach or leave? 1 = it does what the brief says; 0 = it does the opposite (the brief says out and the subject goes in, or the brief says left to right and it goes right to left). If the brief names no direction, answer 1.',
  '"permanence": does everything keep its identity and stay present from the first frame to the last? Lower it when something a character is holding disappears from their hands, when a prop or a piece of furniture vanishes and later comes back, when clothing changes between frames, or when a person or object duplicates. Judge only what the frames can actually show: a thing that leaves the frame because the CAMERA moved, or passes behind something else, has not vanished, and every shot here has a camera move. If you simply cannot follow an object, answer 1 rather than guess. 1 = nothing that should still be visible appears or disappears.',
  '"untouched": does everything that cannot move by itself hold still? Lower it when a door, a drawer, a lid or a window opens or closes with no hand on it, when paper, cloth, curtains or hanging signs move INDOORS where there is no wind, or when an object slides with nothing pushing it. This question is about interiors and about objects with no motive power of their own: outdoors, wind, weather, water, foliage, traffic, animals and crowds move on their own and that is correct, so answer 1 for an exterior unless a door, a lid, a drawer or a piece of furniture moves with nobody near it. 1 = nothing moved that had no cause.',
  '"coherent": does the sequence hold together physically? Lower it when solid things pass through each other, when something floats or sinks into the ground, or when a moving vehicle has no driver.',
  '"morph": true if the frames do not show real movement but a dissolve or warp between two different pictures — the subject changing shape, sliding without turning its wheels or legs, or the scene cross-fading. Otherwise false.',
  '"loop": true if the clip fills its eight seconds by repeating or doubling back — the subject performs the same action twice, or walks out of frame and returns to where it started, or the camera travels somewhere and comes back. Otherwise false.',
  'Answer ONLY JSON: {"direction": number, "permanence": number, "untouched": number, "coherent": number, "morph": boolean, "loop": boolean, "problems": ["short concrete reason", ...]}',
];

/** Motion Judge's body (OpenAI chat), for the contact sheet at `sheetUrl`. */
export function motionJudgeBody(prep: { system: string; ask: string }, sheetUrl: string) {
  return { model: 'gpt-4o', temperature: 0, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: prep.system }, { role: 'user', content: [{ type: 'text', text: prep.ask }, { type: 'image_url', image_url: { url: sheetUrl, detail: 'high' } }] }] };
}

/** Motion Verdict: keep the take, or spend one more generation. Every way of not getting an answer KEEPS it. */
export function motionVerdict(prep: MotionPrep, judge: any, state: ClipBatchState): any {
  state.motionRerolls = state.motionRerolls || {};
  state.motionNotes = state.motionNotes || {};
  const keep = (why: string) => Object.assign({}, prep.passthrough || {}, { motionVerdict: why, motionReroll: false });
  if (!prep.ok) return keep((prep as any).reason || 'not judged');
  let v: any = null;
  try {
    const text = ((judge?.choices || [])[0] || {}).message ? String(((judge.choices || [])[0] || {}).message.content || '') : '';
    const m = text.match(/\{[\s\S]*\}/);
    v = m ? JSON.parse(m[0]) : null;
  } catch (e) { v = null; }
  if (!v) return keep('unreadable');
  const num = (x: unknown) => (typeof x === 'number' && isFinite(x)) ? x : null;
  const direction = num(v.direction), permanence = num(v.permanence), untouched = num(v.untouched), coherent = num(v.coherent);
  const morph = v.morph === true, loop = v.loop === true;
  const problems = Array.isArray(v.problems) ? v.problems.map(String).slice(0, 4) : [];
  const bad: string[] = [];
  if (direction !== null && direction < 0.5) bad.push('direction ' + direction);
  if (permanence !== null && permanence < 0.5) bad.push('permanence ' + permanence);
  if (untouched !== null && untouched < 0.45) bad.push('untouched ' + untouched);
  if (coherent !== null && coherent < 0.45) bad.push('coherence ' + coherent);
  if (morph) bad.push('morph');
  if (loop) bad.push('loop');
  const n = state.motionRerolls[prep.sceneId] || 0;
  if (!bad.length) return keep('ok');
  if (n >= MAX_REROLLS) return keep('wrong-accepted');
  state.motionRerolls[prep.sceneId] = n + 1;
  state.motionNotes[prep.sceneId] = (bad.join(', ') + (problems.length ? ': ' + problems.join('; ') : '')).slice(0, 400);
  return { sceneId: prep.sceneId, ord: prep.ord, motionReroll: true, morph, loop, attempt: n + 1, problems: bad, discardedMediaId: prep.mediaId };
}

/** Motion Resubmit: a new seed, the end frame dropped on a morph, and a positive correction before `Negative:`. */
export function motionResubmit(v: { sceneId: string; ord?: unknown; attempt: number; morph?: boolean; loop?: boolean; problems?: unknown[] }, cs: any, state: ClipBatchState) {
  state.polls = state.polls || {};
  state.polls[v.sceneId] = 0;
  const seed = hash(String(v.sceneId) + ':motion:' + v.attempt) % 2147483647;
  const dropEndFrame = v.morph === true;
  const fired: string[] = [];
  const seen = (Array.isArray(v.problems) ? v.problems : []).map((p) => String(p).trim().split(/\s+/)[0].toLowerCase());
  if (v.morph === true) seen.push('morph');
  if (v.loop === true) seen.push('loop');
  seen.forEach((k) => { if (CLAUSES[k] && fired.indexOf(k) < 0) fired.push(k); });
  const withheld = fired.filter((k) => UNSAFE.test(CLAUSES[k]));
  const used = SIGNAL_ORDER.filter((k) => fired.indexOf(k) >= 0 && withheld.indexOf(k) < 0).slice(0, MAX_CLAUSES);
  const correction = used.length ? LEAD_IN + used.map((k) => CLAUSES[k]).join(' ') : '';
  let basePrompt = '';
  let prompt = '';
  if (correction) {
    try { basePrompt = String(((cs || {}).videoRequest || {}).prompt || ''); } catch (e) { basePrompt = ''; }
    const cut = basePrompt ? basePrompt.search(/\s*Negative\s*:/i) : -1;
    const head = (cut >= 0 ? basePrompt.slice(0, cut) : basePrompt).trim();
    const tail = cut >= 0 ? basePrompt.slice(cut) : '';
    if (head) prompt = head + ' ' + correction + tail;
  }
  return { sceneId: v.sceneId, ord: v.ord, seed, dropEndFrame, attempt: v.attempt, correction, basePrompt, prompt };
}
// A lockstep pair with RG Motion Resubmit (src/clip/regen.ts): change both or neither.
const CLAUSES: Record<string, string> = {
  permanence: 'Whatever the subject is holding stays in their hands for the whole shot and is there in the final frame; every prop, garment and piece of furniture keeps the shape, colour and cut it has in the opening frame.',
  untouched: 'Every door, drawer, lid, window and taped-up sheet of paper stays exactly as the opening frame shows it, and moves only in the instant a hand moves it; indoors the air is still.',
  loop: 'One single continuous action, performed once and carried straight through to the final frame; the subject ends the take somewhere new, further along than it began.',
  direction: 'Everything that travels keeps the one direction the action above names and holds that heading to the final frame; the camera keeps the move it was given and travels that way throughout.',
  coherence: 'Solid things keep their own space: feet stay on the ground, people and vehicles pass around each other, and every vehicle that moves has a driver at its controls.',
  morph: 'Everything that changes on screen changes because something physically moves — wheels turn, legs step, hands travel — and every shape keeps its own edges for the whole take.',
};
const SIGNAL_ORDER = ['permanence', 'untouched', 'loop', 'direction', 'coherence', 'morph'];
const MAX_CLAUSES = 3;
const LEAD_IN = 'CORRECTION — the new take MUST hold to this: ';
const UNSAFE = /\b(?:no|not|never|none|nothing|nobody|nor|without|avoid\w*|prevent\w*|stop\w*|remove\w*|don't|doesn't|isn't|aren't|disappear\w*|vanish\w*|duplicat\w*|morph\w*|warp\w*|flicker\w*)\b/i;

// --- The refusal ladder (VP *) -----------------------------------------------------------------------------------
/** VP Prep: the filter refused the clip. Count it, name the filter, and steer a NEW STILL (twice) before giving up. */
export function vpPrep(cs: any, errJson: any, state: ClipBatchState) {
  state.rewrites = state.rewrites || {};
  const cur = cs || {};
  const f = cur.fields || {};
  const sceneId = cur.id;
  const n = (state.rewrites[sceneId] || 0) + 1;
  state.rewrites[sceneId] = n;
  const errText = JSON.stringify(errJson).slice(0, 20000);
  const audioFiltered = errText.includes('AUDIO_GENERATION_FILTERED') || errText.includes('AUDIO_FILTERED');
  const prominent = errText.includes('PROMINENT');
  const minor = errText.includes('MINOR');
  let reason = 'Google video content filter';
  if (prominent) reason = 'the shot shows or names a recognizable real person';
  else if (minor) reason = 'the shot places a child on screen';
  else if (audioFiltered) reason = 'Google refused the generated AUDIO track, not the picture (AUDIO_GENERATION_FILTERED)';
  const kind = prominent ? 'person' : (minor ? 'minor' : (audioFiltered ? 'audio' : 'generic'));
  const steer = 'AUTO-STEER: ' + (n >= 2 ? STRONGER : STEER[kind]);
  const advice = audioFiltered
    ? 'Two new stills were tried automatically and Google still refused the soundtrack it invents for them. Write the image prompt as a moment with nobody about to speak — the room, the objects, hands — regenerate the image, approve it, then press Regenerate video.'
    : 'Two new stills were tried automatically and Google still refused. The picture is what it refuses: rewrite the image prompt so no face or real person is in frame, regenerate the image, approve it, then press Regenerate video.';
  return { sceneId, imageId: String(f['Image Media ID'] || ''), prompt: String(f['Video Scenă URL'] || ''), note: String(f['Observații Scenă'] || ''), reason, kind, advice, steer, audioFiltered, attempt: n, giveUp: n > MAX_VP_ATTEMPTS };
}
export type VpPrep = ReturnType<typeof vpPrep>;
const STEER: Record<string, string> = {
  audio: 'Keep the same moment, place and light, framed on the setting, the objects and the hands: any person is seen from behind or stands outside the frame, every mouth out of view, so the still reads as a quiet room rather than someone about to speak.',
  person: 'Keep the same moment, place and light, with every face turned away from the camera or outside the frame: people from behind, in profile at a distance, or a detail insert of hands and objects.',
  minor: 'Keep the same moment, place and light, with adults only or the empty setting, every child outside the frame.',
  generic: 'Keep the same moment, place and light, framed on the setting, the objects and the light, with any person seen from behind or outside the frame.',
};
const STRONGER = 'Keep the same place and light as a still life: the setting, the objects and the light only, every person outside the frame.';

/** Mark Video Prompt Rejected's fields. */
export function vpRejectedFields(vp: VpPrep) {
  return { 'Regenerează Video': false, 'Regenerează Imagine': false, 'Status Producție Scenă': 'Generare Video', 'Observații Scenă': 'REJECTED by the video filter after ' + Math.max(0, Number(vp.attempt) - 1) + ' automatically regenerated still(s) — ' + vp.reason + '. ' + vp.advice };
}
/** VP Steer's fields: the steer rides to the image model as the scene's note, and the still is asked for again. */
export function vpSteerFields(vp: VpPrep) {
  return { 'Observații Scenă': vp.steer, 'Regenerează Imagine': true, 'Aprobare Imagine': false };
}
/** VP Image Check's id (the scene id, cleaned the way the live query cleans it). */
export const vpCheckId = (vp: VpPrep) => String(vp.sceneId || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 40);

/** VP Image Ready: has the new still landed (ready), did Flow refuse it too, or wait (16 × 15 s at most)? */
export function vpImageReady(vp: VpPrep, row: { image_media_id?: string | null; regen_image?: boolean | null; note?: string | null }, state: ClipBatchState) {
  state.imageWaits = state.imageWaits || {};
  const id = String(vp.sceneId || '');
  const key = id + ':' + String(vp.attempt || 0);
  state.imageWaits[key] = (state.imageWaits[key] || 0) + 1;
  const polls = state.imageWaits[key];
  const r = row || {};
  const oldId = String(vp.imageId || '');
  const newId = String(r.image_media_id || '');
  const flagUp = r.regen_image === true;
  const note = String(r.note || '');
  const ready = newId !== '' && newId !== oldId && !flagUp;
  const refused = !flagUp && newId === oldId && /^(Image regeneration REJECTED|REJECTED)/i.test(note);
  let st = 'wait';
  if (ready) st = 'ready';
  else if (refused) st = 'timeout';
  else if (polls >= MAX_IMAGE_WAITS) st = 'timeout';
  return { state: st as 'ready' | 'wait' | 'timeout', polls, newImageId: ready ? newId : '' };
}
/** VP Prompt Fix?: the motion prompt is rewritten only when the refusal names a PERSON. */
export const vpPromptFix = (vp: VpPrep) => vp.kind === 'person';

/** VP Rewrite AI's body (gpt-4o-mini). */
export function vpRewriteBody(vp: VpPrep) {
  return { model: 'gpt-4o-mini', temperature: 0.4, messages: [{ role: 'system', content: VP_REWRITE_SYSTEM + (vp.attempt >= 2 ? ' THIS IS REWRITE ATTEMPT ' + vp.attempt + ': earlier rewrites of this prompt were STILL refused, so go much further than before. Remove every face and every identifiable person from the frame (people only from behind, as distant silhouettes, or not at all — prefer the empty environment, objects, hands and light, and outdoors the weather). Remove any violence, weapons, blood, injury, drugs, gambling of minors, nudity, real brands, real names, real events and real places named as such. Keep the shot calm and generic.' : '') }, { role: 'user', content: 'Refusal reason: ' + vp.reason + '\n\nOriginal prompt:\n' + vp.prompt }] };
}
const VP_REWRITE_SYSTEM = 'You rewrite video-generation motion prompts refused by a content filter. The clip is one eight-second Veo shot made from a still that is already approved, so keep the camera move, the scene intent, the location and the mood; change only what triggers the refusal, and fix the shot faults below while you are in there. Real or named people become generic descriptions with the phrase \'no resemblance to any real person\'. Children/minors become adults or move strictly off-screen.\nWRITE THE ACTION ONLY. The prompt you are given may still end with a trailing "Negative: ..." clause: DROP IT, and never write one of your own. The shot rules, the world-consistency sentences and the one negative noun list are composed automatically at submit time, so a stored tail is duplicated at best and contradictory at worst, and naming an unwanted thing in a sentence ("no reversed motion") is the documented way to make Veo render it. That applies to YOUR OWN sentences too: write only what IS in the shot and what IS happening. Never use the words "no", "not", "without", "avoid" or "nothing" anywhere in the prompt you return — if something must be gone, describe the frame that does not contain it: "the counter is bare", never "no cups on the counter". The ONE exception is the fixed phrase \'no resemblance to any real person\' required above, which the content filter itself expects; nothing else you write may be phrased as an absence.\nONE ACTION, NOT A SEQUENCE: eight seconds is one gesture — a reach, a turn, a pour, a step. If the prompt chains two or three, keep the ONE that carries the beat and drop the rest. Never chain verbs with "then", "and then", or a comma list ("reaches, strips off the stack, and pivots to the door" is three shots, and asking for it in one produces a subject that does the first twice, drops what it is holding, and walks out of frame and back).\nIF THE SUBJECT HOLDS OR PICKS UP ANYTHING, say that it stays in their hands to the end of the shot.\nDIRECTION IS NOT OPTIONAL: wherever the prompt says which way something travels relative to the frame or to the camera, keep that wording, and keep it agreeing with what the still already shows.\nNO INVENTED AMBIENT MOTION: describe ONLY motion that something in the shot is actually causing, and name its cause — steam rises because the machine is on, water ripples because the boat cut it, dust blows because there is wind outdoors. INDOORS THERE IS NO WEATHER: in a room, a kitchen, an office or a stockroom the air is still, and paper, cloth, curtains, hanging signs and loose sheets stay exactly as the still shows them. A SHAFT OF LIGHT IS NOT A CAUSE EITHER: "dust motes turning in the window light" is the one piece of invented air movement that survives the sentence above, because it reads as lighting rather than as weather — but motes only move if the air moves, and indoors the air is still. Light falls, lies across a surface and picks out an edge; it carries nothing. If nothing in the shot is causing motion, write nothing about the environment; a still background is correct.\nEVERYTHING THE SUBJECT DOES NOT TOUCH HOLDS STILL: doors, drawers, lids, fridges and windows stay in the position the still shows them in, and only the subject\'s own hands move them. Never give a prop a motion word as a label — write "the door", never "the swinging door", because Veo animates the adjective.\nKeep the descriptive part to 25-45 words. Return ONLY the rewritten prompt text.';

/** VP Note Still's fields: the still was replaced, the clip goes again. */
export function vpNoteStillFields(vp: VpPrep) {
  return { 'Regenerează Video': true, 'Aprobare Video': false, 'Status Producție Scenă': 'Generare Video', 'Observații Scenă': 'AUTO-REWRITE-VIDEO (attempt ' + vp.attempt + '): the video filter refused this scene — ' + vp.reason + '. The start image was regenerated automatically and the clip resubmitted.' };
}
/** VP Apply's fields: the still was replaced AND the motion prompt rewritten. */
export function vpApplyFields(vp: VpPrep, answer: any) {
  return { 'Video Scenă URL': (answer && answer.choices && answer.choices[0] && answer.choices[0].message && answer.choices[0].message.content || '').trim() || vp.prompt, 'Regenerează Video': true, 'Aprobare Video': false, 'Status Producție Scenă': 'Generare Video', 'Observații Scenă': 'AUTO-REWRITE-VIDEO (attempt ' + vp.attempt + '): the video filter refused this scene — ' + vp.reason + '. The start image was regenerated and the motion prompt rewritten automatically, and the clip resubmitted.' };
}

// --- The clip lands -------------------------------------------------------------------------------------------------
/**
 * Update Scene Record's fields, with the take's stored URL. The engine keeps
 * clips in /media through the site's ingest door (D1), never on Drive.
 */
export function clipWrittenFields(cs: any, storedUrl: string, mediaId: string) {
  return { 'Voiceover URL': (cs.fields || {})['Voiceover URL'], 'Scene Final URL': storedUrl, 'Video Media ID': mediaId || '', 'Status Producție Scenă': 'Așteaptă Aprobare Video', 'Aprobare Video': false, 'Regenerează Video': false };
}
