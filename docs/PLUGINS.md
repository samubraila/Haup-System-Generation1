# Erweitern

Neue Funktionen kommen als **neuer Worker oder neuer Adapter**. Der Kern des
Hauptsystems bleibt dabei unberührt.

---

## Video-KI-Adapter

Ein Adapter kapselt genau ein Modell. Das System kennt bereits LTX, Wan,
ComfyUI und den Platzhalter.

### 1. Adapterklasse anlegen

`workers/video/app/adapters/meinmodell.py`:

```python
from __future__ import annotations

import logging
from typing import Any, Callable

from .base import AdapterUnavailable, GenerationRequest


class MeinModellAdapter:
    name = "meinmodell"
    requires_gpu = True
    produces_ai_video = True

    def prepare(self, config: Any, logger: logging.Logger) -> dict[str, Any]:
        path = os.path.join(config.models_dir, "meinmodell")
        present = os.path.isdir(path)
        return {
            "adapter": self.name,
            "producesAiVideo": True,
            "modelPath": path,
            "modelPresent": present,
            "note": None if present else f"Modell fehlt unter {path}",
        }

    def generate(self, request: GenerationRequest, report_progress, logger) -> str:
        report_progress(10.0, "Modell wird geladen")
        ...
        report_progress(100.0, "Fertig")
        return request.output_path
```

Pflichten eines Adapters:

- `prepare` darf **nie** werfen, wenn nur das Modell fehlt. Stattdessen
  `modelPresent: False` und eine verständliche `note` zurückgeben — die
  Oberfläche zeigt das dann als *Nicht eingerichtet*.
- `generate` schreibt die fertige Datei nach `request.output_path` und meldet
  Fortschritt.
- Fehlt eine Bibliothek oder ein Modell, `AdapterUnavailable` werfen. Der
  Worker macht daraus einen dauerhaften Fehler ohne sinnlose Wiederholungen.

Basiert das Modell auf `diffusers`, genügt meist eine Unterklasse:

```python
from .diffusers_base import DiffusersVideoAdapter


class MeinModellAdapter(DiffusersVideoAdapter):
    name = "meinmodell"
    pipeline_class_path = "diffusers.MeinModellPipeline"
    model_env_key = "MEINMODELL_MODEL_PATH"
    frame_limit = 129
```

### 2. Registrieren

`workers/video/app/main.py`:

```python
ADAPTERS = {
    "ltx": LtxAdapter,
    "wan": WanAdapter,
    "comfyui": ComfyUiAdapter,
    "meinmodell": MeinModellAdapter,
    "placeholder": PlaceholderAdapter,
}
```

### 3. Auswählbar machen

In `packages/worker-core/src/jobs.ts` und
`backend/src/services/types.ts` den Wert zur Aufzählung `videoProvider`
hinzufügen, ebenso in `frontend/src/lib/types.ts` und im Auswahlfeld in
`frontend/src/pages/Projects.tsx`.

### 4. Bauen

```bash
docker compose build video-worker
docker compose up -d video-worker
```

---

## Publisher-Worker

Für eine neue Plattform, etwa LinkedIn.

### 1. Adapter schreiben

`packages/publisher-core/src/adapters/linkedin.ts`:

```ts
import { requestJson } from '../http.js';
import {
  emptyAnalytics,
  PlatformRejectedError,
  type PlatformAdapter,
} from '../types.js';

export const linkedinAdapter: PlatformAdapter = {
  platform: 'linkedin',
  label: 'LinkedIn',
  maxFileBytes: 5 * 1024 * 1024 * 1024,
  supportedMimeTypes: ['video/mp4'],

  async publish(input, ctx) {
    await ctx.reportProgress(5, 'Upload wird angemeldet');
    // ... offizielle API aufrufen
    return { externalPostId: '…', externalUrl: '…' };
  },

  async fetchAnalytics(externalPostId, ctx) {
    return emptyAnalytics({ note: 'Noch nicht implementiert' });
  },
};
```

Fehlerklassen benutzen:

- `ReconnectRequiredError` bei abgelaufenem oder zurückgezogenem Token →
  das Konto wird auf `expired` gesetzt, die Oberfläche bietet **Reconnect**
- `PlatformRejectedError` bei inhaltlicher Ablehnung → kein Retry
- alles andere → normaler Retry mit Backoff

### 2. OAuth-Anbindung

In `backend/src/services/social/providers.ts` einen Eintrag nach dem Muster von
`youtube` oder `tiktok` ergänzen: `authorizeUrl`, `exchangeCode`, `refresh`,
`fetchProfile`, `requiredEnv`, `scopes`.

Dann `SUPPORTED_PLATFORMS` erweitern und die Plattform in der Migration
freigeben:

```sql
ALTER TABLE social_accounts DROP CONSTRAINT social_accounts_platform_check;
ALTER TABLE social_accounts ADD CONSTRAINT social_accounts_platform_check
  CHECK (platform IN ('youtube','tiktok','instagram','facebook','linkedin'));
```

Als **neue** Migrationsdatei anlegen — bereits angewendete Dateien dürfen nicht
geändert werden.

### 3. Queue und Worker

- `QUEUES.PUBLISH_LINKEDIN = 'publish.linkedin'` in
  `packages/worker-core/src/types.ts`
- Zuordnung in `backend/src/services/publisher.ts` (`PLATFORM_QUEUE`,
  `PREFERRED_TARGET`)
- Eintrag in `backend/src/services/service-registry.ts`
- Neues Workspace-Paket `workers/publishers/linkedin` nach dem Muster der
  vorhandenen (eine Datei mit vier Zeilen)
- Dienst in `docker-compose.yml` ergänzen

### 4. Oberfläche

`PLATFORM_META` in `frontend/src/lib/format.ts` und die `Platform`-Union in
`frontend/src/lib/types.ts` erweitern. Die Seiten Social, Publishing und
Kalender übernehmen den Rest automatisch.

---

## Neuer Worker

Für einen zusätzlichen Pipeline-Schritt, zum Beispiel Musikerzeugung.

### TypeScript

```ts
import { PermanentJobError, QUEUES, runWorker } from '@acf/worker-core';

await runWorker({
  name: 'music-worker',
  queue: QUEUES.MUSIC,
  defaultConcurrency: 1,

  async onStart({ logger }) {
    return { engine: 'meine-engine' };
  },

  async handler(ctx) {
    await ctx.reportProgress(10, 'Musik wird erzeugt');
    const workDir = await ctx.storage.createTempDir('music');
    try {
      // erzeugen ...
      const target = ctx.storage.projectPath(projectId, 'audio', 'musik.mp3');
      await ctx.storage.push(localPath, target, 'audio/mpeg');
      const media = await ctx.api.registerMedia({ /* ... */ });
      return { mediaId: media.id };
    } finally {
      await ctx.storage.removeTempDir(workDir);
    }
  },
});
```

`runWorker` bringt bereits mit: Queue-Polling, Sperr-Heartbeats,
Zeitüberschreitung, Retry mit Backoff, Crash-Wiederherstellung,
Health-Endpunkt auf Port 9000, Registrierung im Dashboard und sauberes
Herunterfahren.

### Python

```python
from acfworker import JobContext, PermanentJobError, run_worker


def handle(ctx: JobContext) -> dict:
    ctx.report_progress(10, "Start")
    ...
    return {"mediaId": media["id"]}


def main() -> None:
    run_worker(name="music-worker", queue="music", handler=handle, on_start=on_start)
```

### Im Hauptsystem verankern

1. Queue-Name in `packages/worker-core/src/types.ts` (`QUEUES`)
2. Payload-Schema in `packages/worker-core/src/jobs.ts`
3. Pipeline in `backend/src/services/pipeline.ts`: `STAGE_QUEUE`,
   `STAGE_LABEL`, `plannedStages`, `nextStage`, `enqueueStage`
4. Ergebnisverarbeitung in
   `backend/src/modules/internal.routes.ts` (`applyVideoJobResult`)
5. Eintrag in `backend/src/services/service-registry.ts`
6. Dienst in `docker-compose.yml`, optional mit `profiles: ["ai"]`

---

## Skript-Quelle

Der Script-Worker kann heute Vorlagen und Ollama. Eine weitere Quelle kommt in
`workers/script/src/generators.ts` dazu — sie muss ein `ScriptDraft` mit
`scenes` liefern. Danach den Wert in `scriptProvider` ergänzen
(`backend/src/services/types.ts`, `frontend/src/lib/types.ts`, Auswahlfeld in
`Projects.tsx`).

Die Vorlagen-Quelle bleibt als Rückfall bestehen: Ist Ollama nicht erreichbar,
protokolliert der Worker das deutlich und liefert ein Gerüst, statt den Job
scheitern zu lassen.

---

## Vorbereitete Erweiterungen

Die Schnittstellen stehen, die Umsetzung erfolgt je als eigener Worker:

| Funktion | Ansatzpunkt |
|---|---|
| Music Generation | neuer Worker `music`, Einbindung im FFmpeg-Job über `musicPath` |
| Automatische Übersetzung | neuer Worker `translate`, zusätzliche Untertitelspur je Sprache |
| Thumbnail-Erzeugung | Image-Worker mit eigenem Job-Typ |
| Hashtag- und Beschreibungstexte | Script-Worker um einen zweiten Job-Typ erweitern |
| Content Scoring | Feld `ideas.score` wird bereits geführt |
| A/B-Testing | mehrere `social_posts` je Video, Vergleich über `analytics` |
| Revenue Tracking | neue Tabelle mit Bezug auf `social_posts` |
| Affiliate-Links | Feld in `social_posts.meta`, Einsetzen im Publisher-Adapter |

---

## Konventionen

- **Worker schreiben nie direkt in PostgreSQL.** Immer über die interne API.
- **Jeder Worker bedient genau eine Queue.** Mehr Aufgaben bedeuten mehr Worker.
- **Fehlende Einrichtung ist kein Absturz.** `prepare` meldet den Zustand, die
  Oberfläche zeigt ihn an.
- **Nichts vortäuschen.** Kann ein Schritt nicht ausgeführt werden, sagt das
  System das — es liefert keine leeren oder erfundenen Ergebnisse.
- **Temporäre Dateien aufräumen.** `createTempDir` immer mit `finally` und
  `removeTempDir`.
