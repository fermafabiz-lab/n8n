-- The Universal Footage Engine: one library for every source of real footage.
--
-- `stock_media` (db/007) was built for one archive and grew the way the
-- engine needs it to: a row is metadata about an asset somebody might use,
-- filed the moment a search sees it, with the bytes fetched only when a scene
-- takes it. That does not change. What changes:
--
-- - `provider` stops being an enum of three (two of the three were never
--   built and are retired); the EU Audiovisual Service,
--   DVIDS, NASA, pasted URLs and uploads are real. A provider is a free
--   string so the next one needs an adapter and not a migration. Rows from
--   the retired names stay readable — nothing deletes a row over its
--   provider.
-- - The engine's enrichments become columns: what kind of shot it is, when
--   it was SHOT (as distinct from the catalogue's date, which is often the
--   upload), where, of what event, with whom, under what stated rights, and
--   what it IS (provenance) before any scene asks.
-- - Two small tables: provider health/statistics, and a short-lived search
--   cache so the same request twice does not ask the internet twice.
--
--   docker exec -i n8n-postgres-1 psql -U hov -d hov -f - < db/010_universal_footage.sql
--
-- Every statement is re-runnable.

set search_path to hov, public;

-- ---------------------------------------------------------------------------
-- Providers are open-ended now
-- ---------------------------------------------------------------------------

alter table stock_media drop constraint if exists stock_media_provider_check;

comment on column stock_media.provider is
  'Free string: wikimedia | eu_av | dvids | nasa | url_import | user_upload | (a future adapter). '
  'Two ids db/007 allowed were never searched and are retired; rows carrying them stay readable.';

-- ---------------------------------------------------------------------------
-- The engine's enrichments. Every one nullable or defaulted, so a row filed
-- before today reads as "not stated" rather than as wrong.
-- ---------------------------------------------------------------------------

alter table stock_media add column if not exists preview_url          text;
alter table stock_media add column if not exists footage_format       text not null default 'unknown';
alter table stock_media add column if not exists origin               text not null default 'generic';
alter table stock_media add column if not exists filming_date         text;
alter table stock_media add column if not exists publication_date     text;
alter table stock_media add column if not exists location             text;
alter table stock_media add column if not exists country              text;
alter table stock_media add column if not exists event_name           text;
alter table stock_media add column if not exists people               text[] not null default '{}';
alter table stock_media add column if not exists organizations        text[] not null default '{}';
alter table stock_media add column if not exists rights_text          text;
alter table stock_media add column if not exists provenance           text not null default 'unknown';
alter table stock_media add column if not exists provenance_confidence smallint;
alter table stock_media add column if not exists availability_status  text not null default 'available';
-- Where an UPLOAD's bytes live in the media store (relative path). Null for
-- everything that is still only a link to somebody else's server.
alter table stock_media add column if not exists media_path           text;
alter table stock_media add column if not exists content_hash         text;
alter table stock_media add column if not exists verified_at          timestamptz;
alter table stock_media add column if not exists verified_note        text;
alter table stock_media add column if not exists notes                text;

alter table stock_media drop constraint if exists stock_media_footage_format_check;
alter table stock_media add constraint stock_media_footage_format_check check (footage_format in (
  'broll', 'stockshots', 'speech', 'press_conference', 'interview', 'news_package',
  'live_stream', 'documentary', 'unknown'));
alter table stock_media drop constraint if exists stock_media_origin_check;
alter table stock_media add constraint stock_media_origin_check check (origin in (
  'recent_news', 'official_media', 'historical', 'generic', 'user_upload'));
alter table stock_media drop constraint if exists stock_media_provenance_check;
alter table stock_media add constraint stock_media_provenance_check check (provenance in (
  'actual_footage', 'illustrative_footage', 'archival_footage', 'archival_photo', 'real_stock', 'unknown'));
alter table stock_media drop constraint if exists stock_media_provenance_confidence_check;
alter table stock_media add constraint stock_media_provenance_confidence_check
  check (provenance_confidence is null or (provenance_confidence >= 0 and provenance_confidence <= 100));
alter table stock_media drop constraint if exists stock_media_availability_check;
alter table stock_media add constraint stock_media_availability_check check (availability_status in (
  'available', 'unavailable', 'unknown'));

comment on column stock_media.filming_date is
  'When the material was SHOT, as the provider states it. Distinct from date_original (the '
  'catalogue''s own string, often the upload) and from publication_date. Never proof of an event.';
comment on column stock_media.provenance is
  'What the asset IS before any scene asks: archival_footage/archival_photo for catalogued '
  'archive items, unknown for uploads and imports until a person says. Copied to the scene on '
  'attach, where the producer''s Footage type control may overrule it.';
comment on column stock_media.rights_text is
  'The provider''s own rights statement, verbatim — the evidence behind rights_status.';

-- Rows filed before today: Commons items are archival by media type, which
-- is what the picker has been calling them all along.
update stock_media
   set provenance = case when media_type = 'video' then 'archival_footage' else 'archival_photo' end,
       provenance_confidence = coalesce(provenance_confidence, 70),
       footage_format = case when media_type = 'video' then 'broll' else 'unknown' end
 where provider = 'wikimedia' and provenance = 'unknown';

create index if not exists stock_media_provider_idx   on stock_media (provider);
create index if not exists stock_media_review_idx     on stock_media (review_status, status);
create index if not exists stock_media_provenance_idx on stock_media (provenance);
create index if not exists stock_media_updated_idx    on stock_media (updated_at desc);
create unique index if not exists stock_media_content_hash_idx on stock_media (content_hash) where content_hash is not null;

-- ---------------------------------------------------------------------------
-- Provider health and statistics
-- ---------------------------------------------------------------------------

create table if not exists footage_provider_status (
  provider            text primary key,
  healthy             boolean not null default true,
  last_success        timestamptz,
  last_failure        timestamptz,
  last_error          text,
  failure_count       integer not null default 0,
  rate_limited_until  timestamptz,
  searches            bigint not null default 0,
  results_returned    bigint not null default 0,
  assets_selected     bigint not null default 0,
  relevance_sum       bigint not null default 0,
  relevance_n         bigint not null default 0,
  rights_failures     bigint not null default 0,
  download_failures   bigint not null default 0,
  response_ms_sum     bigint not null default 0,
  response_n          bigint not null default 0,
  updated_at          timestamptz not null default now()
);

comment on table footage_provider_status is
  'One row per footage provider: health (consecutive failures, rate-limit hold) and the running '
  'statistics the admin page shows. Written by lib/footage/health.ts after every search; a write '
  'failure here is never allowed to fail a search.';

-- ---------------------------------------------------------------------------
-- The search cache: the same request within a few hours is answered from the
-- rows the first run filed, not from the providers again.
-- ---------------------------------------------------------------------------

create table if not exists footage_search_cache (
  cache_key   text primary key,
  request     jsonb not null,
  stock_ids   text[] not null default '{}',
  created_at  timestamptz not null default now()
);

create index if not exists footage_search_cache_created_idx on footage_search_cache (created_at);

comment on table footage_search_cache is
  'Request fingerprint → the library ids its provider search produced. Read for six hours, then '
  'ignored; rows older than a day are deleted opportunistically on write.';
