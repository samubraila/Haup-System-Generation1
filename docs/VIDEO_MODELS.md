# Lokale Video-KI einrichten

Die Videogenerierung läuft ausschließlich auf deiner Hardware. Es wird keine
kostenpflichtige Cloud-API angesprochen. Der Adapter wird **pro Projekt**
gewählt (Projekte → Bearbeiten → *Video-KI Adapter*).

| Adapter | GPU nötig | VRAM | Erzeugt KI-Video |
|---|---|---|---|
| `placeholder` | nein | — | **nein**, technischer Testclip |
| `comfyui` | auf dem Host | je nach Workflow | ja |
| `ltx` | ja | ab 12 GB | ja |
| `wan` | ja | ab 10 GB | ja |

---

## Platzhalter

Voreinstellung nach der Installation. Erzeugt einen Clip mit dem Prompt-Text
und dem deutlich sichtbaren Hinweis **PLATZHALTER - kein KI-Video**.

Sinn: Die gesamte Kette — Skript, Schnitt, Untertitel, Freigabe, Planung,
Veröffentlichung — lässt sich in wenigen Minuten prüfen, bevor mehrere
Gigabyte Modelldaten geladen werden.

Der Adapter gibt in seinen Fähigkeiten `producesAiVideo: false` zurück, und die
Oberfläche weist im Assistenten darauf hin.

---

## GPU vorbereiten

### Voraussetzungen

- NVIDIA-GPU mit mindestens 10 GB VRAM
- Aktueller NVIDIA-Treiber
- NVIDIA Container Toolkit

### Windows mit Docker Desktop

1. Aktuellen NVIDIA-Treiber installieren (enthält WSL2-Unterstützung).
2. Docker Desktop → **Settings → Resources → WSL Integration** aktivieren.
3. Prüfen:

```bash
docker run --rm --gpus all nvidia/cuda:12.1.1-base-ubuntu22.04 nvidia-smi
```

Erscheint hier deine GPU, ist alles bereit. Andernfalls meldet
`node scripts/preflight.mjs` den Zustand ebenfalls.

### Linux

```bash
distribution=$(. /etc/os-release; echo $ID$VERSION_ID)
curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
curl -s -L https://nvidia.github.io/libnvidia-container/$distribution/libnvidia-container.list | \
  sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' | \
  sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list
sudo apt update && sudo apt install -y nvidia-container-toolkit
sudo nvidia-ctk runtime configure --runtime=docker
sudo systemctl restart docker
```

### GPU-Stack starten

```bash
docker compose -f docker-compose.yml -f docker-compose.gpu.yml --profile ai up -d --build
```

Der Video-Worker wird dabei auf ein CUDA-Basisimage umgestellt und bekommt
PyTorch. Der erste Bau lädt mehrere Gigabyte.

---

## LTX-Video

Schnelles Text-zu-Video-Modell, gut geeignet für kurze Clips.

```bash
docker compose run --rm --entrypoint bash video-worker -c "
  pip install -q huggingface_hub &&
  python3 -c \"
from huggingface_hub import snapshot_download
snapshot_download('Lightricks/LTX-Video', local_dir='/models/ltx-video')
\""
```

In der `.env`:

```ini
VIDEO_GENERATOR_PROVIDER=ltx
LTX_MODEL_PATH=/models/ltx-video
GPU_MIN_VRAM_MB=12000
```

Hinweise:

- Empfohlene Auflösungen sind Vielfache von 32. Für Hochformat funktioniert
  `768 x 1344` gut; die fertige Fassung skaliert der FFmpeg-Worker danach auf
  `1080 x 1920`.
- Die Bildanzahl folgt dem Muster `8n + 1` — darum wird sie automatisch
  angepasst.
- 30 Schritte und Guidance 3.5 sind ein brauchbarer Ausgangspunkt.

---

## Wan

Alternative mit geringerem VRAM-Bedarf in der kleinen Variante.

```bash
docker compose run --rm --entrypoint bash video-worker -c "
  pip install -q huggingface_hub &&
  python3 -c \"
from huggingface_hub import snapshot_download
snapshot_download('Wan-AI/Wan2.1-T2V-1.3B-Diffusers', local_dir='/models/wan')
\""
```

```ini
VIDEO_GENERATOR_PROVIDER=wan
WAN_MODEL_PATH=/models/wan
GPU_MIN_VRAM_MB=10000
```

---

## ComfyUI

Geeignet, wenn ComfyUI ohnehin schon läuft oder du volle Kontrolle über den
Ablauf willst. Der Worker braucht dann selbst **keine** GPU — er schickt
Aufträge an ComfyUI.

### 1. ComfyUI auf dem Host starten

```bash
python main.py --listen 0.0.0.0 --port 8188
```

`--listen 0.0.0.0` ist nötig, sonst erreicht der Container ComfyUI nicht.

### 2. Workflow exportieren

1. In ComfyUI: **Einstellungen → Enable Dev mode Options**
2. Workflow bauen und testen
3. **Save (API Format)** → Datei nach `workers/video/workflows/default_t2v.json`

### 3. Platzhalter einsetzen

Ersetze im JSON die festen Werte durch Platzhalter:

| Platzhalter | Inhalt |
|---|---|
| `%PROMPT%` | Bildbeschreibung der Szene |
| `%NEGATIVE_PROMPT%` | Negativer Prompt aus dem Projekt |
| `%WIDTH%`, `%HEIGHT%` | Zielauflösung |
| `%FRAMES%` | Bildanzahl (Dauer × FPS) |
| `%FPS%` | Bilder pro Sekunde |
| `%SEED%` | Zufallswert |
| `%STEPS%` | Diffusionsschritte |
| `%GUIDANCE%` | Guidance Scale |

Beispielausschnitt:

```json
{
  "6": {
    "class_type": "CLIPTextEncode",
    "inputs": { "text": "%PROMPT%", "clip": ["4", 1] }
  },
  "9": {
    "class_type": "EmptyLatentVideo",
    "inputs": { "width": "%WIDTH%", "height": "%HEIGHT%", "length": "%FRAMES%" }
  }
}
```

Zahlenwerte dürfen mit oder ohne Anführungszeichen stehen — der Adapter setzt
beides korrekt ein.

### 4. Konfigurieren

```ini
VIDEO_GENERATOR_PROVIDER=comfyui
COMFYUI_URL=http://host.docker.internal:8188
COMFYUI_WORKFLOW=default_t2v.json
```

Unter Linux ohne Docker Desktop stattdessen die Host-IP eintragen, etwa
`http://172.17.0.1:8188`.

### 5. Anforderung an den Workflow

Der Workflow **muss** einen Node enthalten, der eine Videodatei
(`.mp4`, `.webm`, `.mkv`) in den ComfyUI-Output schreibt, zum Beispiel
`VHS_VideoCombine`. Fehlt er, meldet der Worker einen klaren Fehler, statt ein
leeres Ergebnis zu liefern.

---

## Bildmodell (optional)

Für den Image-Worker (Profil `ai`):

```bash
docker compose run --rm --entrypoint bash image-worker -c "
  pip install -q huggingface_hub &&
  python3 -c \"
from huggingface_hub import snapshot_download
snapshot_download('stabilityai/stable-diffusion-xl-base-1.0', local_dir='/models/sdxl')
\""
```

```ini
IMAGE_MODEL_PATH=/models/sdxl
```

---

## Prüfen

In der Oberfläche unter **AI Studio → Video** und **System → GPU** steht für
jeden Adapter, ob er einsatzbereit ist:

```
ltx        Nicht eingerichtet   Modell fehlt unter /models/ltx-video
wan        Nicht eingerichtet   Modell fehlt unter /models/wan
comfyui    Nicht eingerichtet   ComfyUI ist nicht erreichbar
placeholder Testmodus           Erzeugt kein KI-Video
```

---

## Wenn keine GPU da ist

```
VIDEO JOB
    ↓
WAITING_FOR_GPU        ← kein Fehler, kein verbrauchter Versuch
    ↓  (alle 60 Sekunden erneut geprüft)
QUEUED → GENERATING → COMPLETED
```

Der Job bleibt beliebig lange in der Queue. Sobald ein Video-Worker mit GPU
erscheint — auch auf einem anderen Rechner, siehe
[REMOTE_GPU.md](REMOTE_GPU.md) — läuft er automatisch los. Alles andere
(Skripte, Schnitt, Untertitel, Planung, Veröffentlichung) funktioniert in der
Zwischenzeit uneingeschränkt.

---

## Speicherbedarf

| Modell | Größe |
|---|---|
| LTX-Video | etwa 20 GB |
| Wan 2.1 1.3B | etwa 8 GB |
| SDXL Base | etwa 7 GB |
| Whisper base | etwa 150 MB |
| Whisper large-v3 | etwa 3 GB |

Alles liegt im Docker-Volume `acf-models` und übersteht `docker compose down`.
Entfernen mit `docker volume rm acf-models`.
