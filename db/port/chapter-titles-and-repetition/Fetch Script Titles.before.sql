select id, "createdTime", fields from hov.at_script
where id = $hov${{ (($('Fetch Project Info').first().json.fields || {}).scripts || [])[0] || 'missing' }}$hov$
