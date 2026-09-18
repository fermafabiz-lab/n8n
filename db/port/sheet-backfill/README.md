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

## The button (same day)

The one-off above needed a session with the n8n connector, so it became a
door the producer owns: **workflow `IGWjknKcffnGlOmV` "Sheet Backfill"**,
webhook `sheet-backfill`, and "⤓ Bring the pictures back" on the series page
(`SeriesFaces`, `bringBackFaces`).

```
Backfill Webhook (POST sheet-backfill, responseMode lastNode)
  → Find Stranded      the query above, scoped by $1 = series_id
  → Anything Stranded? IF flow_id notEmpty
      ├ true  → Ask Flow For A Fresh Link → Keep The Bytes
      └ false → Nothing Owed  (a Set: ok, brought: 0, note)
```

Four things are load-bearing, and three of them cost a round trip to find:

- **The empty case needs its own branch.** With `responseMode: lastNode` and
  zero rows, n8n answers **HTTP 500 `{"code":0,"message":"No item to return
  was found"}`** — measured, not guessed. A show with nothing owed is the
  common case for this button, so answering 500 to it would make the site
  report a failure for the healthiest possible state. `Find Stranded` carries
  `alwaysOutputData`, the IF splits, and the false arm returns a real body.
  (This is the footgun the SDK reference warns about, used the one way it
  says is correct: the empty case has a branch of its own.)
- **The branch indices were read back before publishing**, per the rule in
  `CLAUDE.md`: `addConnection` takes `sourceIndex`, and an edge that silently
  lands on output 0 makes an If fire both arms with nothing complaining.
- **Publishing is a second step.** After `update_workflow` added the IF, the
  ACTIVE version was still the four-node one — `activeVersionId` said so while
  `get_workflow_details` showed the draft. The webhook served the old graph
  until `publish_workflow` ran again.
- **The count is taken by the SITE, from the database**, before and after,
  rather than read out of n8n's answer. The page renders from those rows, so
  a count taken there cannot disagree with what the producer then sees; n8n's
  body is advisory.

Verified end to end on the real show: one `sheet_media` row deleted by hand,
the webhook fired, HTTP 200 with the sheet ingested, and the row back at
14:20:20 at the same content-addressed path — same bytes, so the delete and
the refetch are provably the same picture. The empty case answers
`{"ok":true,"brought":0,…}` with HTTP 200.

**What is still owed**: nothing for this to work. The two things it
deliberately does NOT do are worth knowing — it will not draw a sheet that
was never drawn (an object gets one only when it appears in two or more
scenes, at most three per film, `Cast Sheet Prep`), and the panel says so
instead of offering a button that could not help; and the useapi token is a
hardcoded header on `Ask Flow For A Fresh Link`, matching the existing
pipeline nodes rather than improving on them — it moves when they all do
(CLAUDE.md, "Rotate the ai33 / Railway / useapi keys").
