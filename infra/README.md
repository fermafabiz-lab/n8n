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
