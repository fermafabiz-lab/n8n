-- What db/020 must have left on the live database. Run right after the apply.
select
  (select count(*)::int from information_schema.tables
    where table_schema = 'hov' and table_name = 'captcha_day') as table_present,
  (select count(*)::int from information_schema.columns
    where table_schema = 'hov' and table_name = 'captcha_day') as columns,
  (select count(*)::int from hov.captcha_day) as days
