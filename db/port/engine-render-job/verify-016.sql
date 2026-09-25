-- What db/016 must have left on the live database. Run right after the apply.
select
  (select count(*) from information_schema.columns where table_schema = 'hov' and table_name = 'render_job') as columns,
  (select count(*) from pg_indexes where schemaname = 'hov' and tablename = 'render_job') as indexes,
  (select indexdef from pg_indexes where schemaname = 'hov' and indexname = 'render_job_one_active') as one_active,
  (select count(*) from pg_trigger where tgname = 'render_job_touch') as touch_trigger,
  (select count(*) from hov.render_job) as rows
