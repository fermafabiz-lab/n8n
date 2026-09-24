import type { AtRow, Clip } from './types.ts';

const ord = (row: AtRow): number | null => {
  const f = row.fields || {};
  return (typeof f['Ordine Scenă'] === 'number') ? f['Ordine Scenă'] : null;
};

/**
 * Prepare Clips: the approved scenes that have a final muxed clip, deduped by
 * id, in film order (`Ordine Scenă`, then creation time, then id).
 */
export function prepareClips(rows: AtRow[]): Clip[] {
  let scenes = rows.slice();
  const seen = new Set<string>();
  scenes = scenes.filter(s => { const id = s.id; if (!id || seen.has(id)) return false; seen.add(id); return true; });
  scenes = scenes.filter(s => { const v = (s.fields || {})['Scene Final URL'] || ''; return v.startsWith('http'); });
  scenes.sort((a, b) => {
    const oa = ord(a), ob = ord(b);
    if (oa !== null && ob !== null && oa !== ob) return oa - ob;
    const t = (new Date(a.createdTime as string) as any) - (new Date(b.createdTime as string) as any);
    if (t) return t;
    return a.id < b.id ? -1 : 1;
  });
  if (!scenes.length) throw new Error('No scenes with a final muxed clip (Scene Final URL) found for this project.');
  return scenes.map((s, i) => {
    const f = s.fields as Record<string, any>;
    const o = ord(s);
    // Ordine Scenă = chapter*100 + scene (hook = 1 → chapter 0). With no
    // order at all, the first clip is taken as the hook and the rest as
    // chapter 1 — n8n's fallback, kept as is.
    const chapter = o !== null ? Math.floor(o / 100) : (i === 0 ? 0 : 1);
    return {
      id: s.id,
      url: f['Scene Final URL'],
      voiceUrl: f['Voiceover URL'] || '',
      // Same strip as both TTS paths: speaker tags ([NARRATOR], [CHARACTER: X])
      // are routing, not narration.
      narratorText: String(f['Script Scenă'] || '').replace(/\[[^\]]{0,60}\]\s*/g, ' ').replace(/\s+/g, ' ').trim(),
      chapter,
      order: o,
      // The planned length (3 or 6 on a hook shot, 8 elsewhere). Only the hook reads it.
      seconds: (typeof f['Durată Scenă (secunde)'] === 'number') ? f['Durată Scenă (secunde)'] : null,
    };
  });
}
