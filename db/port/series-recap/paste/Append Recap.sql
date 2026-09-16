-- One statement, so two episodes approved in the same minute cannot lose
-- each other's line: every existing line for THIS episode number goes,
-- the new one is appended, blank lines are dropped. The parameters are the
-- line (base64), the series id, and the LIKE pattern for this episode's
-- line — in that order. They are positional on purpose: pg-promise
-- substitutes them TEXTUALLY, comments included, so a comment must not
-- name one.
update hov.series
   set previously = btrim(
         array_to_string(array(
           select l
             from unnest(string_to_array(previously, E'\n')) as l
            where l not like $3
              and btrim(l, E' \t\r') <> ''
         ), E'\n')
         || E'\n' || convert_from(decode($1, 'base64'), 'UTF8'),
         E'\n')
 where id = $2
returning id, length(previously) as previously_length
