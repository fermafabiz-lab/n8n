# Universal Footage Engine — the n8n and database half

Applied 2026-09-09. The site half is `platform/lib/footage/` and is
documented in `docs/universal-footage-engine.md` and its siblings.

## Database

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

### Rollback

The columns are additive and the site reads them only when
`footageReady()` sees `stock_media.provenance`. To roll the schema back:

```sql
set search_path to hov, public;
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

Rows filed by the new providers (`eu_av`, `dvids`, `nasa`, `url_import`,
`user_upload`) survive a schema rollback as plain library rows.

## n8n: `Archive Suggestions` (`Lo78uXXCFYoIH73r`)

| | version |
|---|---|
| active since 2026-09-09 | `6b5a1417-2828-4e1d-ae0b-28ea1b6a454a` |
| previous active (2026-09-07) | `6ac5f5f1-e0b7-4f34-8fd2-b5e50af9062b` |

Three Code nodes changed — `Build Query Prompt`, `Parse Queries`,
`Build Rank Prompts` — and nothing else; the draft was diffed node by node
against `6ac5f5f1` before publishing. `nodes/` holds the exact `jsCode` of
each; `dump.mjs` prints them JSON-encoded for pasting into an
`updateNodeParameters` operation; `verify.mjs <workflow.json>` diffs a
fetched workflow against them byte for byte.

### Rollback

`restore_workflow_version { workflowId: "Lo78uXXCFYoIH73r", versionId:
"6ac5f5f1-e0b7-4f34-8fd2-b5e50af9062b" }` then publish it. The site's
`/api/archive/suggest` accepts the old prompt's `queries[]` shape as well
as the new `request{}`, so the workflow can be rolled back on its own.
