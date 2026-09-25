import { editingOptions } from './editingOptions.ts';
import type { AtRow, Clip, Fields } from './types.ts';
import type { RenderBody } from './buildProps.ts';

/**
 * Graphic styles: the film's graphic style and what its graphics say
 * (remotion/src/graphics/, db/port/graphic-styles/, 2026-09-25). The same
 * block as the tail of n8n's Caption Colour in
 * db/port/graphic-styles/paste/fa-Caption_Colour.js — check.mjs holds the two
 * to the same output.
 *
 * The producer's pick wins; with none, the style the graphic-plan workflow
 * chose by theme. Items are anchored by scene ORDER and mapped onto the
 * rendered scene list the way attachMotifCards maps its cards. Nothing is
 * sent when there is nothing to say: absent is classic, today's film.
 */
// Kids story and Cinematic have their own six since 2026-09-25
// (db/port/kids-cine-graphics/).
export const GRAPHIC_STYLES = ['classic', 'reportage', 'editorial', 'cinematic', 'handwritten', 'kidsStorybook', 'kidsPlayful', 'kidsAll', 'cineFilm', 'cineNeon', 'cineMemory'];
/** remotion/src/transitions/families.ts, db/port/transitions/. */
export const TRANSITION_STYLES = ['none', 'push', 'crossfade', 'blur', 'shutter', 'glitch'];

export function graphicStyles(body: RenderBody, projectFields: Fields | undefined, sceneRows: AtRow[], clips: Clip[]): RenderBody {
  const out: any = { ...body };
  const opts = editingOptions(projectFields);
  const plan = (opts.graphicPlan && typeof opts.graphicPlan === 'object') ? opts.graphicPlan : null;
  const style = GRAPHIC_STYLES.includes(opts.graphicStyle) ? opts.graphicStyle
    : (plan && GRAPHIC_STYLES.includes(plan.style) ? plan.style : null);
  // Transitions, for every category (db/port/transitions/): the pick wins,
  // 'none' included; else the plan's. Set after the graphics, as the n8n
  // body does, so the key order of the request matches it.
  const transition = TRANSITION_STYLES.includes(opts.transitionStyle) ? opts.transitionStyle
    : (plan && TRANSITION_STYLES.includes(plan.transition) ? plan.transition : null);
  const withTransition = (b: any) => {
    if (transition && transition !== 'none') b.transitionStyle = transition;
    return b;
  };
  if (!style || style === 'classic') return withTransition(out);
  out.graphicStyle = style;
  const planned = plan && Array.isArray(plan.items) ? plan.items : [];
  if (!planned.length) return withTransition(out);
  const orderById = new Map<string, unknown>();
  for (const row of sceneRows) {
    const f = row.fields || {};
    if (row.id != null) orderById.set(row.id, f['Ordine Scenă']);
  }
  const rendered = clips.map((c) => orderById.get(c.id));
  const items = [];
  for (const it of planned) {
    const i = rendered.indexOf(it.sceneOrder);
    // A scene that got no clip is not in the film, so neither is its tag.
    if (!(i >= 0 && i < (out.scenes || []).length)) continue;
    const g = Object.assign({}, it);
    delete g.sceneOrder;
    g.sceneIndex = i;
    items.push(g);
  }
  if (items.length) out.graphicItems = items;
  return withTransition(out);
}
