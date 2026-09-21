# Series Next — the brief proposes the show's next episode

**Workflow `f3iV6hx39rSr0Dbx` "Series Next", published 2026-09-21, active
version `b892a026`.** Webhook `POST /webhook/series-next`, body
`{ series_id, language }`, answers `{ title, idea }`. Called by
`platform/app/api/series-next/route.ts` behind the
"✨ Suggest episode N" button on `/new?series=<id>`. Plain path on the same
host, so the site's derive-by-last-segment rule finds it.

## Why

The producer opened the brief from a series and got what looked like a new
film: the page said "Start a video", the title field was empty, and there
was nothing to say where to start. Their words: *"nu ti da indicatii de
unde sa pornesti… simt ca e foarte vag."* A show knows its own cast, its
places and what has already happened — so the button asks it.

## The chain

```
Episode Webhook → Load Series → Build Episode Prompt → Episode Model → Parse Episode → Respond Episode
```

| Node | What it does |
|---|---|
| `Load Series` (Postgres) | The show by id: premise (or the bible's logline), the recap, the cast and place NAMES out of the bible jsonb, every episode title already used, and the next episode number. `alwaysOutputData` so an unknown id still reaches the rest. |
| `Build Episode Prompt` (Code) | gpt-5.4, `response_format: json_object`. Existing characters by their exact names; at most one new character or place; do not contradict or retell the recap; **do not end the series**. Never returns zero items — an unknown id travels as `skip`. |
| `Episode Model` (HTTP) | Mirror of `Brief Model` in Expand Brief: OpenAI credential `oPGuXelJ6pnDePIs`, `onError: continueRegularOutput`, 60 s. |
| `Parse Episode` (Code) | Parses the JSON, and retries once on the first `{…}` block if the model wrapped it in prose. No title means no suggestion, and the form keeps whatever was typed. |
| `Respond Episode` | `{ title, idea }` — always, including for a `skip`. |

Bodies live in `paste/`; `gen.mjs` composes `series-next.workflow.js` from
them for `validate_workflow` + `create_workflow_from_code`.

## Verified

Against the producer's real show **Pip and the Blue Scarf**
(`recQ9U0eHndN8HIXf`, 1 episode, 3 characters, a recap written by
`series-recap`):

- Execution **15787** (4.0 s) → *The Missing Blue Scarf*, using Pip, Momo
  and Tilly by name and the meadow's own places.
- Execution **15789** (4.4 s), `language: "Română"` → *Fularul Albastru
  Dispărut*, Romanian prose, character names kept in their exact stored
  spelling (they are what the sheets are keyed by).
- Execution **15790** (0.25 s), an id that does not exist → `{title: null,
  idea: null}`. The button reports "couldn't think of one" instead of
  spinning for seventy-five seconds.

Two fixes came out of those runs, and both are in the paste file:

- **The bible's place names are production labels** ("Sunny Clover Meadow —
  building site"), and the first answer pasted them into sentences. The
  prompt now asks for prose and for places named the way a story would.
- **The posted language beats the stored one.** The node read
  `r.language` — the series' column — so a Romanian brief was answered in
  English. The picker opens on the show's language anyway, so the two agree
  until the producer changes it, and a change is exactly the instruction
  this button should follow.

## Known limits

- One suggestion per press, no "give me another" without pressing again.
- The idea only fills the direction box when it is EMPTY: a producer who
  already wrote their own direction does not lose it to a title suggestion.
- It cannot see the episodes' scripts, only their titles and the recap.
