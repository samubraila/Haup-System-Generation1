# n8n Automatisierungen

Der n8n-Container laeuft unter http://localhost:5678 und ist ueber Basic Auth
geschuetzt (`N8N_BASIC_AUTH_USER` / `N8N_BASIC_AUTH_PASSWORD` aus der `.env`).

## Vorlagen importieren

Die Dateien in `workflows/` sind im Container unter `/workflows` eingehaengt.

1. n8n oeffnen, oben rechts auf **Import from File**.
2. Datei aus `n8n/workflows/` auswaehlen.
3. Workflow speichern und aktivieren.

## Zugriff auf die Plattform

Die Workflows sprechen das Backend ueber zwei Umgebungsvariablen an, die der
Container bereits gesetzt bekommt:

| Variable           | Inhalt                          |
|--------------------|---------------------------------|
| `ACF_BACKEND_URL`  | `http://backend:4000`           |
| `ACF_API_KEY`      | Wert aus `INTERNAL_API_KEY`     |

In den HTTP-Request-Nodes stehen sie als `{{ $env.ACF_BACKEND_URL }}` und
`{{ $env.ACF_API_KEY }}` zur Verfuegung. Der Key gehoert in den Header
`x-api-key`.

## Grenzen der Automatisierung

Verlangt ein Projekt eine manuelle Freigabe, lehnt
`POST /api/automation/videos/{id}/publish` die Veroeffentlichung mit HTTP 409 und
dem Code `approval_required` ab. Das ist Absicht: Automatisierungen duerfen
produzieren und planen, aber nicht die Freigabe umgehen.

Alle verfuegbaren Endpunkte stehen in der Oberflaeche unter
**Automatisierungen** und in `docs/API.md`.
