-- Visual provenance: what a viewer is actually looking at, per scene.
--
-- A film cuts AI pictures, AI reconstructions and real archive material into
-- one montage and nothing on screen has ever said which is which. These
-- columns are the record of that, and `remotion/src/components/SourceWatermark`
-- is what prints it.
--
-- Deliberately NOT a second copy of the archive metadata. Provider, title,
-- source URL, creator, credit, licence and rights already live on
-- `stock_media` (db/007) and the scene already links to the row; only the
-- facts that had nowhere to live are added here. `at_scene` below joins the
-- two and emits ONE `Provenance` object in the shape `VisualProvenance` has
-- in platform/lib/provenance.ts, so the render path is a lookup rather than a
-- second classifier.
--
-- `visual_origin` is NOT NULL with a default, and backfilled from
-- `visual_source`, so there is exactly one derivation rule and it runs once —
-- here. Everything after this is a WRITE: the site classifies a scene when its
-- picture is approved or its prompt changes, the archive attach sets it, and
-- the producer's Footage type control overrides it. No reader ever re-derives.
--
--   docker exec -i n8n-postgres-1 psql -U hov -d hov -f - < db/009_visual_provenance.sql
--
-- Every statement is re-runnable.

set search_path to hov, public;

-- ---------------------------------------------------------------------------
-- The scene's own provenance facts
-- ---------------------------------------------------------------------------

alter table scene add column if not exists visual_origin text not null default 'ai_generated';

-- Dropped and recreated rather than `add constraint if not exists` (which
-- Postgres has no form of), so re-running the file cannot leave two.
alter table scene drop constraint if exists scene_visual_origin_check;
alter table scene add constraint scene_visual_origin_check check (visual_origin in (
  'ai_generated', 'ai_reconstruction', 'actual_footage', 'illustrative_footage',
  'archival_footage', 'archival_photo', 'real_stock', 'unknown'));

alter table scene add column if not exists provenance_confidence smallint;
alter table scene drop constraint if exists scene_provenance_confidence_check;
alter table scene add constraint scene_provenance_confidence_check
  check (provenance_confidence is null
         or (provenance_confidence >= 0 and provenance_confidence <= 100));

alter table scene add column if not exists provenance_manually_verified boolean not null default false;
alter table scene add column if not exists provenance_event_name text;
alter table scene add column if not exists provenance_location text;
-- The date of the ORIGINAL as a PERSON stated it. Deliberately separate from
-- stock_media.date_original, which is the catalogue's string and is frequently
-- the upload date (Commons dated a 1969 NASA reel 2015-06-12). Only this one
-- is ever printed on screen.
alter table scene add column if not exists provenance_date text;

comment on column scene.visual_origin is
  'What the picture IS: ai_generated | ai_reconstruction | actual_footage | '
  'illustrative_footage | archival_footage | archival_photo | real_stock | '
  'unknown. Classified and written by the site; never derived at read time.';
comment on column scene.provenance_confidence is
  '0-100 confidence in visual_origin (not in an event match). actual_footage '
  'requires >= 90, which in practice means a person confirmed it.';
comment on column scene.provenance_manually_verified is
  'A person set the footage type by hand. Stops the automatic classifier from '
  'overwriting it on the next approval.';
comment on column scene.provenance_date is
  'Date of the original as a person stated it. NOT stock_media.date_original, '
  'which is the catalogue''s string and often the upload date.';

-- The one-off derivation. Every scene that predates this file is exactly what
-- its visual_source says it is: the archive attach is the only thing that has
-- ever set visual_source away from 'ai', and it sets it to the media type.
update scene
   set visual_origin = case
         when visual_source = 'stock_video' then 'archival_footage'
         when visual_source = 'stock_image' then 'archival_photo'
         else 'ai_generated'
       end
 where visual_origin = 'ai_generated'
   and visual_source in ('stock_video', 'stock_image');

-- ---------------------------------------------------------------------------
-- The compat map, so a workflow can write these through hov.at_write by the
-- same Airtable-shaped names the site's SCENE_FIELDS uses. The two must agree;
-- an unmapped name throws on both sides rather than being dropped.
-- ---------------------------------------------------------------------------

insert into airtable_field (entity, airtable_name, column_name) values
  ('scene', 'Visual Origin',        'visual_origin'),
  ('scene', 'Provenance Confidence','provenance_confidence'),
  ('scene', 'Provenance Verified',  'provenance_manually_verified'),
  ('scene', 'Provenance Event',     'provenance_event_name'),
  ('scene', 'Provenance Location',  'provenance_location'),
  ('scene', 'Provenance Date',      'provenance_date')
on conflict (entity, airtable_name) do update set column_name = excluded.column_name;

-- ---------------------------------------------------------------------------
-- at_scene gains ONE key: `Provenance`, already in the render's own shape.
--
-- Done by WRAPPING the existing view rather than rewriting it. The obvious
-- move is `create or replace view at_scene as <the whole thing plus one key>`,
-- and it means retyping twenty-one Romanian field names — `Script Scenă`,
-- `Status Producție Scenă`, `Observații Scenă` — every one of which is a key
-- that five workflows index by hand. One mistyped diacritic there would not
-- raise: it would silently produce a view whose keys no gate matches, and the
-- pipeline would go quiet rather than fail. So the old definition is renamed,
-- untouched, and the new view adds its key on top of it.
--
-- The join back to `scene` is by id, one row to one row, so the wrapper cannot
-- change the row count. `stock_media` (db/007) is left-joined for the archive
-- fields; this file must therefore run after db/007. If db/009 has not run at
-- all, the old view stands under its own name, `fields.Provenance` is absent,
-- and the render draws no watermark — failing to nothing, which is the right
-- direction for a label.
-- ---------------------------------------------------------------------------

-- Re-runnable: on a second run `at_scene_core` already exists and the rename
-- is skipped, leaving the wrapper below to be replaced in place.
do $mig$
begin
  if not exists (
    select 1 from pg_views where schemaname = 'hov' and viewname = 'at_scene_core'
  ) then
    execute 'alter view hov.at_scene rename to at_scene_core';
  end if;
end
$mig$;

comment on view at_scene_core is
  'The Airtable-shaped scene view as db/002 defined it. Wrapped by at_scene, '
  'which adds the Provenance key. Renamed rather than rewritten so the twenty-'
  'one Romanian field names in it were never retyped.';

create or replace view at_scene as
select
  c.id,
  c."createdTime",
  c.fields || jsonb_build_object(
    -- `VisualProvenance` (platform/lib/provenance.ts, remotion/src/provenance.ts)
    -- assembled once, here, from the scene and the archive row it links to.
    -- Stripped of nulls so an absent field is absent rather than null — the
    -- formatter's own test for "was this ever stated".
    --
    -- Note what is NOT here: stock_media.date_original. It is the catalogue's
    -- string and often the upload date, so printing it would publish a guess
    -- as a fact. Only provenance_date, which a person typed, reaches the screen.
    'Provenance', jsonb_strip_nulls(jsonb_build_object(
      'visualOrigin',         s.visual_origin,
      'provider',             m.provider,
      'sourceTitle',          m.title,
      'sourceUrl',            m.source_url,
      'sourceCreator',        coalesce(nullif(m.creator, ''), nullif(m.credit, '')),
      'originalDate',         nullif(s.provenance_date, ''),
      'originalLocation',     nullif(s.provenance_location, ''),
      'eventName',            nullif(s.provenance_event_name, ''),
      'isExactEventMatch',    case when s.visual_origin = 'actual_footage' then true else null end,
      'rightsStatus',         m.rights_status,
      'licenseName',          m.license_original,
      -- The obligation, not the courtesy. Only the FACT travels; the sentence
      -- is composed by `attributionFor()` on whichever side is printing it, so
      -- the provider's display name ("Wikimedia Commons", not "wikimedia")
      -- has one owner per package instead of a third copy in SQL.
      'attributionRequired',  case when m.attribution_required then true else null end,
      'provenanceConfidence', s.provenance_confidence,
      'manuallyVerified',     case when s.provenance_manually_verified then true else null end
    ))
  ) as fields
from at_scene_core c
join scene s on s.id = c.id
left join stock_media m on m.id = s.stock_media_id;
