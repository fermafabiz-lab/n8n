# Server config, mirrored

These two files are what actually runs on the Hetzner box under `/opt/n8n`.
They were never in the repo, which meant the only copy of the thing that
serves the site lived on a machine one person can reach.

**This is a mirror, not the source.** Nothing deploys from here yet — edit the
files on the box, then copy them back:

    scp root@157.180.26.66:/opt/n8n/docker-compose.yml infra/
    scp root@157.180.26.66:/opt/n8n/Caddyfile          infra/

Secrets are deliberately absent: `/opt/n8n/.env`, `/opt/n8n/platform.env`
(written by the deploy workflow from GitHub Secrets) and
`/opt/n8n/secrets/hov_db_password` stay on the server.

Remember what `CLAUDE.md` says: Caddy does not reload itself, and env vars are
fixed when a container is created — a change to either file needs
`docker compose up -d <service>`, not a restart.

## The mirror and the box disagree about `site-dev` (2026-09-17)

**The box already had a `site-dev` service before this mirror did.** The
first Deploy site-dev run proved it: `docker compose pull site-dev` and
`up -d site-dev` both succeeded on the box and the log reads `Container
site-dev Creating / Created / Starting / Started`. A service that is not
in the box's compose file cannot be pulled, so the box's copy has one and
this file never saw it.

So the `site-dev` service written here is a *guess at* the box's, not a
copy of it — it was added by a session with no key, expecting the box to
lack it. The two may differ in image tag, healthcheck or mount. **Re-sync
from the box before trusting this file**, with the `scp` above, and delete
this section once it matches.

Verified live on the box the same evening, by an HTTP probe from n8n on
`n8n_net` (throwaway workflow, archived): `http://site-dev:3000/` answers
200 with the hero markup, and `/poster.webp` answers 200 as
`image/webp`, 11,766 bytes, immutable.

**One link is still unverified**: whether Caddy answers `/frames/*` from
`/opt/n8n/frames`, where the deploy workflow puts the WebP sequence. That
needs the `handle_path /frames/*` block in the box's Caddyfile AND the
`./frames:/srv/frames:ro` mount on the box's `caddy` service — both are in
this mirror, neither could be read on the box from here. The container
itself answers 404 for `/frames/frame_0001.webp` by design (the frames are
not in the image), so if Caddy does not serve them the hero shows only its
poster and the canvas never appears. Check with a browser, or from the box:

    docker compose exec caddy ls /srv/frames | head
    curl -sI https://<site-dev-host>/frames/frame_0001.webp

A change to either file needs `docker compose up -d caddy`, not a reload.
