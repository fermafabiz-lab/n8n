import type { DriveFile, Fields, MusicPick } from './types.ts';

// The media proxy on the render server: ffmpeg gets a real audio stream
// there, where Drive's direct links answer with redirects/HTML.
const MEDIA_PROXY = 'https://n8n-production-55dd.up.railway.app/media?id=';

const norm = (s: unknown) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const isFile = (f: DriveFile | undefined) => !!(f && f.id && !(f.mimeType || '').includes('folder'));

/** The project's tone, normalised; `default` only when the row itself is missing. */
function toneOf(projectFields: Fields | undefined): string {
  let tone = 'default';
  try { tone = norm((projectFields as Fields).Tonalitate); } catch (e) {}
  return tone;
}

/**
 * Match Tone Folder: in the `Muzica` listing, the subfolder whose name
 * contains the project's tone, else one containing `default`.
 *
 * A project with NO Tonalitate normalises to '' — which every name contains,
 * so the first subfolder wins. That is n8n's behaviour and is kept.
 */
export function matchToneFolder(projectFields: Fields | undefined, rootFiles: DriveFile[] | undefined): { folderId: string | null; folderName: string | null } {
  const tone = toneOf(projectFields);
  const folders = (rootFiles || []).filter(f => (f.mimeType || '').includes('folder'));
  const hit = folders.find(f => norm(f.name).includes(tone)) || folders.find(f => norm(f.name).includes('default')) || null;
  return { folderId: hit ? (hit.id as string) : null, folderName: hit ? (hit.name as string) : null };
}

/**
 * Pick Music Track, in order:
 *   0. a track PINNED by the producer (Editing Options.musicTrack) wins outright
 *   1. files inside the tone-matched subfolder
 *   2. loose files in Muzica whose NAME contains the tone
 *   3. loose files named default*
 *   4. any loose file
 * Several candidates → a random pick, so repeat films vary. `random` is
 * injected so the choice can be reproduced.
 */
export function pickMusicTrack(
  projectFields: Fields | undefined,
  rootFiles: DriveFile[] | undefined,
  toneFolderFiles: DriveFile[] | undefined,
  random: () => number = Math.random,
): MusicPick {
  try {
    const opts = JSON.parse((projectFields as Fields)['Editing Options'] || '{}') || {};
    const pinned = opts.musicTrack;
    if (pinned && typeof pinned.id === 'string' && pinned.id.trim()) {
      const id = pinned.id.trim();
      return { id, name: String(pinned.name || id), matched: 'pinned', url: MEDIA_PROXY + id };
    }
  } catch (e) {}
  const tone = toneOf(projectFields);
  const subFiles = (toneFolderFiles || []).filter(isFile);
  const root = (rootFiles || []).filter(isFile);
  const byTone = root.filter(f => norm(f.name).includes(tone));
  const byDefault = root.filter(f => norm(f.name).includes('default'));
  const pool = subFiles.length ? subFiles : (byTone.length ? byTone : (byDefault.length ? byDefault : root));
  if (!pool.length) return { url: null, name: null, reason: 'no tracks in Muzica folder' };
  const t = pool[Math.floor(random() * pool.length)];
  return {
    id: t.id,
    name: t.name as string,
    matched: subFiles.length ? 'subfolder' : (byTone.length ? 'tone-name' : (byDefault.length ? 'default' : 'any')),
    url: MEDIA_PROXY + t.id,
  };
}
