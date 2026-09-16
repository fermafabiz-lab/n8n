-- One row when the project is an episode of a series, none otherwise —
-- and none is the correct answer for every ordinary film: the chain simply
-- does not run. The narration is the NEWEST row of hov.script for the
-- project, the same rule as getProjectScriptInfo in
-- platform/lib/data/postgres.ts — it is the row approveScript has just
-- written "Script Content" and Status = approved onto. (project's own
-- full_narrator_script / edited_narrator_script are empty on every film
-- since the cutover; nothing writes them.)
select p.id,
       p.name,
       p.series_id,
       coalesce(p.episode_no, 0) as episode_no,
       coalesce(nullif(p.language, ''), nullif(s.language, ''), 'English') as language,
       coalesce((select sc.content
                   from hov.script sc
                  where sc.project_id = p.id
                  order by sc.created_at desc
                  limit 1), '') as script,
       s.name as series_name,
       s.premise,
       s.previously
  from hov.project p
  join hov.series s on s.id = p.series_id
 where p.id = $1
