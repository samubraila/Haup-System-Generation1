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
RUN npm ci --workspace @acf/frontend --include-workspace-root

FROM deps AS build
COPY frontend frontend
RUN npm run build --workspace @acf/frontend

FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime
USER root
RUN rm -f /etc/nginx/conf.d/default.conf \
 && apk add --no-cache curl
COPY frontend/nginx.conf /etc/nginx/conf.d/app.conf
COPY --from=build /repo/frontend/dist /usr/share/nginx/html
RUN chown -R 101:101 /usr/share/nginx/html
USER 101

EXPOSE 8080

HEALTHCHECK --interval=20s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8080/healthz || exit 1

CMD ["nginx", "-g", "daemon off;"]
