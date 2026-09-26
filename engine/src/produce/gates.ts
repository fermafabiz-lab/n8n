// The production pass's SKELETON, ported from Media Generation: which scenes a
// pass covers and in what order (Sort & Cap Scenes), which account makes each
// (Assign Accounts), and the three gates (Evaluate Image Approval, Evaluate
// Video Approval, Settings Gate Guard) plus the decision to run another pass
// (More Batches?). All pure; engine/check-produce-images.mjs holds each to its
// live node. The gates are READS of the scene rows — which is what lets the
// engine check them on a schedule instead of holding an execution open.
import type { AtRow, Fields } from '../assembly/types.ts';
import { ACCOUNTS } from './accounts.ts';

export const PASS_CAP = 200;
export const MAX_PASSES = 12;

/** Sort & Cap Scenes: pending scenes first (no clip, or a regen flag), then film order; at most PASS_CAP. */
export function sortAndCap(rows: AtRow[]): AtRow[] {
  const items = rows.slice();
  const ord = (it: AtRow) => { const f = it.fields || {}; return (typeof f['Ordine Scenă'] === 'number') ? f['Ordine Scenă'] : null; };
  const pending = (it: AtRow) => {
    const f = it.fields || {};
    const hasClip = String(f['Scene Final URL'] || '').startsWith('http');
    const flagged = f['Regenerează Video'] === true || f['Regenerează Imagine'] === true || f['Regenerează Voce'] === true;
    return !hasClip || flagged;
  };
  items.sort((a, b) => {
    const pa = pending(a), pb = pending(b);
    if (pa !== pb) return pa ? -1 : 1;
    const oa = ord(a), ob = ord(b);
    if (oa !== null && ob !== null && oa !== ob) return oa - ob;
    const t = (new Date(a.createdTime as string) as any) - (new Date(b.createdTime as string) as any);
    if (t) return t;
    return a.id < b.id ? -1 : 1;
  });
  if (!items.length) throw new Error('No approved scenes found for this project.');
  return items.slice(0, PASS_CAP);
}

const ownerOf = (id: unknown) => {
  let owner = '';
  const hx = String(id || '').match(/-email:([0-9a-f]+)-/i);
  if (hx) { for (let i = 0; i < hx[1].length; i += 2) owner += String.fromCharCode(parseInt(hx[1].substr(i, 2), 16)); }
  return owner;
};

/**
 * Assign Accounts: contiguous blocks, one per account in use (Editing
 * Options.flowAccounts, 1..3; only accounts whose reference copies are all
 * present and really theirs); a scene that already has an image stays on the
 * account that minted it.
 */
export function assignAccounts(rows: AtRow[], projectFields: Fields | undefined, freshFlowRefs?: Record<string, Record<string, string>>) {
  let opts: any = {};
  try { opts = JSON.parse(((projectFields || {})['Editing Options']) || '{}') || {}; } catch (e) { opts = {}; }
  let n = 1;
  const raw = opts.flowAccounts;
  if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 1 && raw <= ACCOUNTS.length) n = raw;
  const scoped: string[] = [];
  for (const k of ['castRefs', 'objectRefs', 'locationRefs']) {
    const o = opts[k];
    if (o && typeof o === 'object') for (const name of Object.keys(o)) if (o[name]) scoped.push(String(o[name]));
  }
  if (opts.refImageMediaId) scoped.push(String(opts.refImageMediaId));
  const flowRefs: Record<string, Record<string, string>> = {};
  if (opts.flowRefs && typeof opts.flowRefs === 'object') for (const a of Object.keys(opts.flowRefs)) flowRefs[a] = Object.assign({}, opts.flowRefs[a]);
  const fresh = freshFlowRefs || {};
  for (const a of Object.keys(fresh)) flowRefs[a] = Object.assign({}, flowRefs[a] || {}, fresh[a]);
  if (n > 1 && scoped.length) {
    let allowed = 1;
    for (let k = 1; k < n; k++) {
      const acct = ACCOUNTS[k];
      const have = flowRefs[acct] || {};
      const missing = scoped.filter((id) => { const v = have[id]; if (!v) return true; return ownerOf(v) !== acct; });
      if (missing.length) break;
      allowed = k + 1;
    }
    n = allowed;
  }
  const total = rows.length;
  const per = Math.max(1, Math.ceil(total / n));
  const safeOwner = (id: unknown) => { const o = ownerOf(id); return o.indexOf('@') < 0 ? '' : o; };
  return rows.map((it, i) => {
    const block = n > 1 ? Math.min(n - 1, Math.floor(i / per)) : 0;
    let email = ACCOUNTS[block];
    const imgOwner = safeOwner(((it.fields || {})['Image Media ID']) || '');
    if (imgOwner && imgOwner !== email) email = imgOwner;
    return Object.assign({}, it, { flowEmail: email, flowBlock: block });
  });
}

/** Keep the pass's scenes, once each, in the pass's order (the shape every gate starts with). */
function inPassOrder(expected: string[], rows: AtRow[]) {
  const order: Record<string, number> = {};
  expected.forEach((id, i) => { order[id] = i; });
  const seen = new Set<string>();
  return rows
    .filter((r) => order[r.id] !== undefined)
    .filter((r) => { if (seen.has(r.id)) return false; seen.add(r.id); return true; })
    .slice()
    .sort((a, b) => order[a.id] - order[b.id]);
}

/**
 * Evaluate Image Approval — THE ASSET GATE, as a verdict. Open when every
 * image is approved AND present and every voice is approved AND present
 * (a silent scene, or a Cinematic film, needs no take). Image regeneration
 * is the engine's own work now (hov.media_job), so this reports the flagged
 * scenes rather than dispatching them.
 */
export function assetGate(expected: string[], rows: AtRow[], projectFields: Fields | undefined) {
  const recs = inPassOrder(expected, rows);
  const total = recs.length;
  const imagesApproved = recs.filter((r) => { const f = r.fields || {}; const att = f['Imagine Scenă']; return f['Aprobare Imagine'] === true && Array.isArray(att) && att.length > 0; }).length;
  let noSpeech = false;
  try { noSpeech = JSON.parse(((projectFields || {})['Editing Options']) || '{}').category === 'cinematic'; } catch (e) {}
  const voicesApproved = recs.filter((r) => { const f = r.fields || {}; const silentScene = String(f['Script Scenă'] || '').trim() === ''; return f['Aprobare Voce'] === true && (noSpeech || silentScene || String(f['Voiceover URL'] || '') !== ''); }).length;
  const flagged = recs.filter((r) => (r.fields || {})['Regenerează Imagine'] === true).map((r) => r.id);
  return { allApproved: total > 0 && imagesApproved === total && voicesApproved === total, total, imagesApproved, voicesApproved, flagged };
}

/** Evaluate Video Approval — THE VIDEO GATE: every clip approved AND present. */
export function videoGate(expected: string[], rows: AtRow[]) {
  const recs = inPassOrder(expected, rows);
  const total = recs.length;
  const approved = recs.filter((r) => { const f = r.fields || {}; return f['Aprobare Video'] === true && String(f['Scene Final URL'] || '').startsWith('http'); }).length;
  const flaggedVideo = recs.filter((r) => (r.fields || {})['Regenerează Video'] === true).map((r) => r.id);
  const flaggedVoice = recs.filter((r) => (r.fields || {})['Regenerează Voce'] === true).map((r) => r.id);
  return { allApproved: total > 0 && approved === total, total, approved, flaggedVideo, flaggedVoice };
}

/** More Batches?: another pass while an approved scene has no clip or is owed a re-shoot (at most MAX_PASSES). */
export function morePasses(rows: AtRow[], passIndex: number) {
  const remaining = rows.filter((r) => { const f = r.fields || {}; return !String(f['Scene Final URL'] || '').startsWith('http') || f['Regenerează Video'] === true; }).length;
  const more = remaining > 0 && passIndex + 1 < MAX_PASSES;
  return { remaining, more, pass: passIndex + 1 };
}

/** Settings Gate Guard: released when the status leaves `Setări Finale`, or after 480 checks (2 h). */
export const SETTINGS_WAITING = 'Setări Finale';
export const SETTINGS_MAX_CHECKS = 480;
export function settingsGate(projectFields: Fields | undefined, sceneRows: AtRow[], checks: number, bounced: Set<string>) {
  const status = String((projectFields || {})['Status General'] || '');
  const timedOut = checks > SETTINGS_MAX_CHECKS;
  const moved = status !== '' && status !== SETTINGS_WAITING;
  const flagged = sceneRows.filter((r) => ((r.fields || {})['Regenerează Video'] === true)).map((r) => r.id).filter(Boolean);
  const fresh = flagged.filter((id) => !bounced.has(id));
  const regenPending = !moved && !timedOut && fresh.length > 0;
  if (regenPending) fresh.forEach((id) => bounced.add(id));
  return { status, confirmed: moved || timedOut, timedOut, regenPending, flagged: flagged.length };
}
