# Series — a show with the same cast, film after film (2026-09-16)

The producer's ask, the day before: a channel with a specific cartoon and
specific characters, each with their look, name and traits, so that making
the next video means opening the site, picking the show, and writing the
next episode — and the continuations come out looking like the same show.

## What already existed, one level too low

Every film already builds its own world once: `Generate Story Bible` writes
the characters, objects and locations with ONE appearance each; the
consistency chain (`db/port/consistency/`) draws a reference sheet for each
of them — a turnaround or portrait per character, a product sheet per hero
object, an empty plate per location — and stores the Flow ids on the
project as `castRefs` / `castSheets` / `objectRefs` / `locationRefs` /
`locationPlates`; every scene's image request attaches the matching sheets;
and a judge re-rolls a frame that disagrees with them. `Cast Sheet Prep` and
`Set Plate Prep` both **skip a name that already has a reference**.

So a series is those things hoisted above the project and copied back down
on each episode. **No pipeline node learned what a series is.**

## The two doors into n8n, both already there

- **The bible goes in as Lore.** `Normalize Webhook Input` keeps 8000
  characters of `lore`, and `Generate Story Bible` pastes it in as "CANON
  REFERENCE — treat every fact below as GROUND TRUTH that overrides
  everything else". `composeSeriesLore()` (platform/lib/series.ts) writes
  the show's characters, places, objects, visual style, continuity rules and
  the running recap in that shape, cast first so a cut loses the recap and
  not a face. The new bible keeps the names; the sheets are matched by name.
- **The sheets go in as Editing Options.** The brief posts
  `series: { id, refs }`; `Normalize Webhook Input` (Master Orchestrator,
  now `1bde883f`, was `008f0f47`) stores `seriesId` and the five maps.
  Stored THERE and not by a site write after creation for the same reason
  `createdBy` is: `Merge Ref Into Options` rebuilds the whole blob from that
  node's value on a film with a reference photo. The site still merges the
  same keys after creation as a backstop. Proof in `paste/`: the after body
  is byte-identical in output for a plain film, and stores exactly the five
  keys for an episode (a bad id, an empty map and an unknown key are dropped).

## What is new

| piece | where |
|---|---|
| `hov.series`, `project.series_id` / `episode_no`, `hov.sheet_media` | `db/012_series.sql`, applied through `zz apply db/012 series` (`4CaaSzj7xvtAIzPX`, execution 13935: new_tables 2 · new_columns 2 · trigger 1), archived after |
| the series type, normalizers and the Lore composer | `platform/lib/series.ts` |
| reads and writes | `platform/lib/data/postgres.ts` (series section), re-exported by `lib/data.ts` for Postgres only |
| `/series` — the shows, and "Start a series" from any film with a Story Bible | `platform/app/series/page.tsx`, `components/SeriesStarter.tsx` |
| `/series/[id]` — the cast with their sheets, the places with their plates, the objects, the look and the rules, the show in words, the episodes | `platform/app/series/[id]/page.tsx`, `SeriesCharacter.tsx` (description editable in place), `SeriesNotes.tsx` |
| `/new?series=<id>` — the brief as the next episode | `app/new/page.tsx` (server wrapper, new) + `NewVideoForm.tsx` (the old page, moved); `CategoryPicker.preferredVoice` |
| `createProject` turns the series into Lore + refs, then links the film | `app/actions.ts`; `createSeriesFromProject`, `saveSeriesNotes`, `saveSeriesCharacter` |
| `/api/media/ingest` takes `field: "sheet"` | `apiSchemas.ts`, the route, `media-store.ts` (`MediaField` gains `sheet`) |
| a project page links its show; a finished film offers "Start a series" | `app/projects/[id]/page.tsx` |

## Faces

A sheet's `url` in `castSheets` is Flow's signed link, dead within hours —
which is why the judge skips a sheet it can no longer fetch. So a series page
can show a face only if we kept the bytes while the link was alive:
`sheet_media`, written by `/api/media/ingest` with `field: "sheet"`, keyed by
the Flow id. **The Media Generation half — posting each new sheet there
right after it is made — is the next port** (`db/port/sheet-ingest/`);
until it is live, a show shows initials where its faces will be, and says
so. The sheets themselves are still reused by the pipeline through their
Flow ids; only the picture on the site is missing.

## What happens by itself after every episode (since 2026-09-16, evening)

The producer asked for none of this to be manual. All three happen at ONE
moment — when the episode's script is approved (`approveScript` →
`onEpisodeScriptApproved` in `platform/app/actions.ts`), which is after the
Story Bible exists and before Media Generation reads the references. The
human's Approve and hands-off mode both go through `approveScript`.

1. **Names are reconciled.** Lore is a strong instruction, not a lock:
   the writer is told `USE EXACTLY THESE NAMES` and may still write "Pip
   the Fox" for "Pip". The sheets are keyed by name, so a respelling would
   draw a second face. `reconcileRefsToBible()` (`platform/lib/series.ts`)
   re-keys the episode's `castRefs` / `castSheets` / `objectRefs` /
   `locationRefs` / `locationPlates` to the bible's spelling where the
   match is unambiguous — exact, unique whole-word containment, or a
   unique given name of three letters or more — and writes Editing Options
   only when something changed. A name it cannot match is left alone and
   drawn from text, as before.
2. **New characters, places and objects are written back to the show.**
   `mergeBibles()` adds what the episode's bible introduces and the series
   does not know; a respelling is not new. The series page and the next
   episode's Lore read the union of the show's sheets and every episode's
   (`getSeriesRefsUnion`, earlier episode wins), so a face drawn in
   episode 3 anchors episode 4 without anyone copying it.
3. **The recap is written by the pipeline.** The site POSTs `{project_id}`
   to the `series-recap` webhook (workflow `4jVkQjpr7terqQhY`,
   `db/port/series-recap/`), which summarises the approved narration in
   two sentences and replaces-or-appends the `Episode N — Title: …` line
   on `series.previously`. The producer can still edit the text.

`npm run check:series` pins the matching rules (11 fixtures).

## What a series still does NOT do

- The end screen does not print the channel name (the field exists).
- Reconciliation cannot fix a writer that renames a character to something
  unrelated ("Pip" → "Rusty"): that is a new character to it, drawn from
  text, and added to the show as new. The Lore's exact-names line is what
  keeps that rare.

## What is owed

One real episode: start a series from a finished kids film, open `/new`
from it, write a new idea, and read the new film's Story Bible against the
series page — same names, same descriptions — then check `SHEET PLAN` in
the Media Generation log says the cast was skipped, not drawn again.
