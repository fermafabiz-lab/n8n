# "Recently worked on" — the library in order of last activity (2026-09-23)

The ask, verbatim: *"As vrea ca in pagina de "All films", proiectul pe care il
accesezi ultima data sa apara primul … Dar nu vreau sa apara doar daca te uiti
la el sau ceva de genul, ci atunci cand schimbi ceva sau lucrezi la el. Inainte
de a implementa orice te rog pune-mi intrebari"* — the film last worked on
first; looking does not count, changing does; ask first.

## The questions, and the answers that shaped it

| Asked | Answered |
|---|---|
| Does the pipeline advancing by itself count, or only people? | **It counts** |
| Beyond approvals, edits, regenerations and render — which of these count? | **Pause / Resume / Restart** and **hands-off auto-approvals**. **Not** publishing marks, **not** playlists |
| Same order for the whole team, or per person? | **The same for everyone** |
| Where does it apply? | "The same for all" — **everywhere in the library** — plus **a switch in Settings** back to creation order |

The first answer decided the architecture. Had only people counted, every one
of the site's ~40 writing actions would have needed its own stamp, and the
pipeline's hundreds of writes would have had to be told apart from them. With
the pipeline counting too, "activity" is simply **the last time anything about
the film changed** — which the database already half-knows, because every
table carries an `updated_at` kept by `touch_updated_at()`. What it cannot do
by itself is ignore the two exclusions. Viewing needed nothing: a sweep of the
project page, its API routes and every effect-driven server action found no
write that happens by looking (the only effect-driven writers are hands-off
and the AutoResume watchdog, both of which the producer counts).

The switch is per device — a cookie, like the theme — which was decided rather
than asked, and said so to the producer: "the same order for everyone" is the
data; which order a given screen shows is a preference of that screen.

## How it works

| piece | where |
|---|---|
| `project.activity_at` + the `project_activity` trigger | `db/014_project_activity.sql` |
| the film's activity as SQL — one owner | `platform/lib/data/activity-sql.ts` (`PROJECT_ACTIVITY_SQL`) |
| read on every library render | `getProjects` in `platform/lib/data/postgres.ts` → `Project.activityAt` |
| the stamp for what writes nothing | `touchProjectActivity`, called by `pauseProduction`, `resumeProject`, `restartScripting` (restart = pause + resume) |
| the order, the hold, the cookie | `platform/lib/library-order.ts` (`orderLibrary`) |
| the grid | `platform/components/ProjectsGrid.tsx` — orders the WHOLE library before any playlist/tab/search, so the order carries everywhere |
| the switch | Settings → Customize, `platform/components/LibraryOrderPicker.tsx` |

**The trigger** bumps `activity_at` on any UPDATE of a project row that changes
something other than `editing_options.publishing` (the Publishing panel writes
exactly that one key) and the two timestamps. A write that re-sends identical
values changes nothing and bumps nothing. An explicit stamp is let through.

**The children need no trigger.** Scenes, chapters and scripts are never
written by publishing or by playlists, so their `updated_at` IS their activity:

    greatest(coalesce(p.activity_at, p.updated_at, p.created_at),
             max(scene.updated_at), max(chapter.updated_at), max(script.updated_at))

Computed on read — no scene trigger writes the project row, so there is no new
lock between a scene write and a project write (the check proves the project
row is untouched by a scene approval).

**History, without a backfill.** Existing rows keep `activity_at` NULL, which
reads as `updated_at` — the best history there is, since until today every
write counted. The trigger PINS that value the first time the row is written,
so a publishing mark made after this change cannot leak through `updated_at`.
No default on ADD COLUMN (it would stamp all eighty films with the migration's
moment and tie them at the top) and no backfill UPDATE (it would fire
`touch_updated_at` on every row and overwrite the very history NULL reads).

**The hold.** With the pipeline counting, a film can rise at any 15-second
refresh — and a card that moves between the mouse arriving and the click
landing opens, or ticks, the WRONG film. While the pointer is on the cards or
Select is on, every card keeps its place; a film the list did not have yet goes
to the end, so nothing on screen shifts; the real order returns when the
pointer leaves. The grid says `data-holding` while it holds.

**The card** shows the time the order uses — "Dan · updated 4 min ago" — or the
list would look shuffled: sorted by last change but labelled with creation, the
top card could read "3 days ago" above one reading "2 min ago". Newest first
shows the creation age, exactly as before.

## Verified

- **The rules, on a real engine** — `check-trigger.mjs`, PGlite with 001–014,
  read back through the imported `PROJECT_ACTIVITY_SQL`: 17/17. Publishing on
  an old film and on a new one moves nothing; a status change, a scene approval,
  a chapter, a script, a hands-off switch and an explicit stamp all move it; a
  re-sent identical status does not; playlists never do; a new film is active
  at birth. Breaking the publishing exclusion on either side fails four of them.
- **The joints** — `npm run check:activity`, 32 checks, proved to bite: four
  deliberate breakages, all caught — after the first run showed the publishing
  check matched EITHER side of the comparison and let a one-sided break
  through; it now requires both.
- **The page, in Chromium** — `browser/drive.mjs`, 22/22, twice in a row
  against the same database: opening a film and reading it does not move it;
  editing and saving its script puts it first; the pipeline advancing the
  oldest film brings it to the top; marking Posted and adding to a playlist do
  not move anything; inside a playlist and the Finished tab the film just
  worked on comes first; pointing at a card holds the order across a refresh
  and it moves the moment the pointer leaves; Settings' Newest first restores
  the exact creation order, the switch remembers the device's choice, and it
  fits a 390px phone in both themes.

**Three of the failures on the way were the TEST, and each is worth knowing:**
the hover moved to the grid's box, which started at y=943 in a 900px viewport —
it hovered nothing, the order rightly did not hold, and the check blamed the
product (`hover()` scrolls first); the "just now" check read the first card of
page 2, because the helper that reads the whole library leaves the pager on the
last page; and a second run wrote statuses that were already there, which the
trigger — rightly — did not count as activity, so the test now toggles them.

## Applying it

**db/014 must be on the database BEFORE the site code**: `getProjects` selects
`p.activity_at` with no fallback, so the library would fail to load on a
database without it. The apply workflow is generated from the committed file by
the general `db/port/lib/make-apply.mjs` (the playlists one, made general),
wrapped in `set local lock_timeout = '5s'` — the ALTER takes a brief lock on
`hov.project` that pipeline writes queue behind — and `reset search_path`.
Rehearsed on the local engine including a failure forced halfway (nothing
remained) and a re-apply (skips only).

**Applied live: execution 16480.** The verify read `column_present 1`,
`column_default now()`, `trigger_present 1`, `rows_stamped_since 0`,
`projects 80` — the column, its default and the trigger, and not one existing
film stamped. Two checks on the live engine after it: a same-value UPDATE on
the disposable `recGea91h5CGUvTeB` (execution 16484) went through, pinned the
film's history (`activity_at` = its last write, 2026-09-20 20:05:01) and did
not move it; and the Rome film's own pipeline write at 13:47:28 left
`activity_at` equal to `updated_at` to the microsecond — the trigger bumping
on a real write. The orchestrator error at 13:43:47 that same film shows is
NOT this migration: it is `ManualExecutionCancelledError` raised through the
public API's `stopExecution`, i.e. the site's Restart, with the resume webhook
two seconds behind it.

**The site half: deploy #181, live 13:58:36 UTC** on merge `31f3a82` (the
trunk tip; it contains `4987b26`). Build 13:56:14 → 13:58:18, "Write env,
pull and restart on Hetzner" 13:58:18 → 13:58:36. Deployed at the producer's
explicit request over a running Media Generation — `16497`, the Rome film on
Media Generation `f7f03638` — and unlike the playlists deploy this run was
GENERATING, not parked: a still a minute (scene 206 at 13:55:53, 207 at
13:56:54, 208 at 13:57:52). It survived as an execution — still `running`
afterwards — but wrote nothing from 13:57:52 on: three and a half minutes of
silence by 14:01:28 where it had been writing one still a minute, the gap
opening just as `web` went down. Whether it was caught mid-call or sat in an
image cooldown cannot be read from outside a running execution. The
producer's instruction had covered exactly this — "restart the projects that
are running after the deploy" — and it was the one half this session could
not do: stopping an execution needs the n8n API key, which only the site
holds. The Restart press went back to the producer.

**Proving the live page runs the new code, without shell access.** The old
library query never read `hov.chapter`; the new one reads it once per film
per render (the correlated `max(updated_at)` in `PROJECT_ACTIVITY_SQL`), so
`pg_stat_user_tables` for `hov.chapter` jumps by the number of films (80 on
the day) on every render of /projects, beside `hov.playlist`'s +1. Baseline
after the restart and before anyone had opened the page: `hov.chapter`
idx_scan 2357 / seq_scan 57, `hov.playlist` seq_scan 36 (13:59:46). A Postgres
restart resets the counters.
