# Keeping the sheets — the faces of a series (2026-09-16)

`castSheets[name].url` and `locationPlates[name].url` are Flow's signed
links, dead within hours. The pipeline never needed the picture again — it
attaches sheets by Flow id — but a series page does (`db/port/series/`), and
a face nobody kept is a face nobody can show. This port keeps them: right
after each pass makes its sheets and plates, Media Generation posts them to
the site's `/api/media/ingest` with `field: "sheets"`, which downloads each
one into `/opt/n8n/media/<project>/sheet/<hash>.<ext>` and files a
`hov.sheet_media` row keyed by the Flow id. A sheet reused across episodes
is one row.

## The change (Media Generation `yHG4DBCDjR3RJzav`)

Six nodes, two chains, mirrored (`nodes.json` is the definition; `paste/`
the two Code bodies, each proved offline to emit ONE item always):

```
Save Cast Refs  -> Sheet Ingest Prep -> Sheet Ingest? -[true]-> Ingest Sheets -> Set Plate Prep
                                                      -[false]-> Set Plate Prep
Save Set Plates -> Plate Ingest Prep -> Plate Ingest? -[true]-> Ingest Plates -> Find Audio Folder
                                                      -[false]-> Find Audio Folder
```

Three things are load-bearing:

- **One request per pass, not one per sheet.** `Find Audio Folder` is a
  Drive search that runs once per input item; N ingest items would have
  made N folders' worth of downstream work. The Prep emits one item with
  an `items` array, the HTTP node makes one call, the route answers once —
  and answers 200 even when a sheet fails, reporting it in `results`.
- **The HTTP nodes are `onError: continueRegularOutput`** and the Preps
  never return zero items: everything after them is the rest of the batch,
  and a picture we merely wanted to keep must not end a film's pass.
- **The site must be deployed before this is published**: an older
  `/api/media/ingest` rejects `field: "sheets"` with 400 — harmless
  (continue-on-error), but no faces.

## The apply record

| | version |
|---|---|
| was active (built on) | `0f418e8e-cb4b-4289-a1b0-2c1642d8c064` — `Media Generation.before.json` |
| staged draft | `71b42624-f8a8-4001-adc9-f6919a861293` — `Media Generation.draft.json` |

Both Code bodies read back byte-identical to `paste/`; `diff-workflow.mjs
--expect` the six names `--allow-connections`: added 6, removed 0, changed
0, the edge diff exactly the two removed and ten added lines in
`nodes.json`, all twelve Drive nodes intact, no dangling references. The
two HTTP nodes carry `onError: continueRegularOutput` and were bound to
`HOV Media Ingest` with `setNodeCredential` (the API redacts the binding
on every node, the control `Write Scene Image` included, so binding it is
the only evidence available). Published only after the site deploy that
carries `field: "sheets"`, with no Media Generation execution running.

Rollback: `restore_workflow_version` to `0f418e8e`.
