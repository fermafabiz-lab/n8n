# Source watermark — what it is and where it lives

A House of Videos film cuts AI-generated pictures, AI reconstructions and real
archive material into one continuous montage, and until now nothing on screen
told the viewer which was which. The source watermark is the small label in the
bottom-left corner that does: **AI GENERATED**, **AI RECONSTRUCTION**,
**ARCHIVAL FOOTAGE**, **ARCHIVAL PHOTO**, **ACTUAL FOOTAGE**, **ILLUSTRATIVE
FOOTAGE**, **REAL FOOTAGE**, **SOURCE UNVERIFIED**.

It is on by default, per film, and switchable in two places.

## The shape of it

```
selection / generation → classification → stored on the scene → render → label
   (archive attach,       (classifyVisual   (db/009 columns,      (n8n copies
    image approval,        Origin, on the    read back through     it into the
    prompt edit,           site)             hov.at_scene)         render props)
    the producer)
```

The one rule that shapes everything else: **the renderer never decides what a
picture is.** It reads a stored classification. A render that re-derived
provenance could disagree with the record the producer approved, on the one
overlay whose entire job is telling the truth about the picture.

## Every piece

| Piece | Where | Role |
|---|---|---|
| The model, the classifier, the formatters | `platform/lib/provenance.ts` | `VisualOrigin`, `VisualProvenance`, `classifyVisualOrigin`, `refuseFootageType`, `formatSourceWatermark`, `getSourceLabel`, `attributionFor` |
| Storage | `db/009_visual_provenance.sql` | six columns on `hov.scene`; `hov.at_scene` gains one `Provenance` key |
| Read path | `platform/lib/data/postgres.ts` → `buildProvenance` in `derive.ts` | joins the scene's own columns to the `stock_media` row it links to |
| Write paths | `attachStockToScene`, `detachStockFromScene`, `refreshSceneVisualOrigin`, `setSceneProvenance` | every moment the answer can change |
| The brief | `platform/app/new/page.tsx` — the "Source watermark" finish | the film's default, set before it exists |
| Final touches | `platform/components/FinalSettings.tsx` | the same switch, changeable up to the render |
| Per-scene override | `platform/components/FootageTypePicker.tsx` | Documentary, Images step: the producer's own answer |
| The pipeline | `Source Watermark` node in Final Assembly (`BY22Vlhh20Xdkr5Z`) | a lookup: copies the flag and each scene's stored `Provenance` onto the render props |
| The label | `remotion/src/components/SourceWatermark.tsx` + `remotion/src/provenance.ts` | draws it |
| Tests | `npm run check:provenance` (platform), `npm run check:watermark` (remotion) | 58 + 20 cases |

## What the switch does and does not do

Switching the watermark **off** removes the label. It does **not**:

- stop provenance being classified and stored, and
- **not** remove a credit a licence requires.

Those are two systems on purpose — see
[source-watermark-license-separation.md](source-watermark-license-separation.md).

## Deployment

`db/009_visual_provenance.sql` is applied (2026-09-09, through an n8n Postgres
node). Applying it again is harmless: every statement is re-runnable and the
view rename is guarded.

```
docker exec -i n8n-postgres-1 psql -U hov -d hov -f - < db/009_visual_provenance.sql
```

The site tolerates it not being applied — `provenanceReady()` guards the
writes, and the scene read is `select s.*`, so absent columns simply read as an
AI-generated picture. The render then draws nothing.
