# Series Recap — the pipeline writes "what has happened so far"

**Workflow `4jVkQjpr7terqQhY` "Series Recap", published 2026-09-16 15:07 UTC,
active version `238ce853` (2026-09-19, the 100-word cap).** Webhook `POST /webhook/series-recap`, body
`{ project_id }`. Fired by `approveScript` in `platform/app/actions.ts`
(through `onEpisodeScriptApproved`) for a project that is an episode of a
series — fire-and-forget, 8 s timeout, the site never waits on it. Same
host as `new-project`, plain path, so the site's derive-by-last-segment rule
finds it.

## Why

A series (`db/012`, `platform/lib/series.ts`) carries `previously`: the
running recap the next episode's writer is told not to contradict and not
to retell. Until today the producer had to type a line after every
episode. Now the line is written the moment the script is approved.

## The chain

```
Recap Webhook → Load Episode → Build Recap Prompt → Recap Model → Parse Recap → Append Recap
```

| Node | What it does |
|---|---|
| `Load Episode` (Postgres) | One row when the project has `series_id`, none otherwise — an ordinary film stops here. The narration is the NEWEST `hov.script` row, the same rule as `getProjectScriptInfo`. **Not** `project.full_narrator_script` / `edited_narrator_script`: both are empty on all 81 films since the cutover; nothing writes them. |
| `Build Recap Prompt` (Code) | gpt-5.4, two sentences, at most 100 words (60 until 2026-09-19 — see "The word cap" below), past tense, in the film's language, names spelled as the narration spells them. Script capped at 30,000 chars. Returns `[]` (chain stops) when there is no script, no episode number or no series. |
| `Recap Model` (HTTP) | Mirror of `Brief Model` in Expand Brief: `api.openai.com/v1/chat/completions`, `openAiApi` credential `oPGuXelJ6pnDePIs`, `onError: continueRegularOutput`, 120 s timeout. |
| `Parse Recap` (Code) | Collapses whitespace, strips quotes, cuts the summary at 1,000 characters, builds `Episode N — Title: summary` and base64-encodes it. Also emits the LIKE pattern `Episode N —%`. The cut is a runaway guard and must stay well clear of the word cap — see below. |
| `Append Recap` (Postgres) | One statement: every existing line for THIS episode number is dropped, blank lines are dropped, the new line is appended. So approving twice REPLACES rather than doubles, and two episodes approved in the same minute cannot lose each other's line. |

Bodies live in `paste/`; `gen.mjs` composes `series-recap.workflow.js` from
them for `validate_workflow` + `create_workflow_from_code`. Change a paste
file, regenerate, apply through `setNodeParameter`, byte-compare the
read-back, publish with the explicit `versionId`.

## Verified

Execution `13951` (manual, 2.4 s) on a throwaway episode
(`recksVlE6Qax2JfoN`, series `recB1vUbnVeJNfY5c`, script copied from the
clay-builders test film `rec78haMNefc8xaWs`, seeded with two lines:
`Episode 1 — Old line…` and `Episode 10 — Other line…`):

- `Load Episode` returned the 1,030-character script from `hov.script`.
- `Recap Model` answered with `gpt-5.4-2026-03-05`, 97 completion tokens.
- `Parse Recap` produced `Episode 1 — zz recap test episode: At dusk in the
  Clay Builders' Yard, Marn abandoned three separate houses…`.
- `Append Recap` returned `previously_length: 493` = the new line (447) +
  the untouched `Episode 10` line (45) + one newline: **the old `Episode 1`
  line was replaced, `Episode 10` stayed** — `Episode 1 —%` does not match
  `Episode 10 —`.

Both throwaway rows were deleted afterwards (cleanup workflow), so
`hov.series` is back to whatever real shows exist.

## The button (2026-09-18)

The chain only ever ran FORWARD — `approveScript` fires it when an episode's
script is approved. **Episode 1 of every show is the film the show was
started from, and its script was approved before the show existed**, so every
show opens with an empty recap and no way to fill it but typing. That is not
an edge case; it is the first line of every series.

`writeRecapFromEpisodes` (`platform/app/actions.ts`) and the "✎ Write it from
the episodes" button under the field in `SeriesNotes` fix that: it fires this
webhook for every episode of the show, waits, and puts the text back in the
field.

Three things it has to do because of how this chain behaves:

- **It watches the row; it does not trust the answer.** `Recap Webhook` is
  `responseMode: onReceived`, so HTTP 200 means "n8n started", not "a line
  was written". The action polls `hov.series.previously` every 2s for up to
  30s and reports what it actually finds.
- **It stops on a clock, not on a count.** An episode whose script was never
  approved produces NO line — `Build Recap Prompt` returns `[]` — so waiting
  for one line per episode would hang on exactly the shows this exists for.
- **It writes the text back into the field.** Revalidating the page does not
  reach `SeriesNotes`'s own state, so the producer would press the button and
  watch nothing happen. The action returns the new `previously` and the
  component sets it.

Pressing it twice is safe for the same reason approving twice is: `Append
Recap` replaces the line for an episode NUMBER. A note the producer typed
that is not in `Episode N — …` shape is left alone. The button is disabled
while the field has unsaved edits, since it would overwrite them.

Verified on the real show `recQ9U0eHndN8HIXf` ("Pip and the Blue Scarf",
`previously` 0 characters): the webhook fired for its one episode
`reciXLwufF2IrLyhZ` and 25 s later the row read 591 characters, one
`Episode 1 — …` line naming Pip, Momo and Tilly as the narration spells them.

## The word cap (2026-09-19)

**The cap is a suggestion the model overshoots by about a third, in both
directions — so it MOVES the length, it does not hold it.** Measured twice on
the same real episode (`reciXLwufF2IrLyhZ` of "Pip and the Blue Scarf"),
everything else unchanged:

| asked | written | line on the row |
|---|---|---|
| 60 words | ~100 words | 591 characters |
| 100 words | 128 words | 717 characters |

The first row is why the number was raised: the instruction said 60 and was
describing something that had never happened, so it bought nothing. 100 was
the producer's call and it is the better instruction for the job — the next
episode's writer reads this line to avoid contradicting and avoid retelling,
and neither is possible if the events are not named. The 100-word line names
the Golden Acorn Toolbox and the Little Red Builder Wagon, which the 60-word
one did not.

Two things move with it:

- **`Parse Recap`'s character cut, in the same commit.** It was 600, which the
  717-character line would have chopped mid-sentence — and a truncated recap
  still READS like a recap, which is the worse failure. It is 1,000 now: not a
  budget, a runaway guard, sized to clear the next drift as well. **Any future
  change to the word cap has to move this with it**, and by a margin, because
  of the overshoot in the table.
- **The Lore trim comes sooner.** At 717 characters a line, `composeSeriesLore`'s
  8,000-character cap starts dropping the OLDEST lines at about episode 11
  rather than about 13. It is oldest-first and keeps the newest, so it degrades
  gently — but a show heading past ten episodes is the moment to revisit this,
  not before.

## Where the recap goes

`composeSeriesLore` (`platform/lib/series.ts`) puts the recap LAST in the
Lore and fits it into the 8,000-character cap that `Normalize Webhook
Input` applies, newest line first — so when a show has more episodes than
fit, it is the OLDEST lines that fall off, never the newest. The producer
can still edit or condense the text on the series page (`SeriesNotes`,
8,000 chars).

## Known limits

- The line is keyed by episode NUMBER. Two projects in one series with the
  same `episode_no` (only possible by hand — `nextEpisodeNo` is max+1)
  would replace each other's line.
- Recap in the film's language (`project.language`, then the series', then
  English). A bilingual show gets a bilingual recap.
- `approveScript` in demo mode (`isConfigured` false) does nothing, so no
  recap either.
