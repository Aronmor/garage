# Private Notion-Hauptablage

Die App gleicht die Werkstattdaten auf ausdrücklichen Knopfdruck mit **deinem privaten Notion-Workspace** ab. Notion ist die führende Ablage; der kostenlose Cloudflare Worker vermittelt zwischen der öffentlichen GitHub-Pages-App und Notion. Der Sync läuft nicht automatisch im Hintergrund.

## Was gespeichert wird

- Motorrad-Stammdaten und -Eigenschaften, Aufgaben, Planungszeiträume, Einkaufsliste, Werkstatttemperatur, Timer, Chemikalien und KI-Anleitungen werden als privater JSON-Snapshot in Notion gespeichert.
- Die Motorräder werden zusätzlich als Zeilen in deiner vorhandenen Notion-Motorraddatenbank gespiegelt. Dort kannst du Name, Baujahr und Status direkt bearbeiten; diese Felder werden beim nächsten Sync zurück in die App gelesen.
- Fotos und gespeicherte Originaldokumente werden als private Notion-Dateianhänge gesichert und beim Synchronisieren auf ein anderes Gerät zurückgeladen.
- Ein zusätzlicher `MűhelyGarázs — privát synchronizálási adatok`-Eintrag mit dem App-internen Kennzeichen `__muhelygarazs_master_state_v1__` enthält den vollständigen Snapshot und die Dateianhänge. Nicht manuell löschen oder umbenennen.
- Original-PDF-, TXT- und Markdown-Dateien bleiben nur dann erhalten, wenn du den aus dem Dokument erzeugten KI-Leitfaden speicherst. Die App speichert weder Gemini-API-Schlüssel noch ungespeicherte Dokumente.

## Datenschutz und Konflikte

- Andere Besucher der öffentlichen App sehen deine lokalen Daten, Notion-Datenbank-ID und Synchronisierungseinstellungen nicht. Der Sync startet ausschließlich durch deinen Klick.
- Die Notion-Integration ist nur mit deiner Motorrad-Datenbank zu teilen. Das Integrationstoken bleibt ein Cloudflare-Worker-Secret und wird weder in GitHub noch in der App gespeichert.
- Die Worker-URL und der persönliche Sync-Schlüssel werden lokal im jeweiligen Browser gespeichert. Teile den Schlüssel nicht.
- Die Synchronisierung überträgt die Motorrad- und Werkstattdaten sowie Fotos/Dokumente von diesem Gerät zu Cloudflare und Notion. Dokumente, die du mit Gemini analysieren lässt, werden außerdem direkt an Google Gemini gesendet; dafür gilt dessen Datenverarbeitung.
- Der Worker gleicht Änderungen anhand des beim letzten erfolgreichen Sync lokal gespeicherten Vergleichsstands ab: unabhängige Änderungen werden zusammengeführt. Wenn derselbe Eintrag auf beiden Seiten geändert wurde, gewinnt Notion. Ein frisches Gerät ohne Vergleichsstand übernimmt Notion.
- Löschen eines Motorrads wird in Notion durch Archivieren der entsprechenden Motorradzeile übernommen. Notion erlaubt der Integration nicht, bereits hochgeladene Dateiinhalte endgültig zu löschen; nicht mehr verwendete Dateianhänge können deshalb in Notion als verwaiste Anhänge verbleiben.

## Notion kostenlos vorbereiten

1. Öffne [Notion Developer connections](https://www.notion.so/developers/connections) und erstelle eine interne Verbindung für deinen Workspace.
2. Gib der Verbindung Lese-, Einfüge- und Aktualisierungsrechte für Inhalte.
3. Teile **deine vorhandene Motorrad-Datenbank** mit dieser Verbindung. Veröffentliche weder die Datenbank noch ihre Seiten im Web.
4. Die Datenbank braucht eine Datenquelle mit genau diesen Eigenschaften und Typen:
   - `Name` — Titel
   - `App ID` — Text
   - `Year` — Zahl
   - `Status` — Text
5. Halte das geheime Integrationstoken und die **Datenbank-ID oder Datenquellen-ID** bereit. Füge beides nicht in den Chat oder in Repository-Dateien ein.

Notion-Free begrenzt Datei-Uploads auf **5 MB pro Datei**. Der Sync nimmt höchstens 25 Motorräder und maximal 160 KB strukturierte Garagendaten pro Abgleich an. Größere Quelldokumente können weiterhin mit Gemini verarbeitet, aber nicht mit dem kostenlosen Notion-Tarif synchronisiert werden.

## Kostenlosen Cloudflare Worker bereitstellen

Öffne PowerShell:

```powershell
cd C:\Users\fispa\Downloads\muhely-garazs-app\workers\notion-sync
bunx wrangler login
bunx wrangler deploy
```

Melde dich bei Cloudflare an und bleibe bei **Workers Free**. Nicht auf Paid upgraden. Wrangler gibt danach die Worker-Adresse aus.

Setze die drei Werte interaktiv als Secrets (Wrangler fragt die Werte im Terminal ab):

```powershell
bunx wrangler secret put NOTION_TOKEN
bunx wrangler secret put NOTION_DATABASE_ID
bunx wrangler secret put SYNC_TOKEN
```

- `NOTION_TOKEN`: geheimes Token deiner privaten Notion-Verbindung.
- `NOTION_DATABASE_ID`: ID deiner vorhandenen Motorrad-Datenbank oder ihrer Datenquelle. Der Worker akzeptiert beide ID-Arten.
- `SYNC_TOKEN`: eigener, zufälliger Schlüssel mit mindestens 32 Zeichen. Er muss sich vom Notion-Token unterscheiden.

Secrets niemals in `wrangler.jsonc`, GitHub, Screenshots oder den Chat eintragen. Der Worker akzeptiert nur den Produktions-Origin `https://aronmor.github.io` sowie die in `wrangler.jsonc` ausdrücklich eingetragenen lokalen Test-Origin-Adressen.

Cloudflare Workers Free umfasst laut [Cloudflare-Preisdokumentation](https://developers.cloudflare.com/workers/platform/pricing/) ein kostenloses Anfragekontingent. Cloudflare kann beim Konto-Setup eine Zahlungsdatenabfrage anzeigen; bestätige keinen kostenpflichtigen Tarif.

## App verbinden und synchronisieren

In der App öffne **Menü → Einstellungen und Datensicherung → Notion-Synchronisierung**:

1. Trage die Worker-Adresse ein.
2. Trage denselben `SYNC_TOKEN` ein.
3. Wähle **Garázs szinkronizálása**.

Wiederhole den Schritt auf jedem Gerät. Auf einem neuen Gerät ohne gespeicherten Vergleichsstand wird der aktuelle Notion-Stand geladen. Mache vor dem ersten Sync mit wertvollen Daten zusätzlich eine App-Sicherungsdatei.

## Fehlerbehebung

- **401 / Invalid sync token:** App-Schlüssel und `SYNC_TOKEN` stimmen nicht überein.
- **403 / Origin is not allowed:** Die aufgerufene Domain ist nicht in `ALLOWED_ORIGINS` freigegeben.
- **Invalid Notion database properties:** Spaltennamen/-typen prüfen und sicherstellen, dass die Integration Zugriff auf die Datenquelle hat.
- **Notion 401/403/404:** Token, Datenbank-ID, Verbindungsrechte und Datenbankfreigabe prüfen.
- **Datei größer als 5 MB:** Für Notion Free verkleinern; kein Paid-Upgrade nötig, um andere Daten zu synchronisieren.
- **Fehlender Dateianhang:** Die Datei wurde möglicherweise in Notion entfernt oder ein früherer Upload wurde unterbrochen. Stelle sie aus einer Sicherung wieder her und synchronisiere erneut.
- Der Worker protokolliert nur technische Fehler. Repository, Notion-Datenbank-ID und persönliche Motorradwerte gehören nicht in öffentliche Logs oder GitHub-Dateien.
