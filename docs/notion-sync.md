# Notion-Synchronisierung (kostenloser Einweg-Test)

Die App kann die Motorradliste auf Knopfdruck in eine Notion-Datenbank übertragen. Die Synchronisierung ist bewusst **einseitig**: Änderungen in Notion werden nicht in die App zurückgeladen, und nicht mehr vorhandene Motorräder werden in Notion nicht gelöscht.

## Kosten und Datenfluss

- GitHub Pages bleibt die öffentliche, statische App.
- Der Cloudflare Worker läuft im Workers-Free-Tarif. Laut [Cloudflare-Preisdokumentation](https://developers.cloudflare.com/workers/platform/pricing/) umfasst dieser 100.000 Worker-Aufrufe pro Tag; ein manueller Sync nutzt nur wenige Aufrufe. Nicht auf Workers Paid upgraden.
- Der Worker benötigt weder Datenbank noch Dateispeicher. Notion ist das Ziel für die Motorraddaten.
- Cloudflare Access wird dafür nicht benötigt. Eine Abfrage nach Zahlungsdaten beim Konto-Setup kann nicht ausgeschlossen werden; bestätige keinen kostenpflichtigen Tarif.
- Pro Motorrad überträgt die App nur ihre lokale ID, Name, Baujahr und Projektstatus. Dokumente, Fotos, Aufgaben, Rahmennummern und Gemini-Schlüssel werden nicht übertragen.
- Das Notion-API-Token bleibt als Cloudflare-Worker-Secret serverseitig. Ein eigener zufälliger Synchronisierungsschlüssel schützt den Worker zusätzlich; die App speichert ihn nur lokal im Browser. Sende keinen dieser Schlüssel im Chat oder committe sie nicht ins Repository.
- Worker-Adresse und Synchronisierungsschlüssel werden nicht in das JSON-Garage-Backup aufgenommen.
- Die Garage bleibt weiterhin lokal pro Gerät und Browser. Die Notion-Synchronisierung startet nur, wenn du in den Einstellungen auf den Button drückst.

## 1. Notion-Datenbank vorbereiten

1. Erstelle in Notion eine interne Integration für deinen eigenen Workspace und kopiere das geheime Integrationstoken.
2. Gib der Integration Zugriff auf Inhalte: Lesen, Einfügen und Aktualisieren.
3. Erstelle eine Datenbank mit genau einem Datenquellensatz und diesen Eigenschaften:
   - `Name` — Titel
   - `App ID` — Text
   - `Year` — Zahl
   - `Status` — Text
4. Teile die Datenbank mit der Integration über **… → Verbindungen hinzufügen**.
5. Kopiere die Datenbank-ID aus der Notion-Datenbank-URL. Die App ermittelt daraus über die Notion API den Datenquellensatz.

Die Eigenschaften müssen exakt so heißen und den angegebenen Typ haben, damit vorhandene Motorradseiten anhand der stabilen `App ID` aktualisiert statt dupliziert werden.

## 2. Kostenlosen Worker bereitstellen

Installiere nichts global. Öffne PowerShell und führe aus:

```powershell
cd C:\Users\fispa\Downloads\muhely-garazs-app\workers\notion-sync
bunx wrangler login
bunx wrangler deploy
```

Melde dich bei Cloudflare an und bleibe beim kostenlosen Workers-Tarif. Nach dem Deploy speichere die drei Werte über die interaktiven Eingabeaufforderungen als Worker-Secrets:

```powershell
bunx wrangler secret put NOTION_TOKEN
bunx wrangler secret put NOTION_DATABASE_ID
bunx wrangler secret put SYNC_TOKEN
```

- `NOTION_TOKEN`: das geheime Integrationstoken aus Schritt 1.
- `NOTION_DATABASE_ID`: die Datenbank-ID aus ihrer Notion-URL.
- `SYNC_TOKEN`: ein neuer, zufälliger und nur für diesen Worker verwendeter Schlüssel (empfohlen: mindestens 32 zufällige Zeichen). Verwende nicht das Notion-Token erneut.

Wrangler zeigt nach dem Deploy eine Worker-Adresse wie `https://muhelygarazs-notion-sync.<konto>.workers.dev` an. Die Worker-Konfiguration erlaubt Produktionszugriffe von `https://aronmor.github.io`; die localhost-Adressen sind nur für lokale Tests.

## 3. App verbinden

Öffne in der App **Menü → Einstellungen und Datensicherung → Notion-Synchronisierung**:

1. Trage die Worker-Adresse ein.
2. Trage denselben `SYNC_TOKEN` ein, den du für den Worker gesetzt hast.
3. Wähle **Motorräder synchronisieren**.

Bei Erfolg zeigt die App, wie viele Zeilen neu angelegt und aktualisiert wurden. Wiederholte Synchronisierungen aktualisieren dieselben Notion-Seiten anhand der `App ID`.

## Fehlerbehebung und Grenzen

- **401 / Invalid sync token:** Der Schlüssel in der App stimmt nicht mit `SYNC_TOKEN` im Worker überein.
- **403 / Origin is not allowed:** Verwende die veröffentlichte App oder prüfe `ALLOWED_ORIGINS` in der Worker-Konfiguration und deploye erneut.
- **Notion 401/403/404:** Prüfe das Integrationstoken, die exakte Datenbank-ID, die Datenbankfreigabe und die Integrationsrechte.
- **Ungültige Eigenschaften:** Prüfe die Namen und Typen `Name`, `App ID`, `Year` und `Status`.
- **Duplikat für eine App ID:** Lösche in Notion die doppelte Seite mit dieser ID; der Worker bricht absichtlich ab, statt willkürlich eine Seite auszuwählen.
- Der Test synchronisiert nur Motorräder, höchstens 25 pro Anfrage. Es gibt keine automatische Hintergrund-Synchronisierung, keine Konfliktauflösung und keine Löschung in Notion.
- Die [Notion-API hat eigene Ratenlimits](https://developers.notion.com/reference/request-limits). Bei größeren Workspaces kann ein weiterer manueller Versuch nach einer kurzen Wartezeit nötig sein.
