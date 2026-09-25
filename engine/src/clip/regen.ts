// One scene's clip regeneration — the `scene-video-regen` webhook's chain in
// Media Generation (`VRW *` and `RG *`), ported node by node. Every function
// here is pure; the n8n counters kept in `$getWorkflowStaticData('global')`
// are an explicit `ClipState` the caller owns (one per job), and `now` is
// passed in. engine/check-clip.mjs holds each one to its live node, the state
// it leaves behind included.
import type { Fields } from '../assembly/types.ts';

export const FREE_MODEL = 'veo-3.1-lite-low-priority';
export const PAID_MODEL = 'veo-3.1-quality';
/** The Ultra family manager: the only account Google serves the free low-priority model to. */
export const MANAGER = 'fermafabiz@gmail.com';
/** Polls of a clip job before it counts as failed: 20 × 30 s = the measured 10-minute ceiling. */
export const MAX_POLLS = 20;
export const MAX_RESUBMITS = 4;
export const MAX_COOLDOWNS = 20;
export const MAX_REROLLS = 1;
export const END_FRAME_OFF_MS = 6 * 60 * 60 * 1000;

/** What n8n kept in workflow static data, per job. */
export interface ClipState {
  submitCooldowns?: Record<string, number>;
  regenPolls?: Record<string, number>;
  regenResubmits?: Record<string, number>;
  motionRerolls?: Record<string, number>;
  motionNotes?: Record<string, string>;
  endFrameOffAt?: number;
  endFrameFailAt?: number;
  endFrameFails?: number;
}

const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

// --- VRW Build Regen ----------------------------------------------------------------
export type Built =
  | { ok: false; write: boolean; sceneId: string; reason: string }
  | { ok: true; sceneId: string; projectId: string; regen: Regen; sceneFields: Fields; projectFields: Fields; aspectRatio: '9:16' | '16:9' };
export interface Regen { id: string; motionPrompt: string; imageId: string; voiceUrl: string }

/** Decide whether the scene can be re-shot, and build the brief (strip the legacy tail, then append the producer's correction). */
export function buildVideoRegen(sceneId: string, row: { scene: Fields; project: Fields; project_id: string } | null): Built {
  const refuse = (reason: string, write: boolean): Built => ({ ok: false, write: !!write, sceneId, reason });
  if (!sceneId) throw new Error('VRW: no scene_id in the webhook body — nothing to regenerate.');
  if (!row || !row.scene) throw new Error('VRW: scene ' + sceneId + ' not found.');
  const f = row.scene || {};
  const projF = row.project || {};
  const projectId = String(row.project_id || '');
  if (f['Regenerează Video'] !== true) return refuse('the scene is not asking for a new clip (Regenerează Video is already false)', false);
  if (!f['Image Media ID']) return refuse('this scene has no Flow image id, so there is no still for Veo to animate — regenerate and approve its image first', true);
  if (!String(f['Video Scenă URL'] || '').trim()) return refuse('this scene has no shot direction (Video Scenă URL), so there is nothing to shoot — write one in the Video step', true);
  let feedback = String(f['Observații Scenă'] || '').trim();
  if (/^(AUTO-|REJECTED)/i.test(feedback)) feedback = '';
  const storedPrompt = String(f['Video Scenă URL'] || '');
  const action = storedPrompt.split(/\s*Negative:\s*/i)[0].trim();
  let motionPrompt = action || storedPrompt.trim();
  if (feedback) {
    const note = feedback.replace(/\bNegative\s*:/gi, 'Negative,');
    motionPrompt += ' ADJUSTMENT REQUEST — the new video MUST follow this: ' + note + '.';
  }
  const regen = { id: sceneId, motionPrompt, imageId: f['Image Media ID'] || '', voiceUrl: f['Voiceover URL'] || '' };
  return { ok: true, sceneId, projectId, regen, sceneFields: f, projectFields: projF, aspectRatio: String(projF['Format'] || '16:9') === '9:16' ? '9:16' : '16:9' };
}

/** VRW Refuse: what a refusal writes on the scene. */
export function refusalFields(reason: string) {
  return { 'Regenerează Video': false, 'Status Producție Scenă': 'Așteaptă Aprobare Video', 'Observații Scenă': 'REJECTED — ' + String(reason || 'this scene cannot be re-shot') + '. Nothing was thrown away: the clip you have is still there.' };
}

// --- Prep Video Regen (the webhook entry point) ---------------------------------------------
export interface Prepared extends Regen { model: string; seed: number; takes: number; opts: any; aspectRatio: '9:16' | '16:9'; viaWebhook: true }
export function prepVideoRegen(b: Extract<Built, { ok: true }>, now: number): Prepared {
  const r = b.regen;
  if (!r) throw new Error('No regen payload.');
  if (!r.imageId) throw new Error('Scene ' + r.id + ' has no Image Media ID — cannot regenerate its video (regenerate/approve its image first).');
  if (!r.motionPrompt) throw new Error('Scene ' + r.id + ' has no motion prompt (Video Scenă URL).');
  const projF = b.projectFields || {};
  let opts: any = {};
  try { opts = JSON.parse(projF['Editing Options'] || '{}') || {}; } catch (e) { opts = {}; }
  let aspectRatio = String(b.aspectRatio || projF['Format'] || '16:9');
  if (aspectRatio !== '9:16') aspectRatio = '16:9';
  const base = String(opts.videoModel || FREE_MODEL);
  let takes = 0;
  let sceneNote = '';
  try {
    const fields = b.sceneFields || {};
    const v = fields['Versiuni Media'];
    const list = Array.isArray(v) ? v : JSON.parse(String(v || '[]'));
    takes = list.filter((e: any) => e && e.kind === 'video').length;
    sceneNote = String(fields['Observații Scenă'] || '').trim();
  } catch (e) { takes = 0; }
  const rescue = opts.rescueVideoModel === undefined ? PAID_MODEL : String(opts.rescueVideoModel);
  const model = (base === FREE_MODEL && takes >= 2 && rescue && rescue !== FREE_MODEL) ? rescue : base;
  // A refused clip files no take, so without this every press after a refusal
  // re-rolled the identical seed (2026-09-22).
  const wasRefused = /^(AUTO-|REJECTED)/i.test(sceneNote);
  const seed = hash(String(r.id || '') + ':' + takes + (wasRefused ? ':refused:' + now : '')) % 2147483647;
  return Object.assign({}, r, { model, seed, takes, opts, aspectRatio: aspectRatio as '9:16' | '16:9', viaWebhook: true as const });
}

// --- RG End Frame Prompt / RG Generate End Frame / RG Attach End Frame --------------------------
export function endFramePlan(p: Prepared, state: ClipState, now: number): { efOk: false; efReason: string } | { efOk: true; efRequest: Record<string, unknown> } {
  const offUntil = Number(state.endFrameOffAt || 0) + END_FRAME_OFF_MS;
  const off = now < offUntil;
  const opts = p.opts || {};
  const optedIn = opts.endFrame === true;
  const wanted = optedIn && !off;
  const startImage = p.imageId || '';
  const motion = String(p.motionPrompt || '').trim();
  if (!wanted || !startImage || !motion) {
    const seen = JSON.stringify(opts.endFrame);
    const why = !wanted ? (!optedIn ? 'end frames are opt-in since 2026-09-14 — Editing Options has endFrame=' + seen + ', needs the boolean true' : 'end frames paused until ' + new Date(offUntil).toISOString() + ' after a Flow rejection') : (!startImage ? 'no start frame' : 'no motion prompt');
    return { efOk: false, efReason: why };
  }
  const aspect = (p.aspectRatio || '16:9') === '9:16' ? '9:16' : '16:9';
  const prompt = [
    'This is the FINAL FRAME of a single continuous shot: the same camera, the same subject and the same place as the reference image, a few seconds later, after the following motion has fully completed:',
    motion,
    'Draw the world exactly as the reference image shows it — same characters, same faces, same wardrobe, same vehicles and objects, same setting, same lighting and time of day, same lens and framing style. The ONLY thing that may differ is where the moving subjects have got to: every fixed part of the set — walls, furniture, fittings, doors, signage, parked vehicles, anything nobody touches — stays in exactly the position, size and angle the reference shows it in, and the frame stays exactly where the reference put it. Do not restage the shot, do not change the angle for effect, do not add or remove anyone, and do not put any text on the image.',
  ].filter(Boolean).join(' ');
  return { efOk: true, efRequest: { email: MANAGER, model: 'nano-banana-2', prompt, aspectRatio: aspect, count: 1, captchaRetry: 1, reference_1: startImage } };
}

/** The account a Flow asset belongs to, hex-encoded in its id (`…-email:<hex>-…`). */
export function ownerOf(mediaId: unknown): string | null {
  try {
    const h = String(mediaId || '').match(/-email:([0-9a-f]+)-/i);
    if (!h) return null;
    let e = '';
    for (let i = 0; i < h[1].length; i += 2) e += String.fromCharCode(parseInt(h[1].substr(i, 2), 16));
    return e.indexOf('@') > 0 ? e : null;
  } catch (err) { return null; }
}

/** RG Generate End Frame's body: the request, on the start image's own account, captchaRetry 5. */
export function endFrameBody(efRequest: Record<string, unknown>) {
  const r: Record<string, unknown> = Object.assign({}, efRequest);
  const owner = ownerOf(r.reference_1);
  if (owner) r.email = owner;
  r.captchaRetry = 5;
  return r;
}

/** RG Attach End Frame: the end frame's id out of the Flow answer, or why there is none. Never throws. */
export function attachEndFrame(resp: any): { endImage: string; efError: string } {
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
  } catch (e) { why = 'unreadable response: ' + String((e as Error)?.message || e).slice(0, 200); }
  return { endImage, efError: why };
}

// --- Submit Video Regen -------------------------------------------------------------------------
/** The shot rules composed around the action at every submit. Word for word the live expression. */
export function composeVideoPrompt(action: string): string {
  return 'One continuous take, filmed in a single unbroken shot. Begin exactly on the given frame and play the action below as written, in the direction written. ' + String(action || '').split(/\s*Negative:\s*/i)[0].trim() + ' Keep the world consistent for the whole take: every person, vehicle and object holds its shape, size, colour and identity from first frame to last, and each one stays whole and solid, resting on the ground and passing around other things rather than through them. Whatever the subject is holding stays in their hands until the end of the shot, and anything they pick up stays picked up. Everything the subject does not touch holds still exactly as the first frame shows it — doors, drawers, lids, windows and taped-up paper move only when a hand moves them, and indoors the air is still. Every moving vehicle has its driver. The background moves only as the camera moves, so parallax reads correctly. Audio: quiet natural room tone plus the sounds the action itself makes. Negative: speech, voices, dialogue, singing, narration, music, soundtrack, on-screen text, subtitles, captions, watermark, logos, extra people, duplicated subject, morphing, warping, reversed playback.';
}

export interface SubmitContext {
  /** The payload the submit reads as `$json` (Prep Video Regen's, or a re-roll's). */
  p: Prepared & { motionPrompt: string; seed: number };
  /** RG Motion Resubmit's latest output, when there was one. */
  resubmit?: { sceneId: string; motionPrompt?: string; baseMotion?: string; seed?: number; dropEndFrame?: boolean } | null;
  /** RG Attach End Frame's output, when an end frame was drawn. */
  attached?: { sceneId: string; endImage: string } | null;
  /** Regen Cooldown Guard's latest output. */
  cooldown?: { sceneId: string; dropEndFrame?: boolean } | null;
}

export function submitBody(c: SubmitContext): Record<string, unknown> {
  const $json = c.p;
  const action = (() => { const m = c.resubmit; if (m && m.sceneId === $json.id && m.motionPrompt && m.baseMotion === $json.motionPrompt) return m.motionPrompt; return $json.motionPrompt; })();
  const r: Record<string, unknown> = { email: MANAGER, model: ($json.model || FREE_MODEL), prompt: composeVideoPrompt(action), startImage: $json.imageId, aspectRatio: (c.p.aspectRatio === '9:16' ? 'portrait' : 'landscape'), seed: $json.seed, count: 1, async: true, captchaRetry: 1 };
  const owner = ownerOf(r.startImage);
  if (owner) r.email = owner;
  if (c.attached && c.attached.endImage && c.attached.sceneId === $json.id) r.endImage = c.attached.endImage;
  if (c.cooldown && c.cooldown.dropEndFrame && c.cooldown.sceneId === $json.id) delete r.endImage;
  if (c.resubmit && c.resubmit.sceneId === $json.id) { if (c.resubmit.seed) r.seed = c.resubmit.seed; if (c.resubmit.dropEndFrame) delete r.endImage; }
  // Google serves the free low-priority model to the family manager only.
  if (r.email && r.email !== MANAGER && r.model === FREE_MODEL) r.model = 'veo-3.1-lite';
  r.captchaRetry = 5;
  return r;
}

// --- Regen Cooldown Guard (a refused SUBMIT: 429 and the like) ----------------------------------
export function cooldownGuard(p: Prepared, err: any, state: ClipState, now: number, endFrameAttached: boolean) {
  state.submitCooldowns = state.submitCooldowns || {};
  const key = 'regen:' + p.id;
  const n = (state.submitCooldowns[key] || 0) + 1;
  state.submitCooldowns[key] = n;
  const j = err || {};
  const last = String((j.error && (j.error.message || j.error.description)) || j.message || JSON.stringify(j)).slice(0, 300);
  if (n > MAX_COOLDOWNS) throw new Error('Submit Video Regen kept failing after ' + MAX_COOLDOWNS + ' cooldowns of 60s — last reason: ' + last);
  if (endFrameAttached) {
    const FAIL_WINDOW_MS = 60 * 60 * 1000;
    if (now - Number(state.endFrameFailAt || 0) > FAIL_WINDOW_MS) state.endFrameFails = 0;
    state.endFrameFailAt = now;
    state.endFrameFails = (state.endFrameFails || 0) + 1;
    if (/end.?image|i2v|final frame/i.test(last) || state.endFrameFails >= 3) state.endFrameOffAt = now;
  }
  return Object.assign({}, p, { sceneId: p.id, dropEndFrame: endFrameAttached, last, n });
}

// --- Check Video Regen / Extract Regen Video URL -----------------------------------------------
export function checkPoll(item: any, sceneId: string, state: ClipState) {
  const status = (item.status || '').toLowerCase();
  state.regenPolls = state.regenPolls || {};
  state.regenPolls[sceneId] = (state.regenPolls[sceneId] || 0) + 1;
  const raw = JSON.stringify(item);
  const done = status === 'completed' || raw.includes('flow-content.google/video');
  let failed = status === 'failed' || status === 'error' || status === 'cancelled';
  const out = Object.assign({}, item);
  if (!done && !failed && state.regenPolls[sceneId] > MAX_POLLS) {
    failed = true;
    out.error = 'polling timed out after ' + MAX_POLLS + ' polls';
  }
  return Object.assign(out, { done: done && !failed, jobFailed: failed });
}

export function extractVideo(item: any): { Video_Signed_URL: string; Video_Media_Id: string } {
  const find = (obj: any, pred: (s: string) => boolean) => {
    let f: string | null = null;
    (function w(o: any) { if (f) return;
      if (typeof o === 'string') { if (pred(o)) f = o; return; }
      if (Array.isArray(o)) { for (const v of o) { if (f) return; w(v); } return; }
      if (o && typeof o === 'object') { for (const k of Object.keys(o)) { if (f) return; w(o[k]); } }
    })(obj);
    return f as string | null;
  };
  let url: string | null = null;
  let mediaId: string | null = null;
  try { const gv = item.response && item.response.media && item.response.media[0] && item.response.media[0].video && item.response.media[0].video.generatedVideo; if (gv) { if (typeof gv.fifeUrl === 'string') url = gv.fifeUrl; if (typeof gv.mediaGenerationId === 'string') mediaId = gv.mediaGenerationId; } } catch (e) {}
  if (!url) url = find(item, (s) => s.startsWith('http') && s.includes('flow-content.google') && s.includes('/video'));
  if (!mediaId) mediaId = find(item, (s) => s.includes('-video:'));
  if (!url) throw new Error('No video url in regen job. Head: ' + JSON.stringify(item).slice(0, 800));
  return { Video_Signed_URL: url, Video_Media_Id: mediaId || '' };
}

// --- A failed job: the filter, or a resubmit ------------------------------------------------------
/** Regen Filter Failure?: the job's answer names a content filter. */
export const isFilterFailure = (j: unknown) => { const s = JSON.stringify(j); return s.includes('PROMINENT') || s.includes('MINOR') || s.includes('FILTER') || s.includes('SAFETY'); };

/**
 * Mark Regen Filtered's fields — with ONE deliberate change: a refusal of the
 * clip's generated SOUNDTRACK (AUDIO_GENERATION_FILTERED) gets the advice that
 * fits it. n8n's regen path routed it here with the "the still reads as a real
 * person" note, which is exactly the misdiagnosis the batch's audio arm was
 * added to stop (CLAUDE.md, "A clip Google refuses for its AUDIO"; the fix that
 * worked was a still with no person and no hand, so the audio model has
 * nothing to speak).
 */
export function filteredFields(j: unknown) {
  const audio = /AUDIO_GENERATION_FILTERED|AUDIO_FILTERED/.test(JSON.stringify(j));
  const note = audio
    ? 'REJECTED by the video filter for its SOUND, not its picture — Veo writes a soundtrack from the still and Google refused that soundtrack. Regenerate this scene\'s IMAGE without a person or hands in frame (the same place, empty), approve it, and the clip will follow.'
    : 'REJECTED by the video filter even with a cleaned motion prompt — the STILL IMAGE itself is what Google refuses (it reads as a recognizable real person or a minor). Rewrite this scene\'s IMAGE prompt so the subject is clearly generic, regenerate the image, approve it, and the clip will follow.';
  return { 'Regenerează Video': false, 'Aprobare Video': false, 'Status Producție Scenă': 'Așteaptă Aprobare Imagine', 'Aprobare Imagine': false, 'Observații Scenă': note };
}

/** Regen Resubmit Guard: one more try, at most MAX_RESUBMITS, with a fresh poll budget. */
export function resubmitGuard(p: Prepared, state: ClipState) {
  state.regenResubmits = state.regenResubmits || {};
  state.regenPolls = state.regenPolls || {};
  const n = (state.regenResubmits[p.id] || 0) + 1;
  state.regenResubmits[p.id] = n;
  if (n > MAX_RESUBMITS) throw new Error('Scene ' + p.id + ': too many failed video regenerations in this run (' + n + ').');
  state.regenPolls[p.id] = 0;
  return p;
}

// --- The motion judge -----------------------------------------------------------------------------
export function motionPrep(p: Prepared, ev: { Video_Signed_URL: string; Video_Media_Id: string }, state: ClipState) {
  state.motionRerolls = state.motionRerolls || {};
  const key = 'regen:' + p.id;
  const opts = p.opts || {};
  const rawMotion = String(p.motionPrompt || '');
  const adjAt = rawMotion.search(/\s*ADJUSTMENT REQUEST\b/i);
  const storedMotion = adjAt >= 0 ? rawMotion.slice(0, adjAt) : rawMotion;
  const adjustment = adjAt >= 0 ? rawMotion.slice(adjAt).trim() : '';
  const motion = (String(storedMotion).split(/\s*Negative:\s*/i)[0].trim() + (adjustment ? ' ' + adjustment : '')).trim();
  const done = (state.motionRerolls[key] || 0) >= MAX_REROLLS;
  const skip = opts.motionJudge === false ? 'motionJudge: false'
    : (!ev.Video_Signed_URL ? 'no signed clip URL to inspect'
    : (!motion ? 'no motion prompt to judge against'
    : (done ? 'already re-rolled ' + MAX_REROLLS + ' time(s)' : '')));
  const base = { sceneId: p.id, key, ord: p.id, videoUrl: ev.Video_Signed_URL || '', mediaId: ev.Video_Media_Id || '', passthrough: ev };
  if (skip) return Object.assign({}, base, { ok: false as const, reason: skip });
  const system = 'You are a film editor checking whether a generated shot does what its brief said. You are shown a contact sheet: frames sampled at a fixed interval across a single 8-second clip, in time order, left to right and then top to bottom. The frames are samples, not the whole clip: a fault shorter than the gap between two of them is invisible here, so judge what you can actually see and do not infer what happened in between. Judge only what the brief claims and whether the world holds together. Do not judge taste, style, beauty, lighting or composition. Answer only the JSON object requested.';
  const ask = [
    'The brief for this shot was:',
    '"' + motion.slice(0, 700) + '"',
    'Score each 0 to 1.',
    '"direction": does the movement across the frames match what the brief says, including which way things travel and whether they approach or leave? 1 = it does what the brief says; 0 = it does the opposite (the brief says out and the subject goes in, or the brief says left to right and it goes right to left). If the brief names no direction, answer 1.',
    '"permanence": does everything keep its identity and stay present from the first frame to the last? Lower it when something a character is holding disappears from their hands, when a prop or a piece of furniture vanishes and later comes back, when clothing changes between frames, or when a person or object duplicates. Judge only what the frames can actually show: a thing that leaves the frame because the CAMERA moved, or passes behind something else, has not vanished, and every shot here has a camera move. If you simply cannot follow an object, answer 1 rather than guess. 1 = nothing that should still be visible appears or disappears.',
    '"untouched": does everything that cannot move by itself hold still? Lower it when a door, a drawer, a lid or a window opens or closes with no hand on it, when paper, cloth, curtains or hanging signs move INDOORS where there is no wind, or when an object slides with nothing pushing it. This question is about interiors and about objects with no motive power of their own: outdoors, wind, weather, water, foliage, traffic, animals and crowds move on their own and that is correct, so answer 1 for an exterior unless a door, a lid, a drawer or a piece of furniture moves with nobody near it. 1 = nothing moved that had no cause.',
    '"coherent": does the sequence hold together physically? Lower it when solid things pass through each other, when something floats or sinks into the ground, or when a moving vehicle has no driver.',
    '"morph": true if the frames do not show real movement but a dissolve or warp between two different pictures — the subject changing shape, sliding without turning its wheels or legs, or the scene cross-fading. Otherwise false.',
    '"loop": true if the clip fills its eight seconds by repeating or doubling back — the subject performs the same action twice, or walks out of frame and returns to where it started, or the camera travels somewhere and comes back. Otherwise false.',
    'Answer ONLY JSON: {"direction": number, "permanence": number, "untouched": number, "coherent": number, "morph": boolean, "loop": boolean, "problems": ["short concrete reason", ...]}',
  ].join(' ');
  return Object.assign({}, base, { ok: true as const, system, ask, motion });
}
export type MotionPrep = ReturnType<typeof motionPrep>;

/** RG Motion Judge's request body (OpenAI chat), for a contact sheet at `sheetUrl`. */
export function motionJudgeBody(prep: Extract<MotionPrep, { ok: true }>, sheetUrl: string) {
  return { model: 'gpt-4o', temperature: 0, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: prep.system }, { role: 'user', content: [{ type: 'text', text: prep.ask }, { type: 'image_url', image_url: { url: sheetUrl, detail: 'high' } }] }] };
}

/** RG Motion Verdict: keep the take, or spend one more generation. Every way of not getting an answer KEEPS it. */
export function motionVerdict(prep: MotionPrep, judge: any, state: ClipState) {
  state.motionRerolls = state.motionRerolls || {};
  state.motionNotes = state.motionNotes || {};
  const keep = (why: string) => Object.assign({}, prep.passthrough || {}, { motionVerdict: why, motionReroll: false as const });
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
  const n = state.motionRerolls[prep.key] || 0;
  if (!bad.length) return keep('ok');
  if (n >= MAX_REROLLS) return keep('wrong-accepted');
  state.motionRerolls[prep.key] = n + 1;
  state.motionNotes[prep.key] = (bad.join(', ') + (problems.length ? ': ' + problems.join('; ') : '')).slice(0, 400);
  return { sceneId: prep.sceneId, key: prep.key, motionReroll: true as const, morph, loop, attempt: n + 1, problems: bad, discardedMediaId: prep.mediaId };
}

/** RG Motion Resubmit: a new seed and, when the judge found something, a positive correction in the action. */
export function motionResubmit(v: { attempt: number; morph?: boolean; loop?: boolean; problems?: unknown[] }, p: Prepared, state: ClipState) {
  state.regenPolls = state.regenPolls || {};
  state.regenPolls[p.id] = 0;
  const seed = hash(String(p.id) + ':rgmotion:' + v.attempt) % 2147483647;
  const dropEndFrame = v.morph === true;
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
  const fired: string[] = [];
  const seen = (Array.isArray(v.problems) ? v.problems : []).map((x) => String(x).trim().split(/\s+/)[0].toLowerCase());
  if (v.morph === true) seen.push('morph');
  if (v.loop === true) seen.push('loop');
  seen.forEach((k) => { if (CLAUSES[k] && fired.indexOf(k) < 0) fired.push(k); });
  const withheld = fired.filter((k) => UNSAFE.test(CLAUSES[k]));
  const used = SIGNAL_ORDER.filter((k) => fired.indexOf(k) >= 0 && withheld.indexOf(k) < 0).slice(0, MAX_CLAUSES);
  const correction = used.length ? LEAD_IN + used.map((k) => CLAUSES[k]).join(' ') : '';
  const baseMotion = String(p.motionPrompt || '');
  let motionPrompt = baseMotion;
  if (correction) {
    const cut = baseMotion.search(/\s*Negative\s*:/i);
    const head = (cut >= 0 ? baseMotion.slice(0, cut) : baseMotion).trim();
    const tail = cut >= 0 ? baseMotion.slice(cut) : '';
    if (head) motionPrompt = head + ' ' + correction + tail;
  }
  return Object.assign({}, p, { sceneId: p.id, seed, dropEndFrame, attempt: v.attempt, correction, baseMotion, motionPrompt });
}

/** Write Regen Video's fields, with the take's stored URL (the engine never uploads to Drive). */
export function writtenFields(storedUrl: string, mediaId: string) {
  return { 'Scene Final URL': storedUrl, 'Video Media ID': mediaId || '', 'Aprobare Video': false, 'Regenerează Video': false, 'Status Producție Scenă': 'Așteaptă Aprobare Video' };
}
