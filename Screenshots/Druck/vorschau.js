"use strict";

function zeigeDruckbeispiele(bereich, pfad) {
  const ausgaben = [
    ["Auszaehlungen", "Vor- und Nachzählung · Veranstaltung", 1],
    ["Auszaehlung-Einzel", "Einzelne Nachzählung", 1],
    ["Papier-Strichliste", "Papier-Strichliste", 1],
    ["Offene-Betraege", "Offene Beträge", 4],
    ["Aktivenessen", "Aktivenessen mit Beleg", 3],
    ["Aktivenessen-Semester", "Aktivenessen · Semester", 5],
    ["Mixliste", "Mixliste · Katalog", 1],
    ["Mixliste-Veranstaltung", "Mixliste · Ankneipe", 1],
    ["Preisliste", "Preisliste · Katalog", 1],
    ["Preisliste-Veranstaltung", "Preisliste · Ankneipe", 1]
  ];
  bereich.innerHTML = '<div class="druckwahl"><label>Druckbeispiel<select></select></label><div class="seitenwahl"><button type="button" data-zurueck aria-label="Vorherige Seite">‹</button><span role="status"></span><button type="button" data-weiter aria-label="Nächste Seite">›</button></div><a data-pdf>PDF öffnen</a><a data-ods hidden>Tabelle (ODS)</a></div><a class="druckbild"><img alt=""></a>';
  const auswahl = bereich.querySelector("select");
  const zurueck = bereich.querySelector("[data-zurueck]"), weiter = bereich.querySelector("[data-weiter]");
  const bildlink = bereich.querySelector(".druckbild"), bild = bildlink.querySelector("img");
  for (const [datei, name] of ausgaben) auswahl.add(new Option(name,datei));
  let seite = 1;
  function anzeigen() {
    const [datei, name, anzahl] = ausgaben[auswahl.selectedIndex];
    const adresse = pfad+"Seiten/"+datei+"-"+seite+".png";
    bild.alt = name+" · Seite "+seite+" von "+anzahl;
    bild.src = bildlink.href = adresse;
    bildlink.title = "Druckseite in Originalgröße öffnen";
    bereich.querySelector("[data-pdf]").href = pfad+datei+".pdf#page="+seite;
    const tabelle = bereich.querySelector("[data-ods]");
    tabelle.hidden = datei !== "Papier-Strichliste";
    tabelle.href = pfad+"Papier-Strichliste.ods";
    bereich.querySelector("[role=status]").textContent = "Seite "+seite+" von "+anzahl;
    zurueck.disabled = seite <= 1;
    weiter.disabled = seite >= anzahl;
  }
  auswahl.onchange = () => { seite = 1; anzeigen(); };
  zurueck.onclick = () => { seite--; anzeigen(); };
  weiter.onclick = () => { seite++; anzeigen(); };
  anzeigen();
}
