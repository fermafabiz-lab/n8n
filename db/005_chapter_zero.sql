-- Chapter zero is the hook, not damage.
--
-- 001 gave every numeric column the same guard, on the strength of the zeroing
-- bug in CLAUDE.md. That bug is real and specific: fifteen n8n nodes mapped
-- `Ordine Scenă`, `Durată Scenă (secunde)` and `Lenght` with no value, and
-- Airtable wrote a literal 0 that destroyed scene ordering and film length.
--
-- It was never about chapters. Scripting numbers the HOOK chapter **0** and
-- counts real chapters from 1 — visible all along in `scene_order`, which is
-- chapter*100 + scene and starts at 1 for the hook's first scene. Generalising
-- the guard to `chapter.ordinal` made a legitimate value uncommittable, and
-- `Create Chapter Records` failed on the first film's first chapter.
--
-- The import compounded it: its num() helper turned every 0 into NULL and
-- reported it as repaired damage, so 47 chapters lost their hook marker on the
-- way in. Those are restored below from `scene_order`, which kept the truth.
--
-- duration_minutes goes the same way. A hook chapter of a dozen words rounds
-- to a small fraction, an empty one to 0, and neither is corruption — unlike a
-- scene with no order, which silently falls out of the batch.

set search_path to hov, public;

alter table chapter drop constraint chapter_ordinal_check;
alter table chapter add constraint chapter_ordinal_check
  check (ordinal is null or ordinal >= 0);

alter table chapter drop constraint chapter_duration_minutes_check;
alter table chapter add constraint chapter_duration_minutes_check
  check (duration_minutes is null or duration_minutes >= 0);

comment on column chapter.ordinal is
  'Airtable: "Ordine". 0 is the HOOK chapter; real chapters count from 1. '
  'NOT the same field as scene.scene_order, whose 0 really is the zeroing bug.';

-- Recover the hook markers the import nulled. A chapter whose scenes all carry
-- an order below 100 is chapter 0 by the chapter*100 + scene rule; anything
-- else takes the chapter number that rule encodes.
update chapter c
   set ordinal = sub.n
  from (
    select s.chapter_id, min(s.scene_order) / 100 as n
      from scene s
     where s.chapter_id is not null
     group by s.chapter_id
  ) sub
 where c.id = sub.chapter_id
   and c.ordinal is null;
