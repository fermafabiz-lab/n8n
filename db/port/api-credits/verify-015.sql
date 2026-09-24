-- What db/015 must have left on the live database. Run right after the apply.
select
  (select count(*)::int from information_schema.tables
    where table_schema = 'hov' and table_name = 'api_balance') as table_present,
  (select count(*)::int from information_schema.columns
    where table_schema = 'hov' and table_name = 'api_balance') as columns,
  (select count(*)::int from pg_indexes
    where schemaname = 'hov' and tablename = 'api_balance') as indexes,
  (select count(*)::int from hov.api_balance) as readings
