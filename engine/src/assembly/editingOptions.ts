import type { Fields } from './types.ts';

/**
 * `Editing Options` off a project row, parsed the way every Final Assembly
 * node parses it: tolerant, and `{}` for anything missing or malformed. Seven
 * n8n nodes each carry their own copy of this expression; this is the one
 * owner. Note the `|| {}` after the parse: a stored `null` reads as `{}`, while
 * a stored scalar (`5`, `"x"`) survives as itself and simply has no keys — the
 * n8n behaviour, kept.
 */
export function editingOptions(fields: Fields | undefined | null): any {
  try {
    return JSON.parse((fields || {})['Editing Options'] || '{}') || {};
  } catch (e) {
    return {};
  }
}
