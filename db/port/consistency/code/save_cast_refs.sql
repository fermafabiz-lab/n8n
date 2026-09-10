-- The sheets, on the project, so the next pass and every regeneration find
-- them instead of making them again. Merged in JS upstream, because `||` on
-- jsonb replaces a whole key rather than merging into it.
update hov.project
   set editing_options = coalesce(editing_options, '{}'::jsonb) || $hov${{ JSON.stringify({ castRefs: $json.castRefs, castSheets: $json.castSheets, objectRefs: $json.objectRefs }) }}$hov$::jsonb
 where id = $hov${{ $('Receive Batch Input').first().json.Project_ID }}$hov$
returning id, editing_options->'castRefs' as cast_refs, editing_options->'castSheets' as cast_sheets, editing_options->'objectRefs' as object_refs
