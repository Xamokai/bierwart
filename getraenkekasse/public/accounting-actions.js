"use strict";

// Verwaltung und berechtigte Personen verwenden dieselben Datei- und Druckaktionen.
function mountAccountingActions({headers, getAccounts, afterImport}) {
  const id = name => document.getElementById(name);
  id("btnBackupTally").onclick = async e => {
    const button = e.currentTarget; button.disabled = true;
    try {
      const r = await fetch("/api/admin/backup-tally.ods", {headers:headers()});
      if (!r.ok) throw Error("Die Papier-Strichliste konnte nicht erstellt werden.");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(await r.blob());
      a.download = "strichliste-backup-" + new Date().toISOString().slice(0, 10) + ".ods";
      a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 3000);
      BW.toast("Papier-Strichliste erstellt.");
    } catch (error) { BW.toast(error.message); }
    finally { button.disabled = false; }
  };
  id("btnNegPdf").onclick = () => {
    const neg = getAccounts().filter(a => !a.isEvent && !a.isSystem && a.balance < 0).sort((x, y) => x.balance - y.balance);
    if (!neg.length) return BW.toast("Niemand ist im Minus 🎉");
    const total = neg.reduce((s, a) => s + a.balance, 0);
    const today = new Date().toLocaleDateString("de-DE");
    const w = window.open("", "_blank");
    if (!w) return BW.toast("Bitte das Druckfenster im Browser zulassen.");
    BW.printDocument(w,"Negativ-Liste "+today,
    `<div class="head"><h1>Getränkekasse – Offene Beträge</h1>
    <div class="muted">Stand: ${today} · ${neg.length} ${neg.length===1 ? "Konto" : "Konten"} im Minus</div></div>
    <table><thead><tr><th>Name</th><th class="r">Guthaben</th></tr></thead>
    <tbody>${neg.map(a => `<tr><td>${displayText(a.name)}</td><td class="r neg">${BW.money(a.balance)}</td></tr>`).join("")}</tbody>
    <tfoot><tr><td>Summe offen</td><td class="r neg">${BW.money(total)}</td></tr></tfoot></table>
    <p class="muted">Bitte Guthaben aufladen. – Erstellt mit der Getränkekasse.</p>
    `);
  };
  id("btnImport").onclick = async e => {
    const button = e.currentTarget;
    const input = id("impFile");
    const file = input.files[0];
    if (!file) return BW.toast("Bitte eine CSV-Datei wählen.");
    if (button.disabled) return;
    button.disabled = true;
    try {
      const create = id("impCreate").checked ? 1 : 0;
      const result = await BW.api("/api/admin/import?createMissing=" + create, {
        method:"POST", headers:{...headers(), "Content-Type":"text/csv"}, body:await file.text()
      });
      input.value = "";
      const lines = [result.booked + " Einzahlung(en) gebucht."];
      if (result.created.length) lines.push("Neu angelegt: " + result.created.join(", "));
      if (result.skipped.length) lines.push("Übersprungen:", ...result.skipped);
      id("impResult").textContent = lines.join("\n");
      BW.toast("Import abgeschlossen."); await afterImport();
    } catch (error) { BW.toast(error.message); }
    finally { button.disabled = false; }
  };
}
