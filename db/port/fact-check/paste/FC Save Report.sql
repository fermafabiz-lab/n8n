-- The fact-check report, one row per project, replaced on every re-script.
--
-- IN-LINE, never a side branch. n8n flushes parallel branches at the very end
-- of a run, so a scripting execution cancelled mid-way keeps what the spine
-- wrote and silently loses what a branch was holding — which is exactly how
-- execution 844 kept its scenes and lost its evidence rows. The report lands
-- here, during the run, or it does not matter that it was computed.
--
-- The payload arrives BASE64 from `FC Apply`. The report quotes the narration
-- verbatim, so it is arbitrary producer prose heading into a SQL literal:
-- dollar-quoting is undone by a `$hov$` appearing in the text, and a `$`
-- followed by a digit ("$5 billion") becomes a positional parameter the day
-- anyone sets this node to transaction batching. Decoding in Postgres means
-- neither can happen, at the cost of one function call.
--
-- `on conflict` rather than insert: the report describes the script that
-- exists NOW. An older report describes a draft nobody can read any more, and
-- keeping both is how the evidence table ended up duplicating its rows on
-- every re-run.
insert into hov.fact_check (project_id, report, checked_at)
values (
  $hov${{ $('Receive Project Data').first().json.Project_ID }}$hov$,
  convert_from(decode('{{ $json.fcReport64 }}', 'base64'), 'UTF8')::jsonb,
  now()
)
on conflict (project_id) do update
   set report = excluded.report,
       checked_at = excluded.checked_at
returning project_id;
