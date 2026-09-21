# AI Content Studio

Eine vollständig lokal laufende Content-Factory für Social-Media-Videos.
Ideen sammeln, Skript erzeugen, Video mit lokaler KI generieren, schneiden,
untertiteln, freigeben, planen und über die offiziellen Plattform-APIs
veröffentlichen — alles auf dem eigenen Rechner, ohne kostenpflichtige Cloud-KI.

```
                  AI CONTENT STUDIO
                         │
        ┌────────────────┼────────────────┐
        ▼                ▼                ▼
      CREATE           MANAGE           PUBLISH
        │                │                │
      Script           Library         YouTube
      Image            Projects        TikTok
      Video            Calendar        Instagram
      Voice            Analytics       Facebook
        │                │                │
        └────────────────┼────────────────┘
                         ▼
                    LOCAL AI GPU
                         │
                         ▼
                       VIDEO
```

---

## Inhalt

1. [Was das System kann](#was-das-system-kann)
2. [Architektur](#architektur)
3. [Installation](#installation)
4. [Erstes Video erstellen](#erstes-video-erstellen)
5. [Lokale Video-KI einrichten](#lokale-video-ki-einrichten)
6. [Social Media verbinden](#social-media-verbinden)
7. [Betrieb](#betrieb)
8. [Erweitern](#erweitern)
9. [Was ehrlich noch fehlt](#was-ehrlich-noch-fehlt)

---

## Was das System kann

| Bereich | Umfang |
|---|---|
| **Ideen** | Themenspeicher mit Bewertung, Tags und Status; aus jeder Idee wird per Klick ein Video |
| **Projekte** | Eigene Voreinstellungen je Projekt: Sprache, Stil, Format, Plattformen, KI-Adapter, Untertitel-Stil, Wasserzeichen |
| **Skript** | Szenenweise Skripte mit Bild-Prompts; lokal per Vorlage oder über ein lokales Ollama-Modell |
| **Video-KI** | Austauschbare Adapter: **LTX**, **Wan**, **ComfyUI** und ein klar gekennzeichneter Platzhalter zum Testen |
| **Ohne GPU** | Die Plattform läuft vollständig. Generierungsjobs bleiben im Status `WAITING_FOR_GPU` in der Queue und starten automatisch, sobald eine GPU verfügbar ist |
| **Schnitt** | FFmpeg-Worker: Szenen zusammenfügen, skalieren, Ton mischen, Untertitel einbrennen, Wasserzeichen, Vorschaubild |
| **Untertitel** | Spracherkennung mit faster-whisper, SRT und VTT, Stil konfigurierbar (Schrift, Größe, Position, Farbe, Hintergrund) |
| **Freigabe** | `GENERATED → REVIEW_REQUIRED → APPROVED → SCHEDULED → PUBLISHED`; ohne Freigabe wird nichts veröffentlicht, auch nicht durch Automatisierung |
| **Publishing** | Je Plattform ein eigener Worker. Ein Fehler bei TikTok blockiert YouTube und Instagram nicht |
| **Kalender** | Wochenansicht mit Drag & Drop zum Verschieben geplanter Beiträge |
| **Analytics** | Views, Likes, Kommentare, Shares, Watch Time, Engagement — Zeitreihe je Beitrag |
| **System** | Zustand jedes Containers, GPU-Details, Speicherbelegung, Logs, Backups |
| **Automatisierung** | n8n als eigener Container mit eigener API; jeder Schritt bleibt manuell steuerbar |

---

## Architektur

Das System ist bewusst **kein einzelner Container**. Jede ressourcenintensive
Funktion läuft in einem eigenen Container und kann unabhängig neu gestartet,
aktualisiert oder ersetzt werden. Für dich fühlt es sich trotzdem wie **eine**
Anwendung an: Die Oberfläche zeigt nur den Status eines Videos, nie den
Container dahinter.

```
                    ┌──────────────────────┐
                    │   CONTENT STUDIO     │
                    │   Frontend + Backend │
                    └──────────┬───────────┘
                               │ REST API / Events
                               │
                       ┌───────▼────────┐
                       │  Redis Queue   │
                       └───────┬────────┘
          ┌────────────┬───────┼────────┬────────────┐
          ▼            ▼       ▼        ▼            ▼
     ┌─────────┐ ┌─────────┐ ┌──────┐ ┌───────┐ ┌──────────┐
     │ Script  │ │ Image   │ │Video │ │ Voice │ │ Subtitle │
     │ Worker  │ │ Worker  │ │Worker│ │Worker │ │ Worker   │
     └─────────┘ └─────────┘ └──┬───┘ └───────┘ └────┬─────┘
                                │ GPU               │
                                └────────┬──────────┘
                                         ▼
                                  ┌─────────────┐
                                  │   FFmpeg    │
                                  │   Worker    │
                                  └──────┬──────┘
                                         ▼
                    ┌────────────┬───────┴────┬─────────────┐
                    ▼            ▼            ▼             ▼
              ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐
              │publisher-│ │publisher-│ │publisher-│ │publisher-│
              │ youtube  │ │  tiktok  │ │instagram │ │ facebook │
              └──────────┘ └──────────┘ └──────────┘ └──────────┘
```

### Container

| Container | Profil | Aufgabe |
|---|---|---|
| `content-frontend` | Standard | Weboberfläche (nginx, unprivilegiert) |
| `content-backend` | Standard | REST-API, Datenbank, Job-Orchestrierung, Freigabe |
| `content-postgres` | Standard | Metadaten und Job-Verlauf |
| `content-redis` | Standard | Queue und Worker-Registrierung |
| `content-storage` | Standard | Legt die Verzeichnisstruktur an, räumt Arbeitsdateien auf |
| `content-n8n` | Standard | Automatisierungen |
| `content-script-worker` | Standard | Skripte und Szenen-Prompts |
| `content-ffmpeg-worker` | Standard | Schnitt, Skalierung, Ton, Untertitel-Einbrennen |
| `content-video-worker` | Standard / `gpu` | Lokale Video-KI |
| `content-subtitle-worker` | `ai` | Spracherkennung |
| `content-voice-worker` | `ai` | Sprachausgabe |
| `content-image-worker` | `ai` | Bildgenerierung |
| `content-publisher-*` | Standard | Ein Upload-Worker je Plattform |

### Grundregeln

- **Worker schreiben nie direkt in PostgreSQL.** Sie melden Ergebnisse über die
  interne REST-API des Backends (`X-API-Key`). Das Schema bleibt damit eine
  interne Angelegenheit des Hauptsystems.
- **Jobs überleben Neustarts.** Das Queue-Protokoll arbeitet mit atomaren
  Lua-Skripten und Sperr-Heartbeats. Stirbt ein Worker mitten im Job, stellt
  ein Wartungslauf den Job automatisch wieder her.
- **Getrennte Netzwerke.** Nur das Backend erreicht PostgreSQL. Worker sehen
  ausschließlich Redis, das Backend und den Speicher.
- **Keine großen Dateien in der Datenbank.** PostgreSQL speichert Pfade,
  die Dateien liegen unter `./data`.

Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) und
[docs/QUEUE_PROTOCOL.md](docs/QUEUE_PROTOCOL.md).

---

## Installation

### 1. Docker Desktop installieren

Windows: <https://www.docker.com/products/docker-desktop/> herunterladen und
installieren. Nach dem Start unter **Settings → Resources** mindestens
**6 GB RAM** und **4 CPUs** zuweisen (für die KI-Worker eher 12 GB).

Prüfen:

```bash
docker --version
docker compose version
```

### 2. Git installieren

Windows: <https://git-scm.com/download/win>

```bash
git --version
```

### 3. Repository klonen

```bash
git clone https://github.com/samubraila/Haup-System-Generation1.git
cd Haup-System-Generation1
```

### 4. Konfiguration erzeugen

Der Generator legt `.env` an und würfelt alle Passwörter und Schlüssel neu:

```bash
node scripts/generate-secrets.mjs
```

Er gibt das Admin-Passwort und das n8n-Passwort auf der Konsole aus.
**Diese Ausgabe sofort sichern** — sie erscheint kein zweites Mal.

Ohne Node.js auf dem Host: `.env.example` nach `.env` kopieren und alle Werte,
die mit `CHANGE_ME` beginnen, von Hand ersetzen. `ENCRYPTION_KEY` muss exakt
64 Hex-Zeichen lang sein (`openssl rand -hex 32`).

### 5. Systemprüfung

```bash
node scripts/preflight.mjs
```

Prüft Docker, Compose, `.env`, Schreibrechte, Speicherplatz und optional die
GPU. Ohne GPU meldet der Lauf `INFO` statt `FEHL` — das System läuft trotzdem.

### 6. Starten

```bash
docker compose up -d --build
```

Der erste Lauf dauert einige Minuten. Danach:

```bash
docker compose ps
```

Alle Container sollten `healthy` sein.

### 7. Datenbank

Passiert automatisch: Das Backend wendet beim Start die Migrationen an und legt
den Administrator sowie ein Startprojekt an. Im Log sichtbar:

```bash
docker compose logs backend | grep -i migration
```

### 8. Weboberfläche öffnen

<http://localhost:3000>

Anmelden mit `ADMIN_EMAIL` und dem generierten `ADMIN_PASSWORD` aus der `.env`.

### 9. Optionale KI-Worker starten

Untertitel, Sprachausgabe und Bildgenerierung liegen im Profil `ai`:

```bash
docker compose --profile ai up -d --build
```

### 10. GPU aktivieren

Nur mit NVIDIA-GPU und installiertem Container Toolkit:

```bash
docker compose -f docker-compose.yml -f docker-compose.gpu.yml --profile ai up -d --build
```

Details: [docs/VIDEO_MODELS.md](docs/VIDEO_MODELS.md).

---

## Erstes Video erstellen

1. **Projekt anlegen** → `Projekte` → `Neues Projekt`
   Beispiel: Name *Space Facts*, Sprache *Deutsch*, Stil *Cinematic*,
   Format *YouTube Short*, Plattformen *YouTube, TikTok, Instagram*.
2. **Video anlegen** → Knopf `Neues Video` oben rechts.
   Der Assistent führt durch Thema, Format, Länge, Stil und Sprache.
3. **Generieren** → Der Auftrag landet in der Warteschlange. Unter
   `Warteschlange` siehst du live, welcher Worker gerade arbeitet.
4. **Prüfen** → In der Videoansicht läuft die Vorschau, sobald der
   FFmpeg-Worker fertig ist.
5. **Freigeben** → Knopf `Freigeben`. Vorher wird nichts veröffentlicht.
6. **Planen** → `Veröffentlichen` → Plattformen wählen, Texte anpassen,
   Zeitpunkt setzen.
7. **Verschieben** → Im `Kalender` lassen sich geplante Beiträge per
   Drag & Drop auf einen anderen Tag ziehen.

Im Auslieferungszustand steht der Video-Adapter auf `placeholder`. Dabei
entsteht ein deutlich beschrifteter Testclip, **kein KI-Video** — so lässt sich
die gesamte Kette prüfen, bevor Modelle geladen werden.

---

## Lokale Video-KI einrichten

Drei Adapter stehen bereit. Der Adapter wird pro Projekt gewählt.

| Adapter | Braucht | Eignung |
|---|---|---|
| `placeholder` | nichts | Test der Pipeline |
| `comfyui` | ComfyUI auf dem Host | Volle Kontrolle über den Workflow |
| `ltx` | GPU + LTX-Video-Modell | Schnelle Text-zu-Video-Erzeugung |
| `wan` | GPU + Wan-Modell | Alternative Text-zu-Video-Erzeugung |

Modelle herunterladen, Speicherort, VRAM-Bedarf und ComfyUI-Anbindung:
[docs/VIDEO_MODELS.md](docs/VIDEO_MODELS.md).

**Ohne GPU** bleibt ein Generierungsjob im Status `WAITING_FOR_GPU`. Er zählt
nicht als Fehler, verbraucht keinen Versuch und startet automatisch, sobald ein
Video-Worker mit GPU verbunden ist — auch von einem anderen Rechner:
[docs/REMOTE_GPU.md](docs/REMOTE_GPU.md).

---

## Social Media verbinden

Jede Plattform braucht eine eigene App-Registrierung im jeweiligen
Developer-Portal. Solange die Zugangsdaten fehlen, zeigt die Oberfläche ehrlich
**Not configured** und bietet keinen Verbinden-Knopf an.

| Plattform | Portal | Benötigte Werte |
|---|---|---|
| YouTube | Google Cloud Console | `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET` |
| TikTok | TikTok for Developers | `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET` |
| Instagram | Meta for Developers | `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET` |
| Facebook | Meta for Developers | `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET` |

Schritt-für-Schritt inklusive Redirect-URIs, Berechtigungen und
Freigabeprozessen: [docs/SOCIAL_SETUP.md](docs/SOCIAL_SETUP.md).

Nach dem Eintragen in die `.env`:

```bash
docker compose up -d backend
```

Dann in der Oberfläche unter `Social Media` auf `Connect account`.

Die Tokens werden AES-256-GCM verschlüsselt in der Datenbank abgelegt. Sie
verlassen das Backend nur über die interne API an den zuständigen
Publisher-Container und erreichen den Browser nie.

---

## Betrieb

### Alltag

```bash
docker compose ps                      # Zustand aller Container
docker compose logs -f backend         # Logs verfolgen
docker compose restart video-worker    # Einzelnen Worker neu starten
docker compose down                    # Alles stoppen
docker compose up -d                   # Alles starten
```

Alle wichtigen Aktionen gehen auch ohne Terminal: Generieren, Stoppen, Retry,
Vorschau, Bearbeiten, Freigeben, Planen, Veröffentlichen und Löschen sind in
der Oberfläche verfügbar. Technische Logs stehen unter `System → Logs`.

### Backup

```bash
bash scripts/backup.sh                 # ohne Videodateien
bash scripts/backup.sh --with-media    # mit Videodateien
bash scripts/restore.sh backups/acf-backup-...
```

Gesichert werden Datenbank, Konfiguration, Projektmetadaten, Skripte,
Untertitel und n8n-Daten. Große Videodateien nur mit `--with-media`.
Backups lassen sich auch in der Oberfläche unter `System → Speicher` starten.

### Ports

| Dienst | Port | Im Netz erreichbar |
|---|---|---|
| Weboberfläche | 3000 | ja |
| n8n | 5678 | ja |
| Backend | — | nur über die Oberfläche |
| PostgreSQL | — | nein |
| Redis | — | nein |

PostgreSQL und Redis sind bewusst nicht nach außen freigegeben. Für einen
entfernten GPU-Worker muss Redis gezielt geöffnet werden, siehe
[docs/REMOTE_GPU.md](docs/REMOTE_GPU.md).

### API-Dokumentation

<http://localhost:3000/api/docs> (OpenAPI/Swagger) sowie
[docs/API.md](docs/API.md).

---

## Erweitern

Neue Funktionen kommen als **neuer Worker**, nicht als Umbau des Kerns.

- Neues Video-KI-Modell → [docs/PLUGINS.md](docs/PLUGINS.md#video-ki-adapter)
- Neue Social-Media-Plattform → [docs/PLUGINS.md](docs/PLUGINS.md#publisher-worker)
- Neuer Pipeline-Schritt → [docs/PLUGINS.md](docs/PLUGINS.md#neuer-worker)

Vorbereitet sind Voice Generation, Music Generation, Image Generation, AI Script
Generation, Übersetzung, Thumbnail- und Hashtag-Erzeugung, Content Scoring,
A/B-Testing und Revenue Tracking — die Schnittstellen dafür stehen, die
Implementierung erfolgt je als eigener Worker.

### Entwicklung

```bash
npm install
npm run build          # alle TypeScript-Pakete
npm run typecheck      # Typprüfung
npm test               # Tests (Backend + Worker)
npm run dev:backend    # Backend mit Neuladen
npm run dev:frontend   # Frontend mit Neuladen
```

Python-Tests:

```bash
cd workers/subtitle && python -m unittest discover -s tests
```

---

## Was ehrlich noch fehlt

Damit klar ist, was implementiert ist und was Einrichtung braucht:

| Thema | Stand |
|---|---|
| Pipeline, Queue, Freigabe, Kalender, Analytics-Speicherung | vollständig implementiert und lauffähig |
| Video-Adapter LTX / Wan / ComfyUI | implementiert, **Modelle musst du selbst laden** |
| Upload zu YouTube, TikTok, Instagram, Facebook | implementiert gegen die offiziellen APIs, **App-Registrierung nötig** |
| Analytics-Abruf | implementiert; liefert erst Werte, wenn Beiträge veröffentlicht sind und die Plattform Daten freigibt |
| Sprachausgabe | Worker vorhanden, **Piper-Stimme muss hinterlegt werden**; ohne Stimme lehnt der Worker Aufträge mit klarer Meldung ab |
| Bildgenerierung | Worker vorhanden, **Modell muss hinterlegt werden** |
| TikTok-Sichtbarkeit | Nicht geprüfte Apps dürfen nur privat posten — eine Vorgabe von TikTok, keine Einschränkung dieser Software |

Es gibt keine simulierten Daten. Wo eine Integration nicht eingerichtet ist,
sagt die Oberfläche das und nennt die fehlenden Werte.

---

## Lizenz

MIT
