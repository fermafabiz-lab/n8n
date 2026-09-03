-- 006 — an empty string written to a text column stays an empty string.
--
-- Found 2026-09-03: every cinematic film died at creation. The site clears
-- Voice ID to '' for a silent film (nothing speaks), the orchestrator sends
-- "Voice ID": "" through at_create, and at_assign turned it into NULL with
-- the generic nullif($1 ->> k, '') — which exists so that '' never reaches
-- ''::integer. project.voice_id is `text not null default ''`, so the insert
-- raised "null value in column voice_id violates not-null constraint", the
-- webhook answered 200 with an empty body, and the site reported "The
-- project was NOT created". Airtable had swallowed the same '' for months.
--
-- For a TEXT column '' is a perfectly good value and is exactly what Airtable
-- stored; the read views already turn '' into an absent field (nullif on the
-- way OUT), so no reader can tell the difference. Only the numeric/boolean/
-- date branch keeps the nullif. Same function as 002, one branch added.
create or replace function hov.at_assign(p_entity text, p_fields jsonb)
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

    select c.data_type into coltype
      from information_schema.columns c
     where c.table_schema = 'hov' and c.table_name = p_entity and c.column_name = col;

    out := out || case
      when coltype = 'ARRAY' then format(
        '%I = coalesce((select array_agg(v) from jsonb_array_elements_text($1 -> %L) v), ''{}'')',
        col, k)
      when coltype = 'jsonb' and jsonb_typeof(p_fields -> k) in ('object', 'array')
        then format('%I = $1 -> %L', col, k)
      when coltype = 'jsonb'
        then format('%I = ($1 ->> %L)::jsonb', col, k)
      when jsonb_typeof(p_fields -> k) = 'array' then format(
        '%I = nullif(($1 -> %L ->> 0), '''')::%s', col, k, coltype)
      -- TEXT keeps '' as '' (a JSON null still becomes NULL): a cleared text
      -- field is an empty string, exactly as Airtable stored it, and a
      -- `not null default ''` column such as project.voice_id accepts it.
      when coltype = 'text' then format('%I = ($1 ->> %L)', col, k)
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
