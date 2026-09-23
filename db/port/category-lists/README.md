# Category playlists — the site's own lists beside the producer's (2026-09-23)

The ask, verbatim: *"As vrea sa existe default in momentul in care creezi minim
un video per categorie, un buton pe care sa vezi toate videourile din categoria
respectiva (Kids Story, Story, Documentary, Cinematic)"* — as soon as a category
has at least one film, a button that shows every film of it.

## What it is

One chip per category with at least one film, in the playlist row, right after
"All films" and before the producer's own playlists (a thin rule between the
two groups on a laptop): **📖 Story · 🎥 Documentary · 🎬 Cinematic · 🧸 Kids
story**, each with its count. It opens exactly like a playlist —
`?playlist=category:<id>` — so everything below the row (tabs, counts, search,
pages, the activity order) answers inside it, and a reload or a link keeps it.

| piece | where |
|---|---|
| the lists, derived | `platform/lib/category-lists.ts` (`categoryLists`, `resolveCategoryList`) |
| the chips | `platform/components/PlaylistBar.tsx` (`.cat`, `.icon`, `.sep`) |
| opening one | `platform/components/ProjectsGrid.tsx` — a category list IS `active` |
| pinned | `npm run check:category-lists` (30, of which 24 are the lists) |

## Decisions

- **Derived, not stored.** No table, no action, no n8n: the lists are computed
  from the library on every render, so a new film is in its category the moment
  it exists and there is nothing to keep in step. The producer's playlists live
  in `hov.playlist`; these never touch it.
- **Nobody writes to them.** No Rename, no Delete playlist, no "− Remove from",
  no "Add films to it" — a film joins or leaves a category by what it is filed
  as, in its brief. Inside a category, Select still offers "+ Add to playlist"
  (a documentary into "Season two") and Delete films (from the whole library,
  worded as such, as inside any playlist).
- **A film with no category — or one this site no longer knows — is under
  Story**, which is `getCategory`'s own rule: films made before categories
  existed were made by the pipeline Story IS. Every film is in exactly one list.
- **A category with no films has no chip**; an old link to it says "No Cinematic
  films yet." rather than "that playlist no longer exists". A link to a category
  the site does not know is stale, like a deleted playlist.
- **The ids cannot collide** with the producer's playlists: `category:<id>` is
  never a record id (pinned).
- **A category is what the producer ASKED for** (CLAUDE.md, "`category` is a
  REQUEST"): the Burj Al Arab documentary was filed as Story and appears under
  Story. That is the truth about how it was made, and one click in its brief
  from changing.

## Verified

- `npm run check:category-lists` — the grouping on fixtures (unfiled and
  unknown → Story, empty categories absent, brief order, every film exactly
  once, no id collision) and the joints (Remove/Rename/Delete never for a
  category, Add to playlist lists only the producer's). Three deliberate
  breakages, all caught.
- **The production build in Chromium** against a local engine,
  `browser/drive.mjs`, 26/26: the row reads `All films 22 · 📖 Story 7 · 🎥
  Documentary 9 · 🎬 Cinematic 3 · 🧸 Kids story 3 | Season two 0`; the counts
  add up to the library; Documentary opens to exactly the documentary films,
  keeps them across a reload, shows no Rename/Delete; Select inside it offers
  Add to playlist and never Remove, and a film added from there lands in the
  producer's playlist; the unfiled and the unknown film are under Story; a
  category emptied by the database loses its chip; the empty and the unknown
  links say the right thing; 390px phone in both themes, nothing off the side,
  the rule hidden where the row wraps.
