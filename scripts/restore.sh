#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$ROOT_DIR"

if [[ $# -lt 1 ]]; then
  cat <<'USAGE'
Wiederherstellung eines Backups.

Verwendung:
  scripts/restore.sh VERZEICHNIS [--with-env]

Optionen:
  --with-env   Auch die gesicherte .env zurueckspielen.
               Nur noetig, wenn ENCRYPTION_KEY verloren ging.

Achtung: Die aktuelle Datenbank wird ueberschrieben.
USAGE
  exit 1
fi

BACKUP_DIR="$1"
WITH_ENV="false"
[[ "${2:-}" == "--with-env" ]] && WITH_ENV="true"

if [[ ! -d "$BACKUP_DIR" ]]; then
  echo "Fehler: ${BACKUP_DIR} existiert nicht" >&2
  exit 1
fi

if [[ ! -f "${BACKUP_DIR}/database.sql.gz" ]]; then
  echo "Fehler: ${BACKUP_DIR}/database.sql.gz fehlt" >&2
  exit 1
fi

echo "Die aktuelle Datenbank wird vollstaendig ersetzt."
read -r -p "Fortfahren? [ja/nein] " ANSWER
[[ "$ANSWER" == "ja" ]] || { echo "Abgebrochen."; exit 0; }

set -a
source .env
set +a

echo "[1/4] Worker werden gestoppt"
docker compose stop script-worker ffmpeg-worker video-worker subtitle-worker voice-worker image-worker \
  publisher-youtube publisher-tiktok publisher-instagram publisher-facebook backend 2>/dev/null || true

if [[ "$WITH_ENV" == "true" && -f "${BACKUP_DIR}/env.backup" ]]; then
  echo "[2/4] Konfiguration wird zurueckgespielt"
  cp .env ".env.vor-restore-$(date +%s)"
  cp "${BACKUP_DIR}/env.backup" .env
  chmod 600 .env
  set -a
  source .env
  set +a
else
  echo "[2/4] Konfiguration wird beibehalten"
fi

echo "[3/4] Datenbank wird eingespielt"
docker compose up -d postgres
until docker compose exec -T postgres pg_isready -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" >/dev/null 2>&1; do
  sleep 1
done

docker compose exec -T postgres psql -U "${POSTGRES_USER}" -d postgres -c \
  "DROP DATABASE IF EXISTS ${POSTGRES_DB} WITH (FORCE);" >/dev/null
docker compose exec -T postgres psql -U "${POSTGRES_USER}" -d postgres -c \
  "CREATE DATABASE ${POSTGRES_DB};" >/dev/null
gunzip -c "${BACKUP_DIR}/database.sql.gz" | \
  docker compose exec -T postgres psql -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" >/dev/null

echo "[4/4] Projektdateien werden zurueckgespielt"
DATA_PATH="${STORAGE_HOST_PATH:-./data}"
if [[ -f "${BACKUP_DIR}/projects.tar.gz" ]]; then
  mkdir -p "$DATA_PATH"
  tar -xzf "${BACKUP_DIR}/projects.tar.gz" -C "$DATA_PATH"
fi

echo ""
echo "Wiederherstellung abgeschlossen. Starten mit: docker compose up -d"
if [[ "$WITH_ENV" != "true" ]]; then
  echo "Hinweis: Weicht ENCRYPTION_KEY vom Backup ab, muessen die Social-Media-Konten neu verbunden werden."
fi
