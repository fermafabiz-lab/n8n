# Measurement scripts

All four read `scenes.json` from the current directory: one row per scene,
`{name, tone, scene_order, narration, visual_prompt}` — the query that
produced it, run through a throwaway n8n workflow (this box has no route to
the database):

```sql
select p.name, p.tone, s.scene_order, s.narration, s.visual_prompt
from hov.scene s join hov.project p on p.id = s.project_id
where p.id in (…seven recent projects…) order by p.created_at, s.scene_order;
```

`library.mjs` reads `lib.json`: `{title, tone, chunk}` rows from
`hov.script_library` (the first ~900 words of each transcript, SRT cues still
inside — the script strips them the way `cleanTranscript` does).

- `overlap.mjs` — per scene, the share of narration content words (4+ letters,
  stop-words out) that also appear in the SAME scene's `visual_prompt`. The
  headline number of the diagnosis.
- `scenery.mjs` — texture words and camera words per 100 narration words, and
  the share of sentences opening on scenery, chapters only (`scene_order >= 100`).
- `library.mjs` — the same two densities over the real scripts, the baseline.
- `guardcheck.mjs` — runs the DESCRIPTION check exactly as `Narration Guard`
  carries it (the regexes are read out of `../code/cs-Narration_Guard.txt`, so
  the two cannot drift) over the seven films, and prints FIRE / ok per film.
