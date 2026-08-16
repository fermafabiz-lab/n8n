-- The tables the raw-HTTP nodes reach that the first port never saw.
--
-- Twenty-one nodes call api.airtable.com directly rather than through the
-- Airtable node — `Fetch Genre Profile`, `Fetch Style Card`, `Save Evidence`
-- and eighteen others — because the node could not do what those steps needed.
-- Counting nodes by type missed every one of them, and the first test film
-- found that out in ninety seconds.
--
-- They are being pointed at an Airtable-shaped shim on the site instead of
-- being rewritten, so their request bodies — several of which are IIFEs that
-- parse a model's reply — stay exactly as they are. That shim needs three more
-- tables to speak for.

set search_path to hov, public;

-- ---------------------------------------------------------------------------
-- Field maps for the three new entities
-- ---------------------------------------------------------------------------

insert into airtable_field (entity, airtable_name, column_name) values
  ('evidence', 'Claim',       'claim'),
  ('evidence', 'Ref',         'ref'),
  ('evidence', 'Source Name', 'source_name'),
  ('evidence', 'Source URL',  'source_url'),
  ('evidence', 'Source Date', 'source_date'),
  ('evidence', 'Project_ID',  'project_id'),
  ('evidence', 'Proiect',     'project_id'),

  ('genre_profile', 'Tone',               'tone'),
  ('genre_profile', 'Format',             'format'),
  ('genre_profile', 'Research',           'research'),
  ('genre_profile', 'Research Brief',     'research_brief'),
  ('genre_profile', 'Fact Sheet Framing', 'fact_sheet_framing'),
  ('genre_profile', 'Invention',          'invention'),
  ('genre_profile', 'Structure',          'structure'),
  ('genre_profile', 'Voice',              'voice'),
  ('genre_profile', 'WPM',                'wpm'),
  ('genre_profile', 'Hook Rule',          'hook_rule'),
  ('genre_profile', 'Visual',             'visual'),
  ('genre_profile', 'Montage Intensity',  'montage_intensity'),
  ('genre_profile', 'Active',             'active'),

  ('script_library', 'Title',             'title'),
  ('script_library', 'Source URL',        'source_url'),
  ('script_library', 'Category',          'category'),
  ('script_library', 'Tone',              'tone'),
  ('script_library', 'Raw Transcript',    'raw_transcript'),
  ('script_library', 'Style Card',        'style_card'),
  ('script_library', 'Pacing WPM',        'pacing_wpm'),
  ('script_library', 'Hook WPM',          'hook_wpm'),
  ('script_library', 'Duration Seconds',  'duration_seconds'),
  ('script_library', 'Transcript Source', 'transcript_source'),
  ('script_library', 'Active',            'active'),
  ('script_library', 'Notes',             'notes')
on conflict (entity, airtable_name) do nothing;

-- ---------------------------------------------------------------------------
-- Views, same rules as the first four: empty fields absent, booleans always
-- present, linked records as id arrays.
-- ---------------------------------------------------------------------------

create or replace view at_evidence as
select
  e.id,
  to_char(e.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "createdTime",
  jsonb_strip_nulls(jsonb_build_object(
    'Claim',       e.claim,
    'Ref',         e.ref,
    'Source Name', e.source_name,
    'Source URL',  e.source_url,
    'Source Date', e.source_date,
    'Project_ID',  e.project_id,
    'Proiect',     jsonb_build_array(e.project_id)
  )) as fields
from evidence e;

create or replace view at_genre_profile as
select
  g.id,
  to_char(g.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "createdTime",
  jsonb_strip_nulls(jsonb_build_object(
    'Tone',               g.tone,
    'Format',             g.format,
    'Research Brief',     g.research_brief,
    'Fact Sheet Framing', g.fact_sheet_framing,
    'Invention',          g.invention,
    'Structure',          g.structure,
    'Voice',              g.voice,
    'WPM',                g.wpm,
    'Hook Rule',          g.hook_rule,
    'Visual',             g.visual,
    'Montage Intensity',  g.montage_intensity
  )) || jsonb_build_object(
    'Research', g.research,
    'Active',   g.active
  ) as fields
from genre_profile g;

create or replace view at_script_library as
select
  l.id,
  to_char(l.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "createdTime",
  jsonb_strip_nulls(jsonb_build_object(
    'Title',             l.title,
    'Source URL',        l.source_url,
    'Category',          l.category,
    'Tone',              l.tone,
    'Raw Transcript',    l.raw_transcript,
    'Style Card',        l.style_card,
    'Pacing WPM',        l.pacing_wpm,
    'Hook WPM',          l.hook_wpm,
    'Duration Seconds',  l.duration_seconds,
    'Transcript Source', l.transcript_source,
    'Notes',             l.notes
  )) || jsonb_build_object('Active', l.active) as fields
from script_library l;

-- ---------------------------------------------------------------------------
-- at_write / at_create learn the new entities
-- ---------------------------------------------------------------------------

create or replace function at_entities() returns text[] language sql immutable as $$
  select array['project', 'scene', 'chapter', 'script',
               'evidence', 'genre_profile', 'script_library'];
$$;

comment on function at_entities() is
  'One list, so at_write and at_create cannot disagree about what exists.';

-- The guards in at_write/at_create were hard-coded lists; point them at the
-- function so adding an entity is one edit, not three.
create or replace function at_write(p_entity text, p_id text, p_fields jsonb)
returns table (id text, "createdTime" text, fields jsonb)
language plpgsql as $$
declare
  sets text[];
begin
  if not (p_entity = any (at_entities())) then
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

create or replace function at_create(p_entity text, p_fields jsonb)
returns table (id text, "createdTime" text, fields jsonb)
language plpgsql as $$
declare
  sets   text[];
  new_id text;
begin
  if not (p_entity = any (at_entities())) then
    raise exception 'at_create: unknown entity %', p_entity;
  end if;
  new_id := coalesce(nullif(p_fields ->> 'id', ''), gen_rec_id());
  sets   := at_assign(p_entity, p_fields);

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
