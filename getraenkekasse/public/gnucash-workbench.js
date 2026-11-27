/* Gemeinsamer GnuCash-Arbeitsbereich für die Verwaltungsseite und den
 * XXX-Bereich auf „Mein Konto“. Wird mit einem Container-Element und einer
 * Funktion, die die Auth-Header liefert, initialisiert:
 *     mountGnucashWorkbench(document.getElementById("gnu"), () => H());
 */
function mountGnucashWorkbench(root, headers, notify, onImported) {
  const eur = BW.money;
  const number = new Intl.NumberFormat("de-DE");
  const toast = notify || (m => console.log(m));
  const H = () => headers();
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  let state = { open: null, pending: null, runs: [], ledger: [], settings: null, editing: null };

  root.classList.add("gnu-workbench");
  root.innerHTML = `
    <section class="card gnu-import"><div class="gnu-import-head"><div><h3>GnuCash einlesen</h3>
      <p>Personen, Veranstaltungen und Sammelkonten aus einer GnuCash-Datei oder CSV zuordnen.</p></div>
      <label>Datei auswählen<input id="bookFile" type="file" accept=".gnucash,.gnc,.xml,.gz,.csv"></label></div>
      <div id="bookRows" aria-live="polite"></div><button class="btn gold" id="bookApply" hidden>Konten und Auswahl übernehmen</button>
    </section>
    <section class="card gnu-run"><div class="gnu-section-head"><h3>Buchungslauf für GnuCash</h3>
      <button class="btn" id="accountDownload">Neue BW-Konten als CSV</button></div>
      <div id="gnuPending" role="status">Offene Posten werden geladen …</div>
      <div id="gnuOpen"></div>
      <div class="gnu-run-fields">
        <label>Belegnummer (optional)<input id="gnuNumber" placeholder="z. B. SS26 U1" maxlength="48"></label>
        <label>Verbrauch gesammelt bis<input type="date" id="gnuDate"></label>
        <button class="btn gold" id="gnuNewRun">Buchungslauf erstellen</button>
      </div>
      <p>Spätere Buchungen fließen in den nächsten Lauf ein.</p>
    </section>
    <section class="card gnu-ledger">
      <h3>Kassenbuch</h3><p>Eigene Buchungen wie Einkäufe, Bankgebühren und Barentnahmen für den GnuCash-Export erfassen.</p>
      <div class="gnu-ledger-fields">
        <label>Datum<input type="date" id="lgDate"></label>
        <label>Beschreibung<input id="lgDesc" placeholder="z. B. Getränkeeinkauf"></label>
        <label>Betrag (€)<input id="lgAmount" inputmode="decimal" placeholder="0,00"></label>
        <label>Konto (Soll)<input id="lgAcc" list="gnuAccounts" placeholder="Aufwand:Wareneinkauf"></label>
        <label>Gegenkonto (Haben)<input id="lgCounter" list="gnuAccounts" placeholder="Aktiva:Barkasse"></label>
        <label>Belegnummer<input id="lgNo" placeholder="optional"></label>
      </div>
      <div class="gnu-actions"><button class="btn gold" id="lgSave">Buchen</button><button class="btn" id="lgCancel" style="display:none">Abbrechen</button></div>
      <datalist id="gnuAccounts"></datalist><div id="lgMsg" role="status"></div>
      <div class="gnu-section-head gnu-list-head"><h4>Buchungen</h4>
        <label class="gnu-check"><input type="checkbox" id="lgShowAll">Exportierte anzeigen</label></div>
      <div class="table-scroll"><table class="gnu-table"><thead><tr><th>Datum</th><th>Beschreibung</th><th>Konto → Gegenkonto</th><th class="right">Betrag</th><th>Status</th><th></th></tr></thead>
        <tbody id="lgTable"></tbody></table></div>
    </section>
    <details class="daygroup">
      <summary><strong>Sammelkonten der Strichliste</strong></summary>
      <form class="body stack-form" id="collectiveForm">
        <label>Sammelkonto<select id="collectivePick"><option value="">Neues Sammelkonto</option></select></label>
        <label>Name auf der Strichliste<input id="collectiveName" maxlength="120" required></label>
        <label>GnuCash-Kontonummer oder vollständiger Kontopfad<input id="collectiveTarget" maxlength="800" placeholder="z. B. 1800" required></label>
        <div class="row"><button class="btn gold" id="collectiveSave">Anlegen</button>
          <button class="btn" id="collectiveDelete" type="button" hidden>Löschen</button></div>
      </form>
    </details>

    <details class="daygroup">
      <summary><strong>Kontenzuordnung (GnuCash-Kontopfade)</strong></summary>
      <div class="body" id="gnuSettings"></div>
      <div class="body gnu-mapping"><div class="gnu-settings-grid"><div><label for="bwPerson">BW-Konto</label><select id="bwPerson"></select></div><div>
      <label for="bwPath">Vollständiger GnuCash-Kontopfad (einschließlich Kontonummer im Namen)</label>
      <input id="bwPath"></div></div><button class="btn" id="bwMap">Zuordnung speichern</button></div>
    </details>

    <details class="daygroup">
      <summary><strong>Frühere Buchungsläufe</strong></summary>
      <div class="body table-scroll"><table class="gnu-table"><thead><tr><th>Nummer</th><th>Erstellt</th><th>Status</th><th class="right">Summe</th><th></th></tr></thead><tbody id="gnuRuns"></tbody></table></div>
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

  const collectiveUrl = "/api/admin/collectives";
  const picker = $("collectivePick");
  let collectives = [];
  function showCollective() {
    const account = collectives.find(a => a.id === picker.value);
    $("collectiveName").value = account?.name || "";
    $("collectiveTarget").value = account?.target || "";
    $("collectiveSave").textContent = account ? "Speichern" : "Anlegen";
    $("collectiveDelete").hidden = !account;
  }
  picker.onchange = showCollective;
  async function loadCollectives(selected = picker.value) {
    collectives = await api(collectiveUrl);
    picker.replaceChildren(new Option("Neues Sammelkonto",""), ...collectives.map(a => new Option(a.name,a.id)));
    picker.value = collectives.some(a => a.id === selected) ? selected : "";
    showCollective();
  }
  async function changeCollective(remove) {
    const id = picker.value;
    const name = $("collectiveName").value.trim();
    if (remove && !confirm("Sammelkonto „" + picker.selectedOptions[0].text + "“ löschen? Bisherige Buchungen bleiben erhalten.")) return;
    const save = $("collectiveSave"), del = $("collectiveDelete");
    if (save.disabled) return;
    save.disabled = del.disabled = picker.disabled = true;
    try {
      const result = await api(collectiveUrl + (id ? "/" + encodeURIComponent(id) : ""), {
        method:remove ? "DELETE" : id ? "PUT" : "POST",
        body:remove ? undefined : JSON.stringify({name, target:$("collectiveTarget").value.trim()})
      });
      await loadCollectives(remove ? "" : result.id);
      if (onImported) await onImported(); else await loadMappings();
      toast(remove ? "Sammelkonto gelöscht." : "Sammelkonto gespeichert.");
    } catch (error) { toast(error.message); }
    finally { save.disabled = del.disabled = picker.disabled = false; }
  }
  $("collectiveForm").onsubmit = e => { e.preventDefault(); changeCollective(false); };
  $("collectiveDelete").onclick = () => changeCollective(true);

  /* ---------- Buchungsläufe ---------- */
  async function loadRuns() {
    const d = await api("/api/admin/export-runs");
    state.open = d.open; state.pending = d.pending; state.runs = d.runs;
    const p = d.pending;
    const groups = [["Getränke / Veranstaltungen",p.purchases],["Bareinzahlungen",p.deposits],["Kassenbuch",p.ledger],["Aktivenessen",p.meals]];
    $("gnuPending").innerHTML = groups.every(([,count]) => !count)
      ? "<p>Keine weiteren Posten für einen neuen Lauf.</p>"
      : `<div class="gnu-total"><span>Summe offener Posten</span><strong>${eur(p.total)}</strong></div>
        <dl class="gnu-counts">${groups.map(([label,count]) => "<div><dt>"+label+"</dt><dd>"+number.format(count)+"</dd></div>").join("")}</dl>`;

    $("gnuOpen").innerHTML = d.open ? `
      <div class="gnu-open-run">
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
      <tr><td data-label="Nummer">${esc(r.number)}</td>
      <td data-label="Erstellt" class="muted">${new Date(r.createdAt).toLocaleString("de-DE")}</td>
      <td data-label="Status">${r.status === "committed" ? "gebucht" : r.status === "open" ? "offen" : "verworfen"}</td>
      <td data-label="Summe" class="right">${eur(r.total)}</td>
      <td class="gnu-row-actions">${r.status === "discarded" ? "" : `<button class="btn small" data-dl="${r.id}" data-nr="${esc(r.number)}">CSV</button>`}</td></tr>`).join("")
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
        <td data-label="Datum" class="muted">${esc(e.date)}</td>
        <td data-label="Beschreibung"><span>${esc(e.description)}${e.number ? ` <span class="muted">(${esc(e.number)})</span>` : ""}</span></td>
        <td data-label="Soll → Haben" class="muted">${esc(e.account)} → ${esc(e.counterAccount)}</td>
        <td data-label="Betrag" class="right">${eur(e.amount)}</td>
        <td data-label="Status" class="muted">${e.exported ? "gebucht " + esc(e.runNumber || "") : e.runId ? "im Lauf " + esc(e.runNumber || "") : "offen"}</td>
        <td class="gnu-row-actions">${e.locked ? "" :
          `<button class="btn small" data-led-edit="${e.id}">Ändern</button>
           <button class="btn small danger-action" data-led-del="${e.id}">Löschen</button>`}</td>
      </tr>`).join("") || '<tr><td colspan="6" class="muted">Keine Buchungen.</td></tr>';

    root.querySelectorAll("[data-led-edit]").forEach(b => b.onclick = () => {
      const e = state.ledger.find(x => x.id === b.dataset.ledEdit);
      state.editing = e.id;
      $("lgDate").value = e.date; $("lgDesc").value = e.description;
      $("lgAmount").value = String(e.amount).replace(".", ",");
      $("lgAcc").value = e.account; $("lgCounter").value = e.counterAccount; $("lgNo").value = e.number || "";
      $("lgSave").textContent = "Änderung speichern";
      $("lgCancel").style.display = "";
      $("lgDesc").focus();
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
      <div class="gnu-settings-grid">${FIELDS.map(([k, label]) => `<label>${label}<input id="gs_${k}" value="${esc(d.settings[k])}"></label>`).join("")}</div>
      <label class="gnu-check"><input type="checkbox" id="gs_useMemberPrefix" ${d.settings.useMemberPrefix ? "checked" : ""} style="width:auto; min-height:auto"> Mitgliedsnamen unter dem Präfix als Unterkonto führen</label>
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
          rows.map(e=>`<label class="gnu-candidate"><input type="checkbox" data-kind="${kind}" data-book="${esc(e.key)}"><span><small>${[e.date,e.number].filter(Boolean).map(esc).join(" · ")}</small>${[e.description,e.name].filter(Boolean).map(esc).join(" · ")}</span><strong>${eur(e.amount/100)}</strong></label>`).join("")+"</details>";
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
    try { await Promise.all([loadRuns(), loadLedger(), loadSettings(), loadMappings(), loadCollectives()]); }
    catch (e) { toast(e.message); }
  }
  clearForm();
  refresh();
  return { refresh };
}
