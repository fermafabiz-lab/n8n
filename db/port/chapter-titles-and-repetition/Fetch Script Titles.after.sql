-- The script that belongs to this project, newest first.
--
-- This used to read the script id out of the project's `scripts` link field.
-- That field only ever existed in Airtable: hov.at_project does not emit it,
-- so the expression fell through to the literal 'missing', no row came back,
-- and the render got no chapter titles at all. Ask the script instead: it
-- carries the link the other way round, as 'Associated Project'.
--
-- Through the view, not the base table, because everything else this
-- workflow reads is a hov.at_* view and a base-table grant is not something
-- the render path should be the first to discover it lacks.
select id, "createdTime", fields
from hov.at_script
where fields->'Associated Project' @> $hov$["{{ $('Fetch Project Info').first().json.id }}"]$hov$::jsonb
order by "createdTime" desc
limit 1
