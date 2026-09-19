-- The re-run's report, into the same one-row-per-project table the first pass
-- writes, replacing it.
--
-- REPLACING IS THE POINT, not a compromise. The re-run read the script AS IT
-- STANDS — hook included, rewrite included — so it describes the text the
-- producer is actually looking at, and the first pass describes a draft that no
-- longer exists. Keeping both would put two reports on one screen and make the
-- producer decide which is current, which is the job the timestamp already
-- does. `report->>'rerun'` is how the panel knows which kind it is showing.
--
-- The payload arrives BASE64 from `DS Apply`, for the same reason it does in
-- `FC Save Report`: the report quotes the script verbatim, so dollar-quoting is
-- undone by a `$hov$` in the prose and any `$` followed by a digit becomes a
-- positional parameter under transaction batching. Decoding in Postgres costs
-- one function call and removes both.
--
-- BY NAME, NOT `$json`. `DS Write` sits between `DS Apply` and this node and
-- emits `{script_rows, hook_rows}` — it REPLACES the payload, exactly as an
-- agent does. Read off `$json` this node decodes `undefined` and dies with
-- "invalid base64 end sequence", which names nothing that would lead you here.
-- Measured: execution 15202, where the script and the hook were both written
-- correctly and then the report that described them was not.
--
-- The id is re-whitelisted here rather than trusted from upstream. It has
-- already been cleaned once in `DS Load`, and doing it again is free: this is
-- the only other place in the chain where producer-controlled text reaches SQL,
-- and a guard that lives beside the statement cannot be detached from it.
insert into hov.fact_check (project_id, report, checked_at)
values (
  '{{ String($("DS Apply").first().json.projectId || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40) }}',
  convert_from(decode('{{ $("DS Apply").first().json.fcReport64 }}', 'base64'), 'UTF8')::jsonb,
  now()
)
on conflict (project_id) do update
   set report = excluded.report,
       checked_at = excluded.checked_at
returning project_id, checked_at;
