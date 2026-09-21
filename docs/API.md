# API

Interaktive Fassung: <http://localhost:3000/api/docs>
Maschinenlesbar: <http://localhost:3000/api/openapi.json>

Es gibt drei getrennte Bereiche:

| Bereich | Authentifizierung | Erreichbar über |
|---|---|---|
| `/api/...` | Sitzungscookie + CSRF-Token | Browser und Frontend-Proxy |
| `/api/internal/...` | `X-API-Key` | nur im Docker-Netz (Worker) |
| `/api/automation/...` | `X-API-Key` | nur im Docker-Netz (n8n) |

Der Frontend-Proxy beantwortet `/api/internal` und `/api/automation` mit **404**.
Aus dem Browser sind sie nicht erreichbar.

---

## Authentifizierung

```http
POST /api/auth/login
Content-Type: application/json

{ "email": "admin@localhost", "password": "..." }
```

Antwort setzt drei Cookies:

| Cookie | Eigenschaften | Zweck |
|---|---|---|
| `acf_at` | httpOnly, Pfad `/` | Zugriffstoken (JWT, 15 Minuten) |
| `acf_rt` | httpOnly, Pfad `/api/auth` | Refresh-Token (30 Tage, rotierend) |
| `acf_csrf` | lesbar | Double-Submit-Token |

Bei jeder schreibenden Anfrage muss der Wert von `acf_csrf` zusätzlich als
Header `X-CSRF-Token` mitgeschickt werden.

| Route | Zweck |
|---|---|
| `POST /api/auth/login` | Anmelden |
| `POST /api/auth/refresh` | Sitzung verlängern |
| `POST /api/auth/logout` | Abmelden |
| `GET /api/auth/me` | Aktueller Benutzer und neues CSRF-Token |
| `POST /api/auth/password` | Passwort ändern (meldet alle Sitzungen ab) |
| `GET /api/auth/users` | Benutzerliste (nur Admin) |
| `POST /api/auth/users` | Benutzer anlegen (nur Admin) |

Nach acht Fehlversuchen wird das Konto 15 Minuten gesperrt.

---

## Projekte

| Route | Zweck |
|---|---|
| `GET /api/projects` | Liste mit Videozahlen |
| `POST /api/projects` | Anlegen |
| `GET /api/projects/{id}` | Detail mit Statistik und Speicherbedarf |
| `PATCH /api/projects/{id}` | Ändern |
| `POST /api/projects/{id}/archive` | Archivieren |
| `DELETE /api/projects/{id}` | Löschen (`?deleteFiles=false` behält Dateien) |

Löschen wird mit **409** abgelehnt, solange noch Jobs laufen.

---

## Videos

| Route | Zweck |
|---|---|
| `GET /api/videos` | Filter: `projectId`, `status`, `platform`, `language`, `q`, `from`, `to`, `page` |
| `POST /api/videos` | Anlegen, optional direkt generieren |
| `GET /api/videos/{id}` | Detail mit Pipeline, Jobs, Medien, Skript, Veröffentlichungen |
| `PATCH /api/videos/{id}` | Titel, Thema, Beschreibung, Stil, Freigabepflicht |
| `POST /api/videos/{id}/generate` | Generierung starten |
| `POST /api/videos/{id}/stop` | Laufende Jobs abbrechen |
| `POST /api/videos/{id}/regenerate` | Ergebnisse verwerfen und neu starten (`?keepScript=false`) |
| `POST /api/videos/{id}/approve` | Freigeben und geplante Beiträge einreihen |
| `POST /api/videos/{id}/reject` | Ablehnen, zurück auf Entwurf |
| `PUT /api/videos/{id}/publish` | Veröffentlichungsziele setzen |
| `DELETE /api/videos/{id}` | Löschen |

### Veröffentlichungsziele

```http
PUT /api/videos/{id}/publish

{
  "mode": "schedule",
  "targets": [
    {
      "platform": "youtube",
      "enabled": true,
      "accountId": null,
      "title": "5 unglaubliche Fakten über das Universum",
      "description": "...",
      "hashtags": ["space", "universe", "facts"],
      "tags": ["space", "universe"],
      "privacy": "public",
      "scheduledAt": "2026-09-25T10:00:00.000Z"
    }
  ]
}
```

`mode`: `now`, `schedule` oder `draft`.

Antwort je Plattform:

| `status` | Bedeutung |
|---|---|
| `scheduled` | Termin gespeichert |
| `queued` | An den Publisher übergeben |
| `not_connected` | Kein Konto verbunden — nichts passiert |
| `already_published` | Bereits veröffentlicht, unverändert |
| `disabled` | Ziel abgewählt |

Ist bei `mode: "now"` noch keine Freigabe erteilt, antwortet die API mit
`published: false` und `reason: "approval_required"`. Die Ziele werden
gespeichert, veröffentlicht wird nichts.

---

## Jobs

| Route | Zweck |
|---|---|
| `GET /api/jobs` | Jobs mit Filtern `status`, `type`, `videoId`, `projectId` |
| `GET /api/jobs/queues` | Füllstand aller Queues |
| `GET /api/jobs/publishing` | Upload-Warteschlange |
| `POST /api/jobs/{id}/retry` | Job erneut einreihen |
| `POST /api/jobs/{id}/cancel` | Job abbrechen |
| `POST /api/jobs/publishing/{postId}/retry` | Upload erneut versuchen |

---

## Medien

| Route | Zweck |
|---|---|
| `GET /api/media` | Bibliothek, Filter `kind`, `projectId`, `videoId`, `stage`, `q` |
| `GET /api/media/{id}/file` | Datei ausliefern, unterstützt `Range` für Videos |
| `POST /api/media/upload` | Datei hochladen (multipart, Felder `file`, `projectId`, `kind`) |
| `DELETE /api/media/{id}` | Datensatz und Datei löschen |

Uploads werden gegen `ALLOWED_UPLOAD_MIME` geprüft; zusätzlich muss die
Dateiendung zum gemeldeten Typ passen.

---

## Social Media

| Route | Zweck |
|---|---|
| `GET /api/social/platforms` | Plattformen mit Einrichtungsstatus und Konten |
| `GET /api/social/accounts` | Verbundene Konten |
| `POST /api/social/connect` | OAuth starten, liefert `authorizeUrl` |
| `GET /api/social/{platform}/callback` | Rückleitung der Plattform |
| `DELETE /api/social/accounts/{id}` | Konto trennen, Tokens löschen |

Fehlen Zugangsdaten, antwortet `POST /api/social/connect` mit **503** und dem
Code `not_configured` samt Liste der fehlenden Variablen.

Tokens werden nie ausgeliefert.

---

## Kalender

| Route | Zweck |
|---|---|
| `GET /api/calendar?from=&to=` | Beiträge im Zeitraum |
| `PATCH /api/calendar/{postId}` | Termin verschieben (`scheduledAt`) |
| `DELETE /api/calendar/{postId}` | Geplanten Beitrag abbrechen |

Bereits veröffentlichte Beiträge lassen sich nicht verschieben (**409**).

---

## Analytics

| Route | Zweck |
|---|---|
| `GET /api/analytics/summary?days=30` | Summen, Aufteilung je Plattform, Zeitreihe |
| `GET /api/analytics/top?limit=10` | Beste Beiträge nach Views |
| `GET /api/analytics/posts/{postId}` | Verlauf eines Beitrags |

---

## System

| Route | Zweck |
|---|---|
| `GET /api/system/health` | Ohne Anmeldung, für Healthchecks |
| `GET /api/system/services` | Zustand jedes Containers |
| `GET /api/system/workers` | Verbundene Worker mit Fähigkeiten |
| `GET /api/system/gpu` | GPU-Verfügbarkeit und Adapterzustand |
| `GET /api/system/storage` | Belegung nach Projekt und Dateityp |
| `GET /api/system/logs` | Logs, Filter `level`, `source`, `q` |
| `GET /api/system/audit` | Audit-Log (nur Admin) |
| `GET /api/system/events` | Server-Sent-Events für Live-Aktualisierung |
| `GET /api/system/settings` | Laufzeitkonfiguration |
| `PUT /api/system/settings` | Benutzerbezogene Einstellung setzen |
| `GET /api/system/backups` | Backups auflisten (nur Admin) |
| `POST /api/system/backups` | Backup erstellen (`?includeMedia=true`) |
| `POST /api/system/maintenance` | Logs aufräumen, hängende Jobs wiederherstellen |

### Ereignisstrom

```
event: job.updated
data: {"type":"job.updated","jobId":"...","videoId":"...","status":"RUNNING","progress":42,"queue":"video"}

event: video.updated
data: {"type":"video.updated","videoId":"...","status":"PROCESSING","progress":80}

event: post.updated
data: {"type":"post.updated","postId":"...","videoId":"...","platform":"youtube","status":"published"}
```

---

## Automatisierung (n8n)

Header: `X-API-Key: <INTERNAL_API_KEY>`

| Route | Zweck |
|---|---|
| `GET /api/automation/projects` | Projekte mit Voreinstellungen |
| `GET /api/automation/ideas?status=new&limit=20` | Ideen abrufen |
| `POST /api/automation/ideas` | Idee anlegen |
| `POST /api/automation/videos` | Video anlegen, optional generieren |
| `GET /api/automation/videos/{id}` | Status, Jobs, Veröffentlichungen |
| `POST /api/automation/videos/{id}/generate` | Generierung starten |
| `POST /api/automation/videos/{id}/publish` | Geplante Beiträge einreihen |

`publish` antwortet mit **409** und `approval_required`, solange die Freigabe
fehlt. Automatisierungen können die Freigabe nicht umgehen.

---

## Interne API (Worker)

Header: `X-API-Key: <INTERNAL_API_KEY>`

| Route | Zweck |
|---|---|
| `POST /api/internal/jobs/{id}/started` | Job begonnen |
| `POST /api/internal/jobs/{id}/progress` | Fortschritt und ETA |
| `POST /api/internal/jobs/{id}/status` | Zwischenzustand |
| `POST /api/internal/jobs/{id}/completed` | Ergebnis |
| `POST /api/internal/jobs/{id}/failed` | Fehler |
| `POST /api/internal/logs` | Logeintrag |
| `POST /api/internal/media` | Datei registrieren |
| `POST /api/internal/analytics` | Kennzahlen melden |
| `GET /api/internal/social-accounts/{id}/credentials` | Entschlüsseltes Token |
| `POST /api/internal/social-accounts/{id}/tokens` | Erneuerte Tokens ablegen |
| `POST /api/internal/social-accounts/{id}/error` | Kontofehler melden |
| `GET /api/internal/files?path=` | Datei herunterladen |
| `PUT /api/internal/files?path=` | Datei hochladen |

### Ergebnisformate

| Job-Typ | Erwartetes Ergebnis |
|---|---|
| `script` | `{ title, hook, body, scenes[], wordCount, estimatedDurationSec, provider, language }` |
| `video` | `{ mediaId, path, sceneIndex, provider, producesAiVideo }` |
| `voice` | `{ mediaId, path, durationMs }` |
| `subtitle` | `{ mediaId, path, cues, language, transcript }` |
| `ffmpeg` | `{ finalMediaId, thumbnailMediaId, renders[] }` |
| `publish` | `{ externalPostId, externalUrl, platform }` |

---

## Fehlerformat

```json
{
  "error": {
    "code": "not_configured",
    "message": "YouTube ist nicht eingerichtet. Fehlende Werte in der .env: YOUTUBE_CLIENT_ID",
    "details": { "platform": "youtube", "missingEnv": ["YOUTUBE_CLIENT_ID"] }
  }
}
```

| Code | HTTP | Bedeutung |
|---|---|---|
| `bad_request` | 400 | Ungültige Anfrage |
| `validation_error` | 400 | Schemaprüfung fehlgeschlagen, `details` nennt die Felder |
| `unauthorized` | 401 | Nicht angemeldet oder Sitzung abgelaufen |
| `forbidden` | 403 | Keine Berechtigung oder CSRF-Token fehlt |
| `not_found` | 404 | Nicht vorhanden |
| `conflict` | 409 | Zustand passt nicht, z. B. `approval_required` |
| `payload_too_large` | 413 | Datei überschreitet `MAX_UPLOAD_MB` |
| `rate_limited` | 429 | Zu viele Anfragen |
| `not_configured` | 503 | Integration nicht eingerichtet |
| `internal_error` | 500 | Unerwarteter Fehler, Details stehen im Log |

## Grenzwerte

| Bereich | Grenze |
|---|---|
| Gesamte API | 300 Anfragen pro Minute |
| Anmeldung | 10 Versuche pro Minute |
| Uploads | 30 pro Minute |
| Aufrufe mit `X-API-Key` | kein Limit |
