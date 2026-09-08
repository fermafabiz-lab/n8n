-- Which characters, objects and locations the film's approved scenes hold,
-- read BEFORE the sheets are planned so a lead gets a turnaround and a
-- one-scene extra gets nothing. Tags are the segmenter's own answer
-- (`char:` / `obj:` / `loc:`); films made before the tags existed still
-- carry names in Prompt Vizual, which Cast Sheet Prep matches instead.
select s.id, s.scene_order, s.tags, s.visual_prompt
  from hov.scene s
 where s.project_id = $hov${{ $('Receive Batch Input').first().json.Project_ID }}$hov$
   and s.scene_approved
 order by s.scene_order
