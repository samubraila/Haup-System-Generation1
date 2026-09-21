# Sprachausgabe einrichten

Der Voice-Worker erzeugt aus dem Sprechertext des Skripts eine Tonspur. Er
nutzt **Piper**, eine lokale TTS-Engine — es werden keine Daten an einen
Dienstleister gesendet.

Ohne eingerichtete Stimme lehnt der Worker Aufträge mit einer klaren Meldung ab.
Er erzeugt bewusst **keine** stillen Dateien, die später als Fehler auffallen
würden.

---

## Schritt 1 — Worker starten

Der Voice-Worker liegt im Profil `ai`:

```bash
docker compose --profile ai up -d --build voice-worker
```

---

## Schritt 2 — Stimme herunterladen

Stimmen gibt es bei
<https://huggingface.co/rhasspy/piper-voices>.

Jede Stimme besteht aus **zwei** Dateien:

- `<name>.onnx` — das Modell
- `<name>.onnx.json` — die Konfiguration

Beide müssen nebeneinander liegen.

### Empfehlungen

| Sprache | Stimme | Qualität |
|---|---|---|
| Deutsch | `de_DE-thorsten-medium` | ausgewogen |
| Deutsch | `de_DE-thorsten-high` | besser, langsamer |
| Deutsch | `de_DE-eva_k-x_low` | sehr schnell |
| Englisch | `en_US-amy-medium` | ausgewogen |
| Spanisch | `es_ES-sharvard-medium` | ausgewogen |

### Herunterladen

```bash
docker compose run --rm --entrypoint bash voice-worker -c '
  mkdir -p /models/piper &&
  cd /models/piper &&
  curl -L -o de_DE-thorsten-medium.onnx \
    https://huggingface.co/rhasspy/piper-voices/resolve/main/de/de_DE/thorsten/medium/de_DE-thorsten-medium.onnx &&
  curl -L -o de_DE-thorsten-medium.onnx.json \
    https://huggingface.co/rhasspy/piper-voices/resolve/main/de/de_DE/thorsten/medium/de_DE-thorsten-medium.onnx.json &&
  ls -la
'
```

---

## Schritt 3 — Konfigurieren

In der `.env`:

```ini
TTS_PROVIDER=piper
PIPER_MODEL_PATH=/models/piper/de_DE-thorsten-medium.onnx
```

Neu starten:

```bash
docker compose --profile ai up -d voice-worker
```

---

## Schritt 4 — Im Projekt aktivieren

**Projekte → Bearbeiten → Sprachausgabe erzeugen** einschalten.

Ab dem nächsten Video läuft die Pipeline dann so:

```
Skript → KI-Video → Sprachausgabe → Untertitel → Rendern
```

Der Sprechertext stammt aus den `narration`-Feldern des Skripts. Der
FFmpeg-Worker legt die Tonspur unter die Bilder; der Subtitle-Worker
transkribiert sie für die Untertitel.

---

## Prüfen

Unter **AI Studio → Voice** steht der Zustand:

```
provider        piper
modelPath       /models/piper/de_DE-thorsten-medium.onnx
piperBinary     ja
modelPresent    ja
configPresent   ja
ready           ja
```

Steht `ready` auf `nein`, nennt das Feld `note` den Grund.

---

## Häufige Fehler

| Meldung | Ursache |
|---|---|
| `Es ist keine Stimme eingerichtet` | `TTS_PROVIDER=none` oder Modell fehlt |
| `Das Programm piper ist im Container nicht vorhanden` | Image ohne `piper-tts` gebaut — `docker compose build voice-worker` |
| `configPresent: false` | Die `.onnx.json` fehlt neben dem Modell |
| `Piper meldete einen Fehler` | Sprache passt nicht zum Text oder Modell ist beschädigt |

---

## Ohne Sprachausgabe arbeiten

Die Sprachausgabe ist optional. Ist sie im Projekt ausgeschaltet, überspringt
die Pipeline den Schritt.

Wichtig dabei: Ohne Tonspur kann der Subtitle-Worker nichts transkribieren. Er
meldet dann `Die Quelldatei enthält keine verwertbare Tonspur` — korrekt, aber
unnötig. Für Videos ohne Sprache deshalb auch die Untertitel im Projekt
ausschalten oder eine eigene Audiodatei über die Medienbibliothek hochladen.

---

## Geschwindigkeit anpassen

Im Projekt lässt sich `voiceSpeed` zwischen 0,5 und 2,0 einstellen. Intern wird
daraus Pipers `length_scale` (Kehrwert): 1,2 bedeutet schnelleres Sprechen.

## Mehrere Stimmen

Aktuell nutzt der Worker eine Stimme für alle Projekte. Für mehrere Stimmen
lässt sich `PIPER_MODEL_PATH` je Worker-Instanz unterschiedlich setzen und ein
zweiter Voice-Worker mit eigener `WORKER_ID` starten — siehe
[PLUGINS.md](PLUGINS.md).
