// The production pass's IMAGE stage (Media Generation's `Loop Images` chain),
// ported node by node. Pure functions: what n8n reads out of a node's PREVIOUS
// run (the n-1 image, the previous prompt) is passed in as `prev`, what it keeps
// in workflow static data is an explicit `ImageState`, and `now` is a parameter.
// engine/check-produce-images.mjs holds each one to its live node.
import type { AtRow, Fields } from '../assembly/types.ts';
import { CONS } from '../image/references.ts';
import { ACCOUNTS as ACCOUNT_LIST, IMAGE_MODEL, MANAGER } from './accounts.ts';

export { ACCOUNTS, MANAGER } from './accounts.ts';
const ACCOUNTS_ORDER = (a: string) => ACCOUNT_LIST.indexOf(a);

/** What the stage kept in `$getWorkflowStaticData('global')`, reset per pass by Sort & Cap. */
export interface ImageState {
  consistencyRerolls?: Record<string, number>;
  consistencyNotes?: Record<string, string>;
  imgRewrites?: Record<string, number>;
  imgCooldowns?: Record<string, number>;
  /** Accounts Google flagged, until when (ms). Lives across passes. */
  imgAvoid?: Record<string, number>;
}

/** The previous scene of THIS pass, as Build Image Request reads it from its own and Decode's previous runs. */
export interface PrevImage { mediaId?: string; rawPrompt?: string; locTags?: string[] | null }

/** Needs Image?: the scene has no image attachment yet. */
export const needsImage = (scene: AtRow) => ((scene.fields || {})['Imagine Scenă'] || []).length === 0;

// --- Build Image Request --------------------------------------------------------------------
export interface BuildInput {
  scene: AtRow;
  aspectRatio: unknown;
  flowEmail?: string;
  projectFields: Fields | undefined;
  /** What THIS pass stored after the project was read (Save User Ref Id / Save Cast Refs / Save Set Plates). */
  overrides?: { refImageMediaId?: string; castRefs?: object; castSheets?: object; objectRefs?: object; locationRefs?: object };
  prev?: PrevImage | null;
  state: ImageState;
}

export function buildImageRequest(i: BuildInput) {
  const $json = i.scene;
  const f: Fields = $json.fields || {};
  const prompt = f['Imagine First Frame'] || f['Prompt Vizual'] || '';
  if (!prompt) throw new Error('Scene ' + $json.id + ' has no image prompt.');
  const aspect = i.aspectRatio === '9:16' ? '9:16' : '16:9';
  const projF = i.projectFields || {};
  let opts: any = {}; try { opts = JSON.parse(projF['Editing Options'] || '{}') || {}; } catch (e) { opts = {}; }
  let bible: any = {}; try { bible = JSON.parse(projF['Story Bible'] || '{}') || {}; } catch (e) { bible = {}; }
  const o = i.overrides || {};
  if (o.refImageMediaId) opts.refImageMediaId = String(o.refImageMediaId);
  if (o.castRefs) opts.castRefs = o.castRefs;
  if (o.castSheets) opts.castSheets = o.castSheets;
  if (o.objectRefs) opts.objectRefs = o.objectRefs;
  if (o.locationRefs) opts.locationRefs = o.locationRefs;
  const userRefId = String(opts.refImageMediaId || '');
  const isFirstScene = Number(f['Ordine Scenă']) === 1;
  let prevId = String(i.prev?.mediaId || '');
  const prevPrompt = String(i.prev?.rawPrompt || '');
  const wordSet = (s: unknown) => new Set(String(s || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((w) => w.length > 3));
  let promptSim = 0;
  if (prevPrompt) {
    const A = wordSet(prompt), B = wordSet(prevPrompt);
    if (A.size && B.size) { let hit = 0; for (const w of A) if (B.has(w)) hit++; promptSim = hit / Math.max(A.size, B.size); }
  }
  const continuity = String(opts.category || '') === 'cinematic';
  if (promptSim > 0.55 && !continuity) prevId = '';
  let prevF: Fields | null = null;
  if (continuity && i.prev && Array.isArray(i.prev.locTags)) prevF = { 'Tag-uri Scenă': i.prev.locTags.map((x) => 'loc:' + x) };
  const afterRefusal = /AUTO-REWRITE/.test(String(f['Observații Scenă'] || ''));
  const sd = i.state;
  sd.consistencyRerolls = sd.consistencyRerolls || {};
  sd.consistencyNotes = sd.consistencyNotes || {};
  const strict = (sd.consistencyRerolls[$json.id] || 0) > 0;
  const strictNotes = strict ? String(sd.consistencyNotes[$json.id] || '') : '';
  const planned = CONS.plan({ f, opts, bible, prompt, prevId, userRefId, isFirstScene, afterRefusal, strict, strictNotes, continuity, prevF });
  const body = CONS.apply({ email: i.flowEmail || MANAGER, model: IMAGE_MODEL, prompt, aspectRatio: aspect, count: 1, captchaRetry: 1 }, planned);
  return { sceneId: $json.id, requestBody: body, refs: planned.refs, used: planned.used, usedReference: planned.refs.length ? planned.refs[0].id : null, castUsed: planned.used.cast, userRefApplied: planned.used.user, strict, rawPrompt: prompt, promptSimilarityToPrev: Number(promptSim.toFixed(2)), ...(continuity ? { locTags: CONS.tagged(f, 'loc:') } : {}) };
}
export type ImageRequest = ReturnType<typeof buildImageRequest>;

// --- IMG Account -------------------------------------------------------------------------------
export interface Assignment { id: string; flowEmail?: string }

/** The account for this attempt: the scene's block, unless Google flagged it and another account the film uses is free. */
export function imgAccount(sceneId: string, assignments: Assignment[], state: ImageState, now: number) {
  let block = '';
  const inUse: string[] = [];
  for (const x of assignments) {
    const e = String(x.flowEmail || '');
    if (e && inUse.indexOf(e) < 0) inUse.push(e);
    if (x.id === sceneId) block = e;
  }
  inUse.sort((a, b) => ACCOUNTS_ORDER(a) - ACCOUNTS_ORDER(b));
  const avoid = state.imgAvoid || {};
  const avoided = (a: string) => Number(avoid[a] || 0) > now;
  let acct = block;
  if (block && avoided(block)) {
    const alt = inUse.find((a) => a !== block && !avoided(a));
    if (alt) acct = alt;
  }
  return { sceneId, imgAccount: acct, blockAccount: block };
}

// --- Generate Scene Image ------------------------------------------------------------------------
/**
 * The body sent to Flow: the request on the chosen account, each reference
 * swapped for its copy on that account (the replication table, the fresh one
 * first), a reference owned by ANOTHER account dropped (it would be `Email
 * mismatch`), the rest renumbered, captchaRetry 5.
 */
export function generateBody(src: ImageRequest, assignments: Assignment[], chosen: { sceneId: string; imgAccount: string } | null, flowRefs: { fresh?: Record<string, Record<string, string>>; stored?: Record<string, Record<string, string>> }) {
  const r: Record<string, unknown> = Object.assign({}, src.requestBody);
  let acct = '';
  const m = assignments.find((x) => x.id === src.sceneId);
  if (m && m.flowEmail) acct = m.flowEmail;
  if (chosen && chosen.sceneId === src.sceneId && chosen.imgAccount) acct = chosen.imgAccount;
  if (acct) r.email = acct;
  const map: Record<string, string> = Object.assign({}, (flowRefs.fresh || {})[acct] || {});
  const s = (flowRefs.stored || {})[acct] || {};
  for (const k of Object.keys(s)) if (!map[k]) map[k] = s[k];
  const keys = Object.keys(r).filter((k) => k.indexOf('reference_') === 0).sort((a, b) => Number(a.slice(10)) - Number(b.slice(10)));
  const kept: string[] = [];
  for (const k of keys) {
    const id = String(r[k] || '');
    delete r[k];
    if (!id) continue;
    if (map[id]) { kept.push(map[id]); continue; }
    let owner = '';
    const h = id.match(/-email:([0-9a-f]+)-/i);
    if (h) { for (let i = 0; i < h[1].length; i += 2) owner += String.fromCharCode(parseInt(h[1].substr(i, 2), 16)); }
    if (acct && owner && owner !== acct) continue;
    kept.push(id);
  }
  kept.forEach((id, i) => { r['reference_' + (i + 1)] = id; });
  r.captchaRetry = 5;
  return r;
}

// --- Decode Scene Image / IMG Error Router ----------------------------------------------------------
/** The picture out of Flow's answer. A completed job with no image is the filter's SILENT refusal. */
export function decodeSceneImage(resp: any, sceneId: string) {
  const m0 = ((resp && resp.media) || [])[0] || {};
  const gi = (m0.image && m0.image.generatedImage) || {};
  const url = gi.fifeUrl || '';
  const mediaId = gi.mediaGenerationId || '';
  if (!url || !mediaId) throw new Error('FLOW_NO_IMAGE — Google Flow completed the job and returned no image, which is how its content filter refuses quietly. Head: ' + JSON.stringify(resp).slice(0, 400));
  return { sceneId, url, mediaId };
}

/** A failed attempt, sorted: out of credits (fatal), a content refusal (the rewrite ladder), or a throttle (time). */
export function routeImageError(j: any) {
  j = j || {};
  const text = JSON.stringify(j).slice(0, 2000);
  const status = Number((j.error && (j.error.httpCode || j.error.statusCode)) || j.httpCode || j.statusCode || (/"httpCode":"?(\d{3})/.exec(text) || [])[1] || 0);
  if (status === 402 || /insufficient credits|out of credits|"402"/i.test(text)) throw new Error('Google Flow: out of credits — ' + text.slice(0, 300));
  const noImage = text.includes('FLOW_NO_IMAGE');
  const throttled = !noImage && /captcha_quality|UNUSUAL_ACTIVITY|TOO_MUCH_TRAFFIC/i.test(text);
  const refusal = noImage || (!throttled && /PROMINENT|MINOR|FILTER|SAFETY|content policy|content_policy|blocked/i.test(text));
  return Object.assign({}, j, { imgRefusal: refusal, imgThrottled: throttled, imgNoImage: noImage, imgStatus: status });
}

// --- The refusal ladder: Prep Flow Reject → Rewrite Prompt AI → Apply Rewritten Prompt, or Mark Flow Upload Rejected ---
export const MAX_REWRITES = 4;
export function prepFlowReject(scene: AtRow, err: unknown, sentPrompt: string, state: ImageState) {
  const f = scene.fields || {};
  const errText = JSON.stringify(err).slice(0, 1500);
  const service = 'Google Flow';
  let reason = service + ' content policy';
  if (errText.includes('FLOW_NO_IMAGE')) reason = service + ' ran the job and returned no image at all — its silent refusal, which names no cause. Assume the strictest reading: something in the prompt or its reference sheets reads as a real person, a minor, or unsafe content';
  else if (errText.includes('MINOR')) reason = 'the image appears to contain a child (Flow refuses images with minors)';
  else if (errText.includes('PROMINENT') || errText.includes('FACE')) reason = 'the image appears to contain a recognizable real person';
  let prompt = String(sentPrompt || '');
  if (!prompt) prompt = String(f['Imagine First Frame'] || '');
  const note = String(f['Observații Scenă'] || '');
  state.imgRewrites = state.imgRewrites || {};
  const n = (state.imgRewrites[scene.id] || 0) + 1;
  state.imgRewrites[scene.id] = n;
  const attempt = n + (/AUTO-REWRITE|REJECTED/.test(note) ? 1 : 0);
  return { sceneId: scene.id, prompt, note, service, reason, attempt, giveUp: n > MAX_REWRITES };
}
export type FlowReject = ReturnType<typeof prepFlowReject>;

/** Rewrite Prompt AI's request (OpenAI): stricter with every attempt, the people gone by the third. */
export function rewritePromptBody(p: FlowReject) {
  return { model: 'gpt-4o-mini', temperature: 0.4, messages: [{ role: 'system', content: 'You rewrite image-generation prompts that were refused by a content filter. Keep the scene\'s story intent, location, lighting, palette, lens and mood EXACTLY; change only what triggers the refusal. If the reason involves a child/minor: replace the child with an adult, OR keep the child implied but strictly off-screen (a small shoe, a toy, a shadow under a door, an empty swing) — no minor may be visible. If it involves a real/recognizable person: make the person generic and unrecognizable.' + (p.attempt >= 2 ? ' THIS IS REWRITE ATTEMPT ' + p.attempt + ': earlier rewrites of this prompt were STILL refused, so go much further. Remove every explicit depiction of violence, blood, injury, weapons, drugs, self-harm, nudity or sexual content; no children or teenagers anywhere; no real or named people, no brands or logos; every person generic, adult, fully clothed and calm; keep the faces of people out of frame (from behind, in silhouette, at a distance, or hands and objects only) and show the situation through objects, environment, light and weather.' : '') + (p.attempt >= 3 ? ' Remove every person from the frame entirely: an empty environment whose objects, light and weather carry the mood.' : '') + ' Return ONLY the rewritten prompt text, no commentary.' }, { role: 'user', content: 'Refusal reason: ' + p.reason + '\n\nOriginal prompt:\n' + p.prompt }] };
}

/** Apply Rewritten Prompt's writes: the rewritten prompt (or the old one if the model said nothing) and the AUTO-REWRITE note. */
export function rewrittenFields(p: FlowReject, answer: any) {
  return { 'Imagine First Frame': (answer && answer.choices && answer.choices[0] && answer.choices[0].message && answer.choices[0].message.content || '').trim() || p.prompt, 'Regenerează Imagine': false, 'Aprobare Imagine': false, 'Status Producție Scenă': 'Așteaptă Aprobare Imagine', 'Observații Scenă': 'AUTO-REWRITE (attempt ' + p.attempt + '): ' + p.service + ' rejected the previous image — ' + p.reason + '. The image prompt was rewritten automatically and resubmitted.' };
}

/** Mark Flow Upload Rejected's writes: the ladder is spent, a human rewrites the prompt. */
export function rejectedFields(p: { service?: string; attempt?: number; reason?: string }) {
  return { 'Status Producție Scenă': 'Așteaptă Aprobare Imagine', 'Aprobare Imagine': false, 'Regenerează Imagine': false, 'Observații Scenă': 'REJECTED by ' + (p.service || 'Google Flow') + ' after ' + ((p.attempt || 1) - 1) + ' automatic rewrites: ' + (p.reason || 'content policy') + '. The prompt keeps tripping the filter — often the location or a character in the Story Bible carries the refused content. Rewrite the image prompt yourself and regenerate the image.' };
}

// --- IMG Cooldown Guard -------------------------------------------------------------------------------
export const MAX_IMG_COOLDOWNS = 20;
export const AVOID_MS = 30 * 60 * 1000;
export function imgCooldown(sceneId: string, routed: any, usedAccount: string, assignments: Assignment[], state: ImageState, now: number) {
  state.imgCooldowns = state.imgCooldowns || {};
  state.imgAvoid = state.imgAvoid || {};
  const n = (state.imgCooldowns[sceneId] || 0) + 1;
  state.imgCooldowns[sceneId] = n;
  const j = routed || {};
  const last = String(j.lastError || (j.error && (j.error.message || j.error.description)) || j.message || JSON.stringify(j)).slice(0, 300);
  if (n > MAX_IMG_COOLDOWNS) throw new Error('Flow image generation kept failing after ' + MAX_IMG_COOLDOWNS + ' cooldowns of 60s — last reason: ' + last);
  const throttled = !!j.imgThrottled;
  const inUse: string[] = [];
  for (const x of assignments) { const e = String(x.flowEmail || ''); if (e && inUse.indexOf(e) < 0) inUse.push(e); }
  inUse.sort((a, b) => ACCOUNTS_ORDER(a) - ACCOUNTS_ORDER(b));
  let failover = false;
  if (throttled && usedAccount) {
    state.imgAvoid[usedAccount] = now + AVOID_MS;
    const alt = inUse.find((a) => a !== usedAccount && Number(state.imgAvoid![a] || 0) <= now);
    if (alt) failover = true;
  }
  const holds = failover ? 1 : (throttled ? 5 : 1);
  const retryNow = failover || n % holds === 0;
  return { cooldown: n, retryNow, failover, waitSeconds: failover ? 5 : 60, imgThrottled: throttled, lastError: last };
}

// --- The consistency judge ------------------------------------------------------------------------------
export function judgePrep(dec: { sceneId: string; url: string; mediaId: string }, req: ImageRequest, projectFields: Fields | undefined, overrides: { castSheets?: object; locationPlates?: object } | undefined, now: number) {
  const refs: any[] = Array.isArray(req.refs) ? req.refs : [];
  const projF = projectFields || {};
  let opts: any = {}; try { opts = JSON.parse(projF['Editing Options'] || '{}') || {}; } catch (e) { opts = {}; }
  if (overrides?.castSheets) opts.castSheets = overrides.castSheets;
  if (overrides?.locationPlates) opts.locationPlates = overrides.locationPlates;
  let bible: any = {}; try { bible = JSON.parse(projF['Story Bible'] || '{}') || {}; } catch (e) { bible = {}; }
  const descOf = (list: unknown, name: string) => String((((Array.isArray(list) ? list : []).find((x: any) => String((x || {}).name || '') === name)) || {}).visual_description || '');
  const urlOf = (r: any) => {
    if (r.role === 'cast') return String(((opts.castSheets || {})[r.name] || {}).url || '');
    if (r.role === 'place') return String(((opts.locationPlates || {})[r.name] || {}).url || '');
    if (r.role === 'user') return String(opts.refImage || '');
    return '';
  };
  const stillValid = (u: string) => { const m = /[?&]Expires=(\d+)/.exec(u); return !!u && (!m || Number(m[1]) * 1000 > now + 60000); };
  const compare = refs.filter((r) => ['cast', 'place', 'user'].includes(r.role)).map((r) => ({ role: r.role, name: r.name, url: urlOf(r) })).filter((r) => stillValid(r.url));
  if (!compare.length || !dec.url) return Object.assign({}, dec, { skip: true as const });
  const lines: string[] = [];
  const content: any[] = [{ type: 'text', text: 'FRAME — the newly generated film frame to judge:' }, { type: 'image_url', image_url: { url: dec.url, detail: 'low' } }];
  compare.forEach((r, i) => {
    const label = r.role === 'place' ? 'PLACE reference ' + (i + 1) + ' — the location "' + r.name + '"' : (r.role === 'user' ? 'PERSON reference ' + (i + 1) + ' — the producer\'s photo of ' + r.name : 'PERSON reference ' + (i + 1) + ' — the character sheet of ' + r.name);
    const d = r.role === 'place' ? descOf(bible.locations, r.name) : descOf(bible.characters, r.name);
    content.push({ type: 'text', text: label + (d ? ' (described as: ' + d.slice(0, 400) + ')' : '') + ':' });
    content.push({ type: 'image_url', image_url: { url: r.url, detail: 'low' } });
    lines.push(label);
  });
  const hasPerson = compare.some((r) => r.role !== 'place'), hasPlace = compare.some((r) => r.role === 'place');
  const ask = 'Judge whether the FRAME is consistent with the references. Score 0 to 1, where 1 is unmistakably the same and 0.5 is doubtful.' +
    (hasPerson ? ' "identity": does the character in the frame (a person, an animal or a creature) have the same face or head, hair or markings, colours, age and build as their reference (a different angle, distance or expression is fine)? "wardrobe": is it the same outfit — same garments, colours, materials? If the character is not visible in the frame at all (from behind at distance, hands only), answer 0.8 for both and say so in problems.' : '') +
    (hasPlace ? ' "place": is the frame the same location as the PLACE reference — same architecture, layout, landmarks, materials — allowing for a different framing, hour, weather and light?' : '') +
    ' Also check "sheet_leak": did the frame render the reference sheet itself (several copies of one character side by side, a neutral studio backdrop, a grid)? true/false. Answer ONLY JSON: {"identity": number|null, "wardrobe": number|null, "place": number|null, "sheet_leak": boolean, "problems": ["short concrete reason", ...]}';
  content.push({ type: 'text', text: ask });
  const body = { model: 'gpt-4o', temperature: 0, response_format: { type: 'json_object' }, messages: [
    { role: 'system', content: 'You are a film continuity supervisor comparing a generated frame with reference sheets. Be strict about faces or heads, hair or markings, colours, garments and architecture; be lenient about angle, distance, expression, pose, light and weather. Answer only the JSON object requested.' },
    { role: 'user', content },
  ] };
  return Object.assign({}, dec, { skip: false as const, body, compared: lines });
}
export type JudgePrep = ReturnType<typeof judgePrep>;

export const MAX_CONSISTENCY_REROLLS = 2;
export function judgeVerdict(dec: { sceneId: string; url: string; mediaId: string }, prep: { skip: boolean }, answer: any, state: ImageState) {
  state.consistencyRerolls = state.consistencyRerolls || {};
  state.consistencyNotes = state.consistencyNotes || {};
  const pass = (why: string) => ({ sceneId: dec.sceneId, url: dec.url, mediaId: dec.mediaId, reroll: false as const, judged: why !== 'skipped', verdict: why });
  if (prep.skip) return pass('skipped');
  let v: any = null;
  try {
    const j = answer;
    const text = j && j.choices && j.choices[0] && j.choices[0].message ? String(j.choices[0].message.content || '') : '';
    const m = text.match(/\{[\s\S]*\}/);
    v = m ? JSON.parse(m[0]) : null;
  } catch (e) { v = null; }
  if (!v) return pass('unreadable');
  const num = (x: unknown) => (typeof x === 'number' && isFinite(x)) ? x : null;
  const identity = num(v.identity), wardrobe = num(v.wardrobe), place = num(v.place);
  const problems = Array.isArray(v.problems) ? v.problems.map(String).slice(0, 4) : [];
  const bad: string[] = [];
  if (identity !== null && identity < 0.6) bad.push('identity ' + identity);
  if (wardrobe !== null && wardrobe < 0.6) bad.push('wardrobe ' + wardrobe);
  if (place !== null && place < 0.55) bad.push('place ' + place);
  if (v.sheet_leak === true) bad.push('the reference sheet leaked into the frame');
  const n = state.consistencyRerolls[dec.sceneId] || 0;
  if (!bad.length) return pass('ok');
  if (n >= MAX_CONSISTENCY_REROLLS) return pass('drift-accepted');
  state.consistencyRerolls[dec.sceneId] = n + 1;
  state.consistencyNotes[dec.sceneId] = (bad.join(', ') + (problems.length ? ': ' + problems.join('; ') : '')).slice(0, 400);
  return { sceneId: dec.sceneId, reroll: true as const, attempt: n + 1, problems: bad, discardedMediaId: dec.mediaId };
}

/** Write Scene Image's fields (through /api/media/ingest). */
export function writtenImageFields(mediaId: string) {
  return { 'Image Media ID': mediaId, 'Aprobare Imagine': false, 'Regenerează Imagine': false, 'Status Producție Scenă': 'Așteaptă Aprobare Imagine' };
}
