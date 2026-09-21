# Fehlersuche

## Erste Schritte

```bash
docker compose ps                        # Welcher Container ist nicht healthy?
docker compose logs --tail 50 backend    # Logs des betroffenen Dienstes
node scripts/preflight.mjs               # Voraussetzungen prüfen
```

In der Oberfläche: **System → Dienste** zeigt jeden Container mit Grund, falls
etwas fehlt. **System → Logs** zeigt die Meldungen aller Container gefiltert
nach Quelle.

---

## Start

### Backend startet immer wieder neu

```bash
docker compose logs backend | tail -30
```

| Meldung | Lösung |
|---|---|
| `ENCRYPTION_KEY muss genau 64 Hex-Zeichen` | `node scripts/generate-secrets.mjs --force` |
| `Diese Werte stehen noch auf dem Platzhalter` | `.env` ausfüllen, siehe Meldung |
| `JWT_SECRET muss mindestens 32 Zeichen` | Wert verlängern |
| `Migration ... wurde nach dem Anwenden verändert` | Bereits angewendete Migration zurückändern, neue Datei anlegen |
| `ECONNREFUSED postgres:5432` | `docker compose up -d postgres` und Health abwarten |

### Port 3000 ist belegt

```ini
FRONTEND_PORT=3100
```

Dann `docker compose up -d frontend`. Bei geändertem Port auch `APP_URL`
anpassen, sonst stimmen die OAuth-Rückleitungen nicht.

### Frontend zeigt nur eine leere Seite

```bash
docker compose logs frontend
curl -I http://localhost:3000
```

Meist ein abgebrochener Build. `docker compose build --no-cache frontend`.

---

## Anmeldung

### Passwort unbekannt

Es steht in der `.env` unter `ADMIN_PASSWORD`. Neu setzen:

```bash
docker compose exec backend node -e "
const bcrypt = require('/repo/node_modules/bcryptjs');
console.log(bcrypt.hashSync('NeuesPasswort123', 12));
"
```

Hash einsetzen:

```bash
docker compose exec postgres psql -U $POSTGRES_USER -d $POSTGRES_DB -c \
  "UPDATE users SET password_hash='<HASH>', failed_login_attempts=0, locked_until=NULL WHERE email='admin@localhost';"
```

### Konto ist gesperrt

Nach acht Fehlversuchen 15 Minuten warten oder:

```bash
docker compose exec postgres psql -U $POSTGRES_USER -d $POSTGRES_DB -c \
  "UPDATE users SET failed_login_attempts=0, locked_until=NULL;"
```

### Ständige Abmeldung

`COOKIE_SECURE=true` bei HTTP-Zugriff verhindert, dass Cookies gesetzt werden.
Ohne HTTPS auf `false` stellen.

---

## Jobs

### Video hängt in QUEUED

Kein Worker für diese Queue verbunden.

```bash
docker compose ps
docker compose logs script-worker --tail 30
```

Untertitel, Sprache und Bilder liegen im Profil `ai`:

```bash
docker compose --profile ai up -d
```

### Status WAITING_FOR_GPU

Kein Fehler. Der Job wartet auf eine GPU und startet automatisch, sobald eine
verfügbar ist. Prüfen unter **System → GPU** oder:

```bash
curl -s -b cookies.txt http://localhost:3000/api/system/gpu
```

Ohne GPU: Projekt auf den Adapter `placeholder` oder `comfyui` stellen.

### Job schlägt immer wieder fehl

In der Warteschlange steht die Fehlermeldung direkt am Job. Die drei Versuche
erfolgen mit wachsendem Abstand (30 s, 60 s, 120 s). Danach bleibt der Job auf
`FAILED` und lässt sich über **Erneut** wieder einreihen.

Häufige Ursachen:

| Fehler | Ursache |
|---|---|
| `Modellverzeichnis ... existiert nicht` | Modell nicht heruntergeladen |
| `ComfyUI unter ... nicht erreichbar` | ComfyUI läuft nicht oder ohne `--listen 0.0.0.0` |
| `Der Adapter hat keine verwertbare Videodatei erzeugt` | Workflow ohne Video-Export-Node |
| `Die Quelldatei enthält keine verwertbare Tonspur` | Untertitel ohne Sprachausgabe angefordert |
| `Zeitüberschreitung` | `JOB_TIMEOUT_MS` erhöhen |

### Job hängt auf RUNNING

Der Worker ist abgestürzt, ohne die Sperre freizugeben. Nach etwa 60 Sekunden
stellt der Wartungslauf den Job automatisch wieder her. Sofort auslösen:

```bash
curl -X POST -b cookies.txt -H "x-csrf-token: <TOKEN>" \
  http://localhost:3000/api/system/maintenance
```

---

## Rendern

### `Output with label 'N:a' does not exist`

Ein Fehler im Filtergraph. Prüfen, ob alle Quelldateien vorhanden sind:

```bash
docker compose exec ffmpeg-worker ls -la /data/projects/<projekt-id>/videos/
```

### Video hat keinen Ton

Ohne Sprachausgabe und ohne Musik legt der Worker eine stille Tonspur an — das
ist beabsichtigt, weil TikTok und Instagram eine Tonspur erwarten. Für echten
Ton die Sprachausgabe aktivieren ([VOICE_SETUP.md](VOICE_SETUP.md)) oder im
Projekt eine Musikdatei hinterlegen.

### Untertitel erscheinen nicht im Bild

1. Untertitel im Projekt aktiviert?
2. *Untertitel ins Bild brennen* aktiviert?
3. Gibt es eine SRT-Datei? (Videodetail → Dateien)
4. Subtitle-Worker gestartet? (`--profile ai`)

### Untertitel in falscher Schrift

Im Image ist DejaVu Sans enthalten. Andere Schriften müssen im
FFmpeg-Worker-Image installiert werden.

---

## Veröffentlichen

### `Not configured`

Zugangsdaten fehlen in der `.env`. Die Oberfläche nennt die genauen Variablen.
Siehe [SOCIAL_SETUP.md](SOCIAL_SETUP.md).

### `Token expired` / Reconnect

Das Zugriffstoken ließ sich nicht erneuern. Häufig:

- Zugriff in den Plattformeinstellungen entzogen
- Refresh-Token abgelaufen (bei Meta nach 60 Tagen)
- `ENCRYPTION_KEY` wurde geändert

Lösung: **Social Media → Reconnect**.

### Upload bei einer Plattform fehlgeschlagen, andere laufen

Genau so ist es gedacht. Jede Plattform hat einen eigenen Worker. Den
fehlgeschlagenen Upload unter **Publishing** mit **Retry** erneut anstoßen.

### YouTube meldet `quotaExceeded`

Das Tageskontingent ist aufgebraucht (etwa 6 Uploads bei Standardkontingent).
Am nächsten Tag erneut versuchen oder bei Google mehr beantragen.

### TikTok-Video ist nur für mich sichtbar

Vorgabe von TikTok: Nicht geprüfte Apps dürfen nur `SELF_ONLY` posten.

---

## Speicher

### Festplatte voll

```bash
docker compose exec backend du -sh /data/projects/* | sort -h
```

- Arbeitsdateien räumt der Storage-Container nach 24 Stunden selbst auf.
- Alte Videos in der Medienbibliothek löschen.
- Modelle entfernen: `docker volume rm acf-models`.

### Dateien fehlen nach Neustart

`STORAGE_HOST_PATH` prüfen — Standard ist `./data` im Projektverzeichnis. Bei
geändertem Pfad müssen alle Container denselben Pfad sehen.

---

## Datenbank

### Migration schlägt fehl

```bash
docker compose logs backend | grep -i migration
```

Läuft eine Migration halb durch, greift der Rollback in der Transaktion. Fehler
beheben und Backend neu starten.

### Zurücksetzen (alle Daten gehen verloren)

```bash
docker compose down
docker volume rm acf-postgres
docker compose up -d
```

---

## Leistung

### Generierung ist sehr langsam

- Ohne GPU ist Videogenerierung nicht praktikabel — deshalb `WAITING_FOR_GPU`.
- Weniger Szenen im Projekt einstellen.
- Kleineres Modell wählen (Wan 1.3B statt LTX).
- `GENERATION_CONCURRENCY=1` lassen; parallele Läufe auf einer GPU bringen nichts.

### Rendern dauert lange

- `MEDIA_CONCURRENCY` erhöhen, wenn genug CPU-Kerne da sind.
- Weniger Zielformate im Projekt (jedes Format ist ein eigener Renderlauf).
- Im FFmpeg-Worker `-preset` von `medium` auf `fast` setzen.

### Oberfläche wirkt träge

Besteht keine Live-Verbindung, fragt die Oberfläche häufiger nach. Oben rechts
zeigt ein Symbol `Live` oder `Polling`. Bleibt es auf `Polling`, blockiert
vermutlich ein Proxy den Ereignisstrom.

---

## Alles zurücksetzen

```bash
docker compose down -v          # löscht auch Datenbank und Modelle
rm -rf data backups
node scripts/generate-secrets.mjs --force
docker compose up -d --build
```

`down -v` entfernt alle Volumes. Vorher `scripts/backup.sh` ausführen.
