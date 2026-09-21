FROM node:22-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends tini curl coreutils \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY storage/server.mjs ./server.mjs

ENV DATA_DIR=/data \
    BACKUP_DIR=/backups \
    HEALTH_PORT=9000

EXPOSE 9000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -fsS http://127.0.0.1:9000/health || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "/app/server.mjs"]
