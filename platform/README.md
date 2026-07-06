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
   | `AIRTABLE_API_KEY` | Airtable personal access token (scope: `data.records:read`, access to the production base) |
   | `AIRTABLE_BASE_ID` | the `app...` id of the base (visible in the base URL) |
   | `AIRTABLE_PROJECTS_TABLE` | table name/id for projects (default `Proiecte`) |
   | `AIRTABLE_SCENES_TABLE` | table name/id for scenes (default `Scene`) |

4. Deploy. Without the env vars the app serves demo data, so the UI is
   reviewable before wiring anything.

## Local dev

```bash
cd platform
npm install
npm run dev
```

## Roadmap

- Phase B: Google login (Supabase), approve/regenerate buttons that write the
  Airtable checkboxes n8n polls.
- Phase C: new-project form (replaces the n8n form trigger), script editing.
- Phase D: multi-user roles, workspaces, Postgres adapter.
