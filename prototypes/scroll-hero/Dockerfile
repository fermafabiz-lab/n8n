# The scroll-hero prototype, as the `site-dev` container on the Hetzner box.
# Same shape as platform/Dockerfile and for the same reason: built in GitHub
# Actions (.github/workflows/deploy-site-dev.yml), never on the server, which
# has no RAM to spare for `next build`.
#
# The WebP frame sequence AND the poster are NOT in this image. Caddy serves
# /frames/* off the host (/opt/n8n/frames), so the image stays a few MB and a
# new render of the sequence is an upload, not a rebuild. See .dockerignore.
#
# Nothing in the deploy writes /opt/n8n/frames — the real frames are scp'd
# there by hand and must survive every deploy untouched.

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# The devDependencies carry the Playwright and Lighthouse tooling; none of
# it runs here, but `next build` needs typescript from the same tree, so the
# whole lockfile is installed and only the standalone output is kept below.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

# `output: "standalone"` emits server.js plus its traced deps, but leaves
# public/ and .next/static out — they are served straight off disk.
#
# There is no `COPY public` here, and that is the point: .dockerignore drops
# the whole of public/ (frames AND poster), so the directory does not exist
# in the build context and copying it would fail the build. Next only serves
# what it is given, so an empty public/ keeps the image from answering for
# those paths at all — Caddy does, from /opt/n8n/frames.
RUN mkdir -p public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
# Documentation only: the compose service publishes no port on the host.
EXPOSE 3000
CMD ["node", "server.js"]
