-- What db/014 must have left on the live database. Run right after the apply.
select
  (select count(*)::int from information_schema.columns
    where table_schema = 'hov' and table_name = 'project' and column_name = 'activity_at') as column_present,
  (select column_default from information_schema.columns
    where table_schema = 'hov' and table_name = 'project' and column_name = 'activity_at') as column_default,
  (select count(*)::int from pg_trigger
    where tgname = 'project_activity' and tgrelid = 'hov.project'::regclass) as trigger_present,
  (select count(*)::int from hov.project where activity_at is not null) as rows_stamped_since,
  (select count(*)::int from hov.project) as projects
