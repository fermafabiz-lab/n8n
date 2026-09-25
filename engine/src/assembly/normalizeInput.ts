import type { Trigger } from './types.ts';

/**
 * Normalize Assemble Input: the site's `assemble` webhook body
 * `{Project_ID, aspect?, captions?}` in the shape the sub-workflow trigger
 * gives.
 */
export function normalizeInput(body: any): Trigger {
  const b = body || {};
  const id = b.Project_ID || b.project_id || '';
  if (!id) throw new Error('Project_ID missing in webhook body');
  return {
    Project_ID: id,
    Aspect: b.aspect === '9:16' ? '9:16' : (b.aspect || ''),
    No_Captions: (b.captions === 'no' || b.no_captions === true) ? 'yes' : '',
  };
}

/**
 * Which trigger a node reads. Receive Project ID wins when it ran; the
 * webhook's normalised input replaces it when the first carries no aspect.
 *
 * Build Timeline and Build Remotion Props disagree on one detail and both are
 * kept: Props also stays on the first trigger when it carries `No_Captions`
 * (`captionsCount: true`), Timeline does not look at captions at all.
 */
export function resolveTrigger(t: { receive?: Trigger; normalize?: Trigger }, captionsCount = false): Trigger {
  let trig: Trigger = {};
  if (t.receive) trig = t.receive;
  const keep = captionsCount ? (trig.Aspect || trig.No_Captions) : trig.Aspect;
  if (!keep && t.normalize) trig = t.normalize;
  return trig;
}
