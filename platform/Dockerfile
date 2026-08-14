# The producer's site, built for the Hetzner box that already runs n8n.
# Built in CI, never on the server: the CPX has ~2 GB free and `next build`
# would fight n8n for it.

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
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

# /api/audio-bundle joins a project's per-scene takes into one narration
# file. The takes are separate mp3s on Drive and nothing in the pipeline ever
# keeps a combined track, so the joining has to happen somewhere — here rather
# than on the Railway render server, which would have meant giving the site
# that server's URL and key as two more secrets.
RUN apk add --no-cache ffmpeg

RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

# `output: "standalone"` emits server.js plus its traced deps, but leaves
# public/ and .next/static out — they are served straight off disk.
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
