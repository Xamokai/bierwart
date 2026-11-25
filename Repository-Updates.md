# Bierwart über ein Git-Repository aktualisieren

## Bestehende Kasse einmalig übernehmen

1. Den laufenden Server 1.10.1 stoppen und den gesamten bisherigen Kassenordner sichern.
2. Das ZIP in einen **eigenen, dauerhaften Ordner** entpacken. Im neuen Unterordner `getraenkekasse` die mitgelieferten Ordner `data`, `assets` und die Datei `config.json` durch die gleichnamigen Originale der bestehenden Kasse ersetzen. Dazu gehören die Verwaltungs-PIN, die Produkte und die Belegbilder.
3. Im neuen `getraenkekasse` mit **`npm start`** starten. Einen vorhandenen Serverdienst auf dieses Arbeitsverzeichnis und `npm start` umstellen. Der Dienst läuft unter dem normalen Benutzer der Kasse. Er braucht Schreibzugriff auf diesen Ordner. Für Linux werden Node.js 24, Git mit SSH-Tag-Signaturen (ab 2.34), OpenSSH und `flock` aus util-linux benötigt. Für die abweichende Zielplattform bei Bedarf zuvor `npm ci` ausführen.
4. Die bisherige LAN-Adresse öffnen. Unter **Verwaltung → Software-Updates** die HTTPS-Klonadresse des eigenen Repositories speichern und **Nach Updates suchen** wählen.

## Das eigene Repository befüllen

Im ZIP liegt `Bierwart-Start.bundle` mit drei signierten Tags und dem Branch `main`. Das Bundle enthält die Programmquellen und die mitgelieferten Beispieldaten. Persönliche Kassen-, Konfigurations- und Belegdateien sind von Git ausgeschlossen.

Auf dem Entwicklungsrechner ein leeres Repository bei eurem Git-Anbieter anlegen. Im entpackten Paket die Befehle ausführen und die Beispieladresse durch die Schreibadresse eures Repositories ersetzen.

```sh
git clone ./Bierwart-Start.bundle bierwart-quellcode
cd bierwart-quellcode
git remote set-url origin https://codeberg.org/EUER-VEREIN/bierwart.git
git push -u origin main
git push origin v1.10.1 v1.11.0 v1.11.1
```

Für ein privates Repository braucht das Serverkonto Git-Lesezugriff über HTTPS. Diesen einmalig im Credential-Helper des Serverkontos einrichten. Die Adresse in der Verwaltung enthält weder Token noch Passwort. Ein bereits befülltes Repository kann ebenfalls verwendet werden. Die Tags müssen auf Bierwart-Quellstände mit der passenden Versionsnummer zeigen.

## Version auswählen oder zurückwechseln

**Nach Updates suchen** liest die Tags des gespeicherten Repositories. Die höchste Versionsnummer steht zuerst. Zum Wechsel eine Version auswählen, **Ausgewählte Version aktivieren** drücken und bestätigen. Über das Adressfeld lässt sich jederzeit ein anderes Repository speichern. Anschließend die Suche wiederholen. Bereits installierte Versionen stehen auch bei nicht erreichbarem Repository zur Verfügung.

Beim Laden läuft die Kasse weiter. Vor dem Wechsel schließt sie laufende Anfragen ab und sichert `data`, `assets` und `config.json` unter `getraenkekasse/.bierwart/backups/`. Dann startet sie die gewählte Version und prüft die Konten- und Produkt-API. Erst danach nimmt sie wieder Buchungen an. Eine fehlgeschlagene Aktivierung stellt den unmittelbar zuvor gesicherten Bestand wieder her. Der nächste Start verarbeitet auch einen durch Stromausfall unterbrochenen Wechsel.

Ein bewusst gewählter Rückwechsel verwendet **den aktuellen Kassenbestand**. Bereits gebuchte Striche bleiben erhalten. Die Version muss das Datenformat der Installation unterstützen. Format 1 ist für den Ausgangsstand 1.10.1 bis 1.11.1 vorgesehen. Künftige Releases mit anderem Format benötigen eine eigene Datenmigration.

Mitglieder melden sich nach dem Neustart erneut an. Der direkte Verwaltungslink `/updates/` funktioniert auch bei einer älteren Kassenoberfläche und bei einem Startfehler der Kasse. Die Zugangsdaten entsprechen der Verwaltungs-PIN. Sicherungen und lokale Programmversionen bleiben bis zur manuellen Bereinigung auf dem Server. Den Datenordner zusätzlich wie bisher auch außerhalb des Servers sichern.

## Weitere Versionen veröffentlichen

Jeder Release-Tag hat die Form `vMAJOR.MINOR.PATCH`, beispielsweise `v1.11.2`. Es werden SSH-signierte, annotierte Tags eines auf dem **Server** freigegebenen Herausgebers installiert. Die drei Tags aus dem Bundle sind bereits freigegeben. Für eure eigenen Veröffentlichungen einmalig einen eigenen Signierschlüssel auf dem Entwicklungsrechner einrichten:

```sh
ssh-keygen -t ed25519 -f ~/.ssh/bierwart-release -C bierwart-release
git config --local gpg.format ssh
git config --local user.signingkey "$HOME/.ssh/bierwart-release"
```

Auf dem Kassenserver eine Zeile in `getraenkekasse/update-manager/local-signers` ergänzen. Sie besteht aus einem Namen, der Beschränkung auf Git und dem vollständigen **öffentlichen** Schlüssel aus `bierwart-release.pub`. Der private Schlüssel bleibt auf dem Entwicklungsrechner.

```text
bierwart namespaces="git" ssh-ed25519 AAAA… bierwart-release
```

Für eine Veröffentlichung im Repository die Änderungen einspielen. In `getraenkekasse` aktualisiert `npm version` die Versionsnummer in beiden Paketdateien. Anschließend die Programmänderungen prüfen, committen, signieren und pushen. Beispiel für 1.11.2:

```sh
cd getraenkekasse
npm version 1.11.2 --no-git-tag-version
npm test
cd ..
git add -A
git commit -m "Bierwart 1.11.2"
git tag -s v1.11.2 -m "Bierwart 1.11.2"
git push origin main v1.11.2
```

Für die Entwicklung aus einem **frischen Clone** zunächst unter `getraenkekasse` mit `node update-manager/init.js` eine leere Testkasse einrichten und mit `npm ci` die Abhängigkeiten installieren. Den Betriebsbestand auf dem Server vom Quell-Repository getrennt halten.

## Betriebsdetails

Der dauerhaft installierte Startdienst stellt die Update-Seite unter der bekannten Kassenadresse bereit. Die Kasse läuft dahinter als einzelner Prozess. Änderungen am Startdienst selbst werden durch ein neues Installationspaket eingespielt. Repository-Wechsel betreffen die Kassenanwendung einschließlich der Weboberfläche.

Git-Tags werden beim Aktivieren nochmals gegen die angezeigte Objekt-ID geprüft. Nur ein gültig signierter Tag mit passendem Paketnamen, Versionseintrag und Datenformat wird übernommen. Gleiche Abhängigkeiten verwenden die bereits installierten Module. Bei geändertem Lockfile installiert der Dienst sie im neuen Versionsordner mit `npm ci --ignore-scripts`. Dafür benötigt der Server Zugriff auf die Paketquelle. Das Kassenverzeichnis selbst mit Zugangsdaten und Sicherungen gehört nicht ins Repository.

Das bereinigte Bundle in ein leeres Repository übertragen. Die früheren Tags wurden ohne das GnuCash-Plugin neu erstellt und signiert. Bei einer bestehenden 1.11.0-Installation vor dem Repo-Wechsel die öffentliche Schlüsselzeile mit dem Namen bereinigtes-startpaket aus update-manager/trusted-signers des neuen Pakets in update-manager/local-signers der Installation ergänzen.
