FROM node:20-bookworm-slim

# System libraries Chrome headless needs to run inside the container.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libnss3 libdbus-1-3 libatk1.0-0 libgbm1 libasound2 \
    libxrandr2 libxkbcommon0 libxfixes3 libxcomposite1 \
    libxdamage1 libatk-bridge2.0-0 libpango-1.0-0 libcairo2 \
    libcups2 fonts-liberation ca-certificates \
    ffmpeg curl \
    && rm -rf /var/lib/apt/lists/*

# yt-dlp standalone binary (no Python needed) — powers /transcript.
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux \
    -o /usr/local/bin/yt-dlp && chmod +x /usr/local/bin/yt-dlp

WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .

# Pre-download Remotion's managed headless Chrome at build time, not on the
# first incoming request (avoids a slow/timeout-prone first render).
RUN npx remotion browser ensure || true

ENV PORT=3000
EXPOSE 3000
CMD ["node", "server/index.mjs"]
