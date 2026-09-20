# Series Recap — the pipeline writes "what has happened so far"

**Workflow `4jVkQjpr7terqQhY` "Series Recap", published 2026-09-16 15:07 UTC,
active version `34c73844` (2026-09-19, the 80-word rule).** Webhook `POST /webhook/series-recap`, body
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
| `Build Recap Prompt` (Code) | gpt-5.4, one or two sentences, 80 words as a HARD RULE (the wording is measured — see "The word cap" below; do not soften it), past tense, in the film's language, names spelled as the narration spells them. Script capped at 30,000 chars. Returns `[]` (chain stops) when there is no script, no episode number or no series. |
| `Recap Model` (HTTP) | Mirror of `Brief Model` in Expand Brief: `api.openai.com/v1/chat/completions`, `openAiApi` credential `oPGuXelJ6pnDePIs`, `onError: continueRegularOutput`, 120 s timeout. |
| `Parse Recap` (Code) | Collapses whitespace, strips quotes, enforces a word ceiling 25% above the budget by dropping WHOLE SENTENCES (logging `RECAP LONG` if it ever fires), keeps a 1,000-character runaway guard under that, builds `Episode N — Title: summary` and base64-encodes it. Also emits the LIKE pattern `Episode N —%` and logs `RECAP LEN` so the length is measurable from any run. |
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

**A cap is obeyed or ignored according to how it is PHRASED, not according to
the number.** This is the second answer to the question; the first one was
wrong and is kept here because it is the trap.

It asked for "two sentences, at most 60 words" and got about a hundred. Raised
to 100 at the producer's call, it wrote 128 — a clean third over both times, so
it looked like a law: a model overshoots any cap, the number only moves the
length. The producer rejected the consequence rather than the measurement —
*"make the workflow actually generate that much, I'm not going to shorten it by
hand"* — which is a different question: not how much it overshoots, but what
stops it.

Four phrasings, one budget of 80 words, two narrations (the 1.4 KB kids episode
`reciXLwufF2IrLyhZ` and the 11.4 KB Burj Al Arab documentary, the longest script
in the database), three runs each — probe executions **15110** and **15111**:

| phrasing | words written |
|---|---|
| `Two sentences, at most 80 words` | 92, 97 |
| `Write between 55 and 80 words — never more than 80` | 79, 86 |
| `You have a budget of 80 words and cannot spend more` | 78, 77, 73, 81, 77, 77 |
| **`LENGTH IS A HARD RULE … Count the words of your draft before you answer … An answer longer than 80 words is rejected and useless`** | **73, 75, 80, 71, 76, 72** |

The last one is live. Three things in it are load-bearing together — length as
a RULE, the COUNT asked for before the answer, and the CONSEQUENCE of breaking
it — and the range version, which has two of the three, still went over once in
two runs. **Changing the number is free; changing those sentences means running
the probe again.**

The probe is worth rebuilding when that day comes: a throwaway workflow of
Manual trigger → Postgres (load two scripts, the shortest real one and
`order by length(script) desc limit 1`) → Code (emit one item per phrasing per
run) → HTTP (`api.openai.com/v1/chat/completions`, runs once per item) → Code
(count words per item). Twelve calls, three seconds, a few cents.

### The net under it

`Parse Recap` enforces a ceiling of **budget + 25%** (100 words at a budget of
80) by dropping whole sentences from the end, never cutting inside one: a half
sentence still reads like a recap, which is the silent failure. The first
sentence is always kept, so an answer with no sentence boundaries at all falls
through to the 1,000-character runaway guard rather than to nothing.

It has never fired, and that is the point — it exists so a future model or a
future rewording turns up as `RECAP LONG` in a log instead of as a long line in
the producer's field. **If you ever see that line, re-measure the prompt; do not
raise the ceiling.** Every run also logs `RECAP LEN <id>: N words / N
characters, asked for N`, which is the cheapest possible drift monitor.

`node db/port/series-recap/check.mjs` (wired into `npm run check` as
`check:recap`) holds 18 assertions over the two committed bodies: that the
prompt still states the rule, asks for the count and names the consequence;
that an ordinary answer passes through untouched; that an over-long one is cut
at a sentence end and logged; and that the ceiling follows the budget rather
than being a second number that can drift away from it.

### What it costs downstream

At ~450 characters a line, `composeSeriesLore`'s 8,000-character Lore cap starts
dropping the OLDEST recap lines at about episode 17 — against about 11 at the
100-word cap, and about 13 at the old 60. Oldest-first, newest kept, so it
degrades gently either way.

**Verified live** on the producer's own show `recQ9U0eHndN8HIXf`, execution
**15114** (webhook, 1.8 s): the Episode 1 line was rewritten to **71 words / 405
characters**, where the same episode had produced 717 characters an hour
earlier. It names Pip, Momo and Tilly, the muddle, what Pip did about it and how
it ended.

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
