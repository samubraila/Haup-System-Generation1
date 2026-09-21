FROM node:22-bookworm-slim AS deps
WORKDIR /repo
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/worker-core/package.json packages/worker-core/
COPY packages/publisher-core/package.json packages/publisher-core/
COPY backend/package.json backend/
COPY frontend/package.json frontend/
COPY workers/script/package.json workers/script/
COPY workers/ffmpeg/package.json workers/ffmpeg/
COPY workers/publishers/youtube/package.json workers/publishers/youtube/
COPY workers/publishers/tiktok/package.json workers/publishers/tiktok/
COPY workers/publishers/instagram/package.json workers/publishers/instagram/
COPY workers/publishers/facebook/package.json workers/publishers/facebook/
RUN npm ci --workspace @acf/worker-core --workspace @acf/backend --include-workspace-root

FROM deps AS build
COPY packages/worker-core packages/worker-core
COPY backend backend
RUN npm run build --workspace @acf/worker-core \
 && npm run build --workspace @acf/backend \
 && npm prune --omit=dev --workspace @acf/worker-core --workspace @acf/backend --include-workspace-root

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    NPM_CONFIG_UPDATE_NOTIFIER=false

RUN apt-get update \
 && apt-get install -y --no-install-recommends postgresql-client tini ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /repo
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/package.json ./package.json
COPY --from=build /repo/packages/worker-core/dist ./packages/worker-core/dist
COPY --from=build /repo/packages/worker-core/package.json ./packages/worker-core/package.json
COPY --from=build /repo/backend/dist ./backend/dist
COPY --from=build /repo/backend/package.json ./backend/package.json
COPY backend/src/db/migrations ./backend/dist/db/migrations

RUN mkdir -p /data /backups && chown -R node:node /data /backups /repo

USER node
WORKDIR /repo/backend
EXPOSE 4000

HEALTHCHECK --interval=20s --timeout=5s --start-period=40s --retries=5 \
  CMD curl -fsS http://127.0.0.1:4000/api/system/health || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/index.js"]
