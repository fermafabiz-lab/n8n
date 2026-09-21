-- Everything the model needs to invent the next episode of a show, by id.
-- The site posts nothing but that id (app/api/series-next/route.ts), so what
-- reaches the prompt is what the database holds, never what a browser typed.
--
-- The bible is stored in the Story Bible's own spelling — `name` and
-- `visual_description` per character — so the names come out of the jsonb
-- rather than out of a column. `episode_titles` is every title the show has
-- used, oldest first, which is the list the prompt must not repeat.
select s.id,
       s.name,
       coalesce(nullif(s.premise, ''), s.bible->>'logline', '') as premise,
       coalesce(s.previously, '') as previously,
       coalesce(nullif(s.language, ''), 'English') as language,
       coalesce(s.category, 'story') as category,
       coalesce(s.tone, '') as tone,
       coalesce((select string_agg(c->>'name', ' | ')
                   from jsonb_array_elements(coalesce(s.bible->'characters', '[]'::jsonb)) c), '') as characters,
       coalesce((select string_agg(l->>'name', ' | ')
                   from jsonb_array_elements(coalesce(s.bible->'locations', '[]'::jsonb)) l), '') as places,
       coalesce((select string_agg(p.name, E'\n' order by p.episode_no nulls last, p.created_at)
                   from hov.project p where p.series_id = s.id), '') as episode_titles,
       coalesce((select max(p.episode_no) from hov.project p where p.series_id = s.id), 0) + 1 as next_episode
  from hov.series s
 where s.id = $1
