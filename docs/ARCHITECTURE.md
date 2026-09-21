# Architektur

## Leitgedanke

Das System ist eine Sammlung kleiner, austauschbarer Dienste, die sich für die
Benutzerin wie **eine** Anwendung anfühlen. Die Oberfläche zeigt nie, welcher
Container gerade arbeitet — sie zeigt nur den Zustand eines Videos:

```
Generate → Queued → Generating → Processing → Ready → Approved → Published
```

Im Hintergrund erledigt das beliebig viele spezialisierte Container. Ein
einzelner Worker kann abstürzen, neu gebaut oder ersetzt werden, ohne dass das
Hauptsystem davon berührt wird.

## Rollenverteilung

### Hauptsystem (`backend` + `frontend`)

Steuert, entscheidet und speichert — rechnet aber nicht.

- Benutzeroberfläche und Authentifizierung
- Projekte, Ideen, Videos, Medienregister
- Job-Erzeugung und Pipeline-Fortschaltung
- Queue- und Worker-Übersicht
- Berechtigungen, Freigabe, Audit-Log
- Verschlüsselte Ablage der OAuth-Tokens

Das Backend führt **keine** FFmpeg-Aufrufe und **keine** Modellinferenz aus.

### Worker

Jeder Worker bedient genau eine Queue und kennt nur seinen Arbeitsschritt.

| Worker | Queue | Sprache | Eingabe | Ausgabe |
|---|---|---|---|---|
| script-worker | `script` | TypeScript | Thema, Stil, Länge | Skript mit Szenen und Bild-Prompts |
| image-worker | `image` | Python | Prompts | PNG-Dateien |
| video-worker | `video` | Python | Szenen-Prompt | MP4 je Szene |
| voice-worker | `voice` | Python | Sprechertext | MP3 |
| subtitle-worker | `subtitle` | Python | Audio oder Video | SRT und VTT |
| ffmpeg-worker | `ffmpeg` | TypeScript | Clips, Ton, Untertitel | Fertige Renderfassungen, Vorschaubild |
| publisher-youtube | `publish.youtube` | TypeScript | Renderfassung, Metadaten | Video auf YouTube |
| publisher-tiktok | `publish.tiktok` | TypeScript | Renderfassung, Metadaten | Video auf TikTok |
| publisher-instagram | `publish.instagram` | TypeScript | Renderfassung, Metadaten | Reel auf Instagram |
| publisher-facebook | `publish.facebook` | TypeScript | Renderfassung, Metadaten | Video auf einer Facebook-Seite |

## Kommunikationswege

```
Frontend ──HTTPS/Cookie──▶ Backend ──SQL──▶ PostgreSQL
                              │
                              ├──Redis──▶ Queue (Jobs)
                              │
Worker ◀──Redis (reserve)─────┘
   │
   └──REST + X-API-Key──▶ Backend  (Fortschritt, Ergebnis, Fehler, Medien)
```

Regeln:

1. **Worker sprechen nie mit PostgreSQL.** Das Datenbankschema bleibt intern.
   Ein Worker meldet ausschließlich über die interne REST-API.
2. **Das Backend ruft nie einen Worker auf.** Es legt Jobs in die Queue, die
   Worker holen sie ab. Damit ist es egal, wie viele Worker laufen und wo.
3. **Dateien fließen über den gemeinsamen Speicher**, nicht durch die API.
   Ausnahme: entfernte Worker im Modus `STORAGE_MODE=api`.

## Netzwerke

| Netz | Teilnehmer | Zweck |
|---|---|---|
| `acf-edge` | frontend, backend | Browserverkehr |
| `acf-data` | backend, postgres | Datenbank, **internal: true** (kein Internetzugang) |
| `acf-queue` | backend, redis, alle Worker | Queue und interne API |
| `acf-automation` | backend, n8n | Automatisierung |

Der Storage-Container läuft mit `network_mode: none` — er braucht kein Netz,
nur das Volume.

Folge: Ein Worker kann PostgreSQL nicht erreichen, selbst wenn er wollte. n8n
erreicht Redis nicht. Das Frontend erreicht nur das Backend.

## Pipeline

Das Backend entscheidet nach jedem abgeschlossenen Schritt neu, was als
Nächstes zu tun ist (`advancePipeline`). Dadurch passt sich die Kette an, wenn
sich Projekteinstellungen ändern oder Szenen hinzukommen.

```
         ┌─────────────────────────────────────────┐
         │ nextStage(video, project)               │
         └─────────────────────────────────────────┘
                            │
   kein Skript? ────────────┼──▶ script
                            │
   Szenen fehlen? ──────────┼──▶ video   (ein Job je Szene)
                            │
   Sprachausgabe an? ───────┼──▶ voice
                            │
   Untertitel an? ──────────┼──▶ subtitle
                            │
   keine Renderfassung? ────┼──▶ ffmpeg
                            │
                            └──▶ fertig
```

Am Ende:

- Projekt verlangt Freigabe → Status `REVIEW_REQUIRED`
- sonst → Status `APPROVED`, geplante Beiträge werden eingereiht

Erst nach `APPROVED` darf ein Publishing-Job entstehen. Das gilt auch für
Aufrufe über die Automatisierungs-API.

## Statusmodell

### Video

```
DRAFT
  ↓ generate
QUEUED → GENERATING ⇄ WAITING_FOR_GPU
  ↓
PROCESSING
  ↓
GENERATED ──▶ REVIEW_REQUIRED ──▶ APPROVED ──▶ SCHEDULED ──▶ PUBLISHING ──▶ PUBLISHED
  │                                                                │
  └───────────────────────── FAILED ◀──────────────────────────────┘
```

### Job

```
PENDING → RUNNING → COMPLETED
   ↑         │
   │         ├──▶ WAITING_FOR_GPU ──┐ (kein Fehler, kein Versuch verbraucht)
   │         │                      │
   │         └──▶ FAILED            │
   └────────── Retry mit Backoff ◀──┘
```

`WAITING_FOR_GPU` ist bewusst kein Fehlerzustand. Der Job bleibt in der Queue,
wird periodisch erneut geprüft und startet, sobald ein passender Worker da ist.

## Ausfallsicherheit

| Fall | Verhalten |
|---|---|
| Worker stürzt mitten im Job ab | Sperre läuft ab, Wartungslauf stellt den Job wieder her |
| Container wird neu gestartet | Laufende Jobs werden zu Ende geführt oder sauber wiederhergestellt |
| Redis startet neu | AOF-Persistenz; Jobs bleiben erhalten |
| Backend startet neu | Worker laufen weiter, melden nach kurzem Retry wieder |
| Plattform-Upload schlägt fehl | Nur dieser eine Publisher ist betroffen |
| Token abgelaufen | Automatische Erneuerung; scheitert sie, Konto auf `expired` und klare Meldung mit Reconnect |
| Keine GPU | Generierungsjobs warten, alles andere läuft weiter |

## Speicher

```
/data
  projects/<projekt-id>/
      scripts/      Skripte als Markdown
      images/       Bilder
      audio/        Sprachausgabe und Musik
      videos/       Rohe KI-Clips je Szene
      subtitles/    SRT und VTT
      thumbnails/   Vorschaubilder
      final/        Fertige Renderfassungen je Plattform
      published/    Archiv
      exports/      Manuelle Exporte
  temp/             Arbeitsdateien, werden nach 24 Stunden aufgeräumt
  logs/
```

PostgreSQL speichert nur: `id`, `project_id`, `video_id`, `kind`, `path`,
`file_name`, `mime_type`, `size_bytes`, Maße, Dauer und `meta`.

Publisher-Container binden `/data` **schreibgeschützt** ein — sie laden hoch,
verändern aber nichts.

## Ressourcen

Jeder Container hat ein Limit, damit ein fehlerhafter Worker nicht den ganzen
Rechner blockiert.

| Container | CPU | RAM |
|---|---|---|
| backend | 2 | 1 GB |
| frontend | 0,5 | 192 MB |
| postgres | 2 | 1,5 GB |
| redis | 1 | 512 MB |
| n8n | 1,5 | 768 MB |
| script-worker | 1 | 512 MB |
| ffmpeg-worker | 4 | 3 GB |
| video-worker | 4 (GPU: 8) | 8 GB (GPU: 24 GB) |
| subtitle-worker | 4 | 4 GB |
| publisher-* | 1 | 512 MB (Instagram 1 GB) |
| storage | 0,25 | 128 MB |

Anpassen in `docker-compose.yml` unter `deploy.resources.limits`.

## Sicherheit im Aufbau

- Alle Container: `no-new-privileges`, `cap_drop: ALL`
- Nicht-root: Node-Container als `node`, Python als UID 1000, nginx unprivilegiert
- Schreibgeschütztes Wurzeldateisystem bei backend, frontend, storage und allen
  TypeScript-Workern (Schreibzugriff nur auf `/data` und `tmpfs`)
- `/api/internal` und `/api/automation` werden vom Frontend-Proxy mit 404
  beantwortet und sind nur im Docker-Netz mit `X-API-Key` erreichbar

Mehr dazu: [SECURITY.md](SECURITY.md).
