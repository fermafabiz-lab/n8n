// The production pass's SETUP, before any scene is drawn (Media Generation from
// `Receive Batch Input` to `Sort & Cap Scenes`), ported node by node: the
// producer's own photo uploaded to Flow, the cast and object reference sheets,
// the location plates, our own copy of each (sheet ingest), and the copies of
// all of them on the other Flow accounts (replication → `flowRefs`). Pure
// functions; engine/check-produce-setup.mjs holds each one to its live node.
//
// Drive's `Find Audio Folder` is not ported: voices land in /media (D1).
import type { Fields } from '../assembly/types.ts';
import { ACCOUNTS, IMAGE_MODEL, MANAGER } from './accounts.ts';

const opts = (projectFields: Fields | undefined): any => {
  try { return JSON.parse(((projectFields || {})['Editing Options']) || '{}') || {}; } catch (e) { return {}; }
};
const merge = (a: unknown, b: object) => Object.assign({}, (a && typeof a === 'object') ? a : {}, b);
const generated = (resp: any): { mediaGenerationId?: string; fifeUrl?: string } => {
  try { return ((((resp || {}).media || [])[0] || {}).image || {}).generatedImage || {}; } catch (e) { return {}; }
};

/**
 * The kids styles — a COPY of the table in Claude Scripting's `Voice Mode`,
 * which n8n also keeps in Cast Sheet Prep and Set Plate Prep. All copies must
 * agree (db/port/sheet-style/check.mjs; the check here pins these to the two
 * Media Generation nodes).
 */
export const KIDS_STYLES: Record<string, string> = {
  illustrated: "Children's storybook illustration, soft watercolor and gouache textures, warm pastel palette, rounded friendly character shapes, gentle diffuse lighting",
  crayon: "Children's crayon and chalk drawing, thick waxy strokes, visible paper tooth, bright primary colours, joyful naive proportions",
  papercut: 'Paper cut-out collage animation still, layered coloured paper with visible torn edges and soft drop shadows, flat storybook depth, warm craft-paper palette',
  cel: 'Classic hand-painted 2D cel animation still for children, clean confident ink outlines, flat gouache colour fills, painted background art, warm saturated palette',
  cartoon3d: 'High-quality 3D animated film still for children, soft rounded character design, expressive friendly faces, vivid warm colors, cinematic soft lighting',
  brick: 'Scene built from interlocking plastic toy bricks, glossy moulded minifigures with cylindrical hands and printed smiling faces, visible studs and brick seams, bright primary colours, macro toy photography lighting',
  clay: 'Stop-motion clay animation still, hand-modelled plasticine characters with visible fingerprints and sculpting marks, soft matte surfaces, miniature handcrafted set, warm practical lighting',
  felt: 'Needle-felted wool and soft-toy animation still, fuzzy fibre textures, hand-stitched seams and button eyes, cosy handmade miniature set, warm soft lighting',
};
const kidsStyleOf = (o: any) => {
  const catOpts = (o.categoryOptions && typeof o.categoryOptions === 'object') ? o.categoryOptions : {};
  const key = Object.prototype.hasOwnProperty.call(KIDS_STYLES, String(catOpts.visual_style || '')) ? String(catOpts.visual_style) : 'illustrated';
  return String(o.category || '') === 'kids' ? KIDS_STYLES[key] : '';
};

// --- The producer's photo -------------------------------------------------------------------------
/** User Ref?: a photo to upload that has no Flow id yet. */
export function userRefNeeded(projectFields: Fields | undefined) {
  try { const o = JSON.parse(((projectFields || {})['Editing Options']) || '{}') || {}; return !!(o.refImage && String(o.refImage).startsWith('http') && !o.refImageMediaId); } catch (e) { return false; }
}
/** The photo's URL (Download User Ref). */
export const userRefUrl = (projectFields: Fields) => JSON.parse(projectFields['Editing Options']).refImage;
/** Upload Asset To Flow always goes to the manager. */
export const USER_REF_ACCOUNT = MANAGER;
/** Extract Asset Id: the uploaded photo's Flow id, in any of the shapes useapi answers with. */
export function extractAssetId(resp: any) {
  const item = resp;
  let id = '';
  const raw = item.mediaGenerationId;
  if (typeof raw === 'string') id = raw;
  else if (raw && typeof raw.mediaGenerationId === 'string') id = raw.mediaGenerationId;
  if (!id) {
    (function walk(o: any) {
      if (id) return;
      if (typeof o === 'string') { if (o.includes('-image:') || o.includes('-asset:')) id = o; return; }
      if (Array.isArray(o)) { for (const v of o) { if (id) return; walk(v); } return; }
      if (o && typeof o === 'object') { for (const k of Object.keys(o)) { if (id) return; walk(o[k]); } }
    })(item);
  }
  if (!id || typeof id !== 'string') throw new Error('No mediaGenerationId string found in Flow asset upload response: ' + JSON.stringify(item).slice(0, 500));
  return { mediaId: id };
}

// --- Cast and object sheets ----------------------------------------------------------------------------
/** Load Scene Cast's row. */
export interface CastScene { id: string; scene_order?: number; tags?: unknown; visual_prompt?: string | null }
export interface SheetWork { kind: 'cast' | 'object'; sheet: string; name: string; requestBody: Record<string, unknown> }

/**
 * Cast Sheet Prep: a LEAD gets a turnaround, a recurring character a portrait,
 * a one-scene extra nothing; a hero object in two or more scenes gets a
 * three-view sheet. The producer's photo is the base of the protagonist's.
 * Returns `[{skip: true}]` when there is nothing to draw, as n8n does.
 */
export function castSheetPrep(i: { projectFields: Fields | undefined; scenes: CastScene[]; flowEmail?: string; aspectRatio?: string; savedUserRefId?: string }): Array<SheetWork | { skip: true }> {
  const f = i.projectFields || {};
  const o = opts(f);
  const kidsStyle = kidsStyleOf(o);
  const styleHead = kidsStyle ? kidsStyle + '. ' : '';
  if (i.savedUserRefId) o.refImageMediaId = String(i.savedUserRefId);
  const castRefs = (o.castRefs && typeof o.castRefs === 'object') ? o.castRefs : {};
  const castSheets = (o.castSheets && typeof o.castSheets === 'object') ? o.castSheets : {};
  const objectRefs = (o.objectRefs && typeof o.objectRefs === 'object') ? o.objectRefs : {};
  let bible: any = {};
  try { bible = JSON.parse(f['Story Bible'] || '{}') || {}; } catch (e) { bible = {}; }
  const chars: any[] = Array.isArray(bible.characters) ? bible.characters : [];
  const objs: any[] = Array.isArray(bible.objects) ? bible.objects : [];
  const aspect = i.aspectRatio === '9:16' ? '9:16' : '16:9';
  const email = i.flowEmail || MANAGER;
  const norm = (s: unknown) => String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const scenes = (i.scenes || []).filter((s) => s && s.id);
  const givens = chars.map((c) => norm(String((c || {}).name || '').split(/\s+/)[0] || ''));
  const count = (name: string, prefix: string) => {
    const full = norm(name), given = norm(name.split(/\s+/)[0] || '');
    const keys = givens.filter((g) => g && g === given).length > 1 || prefix !== 'char:' ? [full] : [full, given];
    let n = 0;
    for (const s of scenes) {
      const tags = (Array.isArray(s.tags) ? s.tags : []).map(String);
      const tagged = tags.filter((t: string) => t.startsWith(prefix));
      if (tagged.length) { if (tagged.some((t: string) => norm(t.slice(prefix.length)) === full)) n++; continue; }
      const text = ' ' + norm(s.visual_prompt || '') + ' ';
      if (keys.some((k) => k.length > 2 && new RegExp('\\b' + esc(k) + '\\b').test(text))) n++;
    }
    return n;
  };
  const total = scenes.length;
  const leadMin = Math.max(3, Math.ceil(total * 0.1));
  const protagonist = (() => {
    const byRole = chars.find((c) => /protagonist|lead|main|hero/i.test(String((c || {}).role || '')));
    return String(((byRole || chars[0]) || {}).name || '');
  })();
  const userRefId = String(o.refImageMediaId || '');
  const work: SheetWork[] = [];
  chars.forEach((c) => {
    const name = String((c || {}).name || '').trim();
    const desc = String((c || {}).visual_description || '').trim();
    if (!name || !desc) return;
    const n = total ? count(name, 'char:') : 2;
    const kind = n >= leadMin || (norm(name) === norm(protagonist) && n >= 2) ? 'turnaround' : (n >= 2 ? 'portrait' : 'none');
    if (kind === 'none') return;
    const have = castRefs[name] ? String((castSheets[name] || {}).kind || 'portrait') : '';
    if (have === kind || (have === 'turnaround')) return;
    if (work.length >= 6) return;
    const isProt = norm(name) === norm(protagonist) && !!userRefId;
    const base = kind === 'turnaround'
      ? 'Character reference sheet of ONE character (a person, an animal or a creature, exactly as described) on a plain neutral grey studio backdrop: four full-body views side by side in one row — front view, left profile, back view, right profile — identical outfit, features, markings, colours and build in all four, relaxed natural standing pose, even soft studio lighting, no text, no labels, no grid lines, no props, nothing else in frame: '
      : 'Character reference portrait of ONE character (a person, an animal or a creature, exactly as described), centred, front three-quarter view, plain neutral studio backdrop, even soft lighting, no props, no text, no collage: ';
    const body: Record<string, unknown> = {
      email,
      model: IMAGE_MODEL,
      prompt: styleHead + (isProt ? 'The reference image is the producer\'s own photo of this character and is GROUND TRUTH: build the sheet FROM it — exactly that face, hair, body and outfit, in every view. ' : '') +
        base + desc + ' If the description offers alternatives for different eras or scenes, use the FIRST one only — one character, one outfit, one age. ' + (kidsStyle ? 'Drawn in exactly that style in every view, the same medium as every frame of the film, clean and sharp.' : 'Photorealistic, natural skin or surface texture, sharp focus.'),
      aspectRatio: kind === 'turnaround' ? '16:9' : aspect,
      count: 1,
      captchaRetry: 1,
    };
    if (isProt) body.reference_1 = userRefId;
    work.push({ kind: 'cast', sheet: kind, name, requestBody: body });
  });
  objs.forEach((ob) => {
    const name = String((ob || {}).name || '').trim();
    const desc = String((ob || {}).visual_description || '').trim();
    if (!name || !desc || objectRefs[name]) return;
    const n = total ? count(name, 'obj:') : 2;
    if (n < 2 || work.filter((w) => w.kind === 'object').length >= 3) return;
    work.push({ kind: 'object', sheet: 'object', name, requestBody: {
      email, model: IMAGE_MODEL,
      prompt: styleHead + 'Product reference sheet of ONE object on a plain neutral grey studio backdrop: three views side by side in one row — front three-quarter view, side profile, rear three-quarter view — identical design, colours, markings, materials and proportions in all three, even soft studio lighting, no text, no labels, no people, nothing else in frame: ' + desc + (kidsStyle ? ' Drawn in exactly that style in all three views, the same medium as every frame of the film, clean and sharp.' : ' Photorealistic, sharp focus.'),
      aspectRatio: '16:9', count: 1, captchaRetry: 1,
    } });
  });
  if (!work.length) return [{ skip: true }];
  return work;
}

/** Generate Cast Sheet / Generate Set Plate: the prepared body with captchaRetry 5. One at a time, 8 s apart. */
export const sheetBody = (w: { requestBody: Record<string, unknown> }) => Object.assign({}, w.requestBody, { captchaRetry: 5 });
export const SHEET_INTERVAL_MS = 8000;

/** Collect Cast Refs: pair each answer with its work item and merge the maps onto what the project had. */
export function collectCastRefs(prep: Array<Partial<SheetWork>>, outs: any[], projectFields: Fields | undefined) {
  const cast: Record<string, string> = {}, sheets: Record<string, { id: string; url: string; kind: string }> = {}, objects: Record<string, string> = {};
  outs.forEach((resp, i) => {
    const p: any = prep[i] || {};
    const name = String(p.name || '');
    const gi = generated(resp);
    const id = String(gi.mediaGenerationId || ''), url = String(gi.fifeUrl || '');
    if (!name || !id) return;
    if (p.kind === 'object') objects[name] = id;
    else { cast[name] = id; sheets[name] = { id, url, kind: p.sheet || 'portrait' }; }
  });
  const o = opts(projectFields);
  return { castRefs: merge(o.castRefs, cast), castSheets: merge(o.castSheets, sheets), objectRefs: merge(o.objectRefs, objects), made: Object.keys(cast).length + Object.keys(objects).length };
}

/** Sheet Ingest Prep / Plate Ingest Prep: our own copy of every sheet made this pass, while Flow's URL lives. */
export function ingestPrep(prep: Array<{ name?: string; kind?: string }>, outs: any[], projectId: string, plates: boolean) {
  const items: Array<{ kind: string; name: string; flowId: string; url: string }> = [];
  outs.forEach((resp, i) => {
    const p: any = prep[i] || {};
    const name = String(p.name || '');
    const gi = generated(resp);
    const id = String(gi.mediaGenerationId || ''), url = String(gi.fifeUrl || '');
    if (!name || !id || !/^https?:\/\//.test(url)) return;
    items.push({ kind: plates ? 'location' : (p.kind === 'object' ? 'object' : 'cast'), name, flowId: id, url });
  });
  const pid = String(projectId || '');
  if (!items.length || !/^rec[A-Za-z0-9]{14}$/.test(pid)) return { skip: true as const };
  return { skip: false as const, projectId: pid, items };
}

// --- Location plates ----------------------------------------------------------------------------------------
export interface PlateWork { name: string; requestBody: Record<string, unknown> }
/** Set Plate Prep: one establishing plate per bible location that has none, at most ten. */
export function setPlatePrep(projectFields: Fields | undefined, flowEmail?: string, aspectRatio?: string): Array<PlateWork | { skip: true }> {
  const f = projectFields || {};
  const o = opts(f);
  const kidsStyle = kidsStyleOf(o);
  const styleHead = kidsStyle ? kidsStyle + '. ' : '';
  const have = (o.locationRefs && typeof o.locationRefs === 'object') ? o.locationRefs : {};
  let bible: any = {};
  try { bible = JSON.parse(f['Story Bible'] || '{}') || {}; } catch (e) { bible = {}; }
  const locs: any[] = Array.isArray(bible.locations) ? bible.locations : [];
  const aspect = aspectRatio === '9:16' ? '9:16' : '16:9';
  const work: PlateWork[] = [];
  for (const l of locs) {
    const name = String((l || {}).name || '').trim();
    const desc = String((l || {}).visual_description || '').trim();
    if (!name || !desc || have[name]) continue;
    if (work.length >= 10) break;
    work.push({ name, requestBody: {
      email: flowEmail || MANAGER,
      model: IMAGE_MODEL,
      prompt: styleHead + 'Establishing reference plate of ONE location, wide shot at eye level, completely empty of people and vehicles, soft neutral overcast daylight without strong shadows so every part of the place reads clearly, ' + (kidsStyle ? 'drawn in exactly that style, the same medium as every frame of the film, clean and sharp' : 'photorealistic, sharp focus') + ', no text, no labels: ' + desc + ' Show the whole layout in one frame — what stands at the centre, on the left, on the right and in the background — and the materials, colours and landmarks that identify this exact place.',
      aspectRatio: aspect, count: 1, captchaRetry: 1,
    } });
  }
  if (!work.length) return [{ skip: true }];
  return work;
}

/** Collect Set Plates: pair each plate with its location; failures fall back to text. */
export function collectSetPlates(prep: Array<{ name?: string }>, outs: any[], projectFields: Fields | undefined) {
  const refs: Record<string, string> = {}, plates: Record<string, { id: string; url: string }> = {};
  outs.forEach((resp, i) => {
    const name = String((prep[i] || {}).name || '');
    const gi = generated(resp);
    if (name && gi.mediaGenerationId) { refs[name] = String(gi.mediaGenerationId); plates[name] = { id: String(gi.mediaGenerationId), url: String(gi.fifeUrl || '') }; }
  });
  const o = opts(projectFields);
  return { locationRefs: merge(o.locationRefs, refs), locationPlates: merge(o.locationPlates, plates), made: Object.keys(refs).length };
}

// --- Replication onto the other accounts ------------------------------------------------------------------------
/** Load Sheet Media's row (`hov.sheet_media`, with the media base URL prefixed). */
export interface SheetMedia { flow_id?: string; kind?: string; name?: string; url?: string }
export interface ReplicateWork { skip: false; account: string; key: string; primaryId: string; url: string }

/** Replicate Prep: every stored reference × every other account in use, minus the copies already on the project. */
export function replicatePrep(projectFields: Fields | undefined, rows: SheetMedia[]): Array<ReplicateWork | { skip: true }> {
  const o = opts(projectFields);
  let n = 1;
  const raw = o.flowAccounts;
  if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 1 && raw <= ACCOUNTS.length) n = raw;
  if (n <= 1) return [{ skip: true }];
  const targets = ACCOUNTS.slice(1, n);
  const sources: Array<{ key: string; primaryId: string; url: string }> = [];
  const seen: Record<string, boolean> = {};
  for (const j of rows || []) {
    const r = j || {};
    const flowId = String(r.flow_id || '');
    const url = String(r.url || '');
    if (!flowId || !url || seen[flowId]) continue;
    seen[flowId] = true;
    sources.push({ key: String(r.kind || 'sheet') + ':' + String(r.name || '?'), primaryId: flowId, url });
  }
  if (o.refImage && o.refImageMediaId && !seen[String(o.refImageMediaId)]) {
    sources.push({ key: 'user', primaryId: String(o.refImageMediaId), url: String(o.refImage) });
  }
  const stored = (o.flowRefs && typeof o.flowRefs === 'object') ? o.flowRefs : {};
  const work: ReplicateWork[] = [];
  for (const acct of targets) {
    const have = stored[acct] || {};
    for (const s of sources) {
      if (have[s.primaryId]) continue;
      work.push({ skip: false, account: acct, key: s.key, primaryId: s.primaryId, url: s.url });
    }
  }
  if (!work.length) return [{ skip: true }];
  return work;
}

/**
 * Collect Replicated: file one copy under the account its id says it landed on
 * (not the one asked for), keyed by the primary id. `built` is the table being
 * accumulated for this pass; it is mutated as n8n mutates static data.
 */
export function collectReplicated(w: Partial<ReplicateWork>, upload: any, built: Record<string, Record<string, string>>) {
  const intended = String(w.account || '');
  const primaryId = String(w.primaryId || '');
  let newId = '';
  const item = upload || {};
  const rawId = item.mediaGenerationId;
  if (typeof rawId === 'string') newId = rawId;
  else if (rawId && typeof rawId.mediaGenerationId === 'string') newId = rawId.mediaGenerationId;
  let owner = '';
  const h = newId.match(/-email:([0-9a-f]+)-/i);
  if (h) { for (let i = 0; i < h[1].length; i += 2) owner += String.fromCharCode(parseInt(h[1].substr(i, 2), 16)); }
  if (owner.indexOf('@') < 0) owner = '';
  const account = owner || intended;
  if (account && primaryId && newId) {
    built[account] = built[account] || {};
    built[account][primaryId] = newId;
  }
  return { account, intended, key: w.key, primaryId, newId };
}

/** Build Flow Refs: the table to merge onto the project, and how many ids it maps. */
export function buildFlowRefs(built: Record<string, Record<string, string>>) {
  let total = 0;
  for (const a of Object.keys(built)) total += Object.keys(built[a] || {}).length;
  return { flowRefs: built, count: total };
}

// --- The writes ---------------------------------------------------------------------------------------------------
/** What each setup write merges into `hov.project.editing_options` (top-level keys replace, as `jsonb ||` does). */
export const userRefPatch = (mediaId: string) => ({ refImageMediaId: mediaId });
export const castPatch = (c: ReturnType<typeof collectCastRefs>) => ({ castRefs: c.castRefs, castSheets: c.castSheets, objectRefs: c.objectRefs });
export const platePatch = (c: ReturnType<typeof collectSetPlates>) => ({ locationRefs: c.locationRefs, locationPlates: c.locationPlates });
/**
 * Save Flow Refs — with ONE deliberate change. n8n writes `{flowRefs: <this
 * pass's copies>}` through `jsonb ||`, which REPLACES the stored table rather
 * than adding to it. Replicate Prep skips what is already stored, so a pass
 * that copies only the missing references then throws the older copies away,
 * and the next pass copies those again and throws the new ones away. Here the
 * stored table and this pass's are merged per account, this pass winning.
 */
export function flowRefsPatch(b: ReturnType<typeof buildFlowRefs>, projectFields: Fields | undefined) {
  const o = opts(projectFields);
  const stored = (o.flowRefs && typeof o.flowRefs === 'object') ? o.flowRefs : {};
  const out: Record<string, Record<string, string>> = {};
  for (const a of Object.keys(stored)) out[a] = Object.assign({}, stored[a]);
  for (const a of Object.keys(b.flowRefs)) out[a] = Object.assign({}, out[a] || {}, b.flowRefs[a]);
  return { flowRefs: out };
}
/** Refs To Save?: only a non-empty table is written. */
export const refsToSave = (b: { count: number }) => b.count > 0;
