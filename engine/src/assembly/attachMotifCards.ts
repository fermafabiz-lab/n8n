import { editingOptions } from './editingOptions.ts';
import type { AtRow, Clip, Fields } from './types.ts';
import type { RenderBody } from './buildProps.ts';

/**
 * Attach Motif Cards: the cards Claude Scripting chose and validated, looked
 * up onto the rendered scene list. Nothing is re-judged here.
 *
 * A card is anchored by `sceneOrder` (the scene's Ordine Scenă), which
 * survives Prepare Clips dropping a scene; `sceneIndex` is the older anchor.
 * A card whose scene has no clip is left out: that scene is not in the film.
 */
export function attachMotifCards(body: RenderBody, projectFields: Fields | undefined, sceneRows: AtRow[], clips: Clip[]): RenderBody {
  const out = { ...body };
  const opts = editingOptions(projectFields);
  // Final touches can switch cards off long after Scripting stored them, so
  // the render is the last place that can still refuse. Absent means yes.
  const allowed = opts.drawnCards !== false;
  const cards = allowed && Array.isArray(opts.motifCards) ? opts.motifCards : [];

  if (cards.length) {
    const orderById = new Map<string, unknown>();
    for (const row of sceneRows) {
      const f = row.fields || {};
      if (row.id != null) orderById.set(row.id, f['Ordine Scenă']);
    }
    const rendered = clips.map((c) => orderById.get(c.id));

    const attached = [];
    for (const card of cards) {
      const i = (card.sceneOrder !== undefined && card.sceneOrder !== null)
        ? rendered.indexOf(card.sceneOrder)
        : card.sceneIndex;
      if (!(i >= 0 && i < (out.scenes || []).length)) continue;
      const spec = Object.assign({}, card);
      // Bookkeeping for the producer's panel, not for the renderer.
      delete spec.sceneOrder;
      delete spec.verdict;
      delete spec.why;
      spec.sceneIndex = i;
      attached.push(spec);
    }
    // Only when there is one: an empty array still counts as "explicit
    // cards" downstream and would switch the derived ones off for nothing.
    if (attached.length) out.textCards = attached;
  }
  return out;
}
