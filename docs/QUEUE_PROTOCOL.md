# Queue-Protokoll

Die Warteschlange ist bewusst selbst gebaut und **sprachneutral**: TypeScript-
und Python-Worker sprechen exakt dasselbe Protokoll. Eine fertige Bibliothek wie
BullMQ hätte alle Worker auf Node festgelegt.

Referenzimplementierungen:

- TypeScript: `packages/worker-core/src/queue.ts`
- Python: `workers/_shared/acfworker/queue.py`

Ändert sich eine Lua-Routine, muss sie in beiden Dateien identisch sein.

## Schlüssel in Redis

| Schlüssel | Typ | Inhalt |
|---|---|---|
| `acf:q:<queue>:waiting` | ZSET | Wartende Jobs, sortiert nach Priorität und Alter |
| `acf:q:<queue>:active` | LIST | Jobs, die gerade bearbeitet werden |
| `acf:q:<queue>:delayed` | ZSET | Jobs mit Startzeitpunkt in der Zukunft |
| `acf:q:<queue>:failed` | LIST | Endgültig fehlgeschlagene Jobs (max. 500) |
| `acf:job:<jobId>` | HASH | Der Job selbst |
| `acf:lock:<jobId>` | STRING mit TTL | Sperre des bearbeitenden Workers |
| `acf:workers` | SET | Bekannte Worker-IDs |
| `acf:worker:<workerId>` | STRING mit TTL | Lebenszeichen und Fähigkeiten |

### Felder eines Jobs

| Feld | Bedeutung |
|---|---|
| `id` | UUID des Queue-Jobs |
| `queue` | Zielqueue |
| `name` | Fachlicher Typ, z. B. `video` oder `publish` |
| `data` | JSON-Payload |
| `refId` | ID des Datensatzes im Backend (`video_jobs.id` oder `publishing_jobs.id`) |
| `attempts` / `maxAttempts` | Versuchszähler |
| `status` | `PENDING`, `WAITING_FOR_GPU`, `RUNNING`, `COMPLETED`, `FAILED`, `CANCELLED` |
| `progress` | 0–100 |
| `priority` | 0 (niedrig) bis 9 (hoch) |
| `createdAt`, `updatedAt`, `startedAt` | Zeitstempel in Millisekunden |
| `lockedBy` | Worker-ID |
| `error` | Letzte Fehlermeldung |

### Sortierung

```
score = (9 - priority) * 1e13 + createdAt
```

Niedrigerer Score zuerst. Da `createdAt` als Millisekunden-Zeitstempel unter
`1e13` liegt, überlappen sich die Prioritätsstufen nicht: Ein Job mit
Priorität 7 kommt immer vor einem mit Priorität 5, innerhalb einer Stufe gilt
das Alter.

Vergebene Prioritäten: Publishing 7, Rendern 6, Skript und Video 5, Sprache und
Untertitel 4, Analytics 1.

## Operationen

Alle Zustandsänderungen laufen als **Lua-Skript** und sind damit atomar. Ein
Absturz mitten in einer Operation kann keinen halb veränderten Zustand
hinterlassen.

### reserve

```
ZPOPMIN waiting          → jobId
LPUSH   active jobId
SET     lock:<jobId> workerId EX <ttl>
HSET    job status=RUNNING lockedBy=<workerId> startedAt=<now>
HINCRBY job attempts 1
```

Worker pollen im Sekundentakt. Bewusst kein blockierendes `BLMOVE`: Das Poll-
Intervall kostet bei Jobs, die Sekunden bis Minuten dauern, nichts, hält aber
die Implementierung in beiden Sprachen identisch und einfach.

### heartbeat

Während der Bearbeitung verlängert der Worker die Sperre regelmäßig
(Standard: alle 24 Sekunden bei 60 Sekunden TTL) und schreibt dabei den
Fortschritt. Läuft die Sperre ab, gilt der Worker als abgestürzt.

### complete

```
LREM active 1 jobId
DEL  lock:<jobId>
HSET job status=COMPLETED progress=100
EXPIRE job 24h
```

### fail

```
LREM active 1 jobId
DEL  lock:<jobId>
wenn permanent oder attempts >= maxAttempts:
    HSET job status=FAILED
    LPUSH failed jobId
    EXPIRE job 7d
sonst:
    HSET job status=PENDING
    ZADD delayed (now + backoff) jobId
```

Backoff: `min(10 Minuten, 30 Sekunden * 2^(attempts-1))`.

### park (WAITING_FOR_GPU)

```
LREM    active 1 jobId
DEL     lock:<jobId>
HINCRBY job attempts -1          ← der Versuch zählt nicht
HSET    job status=WAITING_FOR_GPU
ZADD    delayed (now + retryIn) jobId
```

Damit kann ein Job beliebig lange auf Hardware warten, ohne jemals als
fehlgeschlagen zu gelten.

### promoteDelayed

Verschiebt fällige Jobs aus `delayed` zurück nach `waiting`. `ZREM` liefert nur
bei genau einem Aufrufer `1` — dadurch kann derselbe Job nicht doppelt
aktiviert werden, auch wenn mehrere Worker gleichzeitig aufräumen.

### reapStalled

Geht die `active`-Liste durch. Fehlt zu einem Job die Sperre, ist der Worker
gestorben:

- Versuche übrig → zurück nach `waiting`
- keine Versuche übrig → nach `failed`

Dieser Lauf ist der Grund, warum `docker restart` keinen Job verliert. Er läuft
alle 15 Sekunden in jedem Worker und zusätzlich im Backend-Scheduler.

## Worker-Registrierung

Jeder Worker schreibt alle 10 Sekunden ein Lebenszeichen mit 30 Sekunden TTL:

```json
{
  "id": "video-worker-abc123",
  "name": "video-worker",
  "queue": "video",
  "version": "1.0.0",
  "host": "gpu-pc",
  "startedAt": 1758470000000,
  "lastSeen": 1758470123456,
  "status": "busy",
  "currentJobId": "…",
  "concurrency": 1,
  "capabilities": { "gpu": { "available": true, "name": "RTX 4090" } },
  "reason": null
}
```

Das Backend liest daraus das Health-Dashboard. Weil die Registrierung über
Redis läuft, erscheint auch ein Worker auf einem anderen Rechner automatisch in
der Übersicht.

## Ergebnisse melden

Redis hält nur den Warteschlangen-Zustand. Fachliche Ergebnisse gehen über die
interne REST-API an das Backend:

| Aufruf | Zweck |
|---|---|
| `POST /api/internal/jobs/{refId}/started` | Job begonnen |
| `POST /api/internal/jobs/{refId}/progress` | Fortschritt und ETA |
| `POST /api/internal/jobs/{refId}/status` | Zwischenzustand, z. B. `WAITING_FOR_GPU` |
| `POST /api/internal/jobs/{refId}/completed` | Ergebnis |
| `POST /api/internal/jobs/{refId}/failed` | Fehler samt Retry-Absicht |
| `POST /api/internal/media` | Erzeugte Datei registrieren |
| `POST /api/internal/logs` | Strukturierter Logeintrag |

Alle Aufrufe benötigen den Header `X-API-Key`.

## Einen neuen Job-Typ einführen

1. Zod-Schema in `packages/worker-core/src/jobs.ts` ergänzen.
2. Queue-Namen in `QUEUES` aufnehmen.
3. Im Backend in `services/pipeline.ts` einreihen (`STAGE_QUEUE`, `STAGE_LABEL`,
   `nextStage`, `enqueueStage`).
4. Dienst in `services/service-registry.ts` eintragen, damit er im
   Health-Dashboard erscheint.
5. Worker bauen — siehe [PLUGINS.md](PLUGINS.md).
6. Bei Python-Workern das Schema in `workers/_shared` spiegeln.

## Einschränkung

Die Lua-Skripte greifen auf Schlüssel zu, die sie zur Laufzeit zusammensetzen.
Das funktioniert auf einem einzelnen Redis, **nicht** im Redis-Cluster-Modus.
Für dieses System ist das kein Problem: Ein lokaler Redis genügt bei weitem.
