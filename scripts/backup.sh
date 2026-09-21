#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$ROOT_DIR"

INCLUDE_MEDIA="false"
OUTPUT_DIR="./backups"

usage() {
  cat <<'USAGE'
Backup der AI Content Factory.

Verwendung:
  scripts/backup.sh [--with-media] [--out VERZEICHNIS]

Optionen:
  --with-media    Auch die grossen Video- und Audiodateien sichern.
                  Ohne diese Option werden nur Datenbank, Konfiguration,
                  Skripte, Untertitel und Vorschaubilder gesichert.
  --out PFAD      Zielverzeichnis (Standard: ./backups)
  -h, --help      Diese Hilfe anzeigen
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --with-media) INCLUDE_MEDIA="true"; shift ;;
    --out) OUTPUT_DIR="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unbekannte Option: $1" >&2; usage; exit 1 ;;
  esac
done

if [[ ! -f .env ]]; then
  echo "Fehler: .env nicht gefunden. Erst 'node scripts/generate-secrets.mjs' ausfuehren." >&2
  exit 1
fi

set -a
source .env
set +a

STAMP="$(date +%Y-%m-%d_%H-%M-%S)"
SUFFIX=$([[ "$INCLUDE_MEDIA" == "true" ]] && echo "full" || echo "meta")
TARGET="${OUTPUT_DIR}/acf-backup-${STAMP}-${SUFFIX}"
mkdir -p "$TARGET"

echo "Backup nach ${TARGET}"

echo "[1/4] Datenbank wird gesichert"
docker compose exec -T postgres pg_dump \
  --no-owner --no-privileges --format=plain \
  -U "${POSTGRES_USER}" "${POSTGRES_DB}" | gzip > "${TARGET}/database.sql.gz"

echo "[2/4] Konfiguration wird gesichert"
cp .env "${TARGET}/env.backup"
chmod 600 "${TARGET}/env.backup"
cp docker-compose.yml "${TARGET}/docker-compose.yml"
[[ -f docker-compose.gpu.yml ]] && cp docker-compose.gpu.yml "${TARGET}/"
[[ -f docker-compose.ai.yml ]] && cp docker-compose.ai.yml "${TARGET}/"

echo "[3/4] Projektdateien werden gesichert"
DATA_PATH="${STORAGE_HOST_PATH:-./data}"
if [[ -d "$DATA_PATH" ]]; then
  if [[ "$INCLUDE_MEDIA" == "true" ]]; then
    tar -czf "${TARGET}/projects.tar.gz" -C "$DATA_PATH" projects
  else
    tar -czf "${TARGET}/projects.tar.gz" \
      --exclude='*.mp4' --exclude='*.mov' --exclude='*.webm' --exclude='*.mkv' \
      --exclude='*.wav' --exclude='*.mp3' --exclude='*.m4a' \
      -C "$DATA_PATH" projects
  fi
else
  echo "  Hinweis: ${DATA_PATH} existiert nicht, uebersprungen"
fi

echo "[4/4] n8n-Daten werden gesichert"
docker compose exec -T n8n tar -czf - -C /home/node .n8n > "${TARGET}/n8n.tar.gz" 2>/dev/null \
  || echo "  Hinweis: n8n laeuft nicht, uebersprungen"

cat > "${TARGET}/MANIFEST.txt" <<MANIFEST
AI Content Factory Backup
Erstellt:        $(date -Iseconds)
Medien enthalten: ${INCLUDE_MEDIA}
Datenbank:        ${POSTGRES_DB}

Wiederherstellung:
  scripts/restore.sh ${TARGET}
MANIFEST

SIZE="$(du -sh "$TARGET" | cut -f1)"
echo ""
echo "Fertig. Groesse: ${SIZE}"
echo "Achtung: env.backup enthaelt alle Secrets. Sicher aufbewahren."
