/* Gemeinsames Formular für Aktivenessen – nutzbar auf Konto und Strichliste. */
window.ActiveMeals = (() => {
  const eur = cents => (cents / 100).toFixed(2).replace(".", ",") + " €";
  const esc = value => String(value).replace(/[&<>'"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[ch]);
  const todayLocal = () => {
    const d = new Date();
    const off = d.getTimezoneOffset() * 60000;
    return new Date(d - off).toISOString().slice(0, 10);
  };
  const centsOf = value => {
    if (value === null || value === undefined || String(value).trim() === "") return null;
    const normalized = String(value).trim().replace(",", ".");
    if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return NaN;
    return Math.round(Number(normalized) * 100);
  };

  function init(options = {}) {
    const trigger = document.getElementById(options.triggerId);
    if (!trigger) return null;

    const state = { accounts: [], participants: [], files: [], busy: false, subsidyPerPerson: 400, xxxCard: { accountNumber: "" } };
    const uid = `am-${Math.random().toString(36).slice(2, 8)}`;
    const host = document.createElement("div");
    host.innerHTML = `
      <dialog class="bw-dialog active-meal-sheet" id="${uid}-sheet" aria-labelledby="${uid}-title">
        <div class="dialog-head">
          <h2 id="${uid}-title">Aktivenessen anlegen</h2>
          <button class="btn small ghost" type="button" data-close>Schließen</button>
        </div>

        <div class="active-meal-fields">
          <div><label for="${uid}-name">Name des Essens</label><input id="${uid}-name" data-name autocomplete="off" placeholder="z. B. Pizza nach dem Convent"></div>
          <div><label for="${uid}-date">Datum</label><input id="${uid}-date" data-date type="date"></div>
          <div><label for="${uid}-total">Gesamtkosten in €</label><input id="${uid}-total" data-total inputmode="decimal" placeholder="0,00"></div>
          <div><label for="${uid}-payer">Ausgelegt von</label><select id="${uid}-payer" data-payer></select><div class="muted" data-payer-hint style="font-size:.8rem; margin-top:4px"></div></div>
        </div>

        <div class="extra-payers"><button type="button" class="btn" data-more>Weiteren Ausleger hinzufügen</button><div data-extra></div></div>
        <div class="card active-meal-block">
          <div class="row" style="justify-content:space-between"><strong>Rechnung</strong><span class="muted">mindestens 1 Bild</span></div>
          <p class="muted" style="margin:6px 0 10px">Mehrere Bilder auswählen oder die Kamera wiederholt öffnen.</p>
          <div class="row">
            <button class="btn" type="button" data-pick>Bilder auswählen</button>
            <button class="btn gold" type="button" data-camera>Foto aufnehmen</button>
          </div>
          <input data-file type="file" accept="image/*" multiple hidden>
          <input data-camera-file type="file" accept="image/*" capture="environment" hidden>
          <div class="receipt-preview" data-preview></div>
        </div>

        <div class="card active-meal-block">
          <strong>Personen</strong>
          <p class="muted" style="margin:6px 0 10px">Aktiv und K-Gast erhalten den hinterlegten Zuschuss. Alle anderen zahlen ihren vollen Anteil.</p>
          <div class="row active-meal-add-person">
            <input class="grow" data-person-input aria-label="Person suchen" autocomplete="off" placeholder="Name suchen …">
            <button class="btn" type="button" data-add-person>Hinzufügen</button>
          </div>
          <div class="person-matches" data-matches></div>
          <div data-persons></div>
        </div>

        <div class="split-status" data-status></div>
        <div class="row" style="justify-content:flex-end; margin-top:12px">
          <button class="btn gold" type="button" data-submit>Aktivenessen buchen</button>
        </div>
      </dialog>`;
    document.body.appendChild(host);

    
    const sheet = host.querySelector(`#${uid}-sheet`);
    const nameInput = host.querySelector("[data-name]");
    const dateInput = host.querySelector("[data-date]");
    const totalInput = host.querySelector("[data-total]");
    const extra=host.querySelector("[data-extra]");
    const payerInput = host.querySelector("[data-payer]");
    const payerHint = host.querySelector("[data-payer-hint]");
    const personInput = host.querySelector("[data-person-input]");
    const matches = host.querySelector("[data-matches]");
    const modal = BW.dialog(sheet, () => !state.busy);
    const personRows = host.querySelector("[data-persons]");
    const status = host.querySelector("[data-status]");
    const submit = host.querySelector("[data-submit]");
    const fileInput = host.querySelector("[data-file]");
    const cameraInput = host.querySelector("[data-camera-file]");
    const preview = host.querySelector("[data-preview]");

    function token() { return typeof options.getToken === "function" ? options.getToken() : ""; }
    function creatorId() { return typeof options.getCreatorAccountId === "function" ? options.getCreatorAccountId() : null; }
    function headers(json = false) {
      const h = {};
      if (token()) h.Authorization = "Bearer " + token();
      if (json) h["Content-Type"] = "application/json";
      return h;
    }
    function notify(message) {
      if (typeof options.toast === "function") options.toast(message);
      else alert(message);
    }

    async function loadAccounts() {
      const r = await fetch("/api/active-meals/options", { headers: headers(false) });
      if (!r.ok) throw new Error("Konten konnten nicht geladen werden");
      const d = await r.json();
      state.accounts = d.accounts || [];
      state.subsidyPerPerson = Math.round((d.subsidyPerPerson ?? 4) * 100);
      state.xxxCard = d.xxxCard || { accountNumber: "" };
      const cardLabel = state.xxxCard.accountNumber
        ? `XXX-Karte · ${state.xxxCard.accountNumber}`
        : "XXX-Karte · Kontonummer noch nicht gesetzt";
      payerInput.innerHTML = `<option value="xxx-card">${esc(cardLabel)}</option><option value="bank">Direkt vom Bankkonto</option>` +
        state.accounts.filter(a => !a.collective).map(a => `<option value="account:${esc(a.id)}">${esc(a.name)}</option>`).join("");
    }

    function addParticipant(account) {
      if (!account || state.participants.some(p => p.accountId === account.id)) return;
      state.participants.push({ accountId: account.id, name: account.name, price: "",
        collective:account.collective, role:account.collective ? "kgast" : "voll" });
      personInput.value = "";
      matches.replaceChildren();
      renderParticipants();
    }

    function matchingAccounts() {
      const q = personInput.value.trim().toLocaleLowerCase("de");
      return q ? state.accounts.filter(a => a.name.toLocaleLowerCase("de").includes(q)
        && !state.participants.some(p => p.accountId === a.id)) : [];
    }
    function renderMatches() {
      matches.replaceChildren();
      const list = matchingAccounts();
      for (const a of list.slice(0, 8)) {
        const button = document.createElement("button");
        button.type = "button"; button.textContent = a.name;
        button.onclick = () => addParticipant(a); matches.append(button);
      }
      if (!list.length && personInput.value.trim()) matches.textContent = "Keine weiteren passenden Personen.";
    }
    personInput.oninput = renderMatches;
    function addTypedParticipant() {
      const list = matchingAccounts();
      const q = personInput.value.trim().toLocaleLowerCase("de");
      const match = list.find(a => a.name.toLocaleLowerCase("de") === q) || (list.length === 1 && list[0]);
      if (match) addParticipant(match);
      else { renderMatches(); notify("Bitte einen Namen aus der Trefferliste auswählen."); }
    }

    function split() {
      try {
        const total = centsOf(totalInput.value);
        const split = splitActiveMeal(total, state.participants.map(p => ({...p, cents:centsOf(p.price)})), state.subsidyPerPerson);
        const difference = split.difference;
        const message = difference
          ? (difference > 0 ? `Noch ${eur(difference)} offen.` : `Einzelbeträge sind ${eur(-difference)} zu hoch.`)
          : `Zuschuss pro Aktiv/K-Gast ${eur(state.subsidyPerPerson)} · Zuschuss gesamt ${eur(split.subsidy)} · Kostenanteile ${eur(total-split.subsidy)}.`;
        return {...split, valid:difference === 0, message};
      } catch (error) {
        return {rows:[], difference:null, valid:false, message:error.message};
      }
    }

    function renderParticipants() {
      const calc = split();
      personRows.innerHTML = state.participants.map((p, i) => {
        const row = calc.rows.find(x => x.accountId === p.accountId);
        const auto = row && !row.manual && Number.isInteger(row.cents) ? `Auto: ${eur(row.cents)}` : "Auto-Verteilung";
        return `<div class="participant-row">
          <div class="grow"><strong>${esc(p.name)}</strong><div class="muted auto-price">${auto}</div></div>
          <div class="participant-roles" role="group" aria-label="Gruppe für ${esc(p.name)}">
            ${[["voll","Vollpreis"],["aktiv","Aktiv"],["kgast","K-Gast"]].map(([value,label]) => `
              <label><input type="radio" name="${uid}-role-${i}" data-role-index="${i}" value="${value}"
                ${p.role === value ? "checked" : ""} ${p.collective ? "disabled" : ""}> ${label}</label>`).join("")}
          </div>
          <div class="participant-price"><label for="${uid}-price-${i}">Preis (€)</label><input id="${uid}-price-${i}" data-price="${i}" inputmode="decimal" value="${esc(p.price)}" placeholder="Auto"></div>
          <button class="btn small" type="button" data-remove="${i}" aria-label="${esc(p.name)} entfernen">✕</button>
        </div>`;
      }).join("");
      personRows.querySelectorAll("[data-price]").forEach(input => {
        input.oninput = () => { state.participants[Number(input.dataset.price)].price = input.value; updateStatus(false); };
      });
      personRows.querySelectorAll("[data-role-index]").forEach(input => {
        input.onchange = () => {
          state.participants[Number(input.dataset.roleIndex)].role = input.value;
          updateStatus(false);
        };
      });
      personRows.querySelectorAll("[data-remove]").forEach(button => {
        button.onclick = () => { state.participants.splice(Number(button.dataset.remove), 1); renderParticipants(); };
      });
      updateStatus(true);
    }

    function updateStatus(rerenderAuto) {
      const calc = split();
      status.className = `split-status ${calc.valid ? "ok" : calc.difference !== null ? "warn" : ""}`;
      status.innerHTML = `<strong>${calc.valid ? "✓ " : calc.difference !== null ? "⚠ " : ""}${esc(calc.message)}</strong>`;
      submit.disabled = state.busy || !calc.valid || !nameInput.value.trim() || !dateInput.value || !state.files.length;
      if (rerenderAuto) return;
      personRows.querySelectorAll("[data-price]").forEach((input, i) => {
        const row = calc.rows.find(x => x.accountId === state.participants[i].accountId);
        const label = input.closest(".participant-row").querySelector(".auto-price");
        label.textContent = row && !row.manual && Number.isInteger(row.cents) ? `Auto: ${eur(row.cents)}` : "Auto-Verteilung";
      });
    }

    function addFiles(fileList) {
      for (const file of Array.from(fileList || [])) {
        const imageLike = String(file.type || "").startsWith("image/") || /\.(jpe?g|png|webp|gif|heic|heif)$/i.test(file.name || "");
        if (!imageLike || state.files.length >= 10) continue;
        state.files.push({ file, url: URL.createObjectURL(file) });
      }
      renderFiles();
    }

    function renderFiles() {
      preview.innerHTML = state.files.map((item, i) => `<div class="receipt-thumb">
        <img src="${item.url}" alt="Rechnungsfoto ${i + 1}">
        <button type="button" data-remove-file="${i}" aria-label="Foto entfernen">✕</button>
      </div>`).join("");
      preview.querySelectorAll("[data-remove-file]").forEach(button => {
        button.onclick = () => {
          const [removed] = state.files.splice(Number(button.dataset.removeFile), 1);
          if (removed) URL.revokeObjectURL(removed.url);
          renderFiles();
        };
      });
      updateStatus(false);
    }

    function reset() {
      state.participants = [];
      state.files.forEach(item => URL.revokeObjectURL(item.url));
      state.files = [];
      nameInput.value = "";
      dateInput.value = todayLocal();
      totalInput.value = "";
      extra.replaceChildren();
      const id = creatorId();
      payerInput.value = id && state.accounts.some(a => a.id === id) ? `account:${id}` : "xxx-card";
      updatePayerHint();
      personInput.value = "";
      matches.replaceChildren();
      renderFiles();
      renderParticipants();
    }

    async function open() {
      try {
        await loadAccounts();
        reset();
        const id = creatorId();
        const creator = state.accounts.find(a => a.id === id);
        if (creator) addParticipant(creator);
        modal.open();
      } catch (error) { notify(error.message); }
    }

    function updatePayerHint() {
      if (payerInput.value === "xxx-card") {
        payerHint.textContent = state.xxxCard.accountNumber
          ? `Gegenkonto: ${state.xxxCard.accountNumber}`
          : "Fallback: XXX-Karte. Die Kontonummer kann von Admin oder XXX gesetzt werden.";
      } else if (payerInput.value === "bank") {
        payerHint.textContent = "Die Ausgabe wird direkt über das Bankkonto gebucht.";
      } else {
        payerHint.textContent = "Alle Beteiligten zahlen über die Getränkekasse an diese Person.";
      }
    }
    function close(force = false) {
      if (force) sheet.close(); else modal.close();
    }

    async function uploadFile(file) {
      const params = new URLSearchParams({ name: file.name || "rechnung", type: file.type || "" });
      const r = await fetch(`/api/active-meals/upload?${params}`, {
        method: "POST", headers: { ...headers(false), "Content-Type": "application/octet-stream" }, body: file
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || `Upload von ${file.name || "Bild"} fehlgeschlagen`);
      return d.file;
    }

    host.querySelector("[data-more]").onclick=()=>{
      const row=document.createElement("div");row.className="row";
      row.innerHTML='<select aria-label="Weiterer Ausleger"></select><input aria-label="Auslage in Euro" inputmode="decimal" placeholder="Auslage in €"><button type="button" class="btn">Entfernen</button>';
      row.className = "extra-payer";
      row.querySelector("select").replaceChildren(...state.accounts.filter(a => !a.collective).map(a=>new Option(a.name,a.id)));
      row.querySelector("button").onclick=()=>row.remove();
      extra.append(row);
    };
    async function submitMeal() {
      if (state.busy) return;
      const calc = split();
      if (!calc.valid || !nameInput.value.trim() || !dateInput.value || !state.files.length) {
        updateStatus(false); return notify("Bitte alle Pflichtfelder prüfen.");
      }
      state.busy = true; updateStatus(false);
      submit.textContent = "Wird gebucht …";
      try {
        const receipts = [];
        for (const item of state.files) receipts.push(await uploadFile(item.file));
        const participants = state.participants.map(p => ({ accountId: p.accountId, role:p.role, price: p.price.trim() === "" ? null : p.price }));
        const payerValue = payerInput.value;
        const payerKind = payerValue.startsWith("account:") ? "account" : payerValue;
        const payerAccountId = payerKind === "account" ? payerValue.replace(/^account:/, "") : null;
        const r = await fetch("/api/active-meals", {
          method: "POST", headers: headers(true),
          body: JSON.stringify({ name: nameInput.value.trim(), date: dateInput.value, total: totalInput.value, allocation:"roles",subsidyPerPerson:state.subsidyPerPerson / 100,extraPayers:[...extra.children].map(r=>({accountId:r.querySelector("select").value,amount:r.querySelector("input").value})), receipts, participants, payerKind, payerAccountId })
        });
        const d = await r.json().catch(() => ({}));
        if (r.status === 409 && d.subsidyPerPerson !== undefined)
          state.subsidyPerPerson = Math.round(d.subsidyPerPerson * 100);
        if (!r.ok) throw new Error(d.error || "Aktivenessen konnte nicht gebucht werden");
        close(true);
        notify(`${d.meal.identifier} gebucht ✓`);
        if (typeof options.onCreated === "function") options.onCreated(d.meal);
      } catch (error) {
        notify(error.message);
      } finally {
        state.busy = false;
        submit.textContent = "Aktivenessen buchen";
        updateStatus(false);
      }
    }

    trigger.onclick = open;
    host.querySelector("[data-pick]").onclick = () => fileInput.click();
    host.querySelector("[data-camera]").onclick = () => cameraInput.click();
    fileInput.onchange = () => { addFiles(fileInput.files); fileInput.value = ""; };
    cameraInput.onchange = () => { addFiles(cameraInput.files); cameraInput.value = ""; };
    host.querySelector("[data-add-person]").onclick = addTypedParticipant;
    personInput.onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); addTypedParticipant(); } };
    [nameInput, dateInput, totalInput].forEach(input => input.addEventListener("input", () => updateStatus(false)));
    payerInput.addEventListener("change", updatePayerHint);
    submit.onclick = submitMeal;
    dateInput.value = todayLocal();
    updateStatus(false);

    return { open, close, refreshAccounts: async () => { state.accounts = []; await loadAccounts(); } };
  }

  return { init };
})();
