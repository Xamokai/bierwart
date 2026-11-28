# Bierwart LAN 1.14.0

## Update einspielen

1. Für den Wechsel von 1.10.1 einmalig die bestehende Kasse übernehmen und die neue Version mit `npm start` starten. Danach unter **Verwaltung → Software-Updates** die Repository-Adresse speichern, nach Updates suchen und die gewünschte Version aktivieren. Die Schritte zur Übernahme, zum Befüllen des Repositories und zum Zurückwechseln stehen in [Repository-Updates.md](Repository-Updates.md).
2. Für den Abgleich im Browser **Verwaltung → GnuCash Import / Export** öffnen.
3. Beim ersten Abgleich mit einer neuen Kasse den Kontenbaum in der Vorschau übernehmen. Das geht bereits mit der Verwaltungs-PIN und ohne angelegte Personen. Eine automatisch erzeugte PIN steht auf dem Server in `data/admin-pin`. Bei einer selbst konfigurierten PIN dieselbe wie für die BW-Verwaltung verwenden.

## Einstieg auf Handy, Tablet und PC

Mit v1.13.2 lässt sich die Kasse zusätzlich per HTTPS erreichen, einschließlich der Update-Seite. Die Einrichtung für den Hausserver und den Zugriff unter `https://bw.uhaus/` steht unter [HTTPS im Hausnetz](getraenkekasse/README.md#https-im-hausnetz).

Die normale BW-Adresse öffnet auf dem Handy **Mein Konto**, auf dem Tablet die **Strichliste** und am PC die **Verwaltung**. Eine bestehende Anmeldung wird verwendet. Über die Bereichslinks lässt sich jederzeit wechseln. Für ein festes Lesezeichen stehen `/strichliste.html`, `/veranstaltung.html`, `/user.html` und `/admin.html` zur Verfügung. Auch bisherige Strichlisten- und Veranstaltungslinks funktionieren weiter.

Die Oberfläche folgt dem hellen oder dunklen Farbschema des Geräts. Mit dem Sonne-Mond-Schalter lässt sich die Ansicht für diesen Browser umstellen. Die [Galerie mit Geräteansichten und Druckbeispielen](Screenshots/index.html) enthält auch die aufgeklappte Produktpflege und das Kassenbuch.

Am PC öffnet **Mein Konto** mit **Meine Buchungen**. Das Kontomenü führt zum Getränkekauf, zu den Kontoeinstellungen und zu den freigeschalteten BW- und XXX-Bereichen. E-Mail-Adresse und Passwort stehen auf dem PC unter **Kontoeinstellungen**.

## Schnapswart und Getränkekarten

Im Ordner **Druckbeispiele** liegen die fertige Mixliste und die Preisliste der Halloweenparty als A4-PDF.

1. In **Verwaltung → Konten** beim persönlichen Konto **SW** anhaken. Der Bereich erscheint unter **Mein Konto → Getränkekarten (SW)**. Der Admin kann ihn direkt unter **Verwaltung → Getränkekarten (SW)** öffnen.
2. Unter **Rezept anlegen** Name, Kategorie, Preis und Glas wählen. Für jede Zutat gibt es ein Mengenfeld, das z. B. auch „1–2 TL“ oder „Schuss“ annimmt. Mengen dürfen frei bleiben. Die zwölf Getränke der mitgegebenen Mixliste stehen beim ersten Start im Katalog. Die übernommenen Startpreise sind 5 € für Cocktails, 4 € für Longdrinks, 3 € für Alkoholfreies und 1 € für Shots.
3. Gewünschte Getränke anhaken und **Mixliste (PDF)** oder **Preisliste (PDF)** wählen. Beide A4-Dateien lassen sich öffnen und drucken. Die Mixliste enthält Glasart, Zutaten und Mengen. Die Gästekarte zeigt den Preis je Kategorie, bei unterschiedlichen Preisen den Einzelpreis.
4. Dieselbe Auswahl lässt sich im Katalog über das Feld **Veranstaltung** und **Auswahl hinzufügen** auf eine Veranstaltungskarte setzen. Vor Ort können Helfer bei der geöffneten Veranstaltung **Getränkekarte** wählen und weitere Kataloggetränke hinzufügen. Die beiden PDF-Schaltflächen dort drucken die tatsächlich zugeordnete Karte mit dem Namen der Veranstaltung. Gebucht wird anschließend auf der gewohnten Strichliste oder direkt auf die Veranstaltung.
5. **Auswahl von Karte nehmen** entfernt eine Zuordnung. **Bearbeiten → Rezept löschen** entfernt das Rezept aus dem Katalog und allen Veranstaltungskarten. Beides steht dem Schnapswart und dem Admin zur Verfügung. Gebuchte Posten behalten ihren damaligen Namen und Preis. Katalogrezepte sind dauerhaft, auch wenn die Veranstaltung abläuft.

## Auszählungen für Lager und Veranstaltungen

Unter **Mein Konto → Auszählungen** erfassen KW (Kneipwart) und SW (Schnapswart) Flaschen aus dem Barkatalog, auch angebrochene Flaschen wie 0,75. Neue Getränke lassen sich mit Namen und Flaschenpreis ergänzen. BW zählt die aktuell unter **Produkte & Preise** hinterlegten Getränke. XXX zählt die Barkasse nach Münzen und Scheinen. Die Verwaltung kann alle drei Bereiche öffnen.

Jede Zählung erhält einen Namen, ein Datum und den Anlass **Lagerzählung** oder eine ausgewählte Veranstaltung. Für Getränke aus der Vorlage ohne Preis den Stückpreis bei der Zählung eintragen. Gespeicherte Zählungen enthalten die damaligen Mengen und Preise. Das Archiv gruppiert nach Semester und darin nach Veranstaltung. Lagerzählungen stehen in jedem Semester in einem eigenen Abschnitt. XXX und Verwaltung können einzelne Zählungen oder das gesamte Archiv in dieser Reihenfolge drucken.

Für eine Veranstaltung zuerst eine **Vorzählung** speichern. Über **Nachzählung erfassen** an dieser Vorzählung den Restbestand desselben Bereichs eintragen. Beide Zählungen stehen im Semester der Vorzählung, auch wenn die Veranstaltung über den Semesterwechsel geht.

Nachgeholte Getränke lassen sich über **Bearbeiten** in der Vorzählung ergänzen. Der Verbrauch ergibt sich je Getränk aus Anfangsbestand plus nachgeholter Menge abzüglich Restbestand. Bei der Barkasse zählt der Zuwachs gegenüber dem Anfangsbestand. Die Nachzählung zeigt die einzelnen Differenzen und den noch offenen Betrag. Mit **Auf Veranstaltung buchen** wird dieser Betrag einmalig verbucht. Wer später eine Menge berichtigt, kann die verbleibende Korrektur separat buchen.

## Zahlungserinnerungen für XXX

Unter **Mein Konto → Zahlungserinnerungen (XXX)** die gewünschten Personen mit offenem Betrag markieren und **Entwürfe vorbereiten** wählen. Die Vorschau verwendet pro Person die aktuelle E-Mail-Adresse und denselben Saldo wie in „Mein Konto“. Bei einem inzwischen ausgeglichenen Konto entfällt der Entwurf. Jeder Entwurf zeigt Empfänger, Betreff und Text. Über **Im Mailprogramm öffnen** kannst du ihn bearbeiten und selbst versenden. **Mailtext kopieren** eignet sich für Webmail. Der BW-Server braucht dafür keinen Mailzugang.

Mitglieder können unter **Mein Konto → E-Mail-Adresse** eine persönliche Adresse hinterlegen oder zur Standardadresse zurückkehren. Der Standard lautet `vorname.nachname@uttenruthia.de`. Leerzeichen innerhalb eines Namens werden zu Punkten, Bindestriche bleiben erhalten und deutsche Umlaute werden als ae, oe oder ue geschrieben. Bei fehlendem Vor- oder Nachnamen kann das Mitglied die Adresse selbst ergänzen.

## Anstreichen und Veranstaltungen

Die **Veranstaltungen** zeigen den Terminplan aus dem [Semesterprogramm der Uttenruthia](https://uttenruthia.de/programm/ical-export.html). Während eines Termins führt **Jetzt buchbar** zur Buchung. Beginn und Ende gelten in Erlanger Ortszeit. Vergangene Termine des laufenden Semesters lassen sich aufklappen. Die Kasse prüft das Programm alle sechs Stunden und behält bei Verbindungsproblemen den letzten erfolgreichen Stand. Burschenconvent, Philisterstammtisch (PST) und Wissenschaftliche Abende (WA) sind ausgenommen.

BW, SW und KW können sich in **Mein Konto** anmelden und unter **Veranstaltungen → Termin anlegen** Datum und Buchungsart wählen. In der Verwaltung steht dieselbe Funktion zur Verfügung. Eigene Termine sind am angegebenen Tag ganztägig buchbar. Bei Direktbuchungen trägt das Veranstaltungskonto den Verbrauch. Bei Personenbuchungen wählt man zuerst die Person. XXX kann unter **GnuCash Import / Export → Kontenzuordnung** das GnuCash-Konto des datierten Termins festlegen.

Bei **Gast** und **Couleur** zuerst den Namen eintragen, bei **Arbeitseinsatz** die Tätigkeit. Vorschläge stammen aus den Buchungen des jeweiligen Kontos in den letzten 24 Stunden. In der **Kontenübersicht** sehen BW und XXX auch später noch, zu wem oder wozu eine Buchung gehört. Couleur verwendet weiterhin das Konto 1800. SHV ist archiviert.

Unter den Sammelkonten stehen zuerst die priorisierten Personen und danach die Personen mit einem Getränkekauf in den vergangenen sieben Tagen. Jede Gruppe ist alphabetisch sortiert. Über die Suche findest du auch die übrigen Personen und die Langnamen der Sammelkonten. Bei Personenstrichlisten für Veranstaltungen erscheinen nur die Personengruppen.

Unter **GnuCash Import / Export → Sammelkonten der Strichliste** können Verwaltung und XXX-Berechtigte ein Sammelkonto anlegen, umbenennen, sein GnuCash-Ziel ändern oder es löschen. Als Ziel eine Kontonummer aus dem eingelesenen Kontenbaum oder den vollständigen Kontopfad eingeben. Änderungen gelten für neue Buchungen. Gelöschte Konten verschwinden aus der Auswahl, ihre bisherigen Buchungen bleiben erhalten.

Eine Getränkekachel fügt einen Strich hinzu. **−** nimmt einen einzelnen Strich zurück, **Zurücksetzen** leert die Auswahl. Erst **Buchen** schreibt die Buchung. Auf dem Handy lässt sich die Auswahl unter **Mein Konto → Getränke kaufen** öffnen.

Unter **Temporäre Getränke** einen Namen und Preis eingeben. Das Getränk ist 24 Stunden auf der normalen Strichliste und bei Veranstaltungen verfügbar. Bei beiden Veranstaltungsarten beschränkt **Nur bei dieser Veranstaltung** das Getränk auf den ausgewählten Anlass. Im selben Dialog lässt es sich über **Entfernen** vorzeitig herausnehmen. Bereits gebuchte Getränke behalten Name und Preis.

In **Mein Konto → Meine Buchungen** stehen Aktivenessen zusammen mit Getränkekäufen und den übrigen Kontobewegungen. Die jeweilige Essensbuchung lässt sich für Aufteilung, Ausleger und hinterlegte Rechnung öffnen. Die Verwaltungsfunktionen liegen unter **GnuCash Import / Export → Aktivenessen verwalten**.

Die vorhandene Vorlage **Stiftungsfest** erscheint unter **Stiftungsfestball**. Die separate **Stiftungsfestkneipe** verwendet die Kneipenzuordnung. Bei abweichenden bestehenden Kontenplänen die Zuordnung im GnuCash-Arbeitsbereich prüfen.

Unter **Verwaltung → Veranstaltungen** zeigt **BW-Getränkeposten gesamt** auch bereits übernommene Getränkebuchungen. **Offen in BW** zeigt Beträge, für die noch kein Export bestätigt wurde. **GnuCash-Saldo** zeigt den Wert des zugeordneten Kontos zum letzten Abgleich einschließlich Semesterabschluss und anderer GnuCash-Buchungen. Für diese Spalte einen Saldenabgleich mit der vollständigen GnuCash-XML-Datei durchführen.

## Aktivenessen und Abrechnungs-PDF

Unter **GnuCash Import / Export → Aktivenessen verwalten** können Verwaltung und XXX ein einzelnes Essen über **Formular und Rechnungen als PDF** herunterladen. **Semester als PDF** enthält die Formulare aller Essen im gewählten Semester mit den zugehörigen Rechnungsbildern. Die Abrechnung verwendet das Originalformular von 2024 mit 18 Teilnehmerzeilen. Aktiv und K-Gast werden im jeweiligen Kästchen angekreuzt. Weitere Personen folgen auf einem Zusatzblatt, danach die Rechnungsbilder. Die Portionszahl steht je Person in der Spalte „Portion“. Bei älteren Essen bleibt sie frei, wenn sie nicht erfasst wurde. Bei älteren Essen erscheinen Teilnehmergruppen und der Zuschuss pro Person nur, wenn die Angaben vorliegen.

Im selben Bereich steht **Zuschuss pro Aktiv/K-Gast in €**. Der Standard ist **4,00 €**. Beim Anlegen eines Essens für jede Person **Vollpreis**, **Aktiv** oder **K-Gast** auswählen. Die Anzahl der Portionen steht anfangs auf eins. Bierwart verteilt die Gesamtkosten centgenau nach Portionen und gewährt den Zuschuss je berechtigter Person einmal. **Aktiv** und **K-Gast** erhalten den Zuschuss höchstens bis zur Höhe ihres Anteils. Das Sammelkonto **Gast / Mitgliederwerbung** zählt als ein K-Gast. Ein leerer Preis wird automatisch berechnet. Manuelle Preise müssen zusammen mit dem Zuschuss die gesamte Rechnung ergeben.

Für bestehende BW-Installationen den Server wie oben aktualisieren. Das ZIP bringt die PDF-Abhängigkeiten für reguläres 64-Bit-Linux mit. Bei einer Installation auf Windows, macOS oder einer anderen Architektur im Ordner **getraenkekasse** zuerst `npm ci` ausführen, damit Node die zur Plattform passenden Bildbibliotheken installiert.

In **Verwaltung → Konten** und in der **Übersicht** stehen die zugeordneten Konten aufsteigend nach GnuCash-Kontonummer. Konten ohne Nummer folgen alphabetisch. Über die Suche in der Übersicht lassen sich auch Kontonummern eingeben.

## Unbenutztes BW-Personenkonto löschen

**Verwaltung → Konten → Löschen** neben dem Testkonto wählen und bestätigen. Erforderlich ist die Verwaltungs-PIN. Das Programm prüft unter anderem auf Buchungen und Beteiligung an Aktivenessen. Bereits bebuchte Konten sind auch bei einem Saldo von null geschützt. Ein eigenständiges GnuCash-Konto wird durch diese Aktion nicht gelöscht und kann beim folgenden Kontenimport wieder in BW erscheinen.

## Buchungsläufe

Bei der Sammelbuchung erhält jede Veranstaltung einen eigenen ausgeglichenen Buchungssatz. Im Abrechnungsbuch ist beispielsweise **4116 Divali** das Gegenkonto. Die Zuordnung lässt sich im GnuCash-Arbeitsbereich prüfen und ändern. Für eine neue Veranstaltung ohne zugeordnetes Konto kann BW nach dem Einlesen des Kontenbaums ein Konto vorschlagen.

Bei einem vor diesem Update vorbereiteten Lauf mit Partybuchungen zuerst die Vorschau prüfen. Falls die Buchung noch nicht in GnuCash gespeichert wurde, den alten Lauf verwerfen und neu erstellen. Bereits gespeicherte Buchungen bei Bedarf in GnuCash umbuchen. Für einen Semesterlauf etwa den Stichtag `2026-08-31` und den freien Beleg `SS26 U1` eintragen. Nach einer Unterbrechung dieselbe aktuelle Buchdatei öffnen und den Import erneut aufrufen.


## Abweichende Personensalden abgleichen

Die frühere Übernahme ausgewählter Buchungen erfasst nur einen Teil des Personenkontos. Beispielsweise können Anfangsbestände und andere Vereinsbuchungen im GnuCash-Saldo enthalten sein. Ein positives Guthaben im GnuCash-Verbindlichkeitskonto entspricht einem positiven Guthaben in BW.

1. Das aktuelle Vereinsbuch in GnuCash speichern. Im Browser unter **Verwaltung → GnuCash Import / Export → GnuCash einlesen** die vollständige .gnucash-XML-Datei wählen.
2. In der Vorschau steht **Saldenabgleich** oben. **Kontoauszüge und Salden aus GnuCash übernehmen** ist vorausgewählt, wenn ein vollständiger Saldo verfügbar ist und kein Buchungslauf offen ist. Unter **Salden anzeigen** stehen der bisherige BW-Saldo, der GnuCash-Stand, offene BW-Buchungen und der vorgesehene neue Stand. Historische Buchungen wie Aktivenessen lassen sich zusätzlich auswählen.
3. Prüfen und übernehmen. BW verwendet den GnuCash-Saldo bis zum heutigen Buchungstag und rechnet offene BW-Buchungen hinzu. Die interne Korrektur erscheint in der Historie und ist vom GnuCash-Export ausgeschlossen. Bei einem offenen Buchungslauf zuerst dessen Status klären. Bereits manuell in GnuCash verbuchte Posten müssen in BW als erledigt erfasst sein, damit sie nicht nochmals als offen zählen.


## Meine Buchungen

Nach dem Abgleich zeigt **Mein Konto → Meine Buchungen** jede Bewegung auf dem zugeordneten EUR-Personenkonto bis zum Buchungstag des Abgleichs. Dazu gehören Anfangsbestand, Ausgaben, Gutschriften, Buchungsdatum, Beleg, Gegenkonto und der Saldo nach der Buchung. Die Semester sind aufklappbar und zeigen die Summe der Zu- und Abgänge. Die Ansicht enthält auch BW-Buchungen, die seit dem Abgleich hinzugekommen sind.

Übernommene BW-Einzelposten stehen unter der Buchungsliste mit ihrer ursprünglichen Uhrzeit und Getränkeauswahl. Der Saldo zählt sie über die zugehörige GnuCash-Buchung. Für die vollständige Ansicht im Browser eine aktuelle vollständige GnuCash-XML-Datei einlesen. Die Auswahl einzelner historischer Belege ist für den Kontoauszug optional.
