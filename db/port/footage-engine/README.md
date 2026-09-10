# Universal Footage Engine — the n8n and database half

Applied 2026-09-09, extended 2026-09-10. The site half is
`platform/lib/footage/` and is documented in
`docs/universal-footage-engine.md` and its siblings; the sources
themselves are catalogued in `docs/footage-sources.md`.

## Database

### db/010 (2026-09-09)

`db/010_universal_footage.sql`, applied through a throwaway n8n workflow
(`zz apply db/010 universal footage`, `iZR5m5OLnRIr27VA`, execution 11567,
archived after). `Verify 010` answered:

```
new_columns 19 · provider_check_left 0 · status_table true · cache_table true
library_rows 178 · backfilled_video 18 · backfilled_photo 160 · at_scene_rows 740
```

No `at_*` view changed. The migration is idempotent (`if not exists`
everywhere, constraints dropped before being re-added), so it can be
re-run.

### db/011 (2026-09-10)

`db/011_footage_sources.sql` — table and column comments that no longer
name retired providers, and one index
`stock_media_provider_media_idx (provider, media_type, created_at desc)`.
Nothing to migrate: db/010 had already made `provider` a free string, so
the nine providers added that day file rows with no schema change. Applied
through the repurposed probe workflow (`zz apply db/011 footage sources`,
`3J0twb7l79ykDkH3`, execution 11848, archived after); `Verify 011` reads
both comments and the index back.

### Rollback

The columns are additive and the site reads them only when
`footageReady()` sees `stock_media.provenance`. To roll the schema back:

```sql
set search_path to hov, public;
drop index if exists stock_media_provider_media_idx;
drop table if exists footage_search_cache;
drop table if exists footage_provider_status;
alter table stock_media
  drop column if exists preview_url, drop column if exists footage_format,
  drop column if exists origin, drop column if exists filming_date,
  drop column if exists publication_date, drop column if exists location,
  drop column if exists country, drop column if exists event_name,
  drop column if exists people, drop column if exists organizations,
  drop column if exists rights_text, drop column if exists provenance,
  drop column if exists provenance_confidence, drop column if exists availability_status,
  drop column if exists media_path, drop column if exists content_hash,
  drop column if exists verified_at, drop column if exists verified_note,
  drop column if exists notes;
-- The old three-way provider CHECK is deliberately NOT restored: rows from
-- the new providers would make it fail, and nothing depends on it.
```

Rows filed by the newer providers (`eu_av`, `dvids`, `nasa`,
`internet_archive`, `europeana`, `loc`, `wellcome`, `flickr`, `openverse`,
`pexels`, `pixabay`, `unsplash`, `url_import`, `user_upload`) survive a
schema rollback as plain library rows.

## n8n: `Archive Suggestions` (`Lo78uXXCFYoIH73r`)

| | version |
|---|---|
| active since 2026-09-10 | `a3278855-7c67-4e1f-960f-5ef7168d1127` |
| active 2026-09-09 → 09-10 | `6b5a1417-2828-4e1d-ae0b-28ea1b6a454a` |
| active 2026-09-07 → 09-09 | `6ac5f5f1-e0b7-4f34-8fd2-b5e50af9062b` |

09-09 changed three Code nodes — `Build Query Prompt`, `Parse Queries`,
`Build Rank Prompts`; 09-10 changed `Build Query Prompt` alone (the system
prompt names the new sources and adds the `stockshots` footage type). Each
time the draft was diffed node by node against the active version before
publishing and only the intended nodes differed. `nodes/` holds the exact
`jsCode` of each; `dump.mjs` prints them JSON-encoded for pasting into an
`updateNodeParameters` operation; `verify.mjs <workflow.json>` diffs a
fetched workflow against them byte for byte.

### Rollback

`restore_workflow_version { workflowId: "Lo78uXXCFYoIH73r", versionId:
"6b5a1417-2828-4e1d-ae0b-28ea1b6a454a" }` then publish it (or `6ac5f5f1…`
for the 09-07 prompt). The site's `/api/archive/suggest` accepts every
shape the three prompts produce, so the workflow can be rolled back on its
own.
