# Sicherheit

Das System läuft lokal, verwaltet aber Zugangsdaten zu Social-Media-Konten.
Ein gestohlenes Token bedeutet fremden Zugriff auf deine Kanäle. Entsprechend
ist der Umgang damit ausgelegt.

## Anmeldung und Sitzungen

- **Passwörter:** bcrypt mit Kostenfaktor 12. Klartext wird nirgends abgelegt.
- **Mindestanforderung:** 12 Zeichen, Groß- und Kleinbuchstaben, mindestens eine
  Ziffer.
- **Sperre:** Nach acht Fehlversuchen ist das Konto 15 Minuten gesperrt.
- **Einheitliche Fehlermeldung:** Bei unbekannter Adresse wird trotzdem ein
  bcrypt-Vergleich ausgeführt, damit die Antwortzeit nicht verrät, ob ein Konto
  existiert.
- **Zugriffstoken:** JWT, 15 Minuten gültig, in einem httpOnly-Cookie.
- **Refresh-Token:** 30 Tage, zufällig erzeugt, nur als SHA-256-Hash
  gespeichert, bei jeder Erneuerung rotiert. Das Cookie gilt nur für
  `/api/auth`.
- **Kontostatus:** Bei jeder Anfrage wird gegen die Datenbank geprüft. Ein
  deaktiviertes Konto verliert den Zugang sofort, nicht erst nach Ablauf.
- **Passwortwechsel:** Beendet alle bestehenden Sitzungen.

## CSRF

Double-Submit-Verfahren:

1. Bei der Anmeldung wird ein lesbares Cookie `acf_csrf` gesetzt.
2. Jede schreibende Anfrage muss denselben Wert als Header `X-CSRF-Token`
   senden.
3. Der Vergleich erfolgt zeitkonstant.

Fremdes JavaScript kann das Cookie wegen der Same-Origin-Policy nicht lesen und
damit keine schreibende Anfrage stellen. Zusätzlich gilt `SameSite=lax`.

Ausgenommen sind Aufrufe mit `X-API-Key` — sie tragen kein Cookie und sind
deshalb nicht anfällig.

## OAuth-Tokens

```
Plattform ──Code──▶ Backend ──AES-256-GCM──▶ PostgreSQL
                       │
                       └──nur intern──▶ Publisher-Container
```

- **Verschlüsselung:** AES-256-GCM mit zufälligem 96-Bit-IV je Wert.
  Format `v1.<iv>.<authTag>.<ciphertext>`.
- **Integrität:** Das GCM-Auth-Tag schlägt bei jeder Manipulation fehl.
- **Schlüssel:** `ENCRYPTION_KEY`, 32 Byte, ausschließlich in der `.env`.
- **Auslieferung:** Tokens erreichen den Browser nie. Die API gibt sie nur über
  `/api/internal/social-accounts/{id}/credentials` an Aufrufer mit gültigem
  API-Key heraus.
- **Logs:** Der Logger entfernt `authorization`, `cookie`, `x-api-key`,
  `password`, `accessToken`, `refreshToken`, `client_secret` automatisch.
- **Trennen eines Kontos** löscht die Tokens aus der Datenbank.

Geht `ENCRYPTION_KEY` verloren, sind alle Tokens unlesbar und die Konten müssen
neu verbunden werden. Der Schlüssel liegt im Backup (`scripts/backup.sh`).

## Netzwerkgrenzen

| Von | Nach | Erlaubt |
|---|---|---|
| Browser | Frontend | ja |
| Frontend | Backend | ja |
| Browser | `/api/internal`, `/api/automation` | **nein**, Proxy antwortet 404 |
| Backend | PostgreSQL, Redis | ja |
| Worker | Redis, Backend-API, Storage | ja |
| Worker | PostgreSQL | **nein**, nicht im selben Netz |
| n8n | Backend | ja |
| n8n | Redis, PostgreSQL | **nein** |

Das Netz `acf-data` ist als `internal: true` markiert und hat keinen
Internetzugang. PostgreSQL und Redis sind nicht auf dem Host veröffentlicht.

## Container

| Maßnahme | Umsetzung |
|---|---|
| Kein Root | Node als `node`, Python als UID 1000, nginx unprivilegiert |
| `no-new-privileges` | alle Container |
| `cap_drop: ALL` | alle Container; Storage erhält nur `CHOWN`, `FOWNER`, `DAC_OVERRIDE` |
| Schreibgeschütztes Wurzeldateisystem | backend, frontend, storage, alle TypeScript-Worker |
| Schreibzugriff | nur `/data` und `tmpfs` |
| Nur-Lese-Zugriff | Publisher binden `/data` mit `:ro` ein |
| Ressourcenlimits | CPU und RAM je Container gesetzt |
| Healthchecks | jeder Container |

## Eingaben

- **Schemaprüfung:** Jeder Request-Body wird mit Zod geprüft; unbekannte Felder
  fallen weg.
- **SQL:** Ausschließlich parametrisierte Abfragen. Keine Zeichenkettenbildung
  mit Benutzerdaten.
- **Pfade:** Jeder Speicherpfad wird normalisiert und muss innerhalb von
  `DATA_DIR` liegen. `../` wird abgewiesen — im Backend, in der TypeScript- und
  in der Python-Storage-Klasse.
- **Uploads:** MIME-Typ gegen `ALLOWED_UPLOAD_MIME`, zusätzlich Abgleich mit der
  Dateiendung, Größenbegrenzung über `MAX_UPLOAD_MB`, eine Datei pro Anfrage,
  Dateinamen werden bereinigt.
- **Ausgabe:** Dateien werden mit `X-Content-Type-Options: nosniff` und dem
  registrierten MIME-Typ ausgeliefert.

## Security-Header

Gesetzt über Helmet im Backend und zusätzlich in nginx:

```
Content-Security-Policy: default-src 'self'; object-src 'none'; frame-ancestors 'none'; ...
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: no-referrer
Cross-Origin-Resource-Policy: same-site
Permissions-Policy: camera=(), microphone=(), geolocation=()
```

Mit `COOKIE_SECURE=true` kommt HSTS hinzu.

## Live-Aktualisierung

Der Ereignisstrom (`/api/system/events`) liefert Ereignisse zu Videos, Jobs und
Veröffentlichungen **nur an den Besitzer** des jeweiligen Projekts. Technische
Logmeldungen gehen an alle angemeldeten Abonnenten — genau wie der
REST-Endpunkt `/api/system/logs`, der ebenfalls systemweit ist.

## Grenzwerte

| Bereich | Grenze |
|---|---|
| API gesamt | 300 Anfragen pro Minute |
| Anmeldung | 10 Versuche pro Minute, erfolgreiche zählen nicht |
| Uploads | 30 pro Minute |
| JSON-Body | 2 MB |
| Datei-Upload | `MAX_UPLOAD_MB`, Standard 512 MB |

## Nachvollziehbarkeit

Zwei getrennte Protokolle:

- **`logs`** — technische Meldungen aus allen Containern, sichtbar unter
  *System → Logs*, werden nach `LOG_RETENTION_DAYS` gelöscht.
- **`audit_logs`** — fachliche Vorgänge mit Benutzer, IP und Zeitpunkt:
  Anmeldung, fehlgeschlagene Anmeldung, Projekt- und Videoänderungen, Freigaben,
  Verbinden und Trennen von Konten, Veröffentlichungen, Backups. Wird nicht
  automatisch gelöscht, nur für Admins sichtbar.

## Start-Prüfung

Das Backend startet nicht, wenn

- ein Pflichtwert fehlt,
- `ENCRYPTION_KEY` nicht exakt 64 Hex-Zeichen hat,
- `JWT_SECRET` kürzer als 32 Zeichen ist,
- `ADMIN_PASSWORD` kürzer als 12 Zeichen ist,
- oder im Produktivmodus noch ein `CHANGE_ME`-Platzhalter steht.

Das ist Absicht: Ein System mit unsicherer Voreinstellung soll gar nicht erst
laufen.

## Was dieses System nicht leistet

- **Keine Mehrmandantenfähigkeit.** Trennung erfolgt je Benutzer über
  `user_id`, ist aber nicht als Absicherung gegen bösartige Mitbenutzer
  ausgelegt.
- **Kein HTTPS im Auslieferungszustand.** Für den Betrieb über ein Netz braucht
  es einen Reverse-Proxy mit TLS und `COOKIE_SECURE=true`.
- **Keine Zwei-Faktor-Authentifizierung.**
- **Keine Verschlüsselung der Mediendateien im Ruhezustand.** Wer Zugriff auf
  `./data` hat, sieht die Videos.

## Wenn etwas passiert ist

1. `docker compose down`
2. Alle Social-Media-Konten in den jeweiligen Portalen trennen (Google:
   Sicherheit → Drittanbieter-Apps; Meta: Business-Integrationen; TikTok:
   Sicherheit → Verbundene Apps).
3. Neue Secrets erzeugen: `node scripts/generate-secrets.mjs --force`
4. Sitzungen beenden:
   `docker compose exec postgres psql -U $POSTGRES_USER -d $POSTGRES_DB -c "UPDATE refresh_tokens SET revoked_at = now();"`
5. `docker compose up -d`, Konten neu verbinden.
6. `audit_logs` prüfen: `GET /api/system/audit` oder direkt per SQL.
