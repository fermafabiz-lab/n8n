-- Put the cafe film recXibIyVuLvMIqy3 back exactly as it was before 2026-09-13 22:47.
-- The backup table was written by apply.sql and verified: 16 rows, all 16 carrying
-- the old "Negative:" tail, 5 carrying a phantom-motion word (quiver / flutter /
-- swinging / tremble), shortest 613 characters.
update hov.scene s
   set motion_prompt = b.motion_prompt
  from hov.scene_motion_backup_20260913 b
 where b.id = s.id
   and s.project_id = 'recXibIyVuLvMIqy3';

-- Proof it went back:
select scene_order,
       length(motion_prompt) as len,
       (motion_prompt ilike '%Negative:%') as has_tail
  from hov.scene
 where project_id = 'recXibIyVuLvMIqy3'
 order by scene_order;

-- Only once you are sure you will not need it again:
-- drop table hov.scene_motion_backup_20260913;
