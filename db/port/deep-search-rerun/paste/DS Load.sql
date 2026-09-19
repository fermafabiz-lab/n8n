-- Everything the re-run needs, in one row: the project's mode, the script AS IT
-- NOW STANDS, and the research pack that was saved when the film was written.
--
-- WHY THE SCRIPT ROW AND NOT THE CHAPTERS. `hov.script.content` is the finished
-- narration in exactly the `[CHAPTER n: title]\n…` shape `FC Prep` builds for
-- the judge — and, critically, it INCLUDES THE HOOK, which the first pass never
-- sees because `Generate Hook` runs after the whole Deep Search chain. That is
-- the entire reason this re-run exists; see `db/port/fact-check/README.md` §7.
-- It also carries whatever the rewrite produced, which closes §8.
--
-- `hov.evidence` is what `Save Evidence` wrote during scripting: one row per
-- sourced claim, with the ref the judge cites. Rebuilding `packList` from it is
-- what makes a re-run a CLOSED-BOOK check against the same ground truth rather
-- than a second opinion from a model's memory.
--
-- THE ID IS WHITELISTED IN THE EXPRESSION, not quoted around. It arrives from a
-- webhook body, so it is producer-controlled text going into a SQL literal; the
-- replace() strips everything that is not alphanumeric, underscore or hyphen,
-- which an Airtable-style `rec…` id never contains. Nothing else here is
-- interpolated, so there is no second place to get this wrong.
select
  p.id                                             as project_id,
  p.name                                           as project_name,
  coalesce(p.editing_options::text, '{}')          as editing_options,
  (select s.content
     from hov.script s
    where s.project_id = p.id
    order by s.created_at desc
    limit 1)                                       as script,
  coalesce(
    (select json_agg(
       json_build_object(
         'ref',    e.ref,
         'claim',  e.claim,
         'source', e.source_name,
         'url',    e.source_url,
         'date',   e.source_date
       ) order by e.ref)
       from hov.evidence e
      where e.project_id = p.id),
    '[]'::json)                                    as claims
from hov.project p
where p.id = '{{ String($json.body.project_id || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40) }}'
