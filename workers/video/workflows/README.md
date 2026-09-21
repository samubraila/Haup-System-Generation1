# ComfyUI Workflows

Lege hier exportierte ComfyUI-Workflows im **API-Format** ab
(ComfyUI: Einstellungen -> "Enable Dev mode Options" -> "Save (API Format)").

Der Adapter ersetzt vor dem Absenden folgende Platzhalter im JSON:

| Platzhalter           | Inhalt                                   |
|-----------------------|------------------------------------------|
| `%PROMPT%`            | Bildbeschreibung der Szene               |
| `%NEGATIVE_PROMPT%`   | Negativer Prompt aus den Projekteinstellungen |
| `%WIDTH%` / `%HEIGHT%`| Zielaufloesung                           |
| `%FRAMES%`            | Anzahl Einzelbilder (Dauer x FPS)        |
| `%FPS%`               | Bilder pro Sekunde                       |
| `%SEED%`              | Zufallswert                              |
| `%STEPS%`             | Anzahl Diffusionsschritte                |
| `%GUIDANCE%`          | Guidance Scale                           |

Die Datei, die verwendet wird, steuerst du ueber `COMFYUI_WORKFLOW` in der `.env`
(Standard: `default_t2v.json`).

Der Workflow muss einen Node enthalten, der eine Videodatei (`.mp4`, `.webm` oder `.mkv`)
in den ComfyUI-Output schreibt, zum Beispiel `VHS_VideoCombine`. Ohne einen solchen Node
meldet der Worker einen Fehler, statt ein leeres Ergebnis zu liefern.
