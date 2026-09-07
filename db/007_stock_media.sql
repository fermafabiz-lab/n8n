-- The archive library for Documentary mode.
--
-- The brief called this the Airtable table "Stock Footage". Airtable was
-- retired on 2026-08-16 and the pipeline runs on this database, so it lives
-- here, next to the scenes it will be cut into.
--
-- One row per asset the archives have ever ANSWERED with — the library grows
-- from searches, never from a bulk import: an unknown fraction of Commons is
-- usable footage, and indexing all of it would buy nothing a search does not.
-- The row holds metadata only. Bytes enter the media store the moment a scene
-- actually uses the asset, through the same attachment rows every other image
-- and clip already uses; a candidate that was merely seen costs a row and no
-- disk.
--
-- Two status columns, on purpose. `review_status` is the RIGHTS verdict,
-- computed by code from the licence (platform/lib/archive/rights.ts) and
-- refreshed on every sighting. `status` is the HUMAN decision — candidate,
-- approved, rejected, used — and a refresh never touches it. Conflating them
-- would let a re-search un-reject an asset the producer had thrown out.
--
--   docker exec -i n8n-postgres-1 psql -U hov -d hov -f - < db/007_stock_media.sql

set search_path to hov, public;

create table if not exists stock_media (
  id                   text primary key default gen_rec_id(),
  provider             text not null check (provider in ('wikimedia', 'nara', 'smithsonian')),
  provider_asset_id    text not null,
  media_type           text not null check (media_type in ('video', 'image')),
  title                text not null,
  description          text,
  source_url           text not null,
  download_url         text not null,
  thumbnail_url        text,
  width                integer,
  height               integer,
  duration_seconds     numeric,
  mime_type            text,
  size_bytes           bigint,
  -- Verbatim from the provider. NOT the year of the event: see the column
  -- comment below before reading it as one.
  date_original        text,
  years_mentioned      integer[] not null default '{}',
  creator              text,
  credit               text,
  license_original     text,
  license_code         text,
  license_url          text,
  rights_status        text not null,
  commercial_use       text not null,
  modifications        text not null,
  attribution_required boolean not null default true,
  review_status        text not null check (review_status in ('auto_approved', 'manual_review', 'rejected')),
  review_reason        text,
  status               text not null default 'candidate'
                         check (status in ('candidate', 'approved', 'rejected', 'used')),
  categories           text[] not null default '{}',
  searchable_text      text not null default '',
  quality_score        real,
  first_query          text,
  last_query           text,
  times_found          integer not null default 1,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (provider, provider_asset_id)
);

create trigger stock_media_touch before update on stock_media
  for each row execute function touch_updated_at();

create index if not exists stock_media_search_idx
  on stock_media using gin (to_tsvector('simple', searchable_text));

comment on table stock_media is
  'Archive assets (Wikimedia Commons, NARA, Smithsonian) the searches have '
  'surfaced. Metadata only; bytes land in the media store when a scene uses one.';
comment on column stock_media.date_original is
  'The provider''s date string, verbatim. Commons gave a 1969 NASA clip the '
  'date 2015-06-12 (its YouTube upload) and a 2013 museum photo of a replica '
  'for an 1886 subject. Shown to the producer, never used as the period.';
comment on column stock_media.review_status is
  'Rights verdict from the licence, computed in code. Refreshed on every sighting.';
comment on column stock_media.status is
  'The producer''s decision. Never touched by a refresh.';

-- Where a scene's picture comes from. Every existing scene is `ai`, which is
-- exactly what it was; nothing reads the other two until a scene is pointed
-- at an archive asset by the site.
alter table scene add column if not exists visual_source text not null default 'ai'
  check (visual_source in ('ai', 'stock_video', 'stock_image'));
alter table scene add column if not exists stock_media_id text
  references stock_media (id) on delete set null;
-- For stock VIDEO: where in the source the scene's segment starts. The
-- segment is cut to the scene's length by the site, never the whole file.
alter table scene add column if not exists stock_offset_seconds numeric
  check (stock_offset_seconds is null or stock_offset_seconds >= 0);

comment on column scene.visual_source is
  'ai (today''s pipeline) | stock_video | stock_image. Set by the site; the '
  'batch skips a stock scene by itself because Needs Image? and Needs Clip? '
  'test asset existence, and the site writes both assets before it hands over.';
