import { editingOptions } from './editingOptions.ts';
import type { Fields } from './types.ts';
import type { RenderBody } from './buildProps.ts';

/**
 * Caption Colour: Editing Options.captionColor as `#RRGGBB`, or nothing —
 * and, since 362a9c56, the film's `category` and `motionPack`.
 * Absent (or none/white/off) is the white default, and that is a decision:
 * white with the spoken word marked by brightness reads on every footage.
 * resolveCaptionAccent() in remotion/src/captionColor.ts has the final say;
 * this only keeps a malformed value out of the props.
 */
export function captionColour(body: RenderBody, projectFields: Fields | undefined): RenderBody {
  const out = { ...body };
  const opts = editingOptions(projectFields);
  const raw = String(opts.captionColor || '').trim();
  if (raw && !/^(none|white|off)$/i.test(raw)) {
    const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(raw);
    if (m) {
      const h = m[1].length === 3 ? m[1].split('').map(c => c + c).join('') : m[1];
      out.captionColor = '#' + h.toUpperCase();
    }
  }
  // The film's category and its animation style, for the motion packs
  // (remotion/src/motion/packs.ts, Final Assembly 362a9c56). `motionPack`
  // goes through only when it is one of the four; absent lets the render
  // apply the category's default (Editorial for Story).
  if (typeof opts.category === 'string' && opts.category.trim()) out.category = opts.category.trim();
  if (MOTION_PACKS.includes(opts.motionPack)) out.motionPack = opts.motionPack;
  return out;
}

/** The packs the render knows (remotion/src/motion/packs.ts). */
export const MOTION_PACKS = ['classic', 'editorial', 'punch', 'lowerThird'];
