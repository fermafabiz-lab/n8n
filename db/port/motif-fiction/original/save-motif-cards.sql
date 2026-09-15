-- A true merge, one statement. Editing Options is shared by the creation form,
-- the final-settings step and the sound switches, and writing it wholesale is
-- the exact bug that once wiped category/cast/multiVoiceMode. Written as raw
-- SQL rather than through hov.at_write because at_write SETS a field and this
-- has to MERGE into one — the same reason the site's updateEditingOptions is
-- `editing_options || $1::jsonb` instead of a read-modify-write.
--
-- Dollar-quoting, exactly as every other Postgres node here does it: the
-- expression is interpolated between $hov$ markers, so nothing in a title or a
-- quoted line can close the string.
update hov.project
   set editing_options = coalesce(editing_options, '{}'::jsonb)
     || $hov${{ JSON.stringify({ motifCards: $json.motifCards }) }}$hov$::jsonb
 where id = $hov${{ $('Receive Project Data').first().json.Project_ID }}$hov$
returning id;