# MűhelyGarázs

Ein erster, eigenständiger React-/TypeScript-Neustart des ungarischen Werkstatt-Prototyps. Die ursprüngliche HTML-Datei bleibt unverändert.

## Lokal starten

Voraussetzung ist Node.js 18+ oder Bun.

```powershell
cd C:\path\to\muhely-garazs-app
bun install
bun run dev
```

Mit npm funktionieren stattdessen `npm install` und `npm run dev`.

Den Produktions-Build prüfst du mit `bun run build` beziehungsweise `npm run build`.

## Mit GitHub Pages veröffentlichen

Das GitHub-Actions-Workflow veröffentlicht die App nach jedem Push auf `main` unter `https://aronmor.github.io/garage/`. In den Repository-Einstellungen unter **Settings → Pages** muss als Quelle **GitHub Actions** ausgewählt sein.

Die App und das Repository haben unterschiedliche Sichtbarkeit: Die veröffentlichte Pages-Website ist öffentlich erreichbar, auch wenn das Quellcode-Repository privat bleibt. GitHub Pages für ein privates Repository kann von deinem GitHub-Tarif abhängen. Prüfe vor dem Veröffentlichen in **Settings → Pages**, ob dein Tarif das ermöglicht. Das Repository wird nicht automatisch öffentlich gemacht.

Die Gemini-Funktion sendet den API-Schlüssel direkt vom Browser an Google; es gibt keinen Server-Proxy. Der Schlüssel steht nicht im Quellcode, ist aber während der Verwendung in den Browser-Entwicklertools sichtbar. Verwende ausschließlich deinen eigenen Gemini-Schlüssel, beschränke ihn in den Google-API-Schlüsseleinstellungen nach Möglichkeit auf die Gemini API und auf den Referrer `https://aronmor.github.io/*`, und teile ihn nicht. Google-Kontingente oder Gebühren können anfallen. Besucher brauchen einen eigenen Schlüssel, um Gemini zu nutzen.

Die Garagendaten bleiben pro Gerät im jeweiligen Browser gespeichert und werden nicht zwischen Geräten synchronisiert. Die öffentlich erreichbare App bedeutet nicht, dass die darin gespeicherten Browserdaten öffentlich geteilt werden.

Eine optionale, manuell gestartete Einweg-Synchronisierung der Motorradliste zu Notion kann über einen Cloudflare Worker im Free-Tarif eingerichtet werden. Notion-Zugangsdaten liegen dabei nicht im öffentlichen App-Code. Die Garage selbst bleibt lokal und eine Änderung in Notion wird nicht zurück in die App übernommen. Die Einrichtung ist in [docs/notion-sync.md](./docs/notion-sync.md) beschrieben.

## Auf dem Handy installieren

Die App ist als PWA vorbereitet und kann ohne APK installiert werden. Dafür muss die gebaute App unter einer HTTPS-Adresse erreichbar sein.

- **Android:** App-Adresse in Chrome öffnen und im Menü „App installieren“ oder „Zum Startbildschirm hinzufügen“ wählen.
- **iPhone:** App-Adresse in Safari öffnen, „Teilen“ und anschließend „Zum Home-Bildschirm“ wählen.

Die App nach dem ersten Aufruf kurz laden lassen. Danach funktionieren die App-Oberfläche und die auf diesem Gerät gespeicherten Daten auch offline. Für Aktualisierungen und die erste Installation wird Internetzugang benötigt.

Die Daten werden pro Gerät im jeweiligen Browser gespeichert; es gibt keine Synchronisierung zwischen Handy und PC. Textdaten liegen in `localStorage`, Dokumentationsfotos separat in der lokalen IndexedDB des Browsers. Browserdaten können verloren gehen, wenn Browserdaten oder die App-Speicherung gelöscht werden. Über **Adatmentés** kannst du deshalb ein JSON-Backup herunterladen und auf einem anderen Gerät oder nach einer Neuinstallation wieder einspielen. Das Backup enthält die Fotos eingebettet; dadurch kann die JSON-Datei je nach Anzahl und Größe der Fotos groß werden. Der Import ersetzt nach einer Bestätigung die vorhandenen App-Daten und lokalen Fotos. Bewahre die Backupdatei sicher auf; sie kann persönliche Motorraddaten und Fotos enthalten. Fotos werden für die Speicherung optimiert, aber es gibt kein festes Gesamtlimit in der App. Der tatsächlich verfügbare lokale Speicher hängt vom Browser und Gerät ab und ist nicht unbegrenzt; regelmäßige Backups bleiben wichtig. Die Originalfotos, hochgeladenen PDFs und der Gemini-API-Schlüssel werden nicht separat gespeichert.

Den Namen für die Begrüßung kannst du unter **Menü → Einstellungen und Datensicherung → Anzeigename** eintragen. Browser dürfen den Namen des Gerätebesitzers nicht automatisch auslesen; der eingegebene Name bleibt lokal in diesem Browser und wird nicht in die Garagensicherung übernommen.

## Im ersten Stand enthalten

- Motorrad-Garage mit den Jawa-/Simson-Beispielprojekten
- Motorräder in der Garage auswählen und ihre separate Projektseite öffnen
- Technische Motorraddaten wie Motorkennung, Rahmen-/Motornummer und Hubraum sowie frei benannte Zusatzfelder pflegen
- Motorrädern lokal in IndexedDB gespeicherte Dokumentationsfotos zuordnen, nach Bauteil beschriften, kommentieren, datieren und löschen; eine nummerierte Zeitachse sortiert sie chronologisch, ältere Fotos werden beim Start migriert
- Fotos zusammen mit den übrigen Daten in einem JSON-Backup exportieren und beim Wiederherstellen in den lokalen Fotospeicher übernehmen
- Aufgaben je Motorrad erstellen, abhaken, filtern und löschen
- Offene Aufgaben aller Motorräder direkt auf der Startseite sehen, erledigen und ohne Umweg dem jeweiligen Motorrad zuordnen
- Aufgaben über alle Motorräder hinweg in frei benennbaren Plan-Abschnitten wie Jahreszeiten, Monaten oder Tagesplänen planen
- Gemeinsame Einkaufsliste mit den Status „zu besorgen“, „bestellt“ und „angekommen“ sowie separate Teilelisten pro Motorrad
- Werkstatt-Timer mit sichtbarer Abbruchfunktion, eigene Chemikalien mit optionalem Timer sowie Rechner für Zweitaktmischung, Gabelöl und Zitronensäure
- Schnellreferenzen für Chemie, Elektrik, Jikov und Jawa-Lager
- PDF-/Text-Dokumente mit Gemini in ungarische Werkstattschritte, Checkpoints und überprüfbare Chemikalienvorschläge umwandeln
- Generierte Anleitungen lokal speichern und offene Checkpoints mit den Aufgaben verknüpfen
- Plan-Zeiträume einschließlich der voreingestellten Jahreszeiten löschen; zugehörige Aufgaben werden dabei in einen verbleibenden Zeitraum verschoben
- Aktives Projekt auf schmalen Smartphone-Ansichten einklappen; auf Tablet und Desktop bleibt es geöffnet
- Fortschritt für Garage und einzelne Projekte
- Lokale Speicherung im Browser über `localStorage` und IndexedDB
- Zeitpläne, Einkaufsstatus, Timer, eigene Chemikalien und Einstellungen werden lokal gespeichert und sind im JSON-Backup enthalten

Die Werkstatt-Timer sind Erinnerungen mit Richtwerten aus dem ursprünglichen Prototyp. Maßgeblich sind immer die Produktetiketten, Sicherheitsdatenblätter und Werkstatthandbücher; berechnete Rezept- und Bauteilwerte vor der Anwendung für das konkrete Motorrad prüfen.

## Gemini-Dokumentauswertung

- Die Auswertung braucht Internet und einen eigenen Gemini-API-Schlüssel aus Google AI Studio. Ein API-Aufruf kann Google-Kontingent oder Kosten verbrauchen.
- Vor jeder Analyse fragt die App deine Zustimmung ab. Die ausgewählte Datei, ihr Dateiname, der Motorradname und dein optionaler Hinweis werden direkt an die Gemini API gesendet.
- Gemini kann benannte Chemikalien und im Dokument exakt angegebene Zeitwerte vorschlagen. Du kannst jeden Vorschlag vor dem Speichern abwählen; die Angaben müssen anschließend mit Etikett und Sicherheitsdatenblatt geprüft werden.
- Der API-Schlüssel wird in der App eingegeben und direkt vom Browser an die Gemini API gesendet. Er ist nicht im Repository oder im Anwendungscode hinterlegt, kann während der Verwendung aber in den Browser-Entwicklertools sichtbar sein.
- Verwende nur deinen eigenen API-Schlüssel und beschränke ihn in Google AI Studio beziehungsweise Google Cloud nach Möglichkeit auf die Gemini API und den Referrer `https://aronmor.github.io/*`. Beachte das Google-Kontingent und mögliche Kosten.
- Die Datei wird nicht in der App gespeichert. Die von Gemini erstellte Anleitung, der Quell-Dateiname und ausdrücklich übernommene Chemikalien werden lokal auf diesem Gerät gespeichert.
- KI-generierte Reparaturhinweise vor der Arbeit mit dem passenden Werks- und Sicherheits-Handbuch vergleichen.

Die App-Oberfläche kann zwischen Ungarisch und Deutsch umgeschaltet werden; die Auswahl wird auf dem Gerät gespeichert. Nutzereingaben und gespeicherte Kategorien bleiben unverändert, während die Oberfläche und neu erzeugte KI-Anleitungen der ausgewählten Sprache folgen. Die Beispieldaten enthalten keine Fahrgestell-, Motor- oder Kennzeichennummern. Beim ersten Start der aktualisierten App wird die alte Browser-Sicherung entfernt. Spätere Änderungen werden lokal im Browser gespeichert.
