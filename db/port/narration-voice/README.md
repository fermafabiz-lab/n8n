# The voice says what the picture cannot — 2026-09-13

The producer's report: "AI-ul bagă mult din descrierea vizuală a scenei și în
scriptul audio, ceea ce nu este ok — noi nu scriem o carte. Pentru AI-ul care
creează imaginea și videoul descrierea e crucială, dar pentru spectatori nu
are sens și scoate mult din poveste."

They were right, and it was measurable. Everything below was measured before
anything was changed; the numbers are what the thresholds were set against.

## The diagnosis

**Share of a scene's narration content-words that also appear in that same
scene's own shot description** (`measure/overlap.mjs`, seven recent films):

| film | tone | scenes | median | mean |
|---|---|---|---|---|
| Lego chase (2026-09-13, written under the 09-10 profiles) | Dramatic | 23 | **33%** | 34% |
| Peking to Paris, 1907 | Dramatic | 53 | **33%** | 36% |
| Talk in Senate (fiction) | Epic | 41 | **33%** | 37% |
| Burj Al Arab | Educativ | 90 | 22% | 23% |
| Tupac | Conspiracy | 37 | 14% | 15% |
| How NASA was created | Documentary | 9 | 11% | 16% |
| How WW2 started | Documentary | 16 | 6% | 7% |

A third of what the voice says in a fiction film is the shot list read aloud.
The factual films sit at 6–14% because a fact is not a picture.

**Texture and camera words per 100 narration words**, chapters only, against
the producer's own library of real scripts (`measure/scenery.mjs`,
`measure/library.mjs`):

| text | texture / 100 words | sentences opening on scenery |
|---|---|---|
| nine real scripts from the library, 8,144 words | **0.0** | 0% |
| Lego chase | **1.60** | 22% |
| Talk in Senate | 0.47 | 4% |
| Peking to Paris | 0.18 | 4% |
| the three factual films | 0.00 | 0% |

Real scripts carry NO texture words. "The road climbs above the river, slick
and narrow under flashing lamps" / "sparks spit through spray" is a sentence
no human narrator ever says, because the viewer is looking at the road.

### The four causes, in the pipeline

1. **The writer was handed the whole Story Bible** — every character's
   wardrobe, every location's geometry, the palette, the lighting plan: 1,530
   words of visual description for a 404-word script. A writer who can see
   the wardrobe describes it.
2. **The outline's chapter plan was itself a shot list** ("the cruiser scrapes
   the guardrail and sheds speed while the Ferrari surges ahead on spray"),
   and the writer was told to follow it.
3. **The 09-10 genre profiles asked for it in as many words.** Cinematic:
   "The sentence is a SHOT — what is in frame, what moves"; Dramatic: "Lines
   land on the concrete — an object, a gesture, a distance"; Emotional:
   "hands, objects, weather, what is left on a table". The Lego film is the
   only one written under those profiles and it has the worst numbers.
4. **Length was a floor, not a ceiling.** `Narration Guard` sent a draft under
   90% of target back to be lengthened, and by then repetition, inventories,
   glossary and meta were all COUNTED — so the padding went to the one outlet
   still unmeasured: the picture spoken aloud. The lesson from the repetition
   guard, a second time: if the only thing you measure is length, length is
   what you get, and it arrives through whatever you did not measure.

## What changed

### Claude Scripting `gkEtGMecv4TC3ZHp` — active `b2d90d70` (was `05bf7412`)

Exactly six nodes differ; `code/` holds the new bodies, `original/` the live
ones they replaced, byte-verified both ways.

| node | change |
|---|---|
| `Generate Outline` | the STORY BIBLE block becomes WHO AND WHERE — logline, era, character names + roles, place names, object names, NOTHING visual; `chapter_summary` is a STORY plan, not a shot list (with a worked example of each); ENDS WITH / LEADS INTO are events, never pictures; the word budget is a CEILING ("never plan filler") |
| `Write Full Narration` | same stripped WHO AND WHERE; rule 3 forbids descriptive sentences outright; rule 12's particulars drop "a material"; **new rule 16** THE VOICE SAYS WHAT THE PICTURE CANNOT (place/time may be NAMED, never described; silent film excepted); LENGTH is "AT MOST 1.1× … a CEILING, not a target … when the story is told, STOP" |
| `Edit Full Narration` | new rule 2b DESCRIPTION (replace with intent/stake/cost/cause/consequence or cut); LENGTH "at most 1.12× … if short, add EVENTS only where the plan holds an untold one; otherwise LEAVE IT SHORT" |
| `Segment Chapter Into Scenes` | rule 5: the narration no longer describes the picture, so the segmenter DECIDES the shot from the event the line is about — "never the sentence illustrated word by word" |
| `Voice Mode` | the cinematic beat-sheet rules say in words that they REPLACE rule 16 (a silent film's text IS the picture plan) |
| `Narration Guard` | length floor 0.9 → **0.55** of target (only a broken draft goes back for length); new DESCRIPTION check — fires when texture words ≥ 0.4/100 and ≥ 4, or camera words ≥ 2, or ≥ 12% and ≥ 4 sentences open on scenery; same `editorFeedback` path, same `MAX_RETRIES = 2`, skipped for silent and dialogue films like every style check |

`measure/guardcheck.mjs` runs the guard's own regexes over the seven films:
it FIRES on the Lego chase (5 texture, 22% scenery) and on Burj (3 camera
words — "its silhouette can stand alone against sea and sky", "the camera
enters the atrium", all three real defects) and stays quiet on the two
documentaries, Tupac, the Epic and Peking.

### `hov.genre_profile` — `genre_profiles.sql`, applied 2026-09-13 16:55 UTC

- Cinematic, Dramatic, Epic, Emotional: the screenplay sentences replaced with
  the decision/cost vocabulary; every "image" in a structure is now an event
  or a consequence (Cinematic 2/5, Dramatic 5, Epic 4, Educativ 1/5 + hook,
  Motivational 5).
- Dark and Horror keep sound, smell and temperature — the senses the picture
  has no access to — and drop "texture"; "never what is visible, the picture
  owns that".
- Educativ drops "a material" from its particulars.
- **One SHARED clause appended to all 11 voices**, idempotently: "THE VOICE
  SAYS WHAT THE PICTURE CANNOT … A place or a time may be NAMED, never
  described …". Rollback: `original/genre_profiles.rollback.sql` (the 09-10
  rows, generated on the box with `format('%L')`).

### What did NOT change
- The bible is still generated in full and still reaches the SEGMENTER and
  every image path — the image pipeline needs every word of it. Only the two
  WRITING prompts see the stripped view.
- The hook chain, the research chain, the motif chain, the site.
- `Genre Profile`'s built-in FICTION fallback (used only when a tone matches
  no row) still carries the old screenplay wording; every real tone has a row.

## Producer's decisions (2026-09-13)
1. For fiction, the voice says what the picture cannot: the decision, the
   stake, the cost, what goes wrong. The picture carries the action.
2. A place or a time may be named, never described.
3. A film shorter than ordered is acceptable when the story runs out; length
   is a ceiling.

## Apply record
- Draft staged with one `update_workflow` (six `setNodeParameter` ops),
  diffed against active `05bf7412`: exactly those six nodes differ, each only
  in `text`/`jsCode`, connections and settings identical, all three Drive
  nodes keep resource/operation, no dangling `$('…')`, every body
  byte-identical to `code/`. Published with `versionId: b2d90d70`.
- SQL applied through a throwaway runner (`IwbFqzh75gomrqM4`, archived after);
  read back: all 11 rows carry the shared clause, `updated_at` 16:55:19.
- First film: below.
