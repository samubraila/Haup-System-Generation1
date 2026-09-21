# Datenbank

Das Schema wird beim Start des Backends automatisch aus
`backend/src/db/migrations/*.sql` angewendet. Eine Advisory Lock verhindert,
dass zwei gleichzeitig startende Backend-Container kollidieren.

Dateien in `database/init/` werden von PostgreSQL **einmalig** beim allerersten
Start ausgefuehrt (leeres Datenverzeichnis). Nutze das nur fuer Dinge, die vor
den Migrationen passieren muessen, etwa zusaetzliche Rollen oder Extensions.

Neue Migration anlegen:

1. Datei `backend/src/db/migrations/00X_beschreibung.sql` erstellen.
2. Backend neu starten: `docker compose restart backend`.

Bereits angewendete Migrationen duerfen nicht mehr geaendert werden. Das Backend
prueft die Pruefsumme und verweigert den Start bei nachtraeglichen Aenderungen.
