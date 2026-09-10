# Sharper scripts and less repetitive pictures — 2026-09-10

The producer's report, on the Burj Al Arab film (`recUHwTIqrNB6vXBl`, tone
Educativ, 86 scenes): "the scripting and the AI visuals feel too bland and
repetitive … the scenes are extremely repetitive until BAM it shows the
finished building from almost nothing, and the script is very basic and
friendly, not ingenious or captivating at all — does the AI still have access
to the library I made?"

## What was actually happening (execution 11663)

| symptom | cause, measured |
|---|---|
| "basic and friendly" | `Fetch Style Card` matched `Tone='Educativ' OR Category='Educativ'` and took the first 3 rows by insertion order: a Moroccan McDonald's vlog ("McDonald's in Morocco not just place for eating…"), a YouTube Shorts tutorial, and one row that yielded no excerpt. The style card the writer imitated was the vlog's: "conversational and moderately informal… warm and engaging". The producer's own Burj Al Arab transcript was in the library as tone **Corporate** / category **Educational** and never matched. |
| glossary sentences | The Educativ genre profile's voice was "Define a term before using it. One new idea per beat." → "A pile is a long structural element…", "A cantilever is a part that…", five of them. |
| timecodes in the excerpt | All 63 active transcripts are SRT files; nothing stripped cues, so the "REAL EXCERPT" read «67 00:02:39,360 --> 00:02:41,670 Marrakesh…». Since the library was loaded (2026-07-21). |
| meta narration | "Only now does the film move inside", "The camera enters the atrium", "This is turning point four in practical form" — the outline's spine leaking into speech. |
| repetitive pictures | 4 bible locations for 86 scenes; 46 on one plate, 75/86 `tod:day`, 73 prompts with "turquoise". The bible's lighting is ONE value; the set plate anchors every scene to the same picture. |
| "BAM, finished" | The bible had one entry for the tower: "Burj Al Arab Exterior at Completion". Chapter 4 (frame rising) anchored 7 scenes to the FINISHED plate; scene 108 in chapter 1 already showed the complete tower. There was no location for a half-built state. |

## What changed

### Site (`platform/`)
- `lib/style-refs.ts` — `pickStyleRefs` (pinned → tone family → category/look), `cleanTranscript` (SRT/VTT cues out), `toneFamily` (Educativ = Educational, Funny = Fun…). `npm run check:style-refs`, 19 checks.
- `GET /api/style-refs?project=…` — the rows Claude Scripting writes against, Airtable-shaped, transcripts cleaned. Keyed for n8n, cookie for the browser (middleware door).
- `GET /api/style-library` — the active rows for the picker.
- `components/StyleRefPicker` on `/new` (section 02, under Tone): pin up to 3 library scripts → `style_refs` → `Editing Options.styleRefs`.
- `EditingOptions.styleRefs` (derive.ts), `createProject` payload.

### n8n
| workflow | version | nodes |
|---|---|---|
| Master Orchestrator `8CienBFfG6SgbB1A` | `e23b2eb0` (was `161ea5a8`) | `Normalize Webhook Input`: stores `styleRefs` |
| Claude Scripting `gkEtGMecv4TC3ZHp` | `fb65aafe` (was `fd27296a`) | `Fetch Style Card` → `/api/style-refs`; `Prepare Style Block` cleans SRT, logs `STYLE REFS: …`; `Write Full Narration` rules 9–14; `Edit Full Narration` 5b/5c; `Narration Guard` counts definitions (>1), meta lines (≥1), steering openers (≥10% and ≥8); `Generate/Rebuild Story Bible` one entry per STATE for a changing place + lighting progression; `Segment Chapter Into Scenes` picks the state of the chapter, moves the light, `time_of_day` gains overcast/storm; `Validate Evidence Refs` logs `TOD MONOTONY` / `LOCATION MONOTONY` |
| Media Generation `yHG4DBCDjR3RJzav` | `12c73515` (was `3fd53a5f`) | `Set Plate Prep` cap 6 → 10 |

Every draft was diffed node-by-node against the active version before publishing (`diff.py` in the session scratchpad: only the listed nodes differed, connections and settings identical, every Drive node kept its operation, no dangling `$('…')`), and each changed body byte-compared against `code/`.

### Genre profiles (`hov.genre_profile`)
All 11 tones rewritten — `structure`, `voice`, `hook_rule`, `visual` only — so no tone asks for definitions, all forbid meta/signposting, and every `visual` demands the light change between chapters. Applied 2026-09-10 19:01 UTC (`genre_profiles.sql`); rollback in `original/genre_profile.rollback.sql`.

## Guard thresholds, measured before they were set

Over the 14 most recent films (sentences / definitions / meta lines / steering openers):

| film | tone | sent | def | meta | signpost |
|---|---|---|---|---|---|
| Burj Al Arab | Educativ | 143 | 4 | 4 | 11.9% |
| Boyd (Motivational essay) | Motivational | 180 | 0 | 2 | 8.9% |
| Ceaușescu in N. Korea | Documentary | 73 | 0 | 6 | 8.2% |
| Ploiești | Dark | 101 | 1 | 0 | 5.0% |
| the other ten | | | 0 | 0–2 | 0–6.8% |

Definitions fire above 1, meta lines at 1 (every one found was a defect), signposts at ≥10% and ≥8. Same `MAX_RETRIES = 2` and accept-anyway ending as the other checks.

## Rollback
- n8n: `publish_workflow` with the "was" ids above.
- profiles: `original/genre_profile.rollback.sql`.
- site: revert the commit; the n8n `Fetch Style Card` is `continueRegularOutput` + `alwaysOutputData`, so a missing route degrades to "no style reference" exactly as a missing table did.

## First live run after publishing (2026-09-10 19:04 UTC)

A disposable 32-second Educativ project (`recTdqIxXei94goJF`, "TEST disposable
— How the Golden Gate Bridge was built…") was created through the real
`new-project` webhook with `style_refs: ["recH6fHwjDFva1wzv"]` (the producer's
Burj Al Arab transcript). Orchestrator execution 12021, Scripting 12022:

- `Normalize Webhook Input` stored `styleRefs` on the project — read back by
  `Fetch Project Record` inside Scripting. ✔
- `Fetch Genre Profile` returned the rewritten Educativ profile. ✔
- `Fetch Style Card` called `/api/style-refs` on the LIVE site, which does not
  carry the route yet (this branch is not merged into the trunk): the
  middleware answered the login page, `Prepare Style Block` degraded to "No
  style reference available" exactly as designed. The pinned reference is
  verified only up to the project record until the site deploys. ✔ (degraded)
- `Research Tema` died: **"You have no credits remaining"** from OpenAI
  (`org-qkmJQuJ2WnvoIKMr2UJwIJkZ`, model gpt-5.4). Every scripting run is dead
  until the account is topped up; that is not this change. The test project
  is left as it is — `restart-scripting` on it after the top-up (styleRefs
  are on the record, so the restart keeps them) exercises the whole chain.

So the writer/editor/guard/bible/segmenter prompts are published and
byte-verified but have NOT yet produced a film. Watch the first real run for:
`STYLE REFS:` in the log naming the pinned row, a bible with
`"<Place> — <stage>"` entries where the subject changes, no `TOD MONOTONY`
line, and the guard's new feedback lines only when they should fire.
