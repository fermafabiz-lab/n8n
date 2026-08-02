# Video Factory — web platform

The web interface for the AI video automation pipeline. Airtable + n8n stay
as the invisible backend; this app is where daily work happens.

Phase A (current): read-only dashboard + production room, reading straight
from the Airtable base that n8n already writes to. No auth yet.

## Deploy on Vercel

1. Import the GitHub repo on vercel.com → **Add New Project**.
2. Set **Root Directory** to `platform` (Framework preset: Next.js — detected
   automatically).
3. Add environment variables:

   | Variable | Value |
   |---|---|
   | `AIRTABLE_API_KEY` | Airtable personal access token (scopes: `data.records:read` **and** `data.records:write`, access to the production base) |
   | `AIRTABLE_BASE_ID` | the `app...` id of the base (visible in the base URL) |
   | `AIRTABLE_PROJECTS_TABLE` | table name/id for projects (default `Proiecte`) |
   | `AIRTABLE_SCENES_TABLE` | table name/id for scenes (default `Scene`) |
   | `SITE_PASSWORD` | optional — locks the whole site behind a shared password |
   | `N8N_NEW_PROJECT_WEBHOOK_URL` | optional — n8n webhook that starts a new project; enables the “New video” form |
   | `AIRTABLE_SCRIPT_APPROVED_STATUS` | optional — Status value the scripting workflow waits for (default `approved`) |

4. Deploy. Without the env vars the app serves demo data, so the UI is
   reviewable before wiring anything.

## Local dev

```bash
cd platform
npm install
npm run dev
```

## Roadmap

- ~~Phase B: approve/regenerate buttons that write the Airtable checkboxes
  n8n polls~~ ✓
- ~~Phase C: new-project form, script review, shared-password gate~~ ✓
- Phase D: Google login (Supabase), multi-user roles, workspaces, Postgres
  adapter.

## Pointing the site at a different n8n instance

Moving between n8n Cloud and self-hosted touches **three** environment
variables on Vercel — every other webhook URL is derived from the first by
replacing the trailing path, so they stay in sync automatically:

| Variable | Value |
| --- | --- |
| `N8N_NEW_PROJECT_WEBHOOK_URL` | `https://<host>/webhook/new-project` |
| `N8N_API_URL` | `https://<host>/api/v1` |
| `N8N_API_KEY` | a key generated on the new instance (Settings → n8n API) |

On the n8n side, two things never travel with an export:

- **Credentials** are encrypted with the instance's own key, so they must be
  re-created and re-attached (Airtable, Google Drive, OpenAI, FAL).
- **`WEBHOOK_URL`** must be set to the public HTTPS address, otherwise n8n
  registers its webhooks under `localhost` and nothing from Vercel reaches
  them.

Verify the whole thing in one command — it checks reachability, that the
workflow ids survived the import (Execute Workflow nodes reference them),
that every webhook the site calls is registered, and which credentials are
still missing:

```sh
N8N_API_URL=https://<host>/api/v1 N8N_API_KEY=... node scripts/check-n8n.mjs
```
