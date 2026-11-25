/* Gemeinsamer GnuCash-Arbeitsbereich für die Verwaltungsseite und den
 * XXX-Bereich auf „Mein Konto“. Wird mit einem Container-Element und einer
 * Funktion, die die Auth-Header liefert, initialisiert:
 *     mountGnucashWorkbench(document.getElementById("gnu"), () => H());
 */
function mountGnucashWorkbench(root, headers, notify, onImported) {
  const eur = n => Number(n).toFixed(2).replace(".", ",") + " €";
  const toast = notify || (m => console.log(m));
  const H = () => headers();
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  let state = { open: null, pending: null, runs: [], ledger: [], settings: null, editing: null };

  root.innerHTML = `
    <div class="card"><h3 class="gold-text">GnuCash einlesen</h3>
      <p>Gespeicherte GnuCash-Datei oder CSV-Export auswählen. Personen, Veranstaltungen und Sammelkonten werden anhand des Kontenbaums zugeordnet.</p>
      <input id="bookFile" type="file" accept=".gnucash,.gnc,.xml,.gz,.csv">
      <div id="bookRows" aria-live="polite"></div><button class="btn gold" id="bookApply" hidden>Konten und Auswahl übernehmen</button>
    </div>
    <div class="card">
      <h3 style="margin-top:0" class="gold-text">Buchungslauf → GnuCash</h3>
      <button class="btn" id="accountDownload">Neue BW-Konten als CSV</button>
      <p class="muted" id="gnuPending">Lade …</p>
      <div id="gnuOpen"></div>
      <div class="row">
        <input id="gnuNumber" aria-label="Belegnummer" placeholder="Belegnummer, z. B. SS26 U1 (optional)" maxlength="48" style="max-width:300px">
        <label>Verbrauch gesammelt bis <input type="date" id="gnuDate"></label>
        <button class="btn gold" id="gnuNewRun">Buchungslauf erstellen</button>
        
      </div>
      <p class="muted" style="margin-bottom:0">Der Lauf friert nur die Buchungen bis zum Klick ein. Wer währenddessen Getränke bucht, stört nicht – das landet automatisch im nächsten Lauf.</p>
    </div>

    <div class="card">
      <h3 style="margin-top:0" class="gold-text">Kassenbuch – eigene Buchungen</h3>
      <p class="muted">Einkäufe, Bankgebühren, Barentnahmen usw. Sie wandern mit demselben Export nach GnuCash.</p>
      <div class="row" style="align-items:flex-end">
        <div style="min-width:130px"><label for="lgDate">Datum</label><input type="date" id="lgDate"></div>
        <div class="grow" style="min-width:180px"><label for="lgDesc">Beschreibung</label><input id="lgDesc" placeholder="z. B. Getränke-Einkauf Großhandel"></div>
        <div style="min-width:110px"><label for="lgAmount">Betrag (€)</label><input id="lgAmount" placeholder="0,00"></div>
      </div>
      <div class="row" style="align-items:flex-end; margin-top:8px">
        <div class="grow" style="min-width:180px"><label for="lgAcc">Konto (Soll)</label><input id="lgAcc" list="gnuAccounts" placeholder="Aufwand:Wareneinkauf"></div>
        <div class="grow" style="min-width:180px"><label for="lgCounter">Gegenkonto (Haben)</label><input id="lgCounter" list="gnuAccounts" placeholder="Aktiva:Barkasse"></div>
        <div style="min-width:120px"><label for="lgNo">Beleg-Nr.</label><input id="lgNo" placeholder="optional"></div>
        <button class="btn gold" id="lgSave">Buchen</button>
        <button class="btn" id="lgCancel" style="display:none">Abbrechen</button>
      </div>
      <datalist id="gnuAccounts"></datalist>
      <div id="lgMsg" class="muted" style="margin-top:6px"></div>
      <div class="table-scroll"><table style="margin-top:12px">
        <thead><tr><th>Datum</th><th>Beschreibung</th><th>Konto → Gegenkonto</th><th class="right">Betrag</th><th>Status</th><th></th></tr></thead>
        <tbody id="lgTable"></tbody>
      </table></div>
      <label class="row" style="margin-top:10px; text-transform:none"><input type="checkbox" id="lgShowAll" style="width:auto; min-height:auto"> auch bereits exportierte anzeigen</label>
    </div>

    <details class="daygroup">
      <summary><strong>Kontenzuordnung (GnuCash-Kontopfade)</strong><span class="muted">▾</span></summary>
      <div class="body" id="gnuSettings"></div>
      <div class="body"><label for="bwPerson">BW-Konto</label><select id="bwPerson"></select>
      <label for="bwPath">Vollständiger GnuCash-Kontopfad (einschließlich Kontonummer im Namen)</label>
      <input id="bwPath"><button class="btn" id="bwMap">Zuordnung speichern</button></div>
    </details>

    <details class="daygroup">
      <summary><strong>Frühere Buchungsläufe</strong><span class="muted">▾</span></summary>
      <div class="body table-scroll"><table><thead><tr><th>Nummer</th><th>Erstellt</th><th>Status</th><th class="right">Summe</th><th></th></tr></thead><tbody id="gnuRuns"></tbody></table></div>
    </details>`;

  const $ = id => root.querySelector("#" + id);

  async function api(url, opts) {
    const r = await fetch(url, { headers: H(), ...opts });
    const ct = r.headers.get("content-type") || "";
    const d = ct.includes("json") ? await r.json() : null;
    if (!r.ok) throw new Error((d && d.error) || "Fehler");
    return d;
  }

  async function download(url,filename) {
    try {
      const response=await fetch(url,{headers:H()});
      if(response.status===204)return toast("Alle BW-Konten sind im eingelesenen Kontenstand vorhanden.");
      if(!response.ok)throw Error((await response.json()).error || "Download fehlgeschlagen");
      const a=document.createElement("a");a.href=URL.createObjectURL(await response.blob());
      a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),3000);
    }catch(e){toast(e.message);}
  }

  /* ---------- Buchungsläufe ---------- */
  async function loadRuns() {
    const d = await api("/api/admin/export-runs");
    state.open = d.open; state.pending = d.pending; state.runs = d.runs;
    const p = d.pending;
    $("gnuPending").innerHTML = p.purchases + p.deposits + p.meals + p.ledger === 0
      ? "Keine weiteren Posten für einen neuen Lauf."
      : `Offen: <strong>${p.purchases}</strong> Getränke-/Veranstaltungsbuchungen, <strong>${p.deposits}</strong> Bareinzahlungen, <strong>${p.ledger}</strong> Kassenbuch-Buchungen, <strong>${p.meals}</strong> Aktivenessen · Summe <strong class="gold-text">${eur(p.total)}</strong>`;

    $("gnuOpen").innerHTML = d.open ? `
      <div class="card" style="background:var(--bg)">
        <strong>Offener Lauf ${esc(d.open.number)}</strong>
        <div class="muted">${d.open.counts.rows} Zeilen · ${eur(d.open.total)} · erstellt ${new Date(d.open.createdAt).toLocaleString("de-DE")} von ${esc(d.open.createdBy || "?")}</div>
        <div class="row" style="margin-top:10px">
          ${d.open.hasAccountCsv ? `<button class="btn" data-accounts="${d.open.id}">1. Neue Konten (CSV)</button>` : ""}
          <button class="btn gold" data-dl="${d.open.id}" data-nr="${esc(d.open.number)}">${d.open.hasAccountCsv ? "2. Buchungen (CSV)" : "Buchungen (CSV)"}</button>
          <button class="btn" data-commit="${d.open.id}">In GnuCash gebucht ✓</button>
          <button class="btn" data-discard="${d.open.id}">Verwerfen</button>
        </div>
        <p class="muted" style="margin-bottom:0">Nach erfolgreichem Import in GnuCash bestätigen. Damit beginnt die Veranstaltungs-Strichliste für diese Posten wieder bei null.</p>
      </div>` : "";

    $("gnuNewRun").disabled = !!d.open;


    $("gnuRuns").innerHTML = d.runs.map(r => `
      <tr><td>${esc(r.number)}</td>
      <td class="muted">${new Date(r.createdAt).toLocaleString("de-DE")}</td>
      <td>${r.status === "committed" ? "gebucht" : r.status === "open" ? "offen" : "verworfen"}</td>
      <td class="right">${eur(r.total)}</td>
      <td>${r.status === "discarded" ? "" : `<button class="btn small" data-dl="${r.id}" data-nr="${esc(r.number)}">CSV</button>`}</td></tr>`).join("")
      || '<tr><td colspan="5" class="muted">Noch keine Läufe.</td></tr>';

    root.querySelectorAll("[data-accounts]").forEach(b=>b.onclick=()=>download("/api/admin/export-runs/"+b.dataset.accounts+"/accounts.csv","BW-Neue-Konten.csv"));
    root.querySelectorAll("[data-dl]").forEach(b => b.onclick = () => download(`/api/admin/export-runs/${b.dataset.dl}/csv`, b.dataset.nr + ".csv"));
    root.querySelectorAll("[data-commit]").forEach(b => b.onclick = async () => {
      if (!confirm("Lauf als in GnuCash gebucht markieren?")) return;
      try { await api(`/api/admin/export-runs/${b.dataset.commit}/commit`, { method: "POST" }); toast("Als gebucht markiert ✓"); refresh(); }
      catch (e) { toast(e.message); }
    });
    root.querySelectorAll("[data-discard]").forEach(b => b.onclick = async () => {
      if (!confirm("Lauf verwerfen? Die Buchungen werden wieder freigegeben.")) return;
      try { await api(`/api/admin/export-runs/${b.dataset.discard}/discard`, { method: "POST" }); toast("Verworfen – nichts wurde gebucht"); refresh(); }
      catch (e) { toast(e.message); }
    });
  }

  $("gnuDate").value=new Intl.DateTimeFormat("sv-SE",{timeZone:"Europe/Berlin"}).format(new Date());
  $("accountDownload").onclick=()=>download("/api/admin/gnucash/exchange/accounts.csv","BW-Neue-Konten.csv");
  $("gnuNewRun").onclick = async () => {
    try {
      const run = await api("/api/admin/export-runs", { method: "POST", body:JSON.stringify({number:$("gnuNumber").value,summaryDate:$("gnuDate").value}) });
      $("gnuNumber").value="";
      toast(`Lauf ${run.number} erstellt ✓`);
      if(!run.hasAccountCsv)download(`/api/admin/export-runs/${run.id}/csv`, run.number + ".csv");
      refresh();
    } catch (e) { toast(e.message); }
  };
  /* ---------- Kassenbuch ---------- */
  function ledgerForm() {
    return {
      date: $("lgDate").value, description: $("lgDesc").value, amount: $("lgAmount").value,
      account: $("lgAcc").value, counterAccount: $("lgCounter").value, number: $("lgNo").value
    };
  }
  function clearForm() {
    $("lgDate").value = new Date().toISOString().slice(0, 10);
    ["lgDesc", "lgAmount", "lgNo"].forEach(id => $(id).value = "");
    state.editing = null;
    $("lgSave").textContent = "Buchen";
    $("lgCancel").style.display = "none";
  }
  $("lgCancel").onclick = clearForm;
  $("lgSave").onclick = async () => {
    try {
      const body = JSON.stringify(ledgerForm());
      if (state.editing) await api(`/api/admin/ledger/${state.editing}`, { method: "PUT", body });
      else await api("/api/admin/ledger", { method: "POST", body });
      $("lgMsg").textContent = "";
      clearForm();
      toast("Kassenbuch aktualisiert ✓");
      refresh();
    } catch (e) { $("lgMsg").textContent = e.message; }
  };
  $("lgShowAll").onchange = loadLedger;

  async function loadLedger() {
    const all = $("lgShowAll").checked ? "1" : "0";
    state.ledger = await api(`/api/admin/ledger?all=${all}`);
    $("lgTable").innerHTML = state.ledger.map(e => `
      <tr>
        <td class="muted">${e.date}</td>
        <td>${esc(e.description)}${e.number ? ` <span class="muted">(${esc(e.number)})</span>` : ""}</td>
        <td class="muted">${esc(e.account)} → ${esc(e.counterAccount)}</td>
        <td class="right">${eur(e.amount)}</td>
        <td class="muted">${e.exported ? "gebucht " + (e.runNumber || "") : e.runId ? "im Lauf " + (e.runNumber || "") : "offen"}</td>
        <td style="white-space:nowrap">${e.locked ? "" :
          `<button class="btn small" data-led-edit="${e.id}">Ändern</button>
           <button class="btn small" data-led-del="${e.id}">✕</button>`}</td>
      </tr>`).join("") || '<tr><td colspan="6" class="muted">Keine Buchungen.</td></tr>';

    root.querySelectorAll("[data-led-edit]").forEach(b => b.onclick = () => {
      const e = state.ledger.find(x => x.id === b.dataset.ledEdit);
      state.editing = e.id;
      $("lgDate").value = e.date; $("lgDesc").value = e.description;
      $("lgAmount").value = String(e.amount).replace(".", ",");
      $("lgAcc").value = e.account; $("lgCounter").value = e.counterAccount; $("lgNo").value = e.number || "";
      $("lgSave").textContent = "Änderung speichern";
      $("lgCancel").style.display = "";
    });
    root.querySelectorAll("[data-led-del]").forEach(b => b.onclick = async () => {
      if (!confirm("Buchung löschen?")) return;
      try { await api(`/api/admin/ledger/${b.dataset.ledDel}/delete`, { method: "POST" }); toast("Gelöscht ✓"); refresh(); }
      catch (err) { toast(err.message); }
    });
  }

  /* ---------- Kontenzuordnung ---------- */
  const FIELDS = [
    ["memberPrefix", "Mitgliedskonten (Präfix)"],
    ["guestAccount", "Gastanteile bei Aktivenessen"],
    ["mealAccount", "Zuschüsse für Aktivenessen"],
    ["revenueDrinks", "Gegenkonto für Getränke (Bierwart)"],
    ["eventAccount", "Veranstaltungskonten (übergeordneter Pfad)"],
    ["cashAccount", "Barkasse"],
    ["bankAccount", "Bank"],
    ["expenseAccount", "Wareneinkauf / Aufwand"],
    ["numberPrefix", "Präfix Buchungsnummer"],
    ["currency", "Währung"]
  ];
  async function loadSettings() {
    const d = await api("/api/admin/gnucash/settings");
    state.settings = d.settings;
    $("gnuSettings").innerHTML = `
      <p class="muted">Vollständige Pfade aus eurem GnuCash-Kontenbaum verwenden. Eine individuelle Zuordnung unten hat Vorrang. Der Dateiimport ordnet passende Personen und Veranstaltungen automatisch zu.</p>
      ${FIELDS.map(([k, label]) => `
        <label for="gs_${k}">${label}</label>
        <input id="gs_${k}" value="${esc(d.settings[k])}" style="margin-bottom:10px">`).join("")}
      <label class="row" style="text-transform:none"><input type="checkbox" id="gs_useMemberPrefix" ${d.settings.useMemberPrefix ? "checked" : ""} style="width:auto; min-height:auto"> Mitgliedsnamen unter dem Präfix als Unterkonto führen</label>
      <button class="btn gold" id="gsSave" style="margin-top:10px">Speichern</button>`;
    $("gnuAccounts").innerHTML = [d.settings.revenueDrinks, d.settings.eventAccount, d.settings.cashAccount, d.settings.bankAccount, d.settings.expenseAccount]
      .map(v => `<option value="${esc(v)}">`).join("");
    if (!$("lgAcc").value) $("lgAcc").value = d.settings.expenseAccount;
    if (!$("lgCounter").value) $("lgCounter").value = d.settings.cashAccount;
    $("gsSave").onclick = async () => {
      const body = { useMemberPrefix: $("gs_useMemberPrefix").checked };
      FIELDS.forEach(([k]) => body[k] = $("gs_" + k).value);
      try { await api("/api/admin/gnucash/settings", { method: "PUT", body: JSON.stringify(body) }); toast("Kontenzuordnung gespeichert ✓"); refresh(); }
      catch (e) { toast(e.message); }
    };
  }

  async function loadMappings() {
    const accounts = await api("/api/admin/gnucash/accounts");
    const select = $("bwPerson"), previous = select.value;
    select.replaceChildren(...accounts.map(a=>new Option(a.name,a.id)));
    if (accounts.some(a=>a.id===previous)) select.value = previous;
    select.onchange = () => {
      const a = accounts.find(a=>a.id===select.value);
      $("bwPath").value = a?.custom || "";
      $("bwPath").placeholder = a?.path || "";
    };
    select.onchange();
    $("bwMap").onclick = async () => {
      try {
        await api("/api/admin/gnucash/accounts/"+select.value,{method:"PUT",body:JSON.stringify({path:$("bwPath").value})});
        toast("Zuordnung gespeichert"); await loadMappings();
      } catch(e) { toast(e.message); }
    };
  }
  let source, result, revision=0;
  const endpoint="/api/admin/gnucash/exchange";
  const typeNames={person:"Personen",event:"Veranstaltungen",collective:"Sammelkonten",bw:"BW-Buchungen",meal:"Aktivenessen",ledger:"Kassenbuch / Sonstige BW-Buchungen",payment:"Einzahlungen"};
  async function readSource(query,file){
    const r=await fetch(endpoint+query,{method:"POST",headers:{...H(),"Content-Type":"application/octet-stream"},body:file});
    const data=await r.json();if(!r.ok)throw Error(data.error);return data;
  }
  $("bookFile").onchange=async()=>{
    const seq=++revision;
    source=$("bookFile").files[0];result=null;$("bookApply").hidden=true;
    $("bookRows").textContent=source?"Lese Konten und Buchungen …":"";
    if(!source)return;
    try {
      const d=await readSource("",source);if(seq!==revision)return;result=d;
      const count=k=>d.changes.filter(a=>a.kind===k).length;
      const warning=[...d.conflicts,...d.notices];
      let html=`<p>Neu oder geändert: ${count("person")} Personen · ${count("event")} Veranstaltungen · ${count("collective")} Sammelkonten.</p>`;
      if(d.changes.length)html+=`<details><summary>Kontenzuordnungen ansehen</summary>${d.changes.map(a=>`<div>${esc(a.path)} · ${a.action==="create"?"neu":"zuordnen"}</div>`).join("")}</details>`;
      if(d.candidates.length)html+="<p>Historische Buchungen ergänzen die Ansicht. Wähle bereits im BW-Programm erfasste Beträge ab.</p>";
      for(const kind of ["bw","meal","ledger","payment"]){
        const rows=d.candidates.filter(e=>e.kind===kind);if(!rows.length)continue;
        html+=`<details><summary>${typeNames[kind]} (${rows.length})</summary>${kind!=="payment"?`<label><input type="checkbox" data-all="${kind}" style="width:auto"> Alle in dieser Gruppe</label>`:""}`+
          rows.map(e=>`<label><input type="checkbox" data-kind="${kind}" data-book="${esc(e.key)}" style="width:auto"> ${esc(e.date)} · ${esc(e.number)} · ${esc(e.description)} ${esc(e.name||"")} · ${eur(e.amount/100)}</label>`).join("")+"</details>";
      }
      const balances = d.balances || [];
      const differences = balances.filter(a => a.target !== a.current);
      if ((balances.length || d.eventBalanceCount) && !d.balanceBlocked) {
        html = `<details open><summary>Saldenabgleich (${differences.length} Abweichungen)</summary>
          <label><input type="checkbox" data-book="balance-sync" style="width:auto" checked> ${d.statementReady ? "Kontoauszüge und Salden aus GnuCash übernehmen" : "Personensalden aus GnuCash übernehmen"}</label>
          <p>Offene BW-Buchungen werden zum GnuCash-Saldo hinzugerechnet. Optional ausgewählte historische Buchungen werden im Abgleich berücksichtigt.</p>
          ${d.eventBalanceCount ? `<p>Enthält den GnuCash-Saldo für ${d.eventBalanceCount} Veranstaltungskonten.</p>` : ""}
          <details><summary>Salden anzeigen</summary>${differences.map(a => `<div>${esc(a.name)} · BW ${eur(a.current/100)} → ${eur(a.target/100)} (GnuCash ${eur(a.book/100)}, offen in BW ${eur(a.open/100)})</div>`).join("") || "<p>Die Salden stimmen bereits überein.</p>"}</details></details>` + html;
      }
      if ((balances.length || d.eventBalanceCount) && d.balanceBlocked) html = "<p>Saldenabgleich verfügbar, sobald der offene BW-Buchungslauf erledigt ist.</p>" + html;
      if (!balances.length && !d.eventBalanceCount) html = "<p>Für den Saldenabgleich die vollständige GnuCash-XML-Datei auswählen.</p>" + html;
      if(d.already)html+=`<p>Bereits übernommen: ${d.already}</p>`;
      if(warning.length)html+=`<details><summary>Zur Prüfung · ${warning.length}</summary>${warning.map(w=>`<div>${esc(w)}</div>`).join("")}</details>`;
      $("bookRows").innerHTML=html;$("bookApply").hidden=false;$("bookApply").disabled=d.conflicts.length>0;
      root.querySelectorAll("[data-all]").forEach(box=>box.onchange=()=>root.querySelectorAll('[data-kind="'+box.dataset.all+'"]').forEach(x=>x.checked=box.checked));
    }catch(e){if(seq===revision)$("bookRows").textContent=e.message;}
  };
  $("bookApply").onclick=async()=>{
    if(!source || !result)return;
    $("bookApply").disabled=true;$("bookFile").disabled=true;
    try{
      const keys=[...root.querySelectorAll("[data-book]:checked")].map(x=>x.dataset.book);
      const sel=await api(endpoint+"/selection",{method:"POST",body:JSON.stringify({keys,preview:result.preview})});
      const done=await readSource("?preview="+result.preview+"&selection="+sel.handle,source);
      $("bookRows").textContent=done.accounts+" Konten angelegt oder zugeordnet · "+done.bookings+" Buchungen übernommen." + (done.statements ? " "+done.statements+" Kontoauszüge aktualisiert." : done.balances ? " "+done.balances+" Personensalden abgeglichen." : "") + (done.eventBalances ? " "+done.eventBalances+" Veranstaltungssalden aktualisiert." : "");
      $("bookApply").hidden=true;$("bookFile").value="";source=null;result=null;
      if(onImported)await onImported();else await refresh();
    }catch(e){toast(e.message);$("bookApply").disabled=false;}finally{$("bookFile").disabled=false;}
  };
  async function refresh() {
    try { await Promise.all([loadRuns(), loadLedger(), loadSettings(), loadMappings()]); }
    catch (e) { toast(e.message); }
  }
  clearForm();
  refresh();
  return { refresh };
}
