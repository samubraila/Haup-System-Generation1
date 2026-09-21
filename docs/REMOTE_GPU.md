# GPU-Worker auf einem anderen Rechner

Das Hauptsystem hat keine Abhängigkeit zu einer bestimmten GPU. Der
Video-Worker kann deshalb auf einem beliebigen Rechner im Netzwerk laufen —
zum Beispiel auf einem Gaming-PC mit starker Grafikkarte, während das
Hauptsystem auf dem Laptop bleibt.

```
LAPTOP                                GPU-PC
┌──────────────────────┐              ┌────────────────────────┐
│ Frontend             │              │ content-video-worker   │
│ Backend              │◀── REST ─────│                        │
│ PostgreSQL           │              │  NVIDIA GPU            │
│ Redis                │◀── Queue ────│  LTX / Wan / ComfyUI   │
│ n8n                  │              │                        │
│ ffmpeg-worker        │              └────────────────────────┘
│ publisher-*          │
└──────────────────────┘
```

Der entfernte Worker braucht genau zwei Dinge: **Redis** (Jobs abholen) und die
**interne Backend-API** (Ergebnisse melden). Er bekommt keinen Zugang zur
Datenbank.

---

## Schritt 1 — Laptop vorbereiten

Standardmäßig sind Redis und das Backend nur im Docker-Netz erreichbar. Für den
entfernten Worker müssen beide Ports gezielt geöffnet werden.

`docker-compose.override.yml` im Projektverzeichnis anlegen:

```yaml
services:
  redis:
    ports:
      - "6379:6379"

  backend:
    ports:
      - "4000:4000"
```

Übernehmen:

```bash
docker compose up -d redis backend
```

Lokale IP ermitteln:

```bash
# Windows
ipconfig | findstr IPv4
# Linux / macOS
hostname -I
```

Angenommen `192.168.1.50`.

### Firewall

Windows-Firewall (als Administrator in PowerShell):

```powershell
New-NetFirewallRule -DisplayName "ACF Redis" -Direction Inbound -LocalPort 6379 -Protocol TCP -Action Allow -RemoteAddress 192.168.1.0/24
New-NetFirewallRule -DisplayName "ACF Backend" -Direction Inbound -LocalPort 4000 -Protocol TCP -Action Allow -RemoteAddress 192.168.1.0/24
```

Die Einschränkung auf das lokale Subnetz ist wichtig. Redis ist zwar durch
`REDIS_PASSWORD` geschützt, gehört aber trotzdem nicht ins offene Internet.

---

## Schritt 2 — GPU-PC vorbereiten

1. Docker und NVIDIA Container Toolkit installieren
   (siehe [VIDEO_MODELS.md](VIDEO_MODELS.md)).
2. Repository klonen:

```bash
git clone https://github.com/samubraila/Haup-System-Generation1.git
cd Haup-System-Generation1
```

3. `.env` anlegen — nur die Werte, die der Worker braucht:

```ini
REDIS_URL=redis://:DEIN_REDIS_PASSWORT@192.168.1.50:6379
BACKEND_URL=http://192.168.1.50:4000
INTERNAL_API_KEY=DERSELBE_WERT_WIE_AUF_DEM_LAPTOP

WORKER_ID=video-worker-gpu-pc
STORAGE_MODE=api
DATA_DIR=/data

VIDEO_GENERATOR_PROVIDER=ltx
LTX_MODEL_PATH=/models/ltx-video
GPU_MODE=auto
GPU_MIN_VRAM_MB=12000
GENERATION_CONCURRENCY=1
LOG_LEVEL=info
```

`REDIS_PASSWORD` und `INTERNAL_API_KEY` müssen **exakt** den Werten aus der
`.env` des Laptops entsprechen.

4. Starten:

```bash
docker compose -f docker-compose.remote-worker.yml up -d --build
```

---

## Schritt 3 — Prüfen

Auf dem Laptop in der Oberfläche unter **System → Dienste** erscheint der
Worker mit dem Hostnamen des GPU-PCs. Unter **System → GPU** stehen Modell,
VRAM und Auslastung.

Auf dem GPU-PC:

```bash
docker compose -f docker-compose.remote-worker.yml logs -f
curl http://localhost:9000/health
```

Wartende Jobs starten von selbst, sobald der Worker sich registriert hat.

---

## Dateiübertragung

| Modus | Bedeutung |
|---|---|
| `STORAGE_MODE=volume` | Gemeinsames Dateisystem (Standard bei lokalem Betrieb) |
| `STORAGE_MODE=api` | Dateien laufen über die interne Backend-API |

Für entfernte Worker ist `api` die richtige Wahl: Es braucht keine
Netzwerkfreigabe, der Worker lädt Eingaben per HTTP und schickt das fertige
Video zurück. Ein 30-Sekunden-Clip liegt typischerweise bei 3–10 MB.

Alternativ lässt sich `/data` per SMB oder NFS einbinden und
`STORAGE_MODE=volume` verwenden. Das ist schneller bei sehr großen Dateien,
aber aufwendiger einzurichten.

---

## Mehrere GPU-PCs

Beliebig viele Video-Worker dürfen parallel laufen. Jeder holt sich Jobs aus
derselben Queue; die Sperre verhindert Doppelarbeit. Jeder bekommt eine eigene
`WORKER_ID`, damit das Dashboard sie auseinanderhalten kann:

```ini
WORKER_ID=video-worker-gpu-pc-1
```

---

## Hinweise zum Betrieb

- **GPU-PC ausgeschaltet:** Jobs bleiben in `WAITING_FOR_GPU` oder werden nach
  Ablauf der Sperre automatisch wiederhergestellt. Nichts geht verloren.
- **Netz weg:** Der Worker versucht Redis und Backend mit wachsendem Abstand
  erneut zu erreichen und nimmt die Arbeit danach wieder auf.
- **Zeitüberschreitung:** `JOB_TIMEOUT_MS` großzügig setzen; große Modelle
  brauchen für ein paar Sekunden Video durchaus mehrere Minuten.
- **Mehrere GPUs im selben Rechner:** `NVIDIA_VISIBLE_DEVICES=0` beziehungsweise
  `=1` setzen und zwei Worker mit unterschiedlicher `WORKER_ID` starten.

## Betrieb über das Internet

Davon ist ohne zusätzliche Absicherung abzuraten. Wenn es sein muss:

- Redis und Backend **nicht** direkt veröffentlichen
- stattdessen ein VPN wie WireGuard oder Tailscale zwischen beiden Rechnern
- oder einen Reverse-Proxy mit TLS vor dem Backend und `redis` über TLS-Tunnel
- `COOKIE_SECURE=true` setzen, sobald HTTPS im Spiel ist
