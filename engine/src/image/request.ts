// The request for one scene's image regeneration — IR Build Request (Claude
// Scripting, the `scene-image-regen` webhook), ported. It rebuilds from the
// database alone what the batch holds in memory: the prompt (with the
// reviewer's adjustment), the aspect, and the SAME references as the
// neighbours (references.ts). engine/check-image.mjs holds it to the live body.
import type { AtRow, Fields } from '../assembly/types.ts';
import { CONS } from './references.ts';

/** One model string, in three places in n8n that must agree. */
export const IMAGE_MODEL = 'nano-banana-2';
/** The Flow account every site regeneration draws on (the Ultra family manager). */
export const REGEN_ACCOUNT = 'fermafabiz@gmail.com';

export interface ImageRequest {
  sceneId: string;
  prompt: string;
  requestBody: Record<string, unknown>;
  refs: Array<{ id: string; role: string; name: string }>;
  usedReference: string | null;
  refIsUser: boolean;
  aspect: '9:16' | '16:9';
  log: string;
}

export function buildRegenRequest(input: { scene: AtRow; siblings: AtRow[]; projectFields: Fields | undefined; captchaRetry?: number }): ImageRequest {
  const scene = input.scene;
  const f: Fields = scene.fields || {};
  const project: Fields = input.projectFields || {};
  const all = input.siblings.slice()
    .sort((a, b) => (Number((a.fields || {})['Ordine Scenă']) || 0) - (Number((b.fields || {})['Ordine Scenă']) || 0));

  let prompt = f['Imagine First Frame'] || f['Prompt Vizual'] || '';
  if (!prompt) throw new Error('Scene ' + scene.id + ' has no image prompt.');
  // Reviewer feedback steers the re-roll instead of repeating it blindly.
  const note = String(f['Observații Scenă'] || '').trim();
  if (note && !/REJECTED|FAILED|AUTO-REWRITE/i.test(note)) {
    prompt += '\n\nADJUSTMENT REQUEST — the new image MUST follow this: ' + note;
  }
  const rejectedBefore = /REJECTED|AUTO-REWRITE/i.test(note);

  let opts: any = {};
  try { opts = JSON.parse(project['Editing Options'] || '{}') || {}; } catch (e) {}
  let bible: any = {};
  try { bible = JSON.parse(project['Story Bible'] || '{}') || {}; } catch (e) {}
  const isFirstScene = Number(f['Ordine Scenă']) === 1;
  const userRefId = isFirstScene ? String(opts.refImageMediaId || '') : '';
  let log = '';
  if (isFirstScene && !userRefId && String(opts.refImage || '').startsWith('http')) {
    log += 'IR: scene 1 has a reference photo but no refImageMediaId yet (the next batch pass uploads it) — regenerating without it.\n';
  }
  // The previous scene's picture, last, by media id; dropped when the two
  // prompts are mostly the same words — except in a Cinematic film, where it
  // is the previous SHOT.
  const idx = all.findIndex((r) => r.id === scene.id);
  const continuity = String(opts.category || '') === 'cinematic';
  let prevId = '';
  if (idx > 0 && !rejectedBefore) {
    const prev = all[idx - 1].fields || {};
    prevId = String(prev['Image Media ID'] || '');
    const wordSet = (s: unknown) => new Set(String(s || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((w) => w.length > 3));
    const A = wordSet(prompt), B = wordSet(prev['Imagine First Frame']);
    if (A.size && B.size) {
      let hit = 0;
      for (const w of A) if (B.has(w)) hit++;
      if (hit / Math.max(A.size, B.size) > 0.55 && !continuity) prevId = '';
    }
  }
  const aspect = project['Format'] === '9:16' ? '9:16' : '16:9';
  const planned = CONS.plan({ f, opts, bible, prompt, prevId, userRefId, isFirstScene, afterRefusal: rejectedBefore, strict: false, strictNotes: '', continuity, prevF: idx > 0 ? (all[idx - 1].fields || {}) : null });
  // count: 1 is mandatory (the API defaults to four).
  const body = CONS.apply({ email: REGEN_ACCOUNT, model: IMAGE_MODEL, prompt, aspectRatio: aspect, count: 1, captchaRetry: input.captchaRetry ?? 1 }, planned);
  log += 'IR refs for ' + scene.id + ': ' + (planned.refs.map((r: any) => r.role + (r.name ? '=' + r.name : '')).join(', ') || 'none');
  return {
    sceneId: scene.id,
    prompt,
    requestBody: body,
    refs: planned.refs,
    usedReference: planned.refs.length ? planned.refs[0].id : null,
    refIsUser: planned.used.user,
    aspect,
    log,
  };
}

/**
 * The engine's one deliberate change to the request: `captchaRetry` 5, not 1.
 * A 403 PUBLIC_ERROR_UNUSUAL_ACTIVITY is a reCAPTCHA token Google rejected, not
 * an account flag, and 1 turned every weak token into a refusal; every batch
 * Flow body was moved to 5 on 2026-09-23 and CLAUDE.md lists this node as the
 * one still owed ("Still owed: the same line in … IR Generate Image").
 */
export const REGEN_CAPTCHA_RETRY = 5;

/** Flow answers synchronously: media[0].image.generatedImage (IR Decode Image). */
export function decodeFlowImage(resp: any): { url: string; mediaId: string } {
  const m0 = ((resp && resp.media) || [])[0] || {};
  const gi = (m0.image && m0.image.generatedImage) || {};
  if (!gi.fifeUrl || !gi.mediaGenerationId) throw new Error('No image in Flow response. Head: ' + JSON.stringify(resp).slice(0, 400));
  return { url: gi.fifeUrl, mediaId: gi.mediaGenerationId };
}

/** What a refusal writes on the scene (IR Mark Rejected), word for word. */
export function rejectionNote(reason: string): string {
  return 'Image regeneration REJECTED: ' + String(reason || 'the image service refused this prompt').slice(0, 400) + ' — edit the image prompt and press Regenerate again.';
}
