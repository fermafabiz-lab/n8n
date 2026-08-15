# Porting the workflows off Airtable

`port-airtable-nodes.mjs` converts a workflow's Airtable nodes into Postgres
nodes that talk to the compatibility layer in `../002_airtable_compat.sql`.

    node port-airtable-nodes.mjs workflows/<id>.original.json          # dry run
    node port-airtable-nodes.mjs workflows/<id>.original.json --write  # writes .ported.json

## These files are the deliverable, not live drafts

**The public API has no draft.** A `PUT /workflows/{id}` on an active workflow
is live the instant it returns — see the section of the same name in
`../../CLAUDE.md`. So the conversion is kept here as files and applied inside
the cutover window, all five at once.

`*.original.json` is a verbatim `GET` from before anything was touched. It is
the rollback, and it is the reason a mistaken PUT cost ninety seconds instead
of an evening. Refresh both sides before the cutover if the workflows have
moved since.

## What it converts, and what it refuses

44 of the 48 Airtable nodes are mechanical:

| Airtable | becomes |
|---|---|
| get | `select id, "createdTime", fields from hov.at_<entity> where id = …` |
| search | the same, with the filter translated (four shapes, all recognised) |
| update | `select * from hov.at_write('<entity>', id, {…}::jsonb)` |
| create | `select * from hov.at_create('<entity>', {…}::jsonb)` |

Node name, id, position, `onError`, `retryOnFail`, `alwaysOutputData`, notes
and `disabled` are carried across untouched. Several nodes are
`onError: continue` deliberately, and re-deriving that would be a second
migration.

**Four nodes are refused, by design:**

    Update Scene Record · Write Scene Image · Write Regen Image · Write Regen Video

They write `"Imagine Scenă": [{url}]` / `"Video Scenă": [{url}]`, and Airtable
went and fetched those bytes itself — which is what kept every asset alive
after fal and Flow's signed links expired. The database cannot do that.
Converting them by dropping the attachment field would leave a scene looking
generated with nothing behind it, so the script names them and stops. They need
a download chain:

    HTTP Request (download) → Write File to /media/<scene>/<field>/<sha>.<ext>
      → Postgres (insert hov.attachment, then at_write for the other fields)

`/opt/n8n/media` is already mounted read-write into the n8n container and n8n
is in the `hovmedia` group, so the write works today.

## Applying them

Inside the cutover window, after the final import:

    curl -X PUT "$N8N_API_URL/workflows/<id>" \
      -H "X-N8N-API-KEY: $N8N_API_KEY" -H 'Content-Type: application/json' \
      -d @payload.json

where `payload.json` is `{name, nodes, connections, settings}` from the
`.ported.json` and **settings is `{"executionOrder": "v1"}` only** — PUT
rejects `binaryMode` and `availableInMCP` even though GET returns them, and the
server merges settings rather than replacing them, so the other two survive.

Rolling back is the same call with the `.original.json`.
