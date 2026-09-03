-- The clip's own Flow identity, which we were extracting and throwing away.
--
-- `Extract Video URL` has always pulled `mediaGenerationId` out of the Flow
-- response and put it in `Video_Media_Id` — and nothing ever stored it. The
-- moment the clip was uploaded to Drive its identity at Google was gone.
--
-- That is fine until you want to do anything to a clip that is not
-- regenerating it from scratch. `POST /google-flow/videos/upscale` takes a
-- mediaGenerationId, so without this column no finished film can be upscaled
-- to 1080p or 4K — the bytes exist on Drive, but Flow has no idea which of
-- its generations they came from.
--
-- Additive and nullable on purpose: every existing row keeps NULL and every
-- existing query is unaffected. Clips made before this migration stay
-- un-upscalable, and no amount of schema fixes that retroactively.
--
--   docker exec -i n8n-postgres-1 psql -U hov -d hov -f - < db/006_video_media_id.sql
--
-- Applied 2026-09-04.

set search_path to hov, public;

alter table scene add column if not exists video_media_id text;

comment on column scene.video_media_id is
  'Flow mediaGenerationId of the generated clip. Airtable had no such field — '
  'this one is new, and it is what POST /videos/upscale needs. The image side '
  'has carried the same thing as image_media_id since the Flow port.';

-- The compat map, so a workflow writing through hov.at_write can set it by
-- the same Airtable-shaped name the site uses. The site's own adapter has its
-- own copy of this mapping in platform/lib/data/postgres.ts (SCENE_FIELDS) —
-- the two must agree, and an unmapped name throws on both sides rather than
-- being silently dropped.
insert into airtable_field (entity, airtable_name, column_name)
values ('scene', 'Video Media ID', 'video_media_id')
on conflict (entity, airtable_name) do update set column_name = excluded.column_name;
