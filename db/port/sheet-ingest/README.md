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

Rollback: `restore_workflow_version` to the "was active" id below.
