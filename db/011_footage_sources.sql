-- 011 — the footage sources of 2026-09-10 (docs/footage-sources.md).
--
-- No new column: db/010 already dropped the provider CHECK, so the nine
-- providers added that day (internet_archive, europeana, loc, wellcome,
-- flickr, openverse, pexels, pixabay, unsplash) file rows with nothing to
-- migrate. What changes is the TABLE COMMENT, which still named two providers
-- the producer has retired, and one index the provider filter on
-- /admin/footage leans on now that the list is fifteen long.
--
-- Idempotent; safe to re-run.

set search_path to hov, public;

comment on table stock_media is
  'Real footage the searches, imports and uploads have seen — one row per provider asset, metadata only until a scene uses it. '
  'Provider is a free string: the registry in platform/lib/footage/registry.ts is the list of who can be searched, and a row from a retired provider stays readable.';

comment on column stock_media.provider is
  'Free string — the registry (platform/lib/footage/registry.ts) is the list of who can be searched: '
  'eu_av | dvids | nasa | internet_archive | europeana | loc | wikimedia | wellcome | flickr | openverse | pexels | pixabay | unsplash | url_import | user_upload. '
  'A row from a retired provider stays readable under its old id.';

create index if not exists stock_media_provider_media_idx on stock_media (provider, media_type, created_at desc);
