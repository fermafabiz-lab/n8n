-- 013 — playlists (2026-09-23)
--
-- The producer's ask: organise the library into playlists they name
-- themselves, filling them with the library's existing Select button.
--
-- A playlist is a NAMED SET OF FILMS, and a film can sit in any number of
-- them — the way a YouTube playlist works, which is where these films end
-- up. That is why membership is a table of its own rather than a column on
-- project: a column would make it a folder, and a folder would force "the
-- Google Maps series" and "to post this week" to fight over the same film.
--
-- Deliberately NOT stored in project.tags, although that column exists and
-- is empty: it is the Airtable-compat field `Tag-uri Proiect`, readable and
-- writable by every n8n node that goes through /api/at. Overloading it would
-- hand the producer's organisation to whichever workflow next writes tags.
--
-- Nothing in n8n reads either table. The site is the only reader and the
-- only writer (platform/lib/data/postgres.ts, "Playlists").
--
-- Both foreign keys CASCADE, and that is the behaviour wanted in both
-- directions: deleting a project (deleteProjectDeep is a bare
-- `delete from project`) takes its memberships with it, and deleting a
-- playlist removes the playlist and its memberships — never a film.
--
-- Idempotent; safe to re-run.

set search_path to hov, public;

create table if not exists playlist (
  id          text primary key default gen_rec_id(),
  -- Stored already normalised by the site (normalizePlaylistName in
  -- platform/lib/playlists.ts: trimmed, inner whitespace collapsed, at most
  -- 60 characters). The check is the backstop for any other writer.
  name        text not null check (name = btrim(name) and length(name) between 1 and 60),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table playlist is
  'A named set of films the producer made to organise the library. A film can be in '
  'any number of them — membership is playlist_project. Site-only; see db/013_playlists.sql.';

-- Two playlists that differ only in case are one playlist spelled twice, and
-- a chip row with "Google Maps" and "google maps" in it is a bug report.
create unique index if not exists playlist_name_idx on playlist (lower(name));

drop trigger if exists playlist_touch on playlist;
create trigger playlist_touch before update on playlist
  for each row execute function touch_updated_at();

create table if not exists playlist_project (
  playlist_id  text not null references playlist(id) on delete cascade,
  project_id   text not null references project(id) on delete cascade,
  added_at     timestamptz not null default now(),
  primary key (playlist_id, project_id)
);

comment on table playlist_project is
  'Which films are in which playlist. Cascades from both sides: deleting a playlist never '
  'deletes a film, and deleting a film leaves no dangling membership.';

-- The primary key serves "what is in this playlist"; this serves the other
-- direction, which the cascade from project uses on every delete.
create index if not exists playlist_project_project_idx on playlist_project (project_id);
