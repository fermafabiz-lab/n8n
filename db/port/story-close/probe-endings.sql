-- Read-only probe, run through a throwaway n8n workflow (2026-09-16):
-- (1) the live genre_profile rows, (2) the tail of the LAST chapter of every
-- film created since 09-05, with category and tone, to see what the closing
-- beat actually looks like on real story / kids films.
with last_ch as (
  select distinct on (project_id) project_id, ordinal, title, chapter_script
  from hov.chapter
  where chapter_script is not null and chapter_script <> ''
  order by project_id, ordinal desc
)
select p.id, left(p.name, 60) as name, p.tone, p.status, p.length_seconds as len,
       to_char(p.created_at, 'MM-DD HH24:MI') as created,
       coalesce(p.editing_options->>'category', '') as category,
       (select count(*) from hov.chapter c where c.project_id = p.id) as chapters,
       lc.ordinal as last_ord,
       right(regexp_replace(lc.chapter_script, '\s+', ' ', 'g'), 300) as tail
from hov.project p
join last_ch lc on lc.project_id = p.id
where p.created_at >= '2026-09-05'
order by p.created_at desc
limit 40;
