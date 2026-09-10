-- The plates, on the project, merged in JS upstream (jsonb || replaces keys).
update hov.project
   set editing_options = coalesce(editing_options, '{}'::jsonb) || $hov${{ JSON.stringify({ locationRefs: $json.locationRefs, locationPlates: $json.locationPlates }) }}$hov$::jsonb
 where id = $hov${{ $('Receive Batch Input').first().json.Project_ID }}$hov$
returning id, editing_options->'locationRefs' as location_refs, editing_options->'locationPlates' as location_plates
