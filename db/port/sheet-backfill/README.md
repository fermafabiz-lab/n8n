# The faces were never lost — bringing back the sheets we did not keep (2026-09-18)

## What was believed, and what is actually true

`db/012_series.sql` and `db/port/sheet-ingest/README.md` both say the same
thing:

> Flow hands back a signed URL that dies within hours, so the only durable
> copy is one taken while it is alive.

**The first half is true and the second half is not.** The signed URL dies —
`Expires` is about six hours out — but the ASSET does not, and useapi will
mint a new URL for it on demand:

```
GET https://api.useapi.net/v1/google-flow/assets/{mediaGenerationId}
→ 200 { "url": "https://flow-content.google/image/<uuid>?Expires=…&Signature=…",
        "mediaGenerationId": "user:2923-email:<hex>-image:<uuid>" }
```

Nothing in the repo used that endpoint, and nothing documented it, so a sheet
drawn before the ingest went live (2026-09-17 11:33 UTC) was written off as a
face nobody could show. It was one GET away the whole time.

It was found by accident and by elimination, which is worth recording because
the accident is repeatable. Three GETs were tried against endpoints the
pipeline POSTs to:

| tried | answer |
|---|---|
| `GET /v1/google-flow/assets?email=…` | 405, "Method GET not allowed" |
| `GET /v1/google-flow/images` | 400, "Wrong GET url" |
| `GET /v1/google-flow/assets/fermafabiz@gmail.com` | 400, **"Invalid mediaGenerationId format: fermafabiz@gmail.com"** |

The third error is the find: an endpoint that rejects a value for its FORMAT
is an endpoint that wants a different value in that position, not one that
does not exist. (Note the shape is the same as the upload's — the last path
segment of `assets/…` is the email on POST and the media id on GET.)

## The backfill

Ten sheets, all from `reciXLwufF2IrLyhZ` — the film "Pip and the Blue Scarf"
was started from — three cast, six locations, one object. Every one came back:
500–980 KB of real JPEG, stored under `reciXLwufF2IrLyhZ/sheet/`, and a second
run of the query returns zero rows.

A throwaway workflow, four nodes, archived after the run. It is written out
here rather than exported, because the export would carry a second copy of the
useapi token into the repo:

```
Start (manual)
  → Find Stranded            Postgres, HOV Postgres
  → Ask Flow For A Fresh Link  GET  api.useapi.net/v1/google-flow/assets/{{ $json.flow_id }}
                               Authorization: Bearer <useapi token>, neverError
  → Keep The Bytes           POST http://web:3000/api/media/ingest
                               httpHeaderAuth = HOV Media Ingest, neverError
```

`Find Stranded`:

```sql
select distinct on (q.flow_id) q.project_id, q.kind, q.name, q.flow_id
from (
  select p.id as project_id,
         k.kind as kind,
         t.k as name,
         case when jsonb_typeof(t.v) = 'object' then t.v->>'id' else t.v #>> '{}' end as flow_id
  from hov.project p
  cross join lateral (values ('cast','castSheets'),('location','locationPlates'),('object','objectRefs')) as k(kind, refkey)
  cross join lateral jsonb_each(coalesce(p.editing_options -> k.refkey, '{}'::jsonb)) as t(k, v)
  where p.series_id is not null
     or p.id in (select source_project_id from hov.series where source_project_id is not null)
) q
where q.flow_id like '%-image:%'
  and not exists (select 1 from hov.sheet_media sm where sm.flow_id = q.flow_id)
order by q.flow_id
```

`Keep The Bytes` body — the singular `sheet` form of the ingest route, one
call per sheet, so grouping needs no Code node and a failure is one picture:

```
={{ JSON.stringify({ field: 'sheet',
    projectId: $('Find Stranded').item.json.project_id,
    kind:      $('Find Stranded').item.json.kind,
    name:      $('Find Stranded').item.json.name,
    flowId:    $('Find Stranded').item.json.flow_id,
    url:       $json.url }) }}
```

Three things about the query worth keeping:

- **It reads projects, not series.** `sheet_media.project_id` is a foreign key
  to `project`, and a series-level ref has no project of its own — but every
  one of them also appears on the episode that drew it, so taking the refs
  from `project.editing_options` gives a valid owner for free.
- **`objectRefs` values are bare strings** where `castSheets` and
  `locationPlates` are objects with an `id`. The `jsonb_typeof` branch is not
  defensive; it is the difference between eight sheets and ten.
- **`distinct on (flow_id)`**, because a sheet reused across episodes is one
  picture and `sheet_media.flow_id` is unique.

## When to run it again

It is idempotent — the `not exists` clause means a second run finds nothing —
so re-run it whenever a show's faces are initials. That happens when a series
is started from a film made before 2026-09-17 11:33 UTC; new films keep their
own sheets as they draw them (24 rows and counting since it went live).

**What is owed**: a producer-facing door. Today this needs a session with the
n8n connector. The shape is a `sheet-backfill` webhook on its own workflow and
a button on the series page, which would make "the faces are missing" a thing
the producer fixes themselves. Nothing else is blocked on it.
