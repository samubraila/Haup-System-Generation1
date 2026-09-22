# Echtes Filmmaterial ohne GPU

Für richtige Videos braucht es nicht zwingend eine Grafikkarte. Zwei Adapter
des Video-Workers erzeugen Bewegtbild aus vorhandenem Material:

| Adapter | Quelle | GPU nötig | Kosten |
|---|---|---|---|
| `stock` | Pexels / Pixabay | nein | kostenlos |
| `slideshow` | eigene Bilder aus der Mediathek | nein | kostenlos |

Beide liefern fertige Szenenclips im Zielformat (z. B. 1080×1920), die danach
ganz normal durch Schnitt, Untertitel, Freigabe und Veröffentlichung laufen.

---

## 1. Kostenlosen API-Schlüssel holen

Es genügt **einer** der beiden Anbieter. Beide sind kostenlos und verlangen
keine Zahlungsdaten.

### Pexels (empfohlen, hat Videos und Fotos)

1. Konto anlegen auf <https://www.pexels.com/join/>
2. <https://www.pexels.com/api/new/> öffnen
3. Verwendungszweck angeben (z. B. „persönliches Videoprojekt")
4. Der Schlüssel erscheint sofort im Dashboard

Limit: 200 Anfragen pro Stunde, 20 000 pro Monat.

### Pixabay

1. Konto anlegen auf <https://pixabay.com/accounts/register/>
2. <https://pixabay.com/api/docs/> öffnen — der Schlüssel steht eingeblendet im
   ersten Beispiel-Request, sobald du angemeldet bist

Limit: 100 Anfragen pro Minute.

---

## 2. Schlüssel eintragen

In der `.env` im Projektverzeichnis:

```dotenv
PEXELS_API_KEY=dein_schluessel
PIXABAY_API_KEY=dein_schluessel
```

Danach den Video-Worker neu starten:

```bash
docker compose up -d --force-recreate video-worker
```

Ob es geklappt hat, zeigt **System → Worker → video-worker → Adapter**. Der
Eintrag `stock` steht dann auf *Bereit* statt *Nicht eingerichtet*.

Die Schlüssel liegen ausschließlich in der `.env` und werden nur an den
Video-Worker durchgereicht. Weder das Frontend noch die Datenbank sehen sie.

---

## 3. Adapter im Projekt wählen

Projekte → Bearbeiten → **Videoquelle**:

- **Stock-Material (Pexels / Pixabay)** — sucht pro Szene passendes
  Filmmaterial
- **Eigene Bilder animieren** — nutzt die Bilder, die im Projekt hochgeladen
  sind

---

## 4. Wie die Suche funktioniert

Der Skript-Worker liefert zu jeder Szene zwei bis drei englische Stichwörter
mit (`keywords`). Nutzt du Ollama, formuliert das Sprachmodell sie direkt;
ohne Ollama werden sie aus Thema und Beschreibung abgeleitet.

Der Stock-Adapter sucht damit in dieser Reihenfolge:

1. alle Stichwörter zusammen
2. die ersten zwei
3. nur das erste

Erst Videos, danach als Rückfall Fotos. Ein gefundenes Foto bekommt eine
Kamerafahrt (Ken Burns), damit es sich wie eine echte Aufnahme bewegt.

Gefundene Clips werden auf das Zielformat gebracht: skalieren, mittig
zuschneiden, und falls das Material kürzer ist als die Szene, nahtlos
wiederholen.

Findet der Adapter nichts, schlägt der Job mit einer klaren Meldung fehl — es
wird **kein** Ersatzclip untergeschoben. Meist helfen konkretere Stichwörter im
Skript.

---

## 5. Eigene Bilder animieren

Der `slideshow`-Adapter nimmt Bilder aus der Mediathek des Projekts
(Bibliothek → Hochladen, `image/png`, `image/jpeg`, `image/webp`). Szene *n*
bekommt Bild *n* (bei weniger Bildern als Szenen wird von vorne begonnen).

Ist kein Bild vorhanden, sucht er ein Stock-Foto — dafür braucht es wieder
einen der beiden Schlüssel oben.

Die Kamerafahrt steuerst du in den Projekteinstellungen unter **Look und
Schnitt**:

| Einstellung | Wirkung |
|---|---|
| Ken Burns (abwechselnd) | jede Szene fährt in eine andere Richtung |
| Langsam heranfahren / herausfahren | gleichmäßiger Zoom |
| Schwenk nach links / rechts | horizontale Fahrt |
| Keine Bewegung | Standbild |
| Stärke der Bewegung | wie weit gezoomt bzw. geschwenkt wird |

---

## 6. Lizenz und Namensnennung

Pexels und Pixabay stellen ihr Material unter einer freien Lizenz bereit:
kostenlose kommerzielle Nutzung, keine Namensnennung erforderlich.

Trotzdem speichert das System zu jedem Clip, woher er stammt — Anbieter, Titel,
Urheber und Quell-URL — in den Metadaten des Mediums. Sichtbar unter
**Video → Medien → Details**. Das brauchst du für:

- freiwillige Namensnennung in der Videobeschreibung (gern gesehen, nicht Pflicht)
- den Nachweis der Herkunft, falls eine Plattform nachfragt

Nicht erlaubt ist bei beiden Anbietern:

- das Material unverändert als eigenes Stock-Angebot weiterverkaufen
- erkennbare Personen so darstellen, dass es beleidigend wirkt oder eine
  Zustimmung suggeriert
- das Material als eigene Aufnahme ausgeben

Die vollständigen Bedingungen: <https://www.pexels.com/license/> und
<https://pixabay.com/service/license-summary/>

---

## 7. Häufige Meldungen

| Meldung | Ursache | Lösung |
|---|---|---|
| `Kein Stock-Anbieter eingerichtet` | kein Schlüssel in der `.env` | Abschnitt 2 |
| `Der Pexels-API-Key wurde abgelehnt (401)` | Schlüssel falsch kopiert | Schlüssel neu aus dem Dashboard holen |
| `Pixabay meldet zu viele Anfragen (429)` | Limit erreicht | ein paar Minuten warten oder den zweiten Anbieter eintragen |
| `Kein passendes Stock-Material gefunden` | Stichwörter zu speziell | Thema konkreter fassen, oder `slideshow` mit eigenen Bildern nutzen |

---

## Verwandte Dokumente

- [VIDEO_MODELS.md](VIDEO_MODELS.md) — echte KI-Videogenerierung mit GPU
- [ARCHITECTURE.md](ARCHITECTURE.md) — wie der Video-Worker in die Kette passt
- [TROUBLESHOOTING.md](TROUBLESHOOTING.md) — allgemeine Fehlersuche
