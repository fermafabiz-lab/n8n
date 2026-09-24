import { editingOptions } from './editingOptions.ts';
import type { AtRow, Clip, Fields } from './types.ts';
import type { RenderBody } from './buildProps.ts';

/**
 * Source Watermark: what the viewer is looking at, per scene (AI GENERATED,
 * ARCHIVAL FOOTAGE, ...). A LOOKUP of the `Provenance` hov.at_scene already
 * emits in the render's shape (db/009); nothing is decided here, so the
 * render can never disagree with the record the producer approved.
 *
 * The label is a Documentary feature (2026-09-19, the producer's call, made
 * knowing a documentary filed as Story loses it; CLAUDE.md has the count).
 * A licence credit is drawn whatever this says: the render decides that from
 * the provenance itself.
 */
export function sourceWatermark(body: RenderBody, projectFields: Fields | undefined, sceneRows: AtRow[], clips: Clip[]): { body: RenderBody; log: string } {
  const out: RenderBody = { ...body, scenes: body.scenes };
  const opts = editingOptions(projectFields);

  const isDocumentary = String(opts.category || 'story') === 'documentary';
  out.showSourceWatermark = opts.sourceWatermark !== false && isDocumentary;
  // Announce each kind of source once. Strictly `=== true`: a missing key
  // must never quieten a film's labels by itself.
  out.watermarkOpenOnce = opts.watermarkOpenOnce === true;
  // Badge size multiplier. REFUSES rather than clamps, like
  // normalizeWatermarkScale in platform/lib/provenance.ts and
  // remotion/src/provenance.ts: a stored 4 is a mistake, not "maximum".
  out.watermarkScale = (() => {
    const n = Number(opts.watermarkScale);
    return (Number.isFinite(n) && n >= 0.7 && n <= 1.6) ? n : 1;
  })();

  // Matched on the scene ID, not on position: Prepare Clips drops scenes
  // with no final clip, so row index and render index part company.
  const byId = new Map<string, unknown>();
  for (const row of sceneRows) {
    const p = (row.fields || {})['Provenance'];
    if (row.id != null && p) byId.set(row.id, p);
  }

  let labelled = 0;
  const scenes = (body.scenes || []).map((s: Record<string, unknown>, i: number) => {
    const clip = clips[i];
    const p = clip ? byId.get(clip.id) : null;
    // No provenance → no label: silence rather than a guess.
    if (p) { labelled++; return { ...s, provenance: p }; }
    return s;
  });
  if (body.scenes) out.scenes = scenes;
  const log = 'provenance on ' + labelled + '/' + (body.scenes || []).length + ' scenes, watermark ' + (out.showSourceWatermark ? 'on' : 'off') + (isDocumentary ? '' : ' (not a documentary: category=' + String(opts.category || 'story') + ')') + (out.watermarkOpenOnce ? ', announced once per source' : '') + (out.watermarkScale !== 1 ? ', size ' + Math.round(out.watermarkScale * 100) + '%' : '');
  return { body: out, log };
}
