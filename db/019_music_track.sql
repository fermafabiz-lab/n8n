-- 019 — the music library on the box instead of Google Drive (2026-09-26)
--
-- The Muzica library lived in a Drive folder, and the only thing that could
-- read it was n8n ("Music Library", webhooks list-music / share-music),
-- because the Drive credential lives there. The site's picker and the
-- engine's render both went through it. To take n8n out, the library moves
-- here: the bytes under /media/music/, one row per track.
--
--   id     the track's id everywhere a track is named. A track copied from
--          Drive keeps its DRIVE FILE ID, because films already pin tracks
--          by it (Editing Options.musicTrack); an uploaded one gets its own.
--   grp    the tone group — Drive's subfolder name ("Muzica" = no group).
--          Auto-pick matches the film's tone against it.
--   path   under the media root, content-addressed: music/<sha256-32>.<ext>
--
-- Idempotent; safe to re-run.

set search_path to hov, public;

create table if not exists music_track (
  id            text primary key default gen_rec_id(),
  name          text not null,
  grp           text not null default 'Muzica',
  path          text not null,
  content_type  text,
  size_bytes    bigint check (size_bytes is null or size_bytes >= 0),
  source        text,
  created_at    timestamptz not null default now()
);

create index if not exists music_track_grp_idx on music_track (grp, name);

reset search_path;
