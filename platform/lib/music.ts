/**
 * The music library, on the box (db/019 `hov.music_track`, bytes under
 * /media/music/) — it used to be a Google Drive folder that only n8n could
 * read. One owner for listing, URLs and storing, used by /api/music (the
 * picker), /api/music/upload (the producer's upload) and /api/music/import
 * (the one-time copy out of Drive).
 *
 * A track copied from Drive keeps its Drive file id as its id, so every film
 * that already pins a track (`Editing Options.musicTrack`) still finds it.
 */
import { createHash } from "node:crypto";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { atQuery, isConfigured } from "@/lib/data/postgres";
import { MEDIA_ROOT, extensionFor, mediaPublicUrl } from "@/lib/media-store";

export type Track = { id: string; name: string; group: string; url: string };

/** The group loose files had in Drive's root folder. */
export const ROOT_GROUP = "Muzica";
export const MAX_TRACK_BYTES = 60 * 1024 * 1024;
const AUDIO_EXT = new Set(["mp3", "m4a", "aac", "wav", "ogg", "oga", "flac", "opus", "webm"]);

export async function listTracks(): Promise<Track[]> {
  if (!isConfigured) return [];
  try {
    const rows = await atQuery<{ id: string; name: string; grp: string; path: string }>(
      `select id, name, grp, path from hov.music_track order by grp, name`,
    );
    return rows.map((r) => ({ id: r.id, name: r.name, group: r.grp, url: mediaPublicUrl(r.path) }));
  } catch {
    return []; // db/019 not applied
  }
}

export async function trackUrl(id: string): Promise<string | null> {
  if (!isConfigured) return null;
  try {
    const rows = await atQuery<{ path: string }>(`select path from hov.music_track where id = $1`, [id]);
    return rows[0] ? mediaPublicUrl(rows[0].path) || null : null;
  } catch {
    return null;
  }
}

/** A group name as the picker and the tone match read it: trimmed, one line, never empty. */
export function cleanGroup(raw: unknown): string {
  const g = String(raw ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
  return g || ROOT_GROUP;
}

/**
 * Store one track and file it. The bytes are content-addressed, so the same
 * file uploaded twice is stored once; the row is keyed by `id` (a Drive id
 * on import, a new record id on upload) and an import re-run updates it.
 */
export async function storeTrack(input: {
  id?: string;
  name: string;
  group: string;
  buf: Buffer;
  contentType: string | null;
  source: string;
}): Promise<Track> {
  if (!input.buf.length) throw new Error("the file is empty");
  if (input.buf.length > MAX_TRACK_BYTES) throw new Error(`the file is larger than ${MAX_TRACK_BYTES / 1024 / 1024} MB`);
  const ext = extensionFor(`https://x/${input.name}`, input.contentType).toLowerCase();
  if (!AUDIO_EXT.has(ext)) throw new Error(`not an audio file (.${ext})`);
  const hash = createHash("sha256").update(input.buf).digest("hex").slice(0, 32);
  const path = `music/${hash}.${ext}`;
  const abs = join(MEDIA_ROOT, path);
  let exists = false;
  try {
    exists = (await stat(abs)).size === input.buf.length;
  } catch {
    /* not there yet */
  }
  if (!exists) {
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, input.buf);
  }
  const name = input.name.trim().slice(0, 200) || `${hash}.${ext}`;
  const group = cleanGroup(input.group);
  const rows = await atQuery<{ id: string }>(
    `insert into hov.music_track (id, name, grp, path, content_type, size_bytes, source)
     values (coalesce($1, hov.gen_rec_id()), $2, $3, $4, $5, $6, $7)
     on conflict (id) do update set name = excluded.name, grp = excluded.grp, path = excluded.path,
       content_type = excluded.content_type, size_bytes = excluded.size_bytes, source = excluded.source
     returning id`,
    [input.id ?? null, name, group, path, input.contentType, input.buf.length, input.source],
  );
  return { id: rows[0].id, name, group, url: mediaPublicUrl(path) };
}
