-- 012 — series (2026-09-16)
--
-- A series is a show: one look, one cast, one set of places, one voice, and
-- a running list of what has happened so far. An episode is an ordinary
-- project that was started FROM a series — the brief pre-fills the settings,
-- the series bible rides to Claude Scripting as Lore (the canon mechanism
-- `Generate Story Bible` already honours), and the series' reference sheets
-- ride into the project's Editing Options, where `Cast Sheet Prep` and
-- `Set Plate Prep` skip every name that already has one. So the same
-- portraits anchor every episode without a single new node.
--
-- Every value here is a COPY, frozen when the series is created from a
-- film: the characters, objects and locations from that film's Story Bible,
-- the Flow reference ids (castRefs, castSheets, objectRefs, locationRefs,
-- locationPlates) from its Editing Options, and the settings the brief needs
-- to start the next episode. A later film changes nothing here unless the
-- producer writes it in.
--
-- sheet_media keeps the BYTES of a reference sheet. Flow hands back a signed
-- URL that dies within hours (consistency README), so the only durable copy
-- is one taken while it is alive: Media Generation posts each new sheet to
-- /api/media/ingest right after making it. Keyed by the Flow id, because a
-- sheet reused across episodes is the same picture.
--
-- Idempotent; safe to re-run.

set search_path to hov, public;

create table if not exists series (
  id                 text primary key default gen_rec_id(),
  name               text not null,
  premise            text not null default '',
  previously         text not null default '',
  channel_name       text not null default '',
  category           text not null default 'kids',
  tone               text,
  language           text not null default 'English',
  aspect             text not null default '16:9'
                       check (aspect in ('16:9', '9:16')),
  voice_id           text not null default '',
  -- The brief's settings an episode inherits: categoryOptions, multiVoiceMode,
  -- cast, voice (tone), hookStyle, videoModel, speed. Same keys and the same
  -- normalize rules as project.editing_options; the site is the only writer.
  settings           jsonb not null default '{}'::jsonb,
  -- {characters:[{name,role,visual_description}], objects:[{name,visual_description}],
  --  locations:[{name,visual_description}], visual_style:{palette,lighting,camera,film_look},
  --  continuity_rules:[…], logline} — the Story Bible's shape, kept verbatim.
  bible              jsonb not null default '{}'::jsonb,
  -- {castRefs, castSheets, objectRefs, locationRefs, locationPlates} — the
  -- Editing Options keys the consistency chain writes, copied as they are.
  refs               jsonb not null default '{}'::jsonb,
  source_project_id  text references project(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

comment on table series is
  'A show: one look, cast, places and voice, frozen from the film it was started from; '
  'episodes are projects with series_id set. bible and refs are COPIES of that film''s '
  'Story Bible and consistency references — see db/012_series.sql.';

drop trigger if exists series_touch on series;
create trigger series_touch before update on series
  for each row execute function touch_updated_at();

alter table project add column if not exists series_id text references series(id) on delete set null;
alter table project add column if not exists episode_no integer
  check (episode_no is null or episode_no > 0);

comment on column project.series_id is  'The show this film is an episode of, or null — set by the site when the brief is started from a series.';
comment on column project.episode_no is 'Its number in that show (1 = the film the series was started from).';

create index if not exists project_series_idx on project (series_id, episode_no);

create table if not exists sheet_media (
  id            text primary key default gen_rec_id(),
  project_id    text not null references project(id) on delete cascade,
  kind          text not null check (kind in ('cast', 'object', 'location')),
  name          text not null,
  -- The Flow mediaGenerationId the sheet carries in Editing Options — the
  -- join key from castSheets / locationPlates to these bytes.
  flow_id       text not null unique,
  path          text not null,
  content_type  text,
  size_bytes    bigint check (size_bytes is null or size_bytes >= 0),
  source_url    text,
  created_at    timestamptz not null default now()
);

comment on table sheet_media is
  'Our own copy of a reference sheet (a character turnaround or portrait, an object sheet, '
  'a set plate) under /opt/n8n/media, taken while Flow''s signed URL was alive. '
  'Keyed by the Flow id: a sheet reused across episodes is one picture.';

create index if not exists sheet_media_project_idx on sheet_media (project_id, kind);
