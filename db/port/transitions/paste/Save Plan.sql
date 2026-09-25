-- One key, merged: every other Editing Options key stays as it is. Base64
-- because the plan is free text from a model, and a Postgres node must never
-- see a dollar sign followed by a digit in its query text (CLAUDE.md,
-- "Cross-cutting gotchas"). Positional parameters: the plan, the project id.
update hov.project
   set editing_options = editing_options
         || jsonb_build_object('graphicPlan', convert_from(decode($1, 'base64'), 'UTF8')::jsonb)
 where id = $2
returning id, jsonb_array_length(editing_options->'graphicPlan'->'items') as items
