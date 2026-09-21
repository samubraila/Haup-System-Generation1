# Social Media einrichten

Jede Plattform verlangt eine eigene App-Registrierung. Das ist keine
Einschränkung dieser Software, sondern die Bedingung der Plattformen für
API-Zugriff. Solange Zugangsdaten fehlen, zeigt die Oberfläche **Not configured**
und nennt genau die fehlenden Variablen.

Nach jeder Änderung an der `.env`:

```bash
docker compose up -d backend
```

---

## YouTube

**Portal:** <https://console.cloud.google.com/>
**API:** YouTube Data API v3

### Schritte

1. Projekt anlegen (oben links auf die Projektauswahl → **Neues Projekt**).
2. **APIs & Dienste → Bibliothek** → *YouTube Data API v3* → **Aktivieren**.
   Für Analytics zusätzlich *YouTube Analytics API*.
3. **APIs & Dienste → OAuth-Zustimmungsbildschirm**
   - Nutzertyp: **Extern**
   - App-Name, Support-E-Mail, Entwicklerkontakt ausfüllen
   - Bereiche hinzufügen:
     - `https://www.googleapis.com/auth/youtube.upload`
     - `https://www.googleapis.com/auth/youtube.readonly`
     - `https://www.googleapis.com/auth/yt-analytics.readonly`
   - Unter **Testnutzer** die eigene Google-Adresse eintragen.
4. **APIs & Dienste → Anmeldedaten → Anmeldedaten erstellen → OAuth-Client-ID**
   - Anwendungstyp: **Webanwendung**
   - Autorisierte Weiterleitungs-URI:
     `http://localhost:4000/api/social/youtube/callback`
5. Client-ID und Client-Schlüssel in die `.env`:

```ini
YOUTUBE_CLIENT_ID=123456789-abcdef.apps.googleusercontent.com
YOUTUBE_CLIENT_SECRET=GOCSPX-...
YOUTUBE_REDIRECT_URI=http://localhost:4000/api/social/youtube/callback
```

### Wissenswert

- **Kontingent:** Standardmäßig 10 000 Einheiten pro Tag. Ein Upload kostet
  etwa 1600 Einheiten — realistisch also rund 6 Uploads täglich. Mehr gibt es
  nur über einen Antrag bei Google.
- **Nicht verifizierte Apps** dürfen nur Testnutzer bedienen und Videos nur
  **privat** oder **nicht gelistet** hochladen. Für öffentliche Uploads ist
  Googles Überprüfung nötig.
- **Vorschaubilder** setzen darf nur ein bestätigter Kanal. Schlägt das fehl,
  wird das Video trotzdem hochgeladen und eine Warnung ins Log geschrieben.
- **Geplante Veröffentlichung** übernimmt YouTube selbst (`publishAt`). Das
  Video wird privat hochgeladen und zum Termin freigeschaltet.

---

## TikTok

**Portal:** <https://developers.tiktok.com/>
**API:** Content Posting API

### Schritte

1. Entwicklerkonto anlegen und verifizieren.
2. **Manage apps → Connect an app** → App anlegen.
3. Produkte hinzufügen: **Login Kit** und **Content Posting API**.
4. Berechtigungen (Scopes) anfordern:
   - `user.info.basic`
   - `video.upload`
   - `video.publish`
   - `video.list` (optional, für Statistiken)
5. Redirect-URI eintragen:
   `http://localhost:4000/api/social/tiktok/callback`
6. Client Key und Client Secret in die `.env`:

```ini
TIKTOK_CLIENT_KEY=aw...
TIKTOK_CLIENT_SECRET=...
TIKTOK_REDIRECT_URI=http://localhost:4000/api/social/tiktok/callback
```

### Wissenswert

- **Solange die App nicht geprüft ist**, erlaubt TikTok ausschließlich
  `SELF_ONLY` — die Videos sind nur für dich sichtbar. Wähle in der Oberfläche
  entsprechend *Privat*. Das ist eine Vorgabe von TikTok.
- **Domain-Verifizierung** ist Voraussetzung für die Prüfung. Auf `localhost`
  lässt sie sich nicht durchführen; dafür braucht es eine erreichbare Domain.
- TikTok verarbeitet das Video nach dem Upload. Der Worker fragt den Status bis
  zu fünf Minuten lang ab und meldet erst danach Erfolg oder Fehler.
- Höchstens 4 GB je Datei, Upload in 10-MB-Blöcken.

---

## Instagram

**Portal:** <https://developers.facebook.com/>
**API:** Instagram Graph API (Content Publishing)

### Voraussetzungen

Instagram veröffentlicht nur über ein **Instagram-Business- oder
Creator-Konto**, das mit einer **Facebook-Seite** verknüpft ist. Ein privates
Instagram-Konto genügt nicht.

1. Instagram-App → Einstellungen → Konto → **Zu professionellem Konto wechseln**
2. Facebook-Seite anlegen oder vorhandene wählen
3. In den Instagram-Einstellungen die Facebook-Seite verknüpfen

### Schritte

1. **Meine Apps → App erstellen** → Typ **Business**.
2. Produkte hinzufügen: **Instagram Graph API** und **Facebook Login**.
3. Unter **Facebook Login → Einstellungen** die Weiterleitungs-URI eintragen:
   `http://localhost:4000/api/social/instagram/callback`
4. Berechtigungen anfordern:
   - `instagram_basic`
   - `instagram_content_publish`
   - `pages_show_list`
   - `business_management`
5. App-ID und App-Geheimnis in die `.env`:

```ini
INSTAGRAM_APP_ID=...
INSTAGRAM_APP_SECRET=...
INSTAGRAM_REDIRECT_URI=http://localhost:4000/api/social/instagram/callback
```

### Wissenswert

- **25 Beiträge in 24 Stunden** je Konto, von Meta vorgegeben.
- Der Upload läuft über das Resumable-Verfahren (`rupload.facebook.com`). Eine
  öffentlich erreichbare Video-URL ist dadurch **nicht** nötig.
- Instagram verarbeitet Reels asynchron; der Worker wartet bis zu fünf Minuten
  auf `FINISHED`, bevor er veröffentlicht.
- Während der Entwicklung funktioniert alles nur für Konten mit einer Rolle in
  der App. Für fremde Konten ist die App-Prüfung nötig.
- **Insights** liefert Meta erst einige Stunden nach der Veröffentlichung. Bis
  dahin zeigt die Analytics-Seite Nullwerte mit entsprechendem Hinweis.

---

## Facebook

**Portal:** <https://developers.facebook.com/>
**API:** Graph API (Page Videos)

### Schritte

1. Dieselbe App wie für Instagram verwenden oder eine neue anlegen.
2. Produkt **Facebook Login** hinzufügen.
3. Weiterleitungs-URI:
   `http://localhost:4000/api/social/facebook/callback`
4. Berechtigungen anfordern:
   - `pages_show_list`
   - `pages_manage_posts`
   - `pages_read_engagement`
   - `publish_video`
   - `business_management`
5. In die `.env`:

```ini
FACEBOOK_APP_ID=...
FACEBOOK_APP_SECRET=...
FACEBOOK_REDIRECT_URI=http://localhost:4000/api/social/facebook/callback
```

### Wissenswert

- Veröffentlicht wird auf einer **Facebook-Seite**, nicht auf einem
  Privatprofil. Beim Verbinden wird die erste verwaltete Seite gewählt.
- Der Upload läuft in Blöcken über `graph-video.facebook.com`.
- Geplante Veröffentlichung braucht mindestens 10 Minuten Vorlauf; kürzere
  Termine behandelt der Worker als *sofort*.

---

## Konto verbinden

1. `.env` ausfüllen, Backend neu starten.
2. In der Oberfläche: **Social Media** → Plattform → **Connect account**.
3. Du wirst zur Plattform geleitet und erteilst die Freigabe.
4. Nach der Rückkehr steht das Konto auf **Connected**.

### Wie Tokens gespeichert werden

```
Plattform ──OAuth-Code──▶ Backend
                             │ tauscht gegen Access- und Refresh-Token
                             ▼
                     AES-256-GCM verschlüsselt
                             ▼
                        PostgreSQL

Publisher-Worker ──X-API-Key──▶ Backend ──entschlüsselt──▶ Token
```

- Tokens erreichen den Browser **nie**.
- Sie liegen nie im Klartext in der Datenbank.
- Nur der zuständige Publisher-Container bekommt sie, nur für einen Upload.
- Läuft ein Token ab, erneuert das Backend es automatisch. Geht das nicht, wird
  das Konto auf `expired` gesetzt und in der Oberfläche erscheint
  **Reconnect**.

### Wichtig zu ENCRYPTION_KEY

Wird `ENCRYPTION_KEY` geändert, sind alle gespeicherten Tokens unlesbar und
jedes Konto muss neu verbunden werden. Der Schlüssel gehört ins Backup
(`scripts/backup.sh` sichert die `.env` mit).

---

## Fehlerbilder

| Meldung | Ursache | Lösung |
|---|---|---|
| `Not configured` | Zugangsdaten fehlen in der `.env` | Werte eintragen, Backend neu starten |
| `redirect_uri_mismatch` | URI im Portal weicht ab | Exakt gleiche URI eintragen, auch Protokoll und Port |
| `Zugriff verweigert (401)` | Token abgelaufen oder zurückgezogen | Konto neu verbinden |
| `Dieses Google-Konto besitzt keinen YouTube-Kanal` | Kein Kanal vorhanden | Kanal anlegen und erneut verbinden |
| `Keine Facebook-Seite mit verknüpftem Instagram-Business-Konto` | Verknüpfung fehlt | In den Seiteneinstellungen verknüpfen |
| `TikTok hat keine Upload-Adresse geliefert` | Content Posting API nicht freigeschaltet | Produkt in der App hinzufügen |
| `quotaExceeded` | YouTube-Tageskontingent aufgebraucht | Am nächsten Tag erneut oder Kontingent beantragen |
