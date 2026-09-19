-- Write the corrected script back, and the hook's spoken copy with it.
--
-- BOTH OR NEITHER, in one statement, for a reason that has bitten this project
-- before: the hook lives twice. `hov.script.content` carries `[CHAPTER 0:
-- HOOK]` as text, and `project.editing_options -> hookPlan -> beats` carries
-- the same lines again — and THAT is the copy the render speaks. Fixing one
-- and not the other shows a corrected hook on the panel while the film still
-- says the old one, which is "a line and its recording drift apart silently"
-- wearing a different hat.
--
-- GUARDED ON `is distinct from`, so a clean re-run writes nothing at all. The
-- reassembly in `DS Apply` round-trips to identical bytes when no sentence
-- changed, so this update touches zero rows on a film with nothing wrong — no
-- bumped `updated_at`, no phantom edit in the history.
--
-- Everything arrives BASE64 for the usual reason: script and report are
-- arbitrary producer prose going into SQL literals, where dollar-quoting is
-- undone by a `$hov$` in the text and `$5 billion` becomes a positional
-- parameter the day this node is switched to transaction batching.
with decoded as (
  select
    '{{ String($json.projectId || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40) }}'::text as pid,
    convert_from(decode('{{ $json.script64 }}',  'base64'), 'UTF8')            as new_script,
    convert_from(decode('{{ $json.editing64 }}', 'base64'), 'UTF8')            as new_editing
),
touched_script as (
  update hov.script s
     set content = d.new_script,
         updated_at = now()
    from decoded d
   where s.project_id = d.pid
     and s.id = (select s2.id from hov.script s2 where s2.project_id = d.pid order by s2.created_at desc limit 1)
     and s.content is distinct from d.new_script
  returning s.id
),
touched_hook as (
  -- GUARDED ON THE FLAG, not only on inequality. `new_editing` is the whole
  -- Editing Options object re-serialised, so its key order and spacing need
  -- not match what is stored even when nothing changed — `is distinct from`
  -- alone would rewrite the row on every single re-run. `DS Apply` sets
  -- `hookChanged` only when the beats actually moved, and that is the one
  -- case where this column should be touched at all.
  -- CAST, because `editing_options` is `jsonb` and `new_editing` arrives as
  -- decoded text. Without it Postgres refuses the whole statement — "column
  -- editing_options is of type jsonb but expression is of type text" — and
  -- since the script update is a CTE in the same statement, the refusal takes
  -- the corrected script down with it. Measured: execution 15199.
  update hov.project p
     set editing_options = d.new_editing::jsonb,
         updated_at = now()
    from decoded d
   where p.id = d.pid
     and '{{ $json.hookChanged }}' = 'true'
     and coalesce(p.editing_options::text, '') is distinct from d.new_editing
  returning p.id
)
select
  (select count(*) from touched_script) as script_rows,
  (select count(*) from touched_hook)   as hook_rows;
