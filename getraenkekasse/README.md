# Bierwart · Getränkekasse 1.13.1

Die Strichliste läuft auf **einem Rechner im Hausnetz**. Mitglieder, Bierwarte und Kassenwart öffnen sie im Browser. GnuCash kann auf einem anderen Rechner laufen. Der Austausch über die CSV-Assistenten und den Bereich **GnuCash Import / Export** ist ebenfalls verfügbar.

## Start und Zugang im Hausnetz

1. Das ZIP auf dem Server entpacken. Getestet mit Node.js 24. Die Node-Abhängigkeiten liegen bei.
2. In `config.json` unter `host` die **private IPv4-Adresse des Servers** eintragen, beispielsweise `192.168.1.25`. Eine feste Adresse oder DHCP-Reservierung erleichtert den Zugriff. Mit dem voreingestellten `127.0.0.1` kannst du erst einmal auf dem Server selbst testen.
3. Im Ordner mit `package.json` einmal `npm start` ausführen und den Prozess während des Betriebs laufen lassen. Beim ersten Start wird eine zufällige Verwaltungs-PIN in `data/admin-pin` erzeugt. Diese Datei direkt auf dem Server öffnen. Alternativ kann der Betreiber vor dem Start `BW_ADMIN_PIN` setzen.
4. Auf Handy, Tablet und PC dieselbe Basisadresse öffnen. Der Einstieg wählt den passenden Bereich. Direkte Bereichslinks eignen sich für feste Lesezeichen. Für den optionalen ODS-Papierausdruck braucht der **Server** zusätzlich das Programm `zip` im Suchpfad.

| Zugang bei der Beispieladresse | Verwendung |
|---|---|
| `http://192.168.1.25:3000/` | Handy → Mein Konto, Tablet → Strichliste, PC → Verwaltung |
| `http://192.168.1.25:3000/strichliste.html` | Strichliste auf jedem Gerät |
| `http://192.168.1.25:3000/veranstaltung.html` | Veranstaltung und Getränke auswählen |
| `http://192.168.1.25:3000/user.html` | Persönliches Konto, Guthaben, Aktivenessen und freigegebene Verwaltungsbereiche |
| `http://192.168.1.25:3000/admin.html` | Verwaltung mit der PIN vom Server |

Der Dienst bindet an die gewählte IPv4-Adresse und prüft die Quelladresse anhand der Netzmaske. Im Browser die eingetragene IP verwenden. Für eine lokale Firewall TCP-Port 3000 ausschließlich aus diesem Subnetz zulassen. Portweiterleitungen, öffentliche Proxys und Tunnel ausgeschaltet lassen. Direkter HTTP-Zugriff überträgt Anmeldedaten unverschlüsselt. Das vorgesehene Netz ist das vertrauenswürdige Hausnetz. Jeder mit Zugang zur offenen Strichliste kann Striche auf einen Namen setzen, wie auf einer Papierliste.

## Konten und Startpasswort

Bei der Anlage den Anzeigenamen wie in GnuCash eingeben, zum Beispiel „Muster, Max“. In das Feld „Nachname (Startpasswort)“ gehört dann „Muster“. Das Startpasswort entspricht exakt diesem Nachnamen, einschließlich Leerzeichen und Großschreibung. Bei der Übernahme einer alten Namensliste wird bei „Muster, Max“ der Teil vor dem Komma und bei „Max Muster“ das letzte Wort verwendet. Mehrteilige Nachnamen im Zweifel über die normale Anlage erfassen.

In **Mein Konto** erscheint nach dem Login oben ein Hinweis. **Passwort ändern** öffnet das Formular. **Später** blendet den Hinweis für diese Anmeldung aus. Alle übrigen Funktionen bleiben bedienbar. Nach dem tatsächlichen Wechsel verschwindet der Hinweis auch bei späteren Anmeldungen. Bestehende selbst gesetzte Passwörter bleiben beim Update gültig.

Die Verwaltung vergibt die Rechte **BW** (Übersicht) und **XXX** (Buchhaltung). Ein Nachname ist im Haus oft bekannt. Vor Vergabe von Verwaltungsrechten persönlich prüfen, dass die betreffende Person ihr eigenes Passwort gesetzt hat. Der Admin kann auch ein individuelles vorläufiges Passwort zurücksetzen und der Person persönlich mitteilen.

## Schnellstart mit eurem GnuCash-Bestand

1. Das GnuCash-Buch speichern. Am selben Rechner das BW-Programm im Hausnetz öffnen, dann **Verwaltung → GnuCash Import / Export**. Die Rolle XXX hat denselben Bereich unter **Mein Konto**.
2. Unter **GnuCash einlesen** die gespeicherte `.gnucash`-Datei wählen. Das Programm liest komprimierte und unkomprimierte GnuCash-XML-Dateien. Die Datei wird nur an den eigenen BW-Server übertragen, im Speicher verarbeitet und unverändert gelassen. Bei einem SQLite- oder SQL-Buch in GnuCash **File → Export → Export Account Tree to CSV…** verwenden und die vollständige Konten-CSV auswählen. Für Buchungen unterstützt derselbe Dialog **Export Transactions to CSV…** mit ausgeschaltetem **Simple Layout**, Komma oder Semikolon und Datum in ISO oder deutschem Format mit vierstelligem Jahr.
3. Die Vorschau zeigt Personen, Veranstaltungen und Sammelkonten. **Konten und Auswahl übernehmen** legt die Konten gesammelt an und speichert ihre GnuCash-Pfade. Bleiben die Buchungsgruppen zugeklappt und leer, werden ausschließlich Konten übernommen. Der Kontenbaum enthält auch Personen ohne Buchungen. Ein reiner Buchungsexport enthält nur die berührten Konten.
4. Falls ihr Buchungen aus dem Altbestand im BW-Programm sehen wollt, die gewünschten Gruppen aufklappen und auswählen. **Alle in dieser Gruppe** übernimmt die erkannten BW-Buchungen oder Aktivenessen gesammelt. Einzahlungen sind einzeln auswählbar, weil auf denselben Personenkonten auch andere Vereinszahlungen eingehen. Ein erneuter Import erkennt dieselben GnuCash-Buchungs-IDs. Bereits anderswo manuell erfasste Buchungen haben keine gemeinsame ID. Für den ersten Abgleich einen Stichtag verwenden und Überlappungen abwählen.

**Beispiel SS26.** Nach dem Kontenbaum lässt sich auch die vorhandene Datei `SS26-U1-Bierwart.csv` in demselben Feld wählen. Unter **BW-Buchungen** erscheint die Sammelbuchung über 7.433,30 €. Die drei zusätzlichen Personenkonten werden beim Übernehmen der Datei angelegt. Sollen nur die Konten ins BW-Programm, das Kästchen vor der Buchung leer lassen.

## Neue BW-Konten in GnuCash anlegen

1. Einmal das GnuCash-Buch oder dessen vollständigen Kontenbaum wie oben einlesen. Er enthält die vergebenen Kontonummern und die vorhandenen übergeordneten Konten.
2. Nach der Anlage neuer Personen oder Veranstaltungen im BW-Programm **Neue BW-Konten als CSV** wählen. Das geht auch ohne Getränkeumsatz. Die Datei enthält die seit dem eingelesenen Kontenstand fehlenden BW-Konten. Bestehende Kneipenkonten und bekannte Veranstaltungen können auf denselben GnuCash-Pfad zeigen.
3. In GnuCash **File → Import → Import Accounts from CSV…** öffnen, **BW-Neue-Konten.csv** wählen, das Komma als Trenner kontrollieren und die Vorschau prüfen. Die Datei enthält vollständigen Pfad, Namen, Kontotyp, Kontocode und EUR. Die Elternkonten stammen aus dem eingelesenen Kontenbaum. Import abschließen und das Buch speichern.
4. Das gespeicherte GnuCash-Buch bei **GnuCash einlesen** erneut wählen und die Konten übernehmen. Damit kennt BW die neu angelegten Konten. Dazwischen bleiben die vorgeschlagenen Kontonummern stabil. Wenn parallel direkt in GnuCash Konten angelegt wurden, vor dem nächsten Export den aktuellen Stand einlesen. Eine mittlerweile anderweitig verwendete Nummer muss vor dem Import geklärt werden.

Neue Personen erhalten bei eurem Kontenplan den GnuCash-Typ **LIABILITY** und die nächste freie fünfstellige Nummer oberhalb des bisherigen Personenbestands. Neue Veranstaltungen erhalten **EXPENSE** und eine freie Nummer zwischen 4201 und 4599. Der Nummernbereich für neue Veranstaltungen ist eine Programmvorgabe. Eine bestehende Veranstaltung, die unter anderem Namen erfasst wurde, kann unter **Kontenzuordnung** auf ihren tatsächlichen Kontopfad gesetzt werden. Konten unter **4600** und **4730** dienen den Essen. **2300** ist kein automatisch angelegtes BW-Konto.

## Verbrauch und Aktivenessen nach GnuCash buchen

1. **Buchungslauf → GnuCash** öffnen. Bei **Verbrauch gesammelt bis** den Stichtag eintragen, z. B. **31.08.2026**, und die freie Belegnummer angeben. Bei `SS26 U1` fasst der Lauf alle bisher offenen Striche bis zu diesem Datum zu einer mehrteiligen Buchung zusammen. Pro betroffenem Konto entsteht eine Zeile, die Summe geht auf **2000 Bierwart**. Striche nach dem Stichtag bleiben offen. Ohne Stichtag werden die Käufe einzeln zu ihrem ursprünglichen Datum exportiert.
2. **Buchungslauf erstellen** wählen. Fehlen Konten im zuletzt eingelesenen GnuCash-Bestand, erscheinen **1. Neue Konten (CSV)** und **2. Buchungen (CSV)**. Erst die Kontendatei wie oben importieren, dann die Buchungsdatei. Stimmen die Konten bereits überein, genügt die Buchungsdatei.
3. In GnuCash **File → Import → Import Transactions from CSV…** wählen. Bei **Load and Save Settings** die Vorlage **GnuCash Export Format** verwenden. Die Datei verwendet Komma, UTF-8, **Multi-split**, **Date Format → y-m-d**, **Currency Format → Period: 123,456.78** und eine Kopfzeile. Den Kontenabgleich prüfen, den Import abschließen und speichern.
4. Im BW-Programm beim offenen Lauf **In GnuCash gebucht ✓** klicken. Ab diesem Zeitpunkt gelten die enthaltenen Posten als exportiert. Ein erneuter Download desselben Laufs liefert dieselben Buchungen. Ein zweiter Import in GnuCash kann die Buchungen verdoppeln.

**Personen und Veranstaltungen.** Der Verbrauch belastet das Personen-, Veranstaltungs- oder Sammelkonto. Bei euren Dateien sind das beispielsweise **4105 Tresenbachelor**, **4110 Stockwerksparty**, **4116 Divali**, **4120 Feuerzangenbowle** und **4150 Kneipen**. Für Arbeitseinsatz, Gäste, Löschbier/Grillkohle und Barzahler gibt es Sammelkonten entsprechend der SS26-Abrechnung. **Barkasse** ist mit **1050 Nebenkassen (KW, BW)** vorbelegt. Falls eine getrennte BW-Barkasse besteht, ihren vollständigen Pfad vor dem Abgleich eintragen. Abgelaufene Ware hat in der SS26-Vorlage keine Betragsbuchung und wird nicht pauschal auf ein Verlustkonto gebucht.

**Aktivenessen.** Rechnungssumme, Datum und Ausleger eintragen. Je Teilnehmer Vollpreis, Aktiv oder K-Gast auswählen. Der automatische Grundpreis entspricht der Rechnungssumme geteilt durch die Anzahl der gewählten Personen. Aktiv und K-Gast bezahlen ihren Anteil abzüglich des von Verwaltung oder XXX eingestellten Zuschusses. Gast / Mitgliederwerbung wird automatisch als ein K-Gast gezählt. Individuelle Preise sind bei ausgeglichener Rechnung möglich. Zuschuss und Gastanteil werden mit den konfigurierbaren Konten **4600 Gemeinsame Essen** und **4730 Mitgliederwerbungskosten** exportiert. Weitere Personen können als Ausleger mit Teilbeträgen hinzugefügt werden. Der erste Ausleger trägt den Rest. Auch direkte Bankzahlung oder die konfigurierte XXX-Karte sind möglich. Jedes Essen bleibt eine eigene ausgeglichene Buchung mit Datum und Referenz. Beim Lesen vorhandener Essen werden vorhandene U- oder S-Belege beibehalten. Neue Essen erhalten wie bisher die interne Semesterreferenz (z. B. SS26 A1). GnuCash-Importe liefern die Buchungsdaten, keine Rechnungsfotos.

## Betrieb, Datensicherung und Updates

Ein Serverprozess verwaltet den Bestand in `data/db.json`. Belege liegen in `assets/receipts`, Bilder und Produktpreise in `assets/res`. Für eine vollständige Sicherung den Server anhalten und `data`, `assets` sowie `config.json` gemeinsam kopieren. Das Änderungsprotokoll liegt ebenfalls in der JSON-Datei und ist für Personen mit Dateizugriff editierbar.

Updates und Rückwechsel erfolgen unter **Verwaltung → Software-Updates**. Die einmalige Einrichtung, der direkte Zugang für ältere Versionen und die Releasedokumentation stehen in [Repository-Updates.md](../Repository-Updates.md). Im Entwurf offen gebliebene alte Buchungsläufe enthalten dessen ursprüngliches CSV-Format. Bereits importierte bestätigen. Noch nicht importierte verwerfen und einen neuen Lauf erzeugen. Das Standardpasswort der früheren Verwaltung wird beim ersten Start durch eine individuelle PIN ersetzt. Der Testbefehl `npm test` arbeitet in einem temporären Testbestand.

Das Transaktionsformat der Vorversion wurde mit GnuCash 5.16 geprüft. Version 1.3 wurde mit GnuCash-XML, der vorhandenen SS26-CSV und einem Konten- und Buchungs-Rundlauf im BW-Programm getestet. Nach einem größeren Versionswechsel zuerst einen kleinen Lauf mit einer Kopie der GnuCash-Datei ausprobieren.

## Oberfläche lokal prüfen

Das Farbschema folgt anfangs dem Gerät. Der Schalter mit Sonne und Mond wechselt zwischen **Hell** und **Dunkel**. Die Auswahl bleibt in diesem Browser auch für Software-Updates gespeichert. Über **Geräte-Farbschema verwenden** im Fußbereich lässt sich die Automatik wiederherstellen. Die [Screenshot-Galerie](../Screenshots/index.html) zeigt die Ansichten auf Smartphone, Kiosk-Tablet und Desktop.

Im Ordner `getraenkekasse` startet `node test/ui-preview.cjs` eine isolierte Beispielkasse auf Port 3182. Unter `/ui-fixtures.html` lassen sich normale Buchungen, ein leerer Verlauf, ein einzelner Eintrag und 1.001 Buchungen mit langen Texten vergleichen. Das Testmitglied heißt **Marlene Hofmann**, sein Passwort lautet **Probe**. Die Testverwaltung verwendet die PIN **246810**. Beim Beenden verwirft der Vorschaudienst seine Daten.

Mit installiertem Playwright für Node und Chromium führt ein zweites Terminal `node test/ui-flows.cjs` aus. Beide Skripte akzeptieren den Port als erstes Argument. Für ein systemweit installiertes Chromium lässt sich der ausführbare Pfad über `CHROMIUM` angeben. Die gemeinsamen Gestaltungsregeln stehen in [DESIGN.md](../DESIGN.md), die CSS-Variablen in [design.css](public/design.css).
