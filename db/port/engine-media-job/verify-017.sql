-- What db/017 must have left on the live database. Run right after the apply.
select
  (select count(*) from information_schema.columns where table_schema = 'hov' and table_name = 'media_job') as columns,
  (select count(*) from pg_indexes where schemaname = 'hov' and tablename = 'media_job') as indexes,
  (select indexdef from pg_indexes where schemaname = 'hov' and indexname = 'media_job_one_active') as one_active,
  (select count(*) from pg_trigger where tgname = 'media_job_touch') as touch_trigger,
  (select count(*) from hov.media_job) as rows
