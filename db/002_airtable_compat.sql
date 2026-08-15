-- Airtable-shaped views and write functions.
--
-- WHY THIS EXISTS
--
-- Swapping 48 Airtable nodes for Postgres nodes looks like a node-by-node job
-- until you count what reads their output: **52 nodes reference
-- `$json.fields['Nume Câmp']`**, in Romanian, with diacritics. A Postgres node
-- returns flat snake_case columns, so a naive swap breaks every one of those
-- expressions — and they are spread across 344 nodes in five workflows. That
-- is not a port, it is a rewrite, and a rewrite of the pipeline's gates is the
-- last thing this migration should attempt.
--
-- So Postgres speaks Airtable instead. Every read returns
--
--     { id, createdTime, fields: { "Ordine Scenă": 102, … } }
--
-- which is exactly what the Airtable node emits, and every write accepts the
-- same shape. Porting a node then means changing where it reads from and
-- nothing else — the expressions around it never learn that anything moved.
--
-- The layer is deliberately temporary. Once every workflow is on Postgres and
-- has been quiet for a while, expressions can move to column names one
-- workflow at a time and this file can be dropped.

set search_path to hov, public;

-- ---------------------------------------------------------------------------
-- The map, as data
--
-- The same correspondence is written down in three places — 001_schema.sql
-- COMMENTs, the site's SCENE_FIELDS/PROJECT_FIELDS maps, and here. This is the
-- only one a query can read, which is what the write functions need.
-- ---------------------------------------------------------------------------

create table airtable_field (
  entity        text not null,
  airtable_name text not null,
  column_name   text not null,
  primary key (entity, airtable_name)
);

comment on table airtable_field is
  'Airtable field name → hov column, per entity. Read at runtime by at_write().';

insert into airtable_field (entity, airtable_name, column_name) values
  -- project ------------------------------------------------------------
  ('project', 'Nume Proiect',              'name'),
  ('project', 'Tonalitate',                'tone'),
  ('project', 'Format',                    'aspect'),
  ('project', 'Fără Subtitrări',           'no_captions'),
  ('project', 'Pace',                      'pace'),
  ('project', 'Lenght',                    'length_seconds'),
  ('project', 'Status General',            'status'),
  ('project', 'Link Video Final',          'final_video_url'),
  ('project', 'Data Finalizare Estimată',  'estimated_finish'),
  ('project', 'Editing Options',           'editing_options'),
  ('project', 'Tag-uri Proiect',           'tags'),
  ('project', 'Language',                  'language'),
  ('project', 'Style',                     'style'),
  ('project', 'Story Bible',               'story_bible'),
  ('project', 'Scene',                     'scene_note'),
  ('project', 'Full Narrator Script',      'full_narrator_script'),
  ('project', 'Edited Narrator Script',    'edited_narrator_script'),
  ('project', 'Script Chapters JSON',      'script_chapters'),
  ('project', 'Script Status',             'script_status'),
  ('project', 'Voice ID',                  'voice_id'),
  ('project', 'Research Thin',             'research_thin'),
  -- scene --------------------------------------------------------------
  ('scene', 'Script Scenă',            'narration'),
  ('scene', 'Capitol',                 'chapter_id'),
  ('scene', 'Project_ID',              'project_id'),
  ('scene', 'Prompt Vizual',           'visual_prompt'),
  ('scene', 'Voiceover URL',           'voiceover_url'),
  ('scene', 'Imagine First Frame',     'image_prompt'),
  ('scene', 'Imagine Last Frame',      'last_frame_url'),
  ('scene', 'Video Scenă URL',         'motion_prompt'),
  ('scene', 'Status Producție Scenă',  'production_status'),
  ('scene', 'Aprobare Scenă',          'scene_approved'),
  ('scene', 'Aprobare Voce',           'voice_approved'),
  ('scene', 'Aprobare Imagine',        'image_approved'),
  ('scene', 'Aprobare Video',          'video_approved'),
  ('scene', 'Regenerează Imagine',     'regen_image'),
  ('scene', 'Regenerează Video',       'regen_video'),
  ('scene', 'Regenerează Voce',        'regen_voice'),
  ('scene', 'Durată Scenă (secunde)',  'duration_seconds'),
  ('scene', 'Observații Scenă',        'note'),
  ('scene', 'Tag-uri Scenă',           'tags'),
  ('scene', 'Image Media ID',          'image_media_id'),
  ('scene', 'Scene Final URL',         'scene_final_url'),
  ('scene', 'Ordine Scenă',            'scene_order'),
  ('scene', 'Evidence Ref',            'evidence_ref'),
  ('scene', 'Needs Fact Check',        'needs_fact_check'),
  ('scene', 'Versiuni Media',          'media_versions'),
  -- chapter ------------------------------------------------------------
  ('chapter', 'Titlu Capitol',            'title'),
  ('chapter', 'Proiect',                  'project_id'),
  ('chapter', 'Idei Principale',          'main_ideas'),
  ('chapter', 'Script Capitol',           'chapter_script'),
  ('chapter', 'Ordine',                   'ordinal'),
  ('chapter', 'Status Aprobare Capitol',  'approval_status'),
  ('chapter', 'Observații Capitol',       'notes'),
  ('chapter', 'Responsabil Capitol',      'owner'),
  ('chapter', 'Durată Capitol (minute)',  'duration_minutes'),
  -- script -------------------------------------------------------------
  ('script', 'Script Title',        'title'),
  ('script', 'Script Content',      'content'),
  ('script', 'script chapters',     'chapters'),
  ('script', 'Status',              'status'),
  ('script', 'Language',            'language'),
  ('script', 'Observații Script',   'notes'),
  ('script', 'Associated Project',  'project_id'),
  ('script', 'Regenerează Video',   'regenerate');

/**
 * A scene's attachments in Airtable's shape.
 *
 * Airtable returned [{id,url,filename,size,type,width,height}]; expressions
 * only ever reach for .url, but the rest costs nothing and keeps anything
 * written against the old shape working.
 */
create or replace function at_attachments(p_scene text, p_field text)
returns jsonb language sql stable as $$
  select case when count(*) = 0 then null else jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
           'id',       a.id,
           'url',      current_setting('hov.media_base_url', true) || '/' || a.path,
           'filename', a.filename,
           'size',     a.size_bytes,
           'type',     a.content_type,
           'width',    a.width,
           'height',   a.height
         )) order by a.created_at) end
  from attachment a
  where a.scene_id = p_scene and a.field = p_field;
$$;

comment on function at_attachments(text, text) is
  'Reads the public base from the hov.media_base_url GUC so the host is not '
  'baked into 334 rows. Set it per-database: '
  'alter database hov set hov.media_base_url = ''https://house-of-videos.com/media'';';

-- ---------------------------------------------------------------------------
-- Reads
--
-- jsonb_strip_nulls is not cosmetic. Airtable OMITS empty fields entirely — an
-- unchecked box is absent from `fields`, not present as false — and expressions
-- downstream were written against that. Emitting explicit nulls would change
-- what `$json.fields['X'] === undefined` answers.
--
-- Booleans are the deliberate exception: they are emitted always, because the
-- gates read them constantly and false is the meaningful answer, not silence.
-- ---------------------------------------------------------------------------

create view at_project as
select
  p.id,
  to_char(p.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "createdTime",
  jsonb_strip_nulls(jsonb_build_object(
    'Nume Proiect',             p.name,
    'Tonalitate',               p.tone,
    'Format',                   p.aspect,
    'Pace',                     p.pace,
    'Lenght',                   p.length_seconds,
    'Status General',           p.status,
    'Link Video Final',         p.final_video_url,
    'Data Finalizare Estimată', p.estimated_finish,
    'Editing Options',          p.editing_options::text,
    'Language',                 p.language,
    'Style',                    p.style,
    'Story Bible',              p.story_bible,
    'Scene',                    p.scene_note,
    'Full Narrator Script',     p.full_narrator_script,
    'Edited Narrator Script',   p.edited_narrator_script,
    'Script Chapters JSON',     p.script_chapters::text,
    'Voice ID',                 nullif(p.voice_id, ''),
    'Project ID',               p.id,
    'Tag-uri Proiect',          case when p.tags = '{}' then null else to_jsonb(p.tags) end
  )) || jsonb_build_object(
    'Fără Subtitrări', p.no_captions,
    'Script Status',   p.script_status,
    'Research Thin',   p.research_thin
  ) as fields
from project p;

comment on view at_project is
  '"Project ID" is emitted as the row id because that is what the Airtable '
  'formula field always was: RECORD_ID().';

create view at_scene as
select
  s.id,
  to_char(s.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "createdTime",
  jsonb_strip_nulls(jsonb_build_object(
    'Script Scenă',           s.narration,
    'Project_ID',             s.project_id,
    'Prompt Vizual',          s.visual_prompt,
    'Voiceover URL',          s.voiceover_url,
    'Imagine First Frame',    s.image_prompt,
    'Imagine Last Frame',     s.last_frame_url,
    'Video Scenă URL',        s.motion_prompt,
    'Status Producție Scenă', s.production_status,
    'Durată Scenă (secunde)', s.duration_seconds,
    'Observații Scenă',       s.note,
    'Image Media ID',         s.image_media_id,
    'Scene Final URL',        s.scene_final_url,
    'Ordine Scenă',           s.scene_order,
    'Evidence Ref',           nullif(s.evidence_ref, ''),
    'Versiuni Media',         s.media_versions::text,
    -- Linked-record fields are arrays of ids in Airtable, not scalars.
    'Capitol',                case when s.chapter_id is null then null
                                   else jsonb_build_array(s.chapter_id) end,
    'Tag-uri Scenă',          case when s.tags = '{}' then null else to_jsonb(s.tags) end,
    -- Attachments come back as [{url,…}], the shape expressions expect.
    'Imagine Scenă',          hov.at_attachments(s.id, 'image'),
    'Video Scenă',            hov.at_attachments(s.id, 'video'),
    'Versiuni Imagine',       hov.at_attachments(s.id, 'image_version')
  )) || jsonb_build_object(
    'Aprobare Scenă',      s.scene_approved,
    'Aprobare Voce',       s.voice_approved,
    'Aprobare Imagine',    s.image_approved,
    'Aprobare Video',      s.video_approved,
    'Regenerează Imagine', s.regen_image,
    'Regenerează Video',   s.regen_video,
    'Regenerează Voce',    s.regen_voice,
    'Needs Fact Check',    s.needs_fact_check
  ) as fields
from scene s;

create view at_chapter as
select
  c.id,
  to_char(c.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "createdTime",
  jsonb_strip_nulls(jsonb_build_object(
    'Titlu Capitol',           c.title,
    'Proiect',                 jsonb_build_array(c.project_id),
    'Idei Principale',         c.main_ideas,
    'Script Capitol',          c.chapter_script,
    'Ordine',                  c.ordinal,
    'Status Aprobare Capitol', c.approval_status,
    'Observații Capitol',      c.notes,
    'Responsabil Capitol',     c.owner,
    'Durată Capitol (minute)', c.duration_minutes
  )) as fields
from chapter c;

create view at_script as
select
  sc.id,
  to_char(sc.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "createdTime",
  jsonb_strip_nulls(jsonb_build_object(
    'Script Title',       sc.title,
    'Script Content',     sc.content,
    'script chapters',    sc.chapters,
    'Status',             sc.status,
    'Language',           sc.language,
    'Observații Script',  sc.notes,
    'Associated Project', case when sc.project_id is null then null
                               else jsonb_build_array(sc.project_id) end
  )) || jsonb_build_object('Regenerează Video', sc.regenerate) as fields
from script sc;

-- ---------------------------------------------------------------------------
-- Writes
--
-- at_write (update) and at_create (insert) differ only in the statement they
-- wrap around the same list of column assignments, so that list is built once
-- in at_assign(). Casting is driven by the column's real type, read from
-- information_schema — there is no second copy of the schema to fall out of
-- date.
-- ---------------------------------------------------------------------------

/**
 * Turns Airtable-shaped fields into `col = expr` fragments written against a
 * jsonb parameter the caller binds as $1.
 */
create or replace function at_assign(p_entity text, p_fields jsonb)
returns text[] language plpgsql as $$
declare
  k       text;
  col     text;
  coltype text;
  out     text[] := '{}';
  stamp   text;
begin
  for k in select jsonb_object_keys(p_fields) loop
    continue when k = 'id';

    -- An attachment cannot be written here and must not be dropped quietly.
    -- The Airtable node accepted [{url}] and Airtable itself went and fetched
    -- the bytes; that fetch is the one thing this database cannot do, and the
    -- whole reason /opt/n8n/media exists. A silently ignored image write would
    -- leave a scene looking generated with nothing behind it.
    if k in ('Imagine Scenă', 'Video Scenă', 'Versiuni Imagine') then
      raise exception
        'at_write: "%" is an attachment — Postgres cannot fetch the bytes. '
        'Download the URL into /media and insert into hov.attachment instead.', k;
    end if;

    select f.column_name into col
      from airtable_field f
     where f.entity = p_entity and f.airtable_name = k;
    if col is null then
      raise exception 'at_write: no % column mapped for Airtable field "%"', p_entity, k;
    end if;

    select c.data_type into coltype
      from information_schema.columns c
     where c.table_schema = 'hov' and c.table_name = p_entity and c.column_name = col;

    out := out || case
      -- text[]: the value arrives as a JSON array of strings.
      when coltype = 'ARRAY' then format(
        '%I = coalesce((select array_agg(v) from jsonb_array_elements_text($1 -> %L) v), ''{}'')',
        col, k)
      -- jsonb: an object/array goes straight in; a string is JSON *text* and
      -- has to be parsed, which is exactly how Editing Options arrived from
      -- Airtable, where it lived in a multilineText field.
      when coltype = 'jsonb' and jsonb_typeof(p_fields -> k) in ('object', 'array')
        then format('%I = $1 -> %L', col, k)
      when coltype = 'jsonb'
        then format('%I = ($1 ->> %L)::jsonb', col, k)
      -- A linked-record field arrives as an ARRAY of ids, because that is
      -- what Airtable always sent and the workflows still build it that way
      -- ("Capitol": [ $('Create Chapter Records').item.json.id ]). The column
      -- holds one id, so take the first element. Without this the whole JSON
      -- array lands in the column as text and the foreign key breaks — quietly,
      -- because a text column will accept '["recXXX"]' without complaint.
      when jsonb_typeof(p_fields -> k) = 'array' then format(
        '%I = nullif(($1 -> %L ->> 0), '''')::%s', col, k, coltype)
      -- Everything else: extract as text, cast to the column's own type.
      -- The nullif is load-bearing: n8n writes '' for an expression that
      -- resolved to nothing, and ''::integer raises rather than giving null.
      else format('%I = nullif($1 ->> %L, '''')::%s', col, k, coltype)
    end;

    stamp := case col when 'regen_image' then 'regen_image_at'
                      when 'regen_video' then 'regen_video_at'
                      when 'regen_voice' then 'regen_voice_at' end;
    if stamp is not null then
      out := out || format('%I = %s', stamp,
        case when (p_fields -> k) = to_jsonb(true) then 'now()' else 'null' end);
    end if;
  end loop;
  return out;
end;
$$;

/**
 * Airtable-shaped update. Same field names the node's column mapping already
 * uses, same output shape the read views produce.
 *
 *   select * from hov.at_write('scene', 'recXXX',
 *     '{"Aprobare Imagine": true, "Status Producție Scenă": "Finalizat"}');
 */
create or replace function at_write(p_entity text, p_id text, p_fields jsonb)
returns table (id text, "createdTime" text, fields jsonb)
language plpgsql as $$
declare
  sets text[];
begin
  if p_entity not in ('project', 'scene', 'chapter', 'script') then
    raise exception 'at_write: unknown entity %', p_entity;
  end if;
  sets := at_assign(p_entity, p_fields);
  if array_length(sets, 1) is null then
    raise exception 'at_write: nothing to write for %', p_id;
  end if;

  execute format('update hov.%I set %s where id = $2', p_entity, array_to_string(sets, ', '))
    using p_fields, p_id;

  return query execute
    format('select v.id, v."createdTime", v.fields from hov.%I v where v.id = $1',
           'at_' || p_entity)
    using p_id;
end;
$$;

/**
 * Airtable-shaped insert.
 *
 * The skeleton row is inserted with its NOT NULL columns already filled from
 * p_fields, because scene and chapter would otherwise fail on project_id and
 * on scene_order's > 0 check before the assignments ever ran.
 */
create or replace function at_create(p_entity text, p_fields jsonb)
returns table (id text, "createdTime" text, fields jsonb)
language plpgsql as $$
declare
  sets   text[];
  new_id text;
begin
  if p_entity not in ('project', 'scene', 'chapter', 'script') then
    raise exception 'at_create: unknown entity %', p_entity;
  end if;
  new_id := coalesce(nullif(p_fields ->> 'id', ''), gen_rec_id());
  sets   := at_assign(p_entity, p_fields);

  -- Insert bare, then apply every field through the same assignments an
  -- update uses, inside one statement pair so a half-built row is never
  -- visible. Defaults cover the NOT NULLs that have one; the rest arrive in
  -- the update before anything can read the row.
  if array_length(sets, 1) is null then
    execute format('insert into hov.%I (id) values ($2)', p_entity) using p_fields, new_id;
  else
    execute format(
      'with fresh as (insert into hov.%I (id, %s) values ($2, %s) returning id) select 1',
      p_entity,
      (select string_agg(split_part(s, ' = ', 1), ', ') from unnest(sets) s),
      (select string_agg(substr(s, strpos(s, ' = ') + 3), ', ') from unnest(sets) s))
      using p_fields, new_id;
  end if;

  return query execute
    format('select v.id, v."createdTime", v.fields from hov.%I v where v.id = $1',
           'at_' || p_entity)
    using new_id;
end;
$$;
