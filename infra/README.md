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

The same applies to the `{$SITE_DEV_HOST}` block written into the
`Caddyfile` here: **the box already serves that host**, at
`dev.house-of-videos.com`, and it serves `/frames/*` off disk too. So this
block is also a guess at the box's, not a copy of it.

Verified live the same evening by HTTP probes from n8n (throwaway
workflows, archived), inside the network and over the public URL:
`http://site-dev:3000/` and `https://dev.house-of-videos.com/` both answer
200 with the hero markup, the second through Caddy;
`/frames/frame_0001.webp` and `/frames/frame_0100.webp` answer 200 as
`image/webp` (11,766 / 12,492 bytes) with
`cache-control: public, max-age=31536000, immutable`; and
`/frames/frame_0999.webp` answers a plain 404 from Caddy with **no** cache
header, which is the behaviour to preserve — a frame that is missing when
someone visits must not be cached as missing for a year.

**`/opt/n8n/frames` is hand-managed content, not deploy output.** The
poster moved in beside the frames and left the container image, and the
deploy workflow no longer copies anything there — it used to overwrite the
real sequence with this repo's placeholders on every run. Treat the
directory as the producer's, and never add a step that writes to it.

A change to either file needs `docker compose up -d caddy`, not a reload.
