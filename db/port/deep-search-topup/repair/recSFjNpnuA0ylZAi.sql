-- One-off repair of the producer's Google Maps film, asked for on 2026-09-23
-- after the two verification presses (executions 16463, 16478) left three
-- marks in its script. Two are undone here:
--
--   1. " When Google Maps first launched in 2005, the team was focused on
--      “mapping the world.”" — added by the FIRST press, before the editor
--      learned that an aim is `minor` (it now rejects this exact sentence,
--      9 of 9 in 16466-16468). Removed.
--   2. "The prototype became part of Google Maps." — `DS Rewrite`'s answer to
--      the unsupported "The prototype proved the idea.", which also swallowed
--      the SUPPORTED sentence after it and near-copied the sentence after that.
--      Replaced by the supported sentence it swallowed, verbatim as the judge
--      quoted it: "In October 2004, Google acquired Where 2 Technologies to
--      create Google Maps." (E2).
--
-- GUARDED: the update touches the newest script row only when BOTH strings are
-- present, so a script the producer has edited in the meantime is left alone
-- and the query returns no row. The hook, and so the render's spoken copy in
-- `hookPlan.beats`, is untouched — neither string is in chapter 0.
with s as (
  select id, content
    from hov.script
   where project_id = 'recSFjNpnuA0ylZAi'
   order by created_at desc
   limit 1
)
update hov.script t
   set content = replace(
                   replace(s.content,
                           ' When Google Maps first launched in 2005, the team was focused on “mapping the world.”',
                           ''),
                   'The prototype became part of Google Maps.',
                   'In October 2004, Google acquired Where 2 Technologies to create Google Maps.'),
       updated_at = now()
  from s
 where t.id = s.id
   and position(' When Google Maps first launched in 2005, the team was focused on “mapping the world.”' in s.content) > 0
   and position('The prototype became part of Google Maps.' in s.content) > 0
returning t.id, t.content;
