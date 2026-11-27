---
name: Bierwart der Uttenruthia
description: Gestaltungsgrundlagen der Getränkekasse für Mitglieder, Kiosk und Verwaltung.
colors:
  black: '#14120d'
  gold: '#e8c358'
  gold-dark: '#806013'
  surface: '#fff'
  bg: '#faf8f3'
  text: '#221f18'
  muted: '#696354'
  line: '#e6e0d0'
  outline: '#938b78'
  priority: '#cc701d'
  focus: '#805b09'
  red: '#98392e'
  green: '#39672e'
  tint: '#faf1ce'
  on-dark: '#e4dfd2'
  dark-bg: '#191816'
  dark-surface: '#25231f'
  dark-text: '#f3efe6'
  dark-muted: '#c0b8a8'
  dark-line: '#494438'
  dark-outline: '#8d8576'
  dark-gold-dark: '#e3bf69'
  dark-tint: '#3d3421'
  dark-balance-bg: '#302c23'
  dark-success-bg: '#233326'
  dark-error-bg: '#3d2926'
  dark-image-bg: '#343128'
  dark-red: '#ffac9e'
  dark-green: '#a4d59b'
typography:
  display:
    fontFamily: Georgia, "DejaVu Serif", serif
    fontSize: clamp(2.15rem,4vw,3.4rem)
    fontWeight: 400
    lineHeight: 1.12
    letterSpacing: -.032em
  section:
    fontFamily: Georgia, "DejaVu Serif", serif
    fontSize: 1.65rem
    fontWeight: 400
    lineHeight: 1.12
    letterSpacing: -.032em
  body:
    fontFamily: Segoe UI, system-ui, -apple-system, Roboto, sans-serif
    fontSize: 1rem
    lineHeight: 1.5
  balance:
    fontFamily: Segoe UI, system-ui, -apple-system, Roboto, sans-serif
    fontSize: clamp(2rem,6vw,3.8rem)
    fontWeight: 550
    lineHeight: 1.18
    letterSpacing: -.04em
rounded:
  control: 7px
  tile: 9px
  card: 12px
spacing:
  space-1: .25rem
  space-2: .5rem
  space-3: .75rem
  space-4: 1rem
  space-5: 1.5rem
  space-6: 2rem
  space-7: 3rem
components:
  button-primary:
    backgroundColor: '{colors.gold}'
    textColor: '{colors.black}'
    rounded: '{rounded.control}'
    padding: 10px 16px
  button-secondary:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.text}'
    rounded: '{rounded.control}'
    padding: 10px 16px
  button-ghost:
    textColor: '{colors.text}'
    rounded: '{rounded.control}'
    padding: 10px 16px
  input:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.text}'
    rounded: '{rounded.control}'
    typography: '{typography.body}'
  kiosk-navigation:
    backgroundColor: '{colors.gold}'
    textColor: '{colors.black}'
    rounded: '{rounded.control}'
    padding: 7px 13px
  balance-card:
    backgroundColor: '{colors.black}'
    textColor: '{colors.surface}'
    rounded: '{rounded.card}'
    padding: '{spacing.space-5}'
  priority-account:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.text}'
    rounded: '{rounded.tile}'
    padding: 14px 16px
---

# Bierwart der Uttenruthia

## Overview

Schwarz, Weiß und Gold verbinden die öffentliche Kasse, das persönliche Konto und die Verwaltung. Die Kopfzeile enthält Navigation und Farbschemawahl.

- Gold kennzeichnet Auswahl und Buchungsaktionen.
- Der Kontostand steht über den jüngsten Buchungen.
- Die Strichliste behält ihre Gruppenfolge auf allen Geräten.

## Colors

Schwarz trägt Kopfzeile, Kontostand und Bestellleiste. Auf Weiß und warmem Papier stehen Text und Beträge in dunkler Schrift. Die getönte Fläche und ihr Goldrand markieren die Auswahl. In der Strichliste kennzeichnet der schmale warme Rand priorisierte Konten. In der Veranstaltungswahl tragen dauerhafte Veranstaltungen dieselbe Kontur. Rot und Grün unterstützen Vorzeichen und Statusmeldungen. Die eigenständig startende Update-Seite verwendet dieselben Grundfarben.

**Farbschema.** Das Farbschema folgt anfangs dem Gerät. Der Schalter mit Sonne und Mond wechselt zwischen Hell und Dunkel. Die Wahl gilt im gesamten Browser für Kasse und Update-Seite. Im Fußbereich stellt „Geräte-Farbschema verwenden“ die automatische Wahl wieder her. Im Dunkelmodus liegen warme graubraune Karten auf dunklerem Grund. Helle Schrift und helles Gold halten Texte und Auswahl lesbar. Druckausgaben verwenden die helle Palette.

**Lesbarkeit auf Gold.** Goldene Buttons tragen schwarze Schrift. Helle Goldtöne auf Weiß brauchen eine ergänzende Kontur oder Beschriftung.

## Typography

Seitentitel verwenden Georgia mit Serifenersatz. Formulare, Navigation und Geldbeträge nutzen den Systemschriftstapel. Der große helle Kontostand bekommt eine eigene Zeile. Die Eurobeträge im Verlauf tragen ihr Vorzeichen.

**Gemeinsame Betragskante.** Buchungsbeträge stehen rechts in Spalten mit gleich breiten Ziffern. Datum, Buchungstext und Folgesaldo bleiben innerhalb desselben Eintrags.

## Layout

- **Smartphone.** Im Konto liegen Verlauf und Getränkekauf in der unteren Navigation. „Mehr“ öffnet die übrigen verfügbaren Funktionen. Bis 620 px stehen Datum und Betrag eines Eintrags oben, mit Platz für den Buchungstext darunter. Die Kontenverwaltung zeigt beschriftete Zeilen.
- **Kiosk.** Das Kontenraster passt seine Spaltenzahl an die Breite an. Auf Sammelkonten folgen priorisierte Konten und Konten mit Buchung in den letzten sieben Tagen. Weitere Konten sind über die Suche erreichbar. Im Getränkedialog bleiben Summe und Buchungsaktion zusammen.
- **Desktop.** Ab 1000 px begleitet eine Seitennavigation die Arbeit im Konto und in der Verwaltung. Ab 1200 px können Kontenliste und Detailansicht nebeneinander stehen. Die maximale Inhaltsbreite beträgt 82 rem, die eigenständige Update-Seite verwendet eine schmalere Lesespalte.

Bei Auszählungen wechseln Handy und Kiosk zwischen Erfassen und Archiv. Ab 1400 px stehen beide Bereiche nebeneinander. Das Archiv gruppiert Vor- und Nachzählungen nach Semester und Veranstaltung.

## Elevation & Depth

Karten und Tabellen trennen ihre Inhalte mit Flächen, Freiraum und dünnen Linien. Überlagerte Dialoge erhalten einen Schatten. Beim Öffnen bleibt erkennbar, welche Ansicht darunterliegt.

**Dialogkontur.** Jeder Dialog hat an allen vier Seiten eine durchgehende, 1 px dünne Kontur in der neutralen Linienfarbe. Beim Öffnen dunkelt der Hintergrund ab. Rechts oben schließt ein X mit 44 × 44 px Bedienfläche und dem zugänglichen Namen „Schließen“ den Dialog.

## Shapes

Bedienelemente haben kleine Rundungen, Kontokacheln etwas größere und Inhaltskarten die größten. Der dezente Prioritätsrand ist 1 px breit. Der Tastaturfokus umgibt das aktive Bedienelement mit Abstand.

## Components

- **Aktionen und Formulare.** Hauptaktionen erhalten die goldene Schaltfläche, Nebenaktionen die jeweilige Oberflächenfarbe mit Kontur. Felder tragen eine sichtbare Beschriftung. Rückmeldungen stehen als Text am Vorgang.
- **Persönliches Konto.** Eine dunkle Karte gruppiert Kontoname, Kontostand und Aktionen. Der Verlauf gliedert Buchungen nach Semester und öffnet zusätzliche Belegdetails am Eintrag.
- **Getränkeauswahl.** Antippen erhöht die Menge. Ausgewählte Getränke zeigen Menge und eine separate Aktion zum Verringern. Die Bestellleiste führt Summe und Abschluss zusammen.
- **Verwaltung und Rollen.** BW, SW, KW, XXX und Verwaltung verwenden gemeinsame Listen, Formulare und Dialoge. Fachbereiche wie Auszählung oder Buchhaltung erscheinen gemäß den bestehenden Zugriffsrechten.

**Menüsymbole.** Auf Handy und Kiosk zeigen die Links zur Strichliste und zu Veranstaltungen jeweils ein Symbol mit mindestens 44 px großer Bedienfläche. Am Desktop steht der Bereichsname daneben. Der Rückweg aus Konto und Verwaltung trägt fünf goldene Striche in einem dünnen Goldrahmen. Reine Symbolaktionen haben einen zugänglichen Namen.

**Produktliste.** Bild, Name und rechtsbündiger Preis bilden die Produktzeile. Antippen öffnet die Felder des gewählten Produkts. Der Speichern-Button erscheint bei Änderungen.

**Kontolöschung.** Die Aktion „Löschen“ trägt die rote Text- und Konturfarbe des jeweiligen Farbschemas.

**Sortierziel.** Beim Ziehen eines Produkts kennzeichnet eine umlaufende gestrichelte Kontur in der Goldfarbe für Text und Konturen die Zielzeile. Sie ist 2 px breit und liegt innerhalb der Zeile. Über „Reihenfolge ändern“ lassen sich ein Produkt und seine Zielposition auch per Touch oder Tastatur auswählen.

## Do's and Don'ts

**Beibehalten**

- Für neue Ansichten die gemeinsamen Variablen aus `getraenkekasse/public/design.css` verwenden.
- Priorisierte Konten mit der schmalen Kontur in ihrer eigenen Gruppe zeigen.
- Die Navigation aus den jeweils freigegebenen Funktionen zusammensetzen.

**Vermeiden**

- Eine Auswahl ausschließlich durch Farbe kennzeichnen.
- Beträge über zwei Zeilen auseinanderziehen oder lange Namen über benachbarte Beträge laufen lassen.
