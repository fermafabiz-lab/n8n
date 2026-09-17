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

## Edited here first, not yet on the box (2026-09-17)

The `site-dev` service (the scroll-hero prototype,
`prototypes/scroll-hero/README.md`, "Deploy") went into the mirror before
the box, because the session that wrote it had no key. Three things to
carry over, then delete this section:

1. `docker-compose.yml`: the `site-dev` service; on `caddy`, the
   `SITE_DEV_HOST` env var and the `./frames:/srv/frames:ro` mount.
2. `Caddyfile`: the `{$SITE_DEV_HOST}` block — if the box already has one
   for that host, only `handle_path /frames/*` is new.
3. `/opt/n8n/.env`: `SITE_DEV_HOST=<the dev hostname>`.

Then `docker compose up -d caddy` (mount + env → recreate, not reload), run
the **Deploy site-dev** workflow once so the image and the frames exist,
and `docker compose up -d site-dev`.
