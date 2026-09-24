# The render engine (engine/README.md). Built in GitHub Actions
# (.github/workflows/deploy-engine.yml) and only pulled on the box, like the
# site. No build step: Node 22 runs the TypeScript directly
# (--experimental-strip-types), so the image is the sources plus `pg`.
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production TZ=Europe/Bucharest
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src
USER node
CMD ["node", "--experimental-strip-types", "--no-warnings=ExperimentalWarning", "src/main.ts"]
