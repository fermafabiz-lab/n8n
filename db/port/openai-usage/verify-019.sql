-- What db/019 must have left on the live database. Run right after the apply.
select
  (select count(*)::int from information_schema.tables
    where table_schema = 'hov' and table_name in ('openai_call', 'openai_scan')) as tables_present,
  (select count(*)::int from information_schema.columns
    where table_schema = 'hov' and table_name = 'openai_call') as call_columns,
  (select count(*)::int from information_schema.columns
    where table_schema = 'hov' and table_name = 'openai_scan') as scan_columns,
  (select count(*)::int from pg_indexes
    where schemaname = 'hov' and tablename in ('openai_call', 'openai_scan')) as indexes,
  (select count(*)::int from hov.openai_call) as calls,
  (select count(*)::int from hov.openai_scan) as scans
