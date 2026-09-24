// The Muzica library, read through n8n's "Music Library" workflow
// (xBRdtrArbbi89yvX) — the same two webhooks the site's picker uses — because
// that is where the Google Drive credential lives. Phase 1 of the plan allows
// this until the engine has a Drive credential of its own.
//
// `list-music` answers a flat list, `{tracks: [{id, name, group}]}`: loose
// files under group 'Muzica', each subfolder's files under its folder name.
// Final Assembly's music nodes read the raw Drive listings instead, so the
// listing is rebuilt here into the two shapes they take: the root listing
// (loose files + one folder entry per group) and each folder's files.
//
// One difference, accepted: a tone folder with NO audio in it does not appear
// in `list-music`, so it cannot be matched, and the pick falls through to the
// Default folder where n8n would have matched the empty folder and then fallen
// through to the loose files. An empty tone folder is a library mistake.
import type { DriveFile } from './assembly/types.ts';
import { NetworkError } from './railway.ts';

export interface MusicLibrary {
  rootFiles: DriveFile[];
  folders: Record<string, DriveFile[]>;
}

export interface MusicSource {
  list(): Promise<MusicLibrary>;
  /** Make one file readable by anyone with the link (idempotent), as Share Music Track did. */
  share(id: string): Promise<void>;
}

const FOLDER = 'application/vnd.google-apps.folder';

export function libraryFromTracks(tracks: Array<{ id: string; name: string; group?: string }>): MusicLibrary {
  const rootFiles: DriveFile[] = [];
  const folders: Record<string, DriveFile[]> = {};
  for (const t of tracks) {
    const group = t.group || 'Muzica';
    if (group === 'Muzica') { rootFiles.push({ id: t.id, name: t.name, mimeType: 'audio/mpeg' }); continue; }
    const key = 'group:' + group;
    if (!folders[key]) { folders[key] = []; rootFiles.push({ id: key, name: group, mimeType: FOLDER }); }
    folders[key].push({ id: t.id, name: t.name, mimeType: 'audio/mpeg' });
  }
  return { rootFiles, folders };
}

export function n8nMusic(webhookBase: string, fetchImpl: typeof fetch = fetch): MusicSource {
  const post = async (path: string, body: unknown) => {
    let res: Response;
    try {
      res = await fetchImpl(`${webhookBase}/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
    } catch (e) {
      throw new NetworkError(`${path}: ${(e as Error).message}`);
    }
    if (!res.ok) throw new Error(`${path} answered ${res.status}`);
    return res.json() as Promise<any>;
  };
  return {
    async list() {
      const out = await post('list-music', {});
      return libraryFromTracks(Array.isArray(out.tracks) ? out.tracks : []);
    },
    async share(id) {
      await post('share-music', { id });
    },
  };
}
