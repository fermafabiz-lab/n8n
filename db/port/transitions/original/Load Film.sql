-- Everything the plan needs, in one row: what kind of film, what the producer
-- already chose, and every scene's narration in order with its chapter. A
-- scene with no chapter is the cold open (the render's chapter 0), listed so
-- the model sees the whole film but marked so nothing is placed on it.
select p.id,
       p.name,
       coalesce(p.tone, '') as tone,
       coalesce(nullif(p.language, ''), 'English') as language,
       coalesce(p.length_seconds, 0) as length_seconds,
       coalesce(nullif(p.editing_options->>'category', ''), 'story') as category,
       coalesce(p.editing_options->>'graphicStyle', '') as graphic_style,
       coalesce((select json_agg(json_build_object(
                          'order', s.scene_order,
                          'chapter', coalesce(c.ordinal, 0),
                          'text', coalesce(s.narration, ''))
                        order by s.scene_order)
                   from hov.scene s
                   left join hov.chapter c on c.id = s.chapter_id
                  where s.project_id = p.id), '[]'::json) as scenes
  from hov.project p
 where p.id = $1
