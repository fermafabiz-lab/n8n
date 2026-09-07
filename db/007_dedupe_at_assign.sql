-- 007 — two Airtable field names that map to one column must not produce two
--       assignments.
--
-- Found on the first researched film after the cutover (rec8K76f498HJ0GNr,
-- 2026-09-01, surfaced 2026-09-04): `Save Evidence` posts records carrying
-- BOTH "Project_ID" (Airtable's text field) and "Proiect" (its linked-record
-- twin) — legitimate in Airtable, where they were two fields, but both rows
-- of hov.airtable_field map to the same project_id column here. at_assign
-- emitted the column twice, INSERT raised `column "project_id" specified
-- more than once`, and because Save Evidence is onError:continueRegularOutput
-- BY DESIGN (evidence storage must never kill scripting), every researched
-- film since the cutover silently lost its whole research pack while the
-- script was correctly written against it.
--
-- The fix is in at_assign, which both at_write and at_create wrap: the first
-- field to claim a column wins and later twins are skipped. First rather
-- than last is deliberate — jsonb sorts object keys (shorter first), so
-- which twin comes first is stable, and the twins carry the same value by
-- construction; picking either is correct, picking deterministically is
-- what matters.
--
-- Apply (from a machine that can reach the box, or through a throwaway n8n
-- Postgres node — see CLAUDE.md). One statement, fully qualified, so the
-- live apply and this file cannot drift.

create or replace function hov.at_assign(p_entity text, p_fields jsonb)
returns text[] language plpgsql as $$
declare
  k       text;
  col     text;
  coltype text;
  seen    text[] := '{}';
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
      from hov.airtable_field f
     where f.entity = p_entity and f.airtable_name = k;
    if col is null then
      raise exception 'at_write: no % column mapped for Airtable field "%"', p_entity, k;
    end if;

    -- Two Airtable names, one column ("Project_ID" text + "Proiect" link):
    -- the first to arrive wins, the twin is skipped. Emitting both raised
    -- `specified more than once` on INSERT and `multiple assignments` on
    -- UPDATE — see the header for what that silently cost.
    continue when col = any(seen);
    seen := seen || col;

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
