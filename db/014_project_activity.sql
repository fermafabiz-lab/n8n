-- 014 — the library's "last worked on" order (2026-09-23)
--
-- The producer's ask: the film you last worked on comes first in the
-- library — "not when you only look at it, but when you change something or
-- work on it". Asked before building, they chose that EVERY kind of change
-- counts — what a person does on the site, what the pipeline does by itself,
-- hands-off approvals, pause/resume/restart — with exactly two exceptions:
-- the Publishing panel (Ready to post / Posted) and playlists. And looking
-- never counts.
--
-- So "activity" is the latest moment anything about the film changed, which
-- the database already half-knows: every table here carries an updated_at
-- maintained by touch_updated_at(). What it cannot do on its own is ignore
-- the Publishing panel, because that writes into project.editing_options and
-- bumps project.updated_at like any other write. Hence one column and one
-- trigger, on project only:
--
--   activity_at — bumped by any UPDATE that changes anything except
--   editing_options.publishing (and the two timestamps themselves). A write
--   that re-sends identical values changes nothing and bumps nothing, so a
--   pipeline that re-saves a status does not float its film.
--
-- The children need no trigger: scenes, chapters and scripts are never
-- written by publishing or by playlists, so their own updated_at IS their
-- activity, and the site reads the film's activity as
--
--   greatest(coalesce(p.activity_at, p.updated_at, p.created_at),
--            max(scene.updated_at), max(chapter.updated_at), max(script.updated_at))
--
-- (platform/lib/data/postgres.ts, getProjects). Playlists live in their own
-- tables and never touch these rows, so they are excluded by construction.
--
-- Existing rows keep activity_at NULL on purpose. A default on ADD COLUMN
-- would stamp every film with the moment this ran, and all eighty would tie
-- at the top. NULL reads as "use updated_at", which is the best history there
-- is; the trigger then PINS that history the first time the row is written at
-- all — even a write that changes nothing, since the value pinned is exactly the
-- one already being read — so a later publishing-only write cannot leak
-- through updated_at. New films get
-- now() — being created is the first thing that happens to a film.
--
-- Pause, resume and restart change nothing in these rows (they talk to n8n),
-- so the site stamps activity_at itself for those; the trigger lets an
-- explicit value through untouched.
--
-- No backfill UPDATE: it would fire touch_updated_at on every project and
-- overwrite the very history the NULL rows are read from.
--
-- Idempotent; safe to re-run.

set search_path to hov, public;

alter table project add column if not exists activity_at timestamptz;
alter table project alter column activity_at set default now();

comment on column project.activity_at is
  'Last time anything about this film changed except the Publishing panel — the library''s '
  '"last worked on" order. NULL on rows untouched since db/014 (read as updated_at). '
  'Maintained by the project_activity trigger; see db/014_project_activity.sql.';

create or replace function project_activity() returns trigger
  language plpgsql as $fn$
begin
  -- An explicit stamp (pause, resume, restart) wins.
  if new.activity_at is distinct from old.activity_at then
    return new;
  end if;
  -- A row from before 014: keep its history the first time it is written.
  if new.activity_at is null then
    new.activity_at := coalesce(old.updated_at, old.created_at);
  end if;
  if (to_jsonb(new) - array['updated_at', 'activity_at', 'editing_options'])
       is distinct from (to_jsonb(old) - array['updated_at', 'activity_at', 'editing_options'])
     or (coalesce(new.editing_options, '{}'::jsonb) - 'publishing')
       is distinct from (coalesce(old.editing_options, '{}'::jsonb) - 'publishing')
  then
    new.activity_at := now();
  end if;
  return new;
end;
$fn$;

drop trigger if exists project_activity on project;
create trigger project_activity before update on project
  for each row execute function project_activity();
