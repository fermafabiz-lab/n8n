# Playlists — the library, organised by the producer (2026-09-23)

The ask, verbatim: *"As vrea sa creezi un sistem in care sa poti sa creezi
playlist-uri in pagina de proiecte ca sa pot sa imi organizez mai bine
proiectele/videourile … sa pot eu sa numesc folderul/playlistul cum vreau si
sa selectez videourile pe care vreau sa le adaug (cu butonul deja creat de
select)"* — playlists on the projects page, named by the producer, filled with
the existing ☑ Select.

## What it is

A playlist is a **named set of films, and a film can be in any number of
them** — the YouTube sense, which is where these films end up. The producer
said "folder" and "playlist" interchangeably; a folder would have forced "the
Google Maps series" and "to post this week" to fight over the same film, so
membership is its own table.

| piece | where |
|---|---|
| `hov.playlist`, `hov.playlist_project` | `db/013_playlists.sql` — both foreign keys `ON DELETE CASCADE`: deleting a playlist never deletes a film, deleting a film leaves no dangling membership |
| the name rule, the id rule, the chip order | `platform/lib/playlists.ts` — one owner, imported by the page, the actions and the check |
| reads and writes | `platform/lib/data/postgres.ts`, "Playlists (db/013)"; re-exported by `lib/data.ts` for Postgres only (demo mode reads none and writes nothing, like `deleteProjects`) |
| five server actions | `platform/app/actions.ts`, after `deleteProjects`: `createPlaylist`, `addToPlaylist`, `removeFromPlaylist`, `renamePlaylist`, `deletePlaylist` |
| the playlist row | `platform/components/PlaylistBar.tsx` (+ module CSS) |
| "+ Add to playlist" in the select bar | `platform/components/AddToPlaylist.tsx` (+ module CSS) |
| scoping, deep link, select-mode actions | `platform/components/ProjectsGrid.tsx` |
| the pins | `npm run check:playlists` (38) |

**Deliberately NOT `project.tags`**, although that column exists and is empty:
it is the Airtable-compat field `Tag-uri Proiect`, readable and writable by
every n8n node that goes through `/api/at`. Nothing in n8n reads the two new
tables; the site is the only reader and writer.

## How the producer uses it

- **+ New playlist** (the row above the toolbar) → type a name → Enter. The
  playlist is created empty and the library opens in Select with it as the
  destination: tick films — across pages, the selection is held by id — and
  **+ Add N to "…"**. The view then switches to the playlist.
- **☑ Select** anywhere → tick films → **+ Add to playlist** → pick one (each
  row says how much of the selection it already holds; one that has all of it
  is disabled) or type a new name and **Create** — the playlist is born with
  those films in it.
- Choosing a chip narrows everything below it: the status tabs count inside the
  playlist, search searches inside it, the pages page it. The chip's number is
  counted against the library the grid holds, so it is always the number of
  cards it opens to. `?playlist=<id>` makes it linkable; a link to a playlist
  that has since been deleted says so and shows the whole library.
- Inside a playlist, Select adds **− Remove from "…"** (one click, then
  **Undo** in the result line). **Delete** there reads **Delete films** and its
  armed text says *"from the whole library, forever"* — it sits next to Remove,
  and it is the film delete, which also stops every running workflow first.
- **Rename** and **Delete playlist** sit at the end of the row for the playlist
  on screen. Delete arms first and says the films stay.
- An empty playlist shows *"… has no films yet"* with **+ Add films to it**.

Names are refused, never clamped: empty, or over 60 characters (counted in
characters, as Postgres counts them — an emoji is one). Whitespace is
collapsed, invisible characters dropped (the zero-width joiner kept, it holds
emoji together), NFC applied so a Romanian ș typed two ways is one name.
Names are unique ignoring case — checked on the page from the chips it holds,
and by the database's unique index for anything the page could not know about.

## The apply record

`db/013_playlists.sql`, through the throwaway workflow
`zz apply db/013 playlists` (`yyLCpL3Gcvl4pjrK`), **execution 16435,
2026-09-23 12:49:21 UTC, 78 ms**: `new_tables 2 · new_indexes 2 ·
trigger_present 1 · cascading_fks 2 · name_checks 1 · playlist_rows 0 ·
projects 80`. Archived after.

The workflow is **generated** (`make-apply.mjs` → `apply-013.workflow.js`),
the committed SQL embedded byte for byte, wrapped in two things the plain
file cannot say:

- `set local lock_timeout = '5s'` — creating a table that REFERENCES
  `hov.project` takes a brief lock on it. Media Generation `16430` was running
  at the time; had any long transaction held a conflicting lock, a plain CREATE
  would have queued behind it and every pipeline write to `project` would have
  queued behind the CREATE. Five seconds and out instead.
- `reset search_path` — every migration here starts with a session-level
  `set search_path to hov, public` because psql runs it outside a transaction.
  Sent through n8n it would stay on whichever pooled connection ran it. The
  whole string is ONE implicit transaction (simple query protocol), so success
  resets it and failure rolls back every SET with everything else.

Both were rehearsed on the local engine first, including a failure forced
halfway through the script: nothing remained.

**Ownership, checked rather than assumed** (execution 16436, probe archived):
`project`, `series`, `playlist` and `playlist_project` are all owned by `hov`
with no other grants on any of them — so whatever role lets the site write
`project` and `series` every day lets it write these.

**The site half: deploy #180, live 13:02:08 UTC** on merge `e804ae6` (the
trunk tip, checked by ancestry). Deployed at the producer's explicit request
over a running Media Generation — `16430`, parked at the approval gates with
15 voices and 11 images awaiting review and nothing written since 12:56 — and
still `running` four minutes after `web` restarted. Proof that the live page
runs the new code: `pg_stat_user_tables` counts a read of `hov.playlist` on
every render of /projects, and nothing else reads that table. It stood at 3
after the apply (the primary-key and name-index builds, the verify query) and
4 after the first live probe's own `count(*)` at 13:04; it was still 4 at
13:05:50, so nobody had opened the page yet. Anything above 4 is the page —
until a Postgres restart, which resets the counters.

**Rollback**, should it ever be wanted: `drop table hov.playlist_project;
drop table hov.playlist;` — nothing else references them, and no film is
touched.

## How it was verified

Not by reading. **A web session cannot reach the database**, and demo mode has
none — so `db/port/lib/local-pg.mjs` (new, and meant for the next feature too)
runs **PGlite**, Postgres compiled to WebAssembly, with the repo's own
migrations 001–013, serves it over the wire protocol, and the site runs
unmodified on `DATA_BACKEND=postgres` against it:

- **the table rules** on the engine: re-apply idempotent; a case-only duplicate
  refused with 23505; untrimmed and 61-character names refused by the CHECK, a
  60-character name ending in an emoji accepted; deleting a project cascades
  its memberships; deleting a playlist leaves every film (21/21).
- **every flow in Chromium** — `browser/drive.mjs`, 63 checks at 1280×900,
  the database read after every write; `browser/phone.mjs`, 14 at 390px in
  both themes, including contrast measured on the rendered page.

**Looking at the screenshots found three things the assertions did not**, and
each is now fixed and pinned by `check:playlists`:

1. **A playlist given three films showed 0.** The first version refreshed from
   the browser after each write; the refresh fired by the playlist's creation
   landed after the one fired by filling it. Every action now calls
   `revalidatePath("/projects")` so the fresh library rides back in its own
   response through the router's action queue, which runs one at a time.
   Sampled every 50 ms for 3 s afterwards: `0 → 3` in ~100 ms, never back.
2. **The menu opened 40px off the left of the screen.** The select bar wraps
   (it already did before this — 112px tall at 1280, 1440 and 1600 either way),
   which can put "+ Add to playlist" at the far left of a row, where a panel
   hung from the button's right edge has nowhere to go. It now measures the
   button and clamps itself 16px inside the viewport, before paint.
   `position: fixed` was not an option: the toolbar's backdrop-filter makes it
   the containing block for fixed children.
3. **Inside a playlist the select bar ran to x=464 on a 390px phone** — five
   controls in a `nowrap` row, Cancel off the screen and the page scrolling
   sideways. The row wraps now; a laptop sees no change.

And one measured before it could ship: the first colour picks for the two
filled buttons (white on the night `--accent`, white on the night `--red`)
were 3.29:1 and 3.12:1. They use the site's same-in-both-themes primary
gradient (5.01:1) and a fixed red (6.00:1); the chip counts use
`--accent-ink` (9.65 / 6.77:1), not the toolbar's `--accent` (4.09:1 at night).

## Noticed, not changed

**The library toolbar sticks UNDER the nav on a laptop.** It is
`position: sticky; top: 10px; z-index: 5` while the nav ends at 72px with
z-index 100, so once scrolled its first row is hidden and only a wrapped second
row — in select mode, the one holding the buttons — peeks out, washed by the
nav's fade. It predates this change (lessons-site.md says the toolbar is meant
to be "still sticky on a laptop, where it is one 64px row"), so it is a
separate decision; the likely fix is `top: 84px`, the same 84px its own
`scroll-margin-top` already uses to clear the nav.
