import { editingOptions } from './editingOptions.ts';
import type { Fields } from './types.ts';
import type { RenderBody } from './buildProps.ts';

/**
 * Caption Colour: Editing Options.captionColor as `#RRGGBB`, or nothing.
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
  return out;
}
