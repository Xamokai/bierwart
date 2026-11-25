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
    w.document.write(`<!doctype html><html lang="de"><head><meta charset="utf-8">
    <title>Negativ-Liste ${today}</title>
    <style>
      body { font-family: "Segoe UI", system-ui, sans-serif; color: #221f18; margin: 40px; }
      .head { border-bottom: 3px solid #d4af37; padding-bottom: 10px; margin-bottom: 20px; }
      h1 { margin: 0; font-size: 1.3rem; letter-spacing: .12em; text-transform: uppercase; }
      .muted { color: #837c6b; font-size: .9rem; }
      table { width: 100%; border-collapse: collapse; margin-top: 10px; }
      th, td { text-align: left; padding: 8px 6px; border-bottom: 1px solid #ddd; }
      th { font-size: .75rem; text-transform: uppercase; letter-spacing: .06em; color: #837c6b; }
      td.r, th.r { text-align: right; }
      .neg { color: #b53d2e; font-weight: 600; }
      tfoot td { border-top: 2px solid #221f18; font-weight: 700; }
      @media print { body { margin: 12mm; } }
    </style></head><body>
    <div class="head"><h1>Getränkekasse – Offene Beträge</h1>
    <div class="muted">Stand: ${today} · ${neg.length} Konto/Konten im Minus</div></div>
    <table><thead><tr><th>Name</th><th class="r">Guthaben</th></tr></thead>
    <tbody>${neg.map(a => `<tr><td>${displayText(a.name)}</td><td class="r neg">${BW.money(a.balance)}</td></tr>`).join("")}</tbody>
    <tfoot><tr><td>Summe offen</td><td class="r neg">${BW.money(total)}</td></tr></tfoot></table>
    <p class="muted">Bitte Guthaben aufladen. – Erstellt mit der Getränkekasse.</p>
    </body></html>`);
    w.addEventListener("load", () => w.print(), {once:true});
    w.document.close();
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
