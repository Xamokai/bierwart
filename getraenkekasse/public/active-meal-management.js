/* Verwaltung aller Aktivenessen für Admin und XXX. */
window.ActiveMealManagement = (() => {
  const esc = value => String(value ?? "").replace(/[&<>'"]/g, ch => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  })[ch]);
  const eur = value => Number(value || 0).toFixed(2).replace(".", ",") + " €";
  const dateDe = value => new Date(`${value}T12:00:00`).toLocaleDateString("de-DE");

  function init(options = {}) {
    const list = document.getElementById(options.listId);
    const settingInput = document.getElementById(options.settingInputId);
    const subsidyInput = document.getElementById(options.subsidyInputId);
    const settingInfo = document.getElementById(options.settingInfoId);
    const saveSetting = document.getElementById(options.saveSettingButtonId);
    if (!list) return null;
    const pdfControls = document.createElement("div");
    pdfControls.className = "row";
    pdfControls.hidden = true;
    const semesters = document.createElement("select");
    semesters.setAttribute("aria-label", "Semester für PDF");
    const semesterPdf = document.createElement("button");
    semesterPdf.className = "btn";
    semesterPdf.type = "button";
    semesterPdf.textContent = "Semester als PDF";
    pdfControls.append(semesters, semesterPdf);
    list.before(pdfControls);
    semesterPdf.onclick = () => downloadPdf(
      "/api/admin/active-meals/pdf?semester=" + encodeURIComponent(semesters.value),
      "Aktivenessen-" + semesters.value, semesterPdf);

    const state = { meals: [], accounts: [], settings: { xxxCardAccountNumber: "", xxxCardBalance: 0 }, busy: false };

    function headers(json = false) {
      const result = typeof options.getHeaders === "function" ? { ...options.getHeaders() } : {};
      if (json) result["Content-Type"] = "application/json";
      return result;
    }
    function notify(message) {
      if (typeof options.toast === "function") options.toast(message);
      else alert(message);
    }

    async function readJson(url) {
      const r = await fetch(url, { headers: headers(false) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Daten konnten nicht geladen werden");
      return d;
    }

    async function refresh() {
      if (state.busy) return;
      state.busy = true;
      list.innerHTML = '<div class="card muted">Aktivenessen werden geladen …</div>';
      try {
        const [meals, settings, accounts] = await Promise.all([
          readJson("/api/admin/active-meals"),
          readJson("/api/admin/active-meals/settings"),
          fetch("/api/accounts").then(r => r.ok ? r.json() : [])
        ]);
        state.meals = meals;
        state.settings = settings;
        state.accounts = accounts;
        if (settingInput) settingInput.value = settings.xxxCardAccountNumber || "";
        if (subsidyInput) subsidyInput.value = Number(settings.subsidyPerPerson ?? 4).toFixed(2).replace(".", ",");
        if (settingInfo) settingInfo.textContent = `Internes Konto: ${settings.xxxCardInternalAccountName || "XXX-Karte"} · Guthaben ${eur(settings.xxxCardBalance || 0)}`;
        render();
      } catch (error) {
        list.innerHTML = `<div class="card muted">${esc(error.message)}</div>`;
      } finally {
        state.busy = false;
      }
    }

    function payerOptions(meal) {
      const number = state.settings.xxxCardAccountNumber;
      const cardLabel = number ? `XXX-Karte · ${number}` : "XXX-Karte · Kontonummer nicht gesetzt";
      const current = meal.payer && meal.payer.type === "account" ? `account:${meal.payer.accountId}` : "xxx-card";
      return `<option value="xxx-card"${current === "xxx-card" ? " selected" : ""}>${esc(cardLabel)}</option>` +
        state.accounts.map(a => `<option value="account:${esc(a.id)}"${current === `account:${a.id}` ? " selected" : ""}>${esc(a.name)}</option>`).join("");
    }

    function render() {
      const available = new Map();
      for (const meal of state.meals) {
        const [year, month] = meal.date.split("-").map(Number);
        const summer = month >= 3 && month <= 8;
        const key = (summer ? "SS" : "WS") + String(month <= 2 ? year - 1 : year).slice(-2);
        available.set(key, semesterOf(meal.date));
      }
      const selected = semesters.value;
      semesters.replaceChildren(...[...available].map(([value, label]) => new Option(label, value)));
      if (available.has(selected)) semesters.value = selected;
      pdfControls.hidden = !available.size;
      if (!state.meals.length) {
        list.innerHTML = '<div class="card muted">Noch keine Aktivenessen vorhanden.</div>';
        return;
      }
      list.innerHTML = renderMealsBySemester(state.meals, meal => {
        const participants = (meal.participants || []).map(p => `
          <div class="list-item">
            <span>${esc(p.name)}${p.portions ? " · " + p.portions + (p.portions === 1 ? " Portion" : " Portionen") : ""}${p.role ? " · " + esc(activeMealRoleLabel(p.role)) : ""}</span>
            <strong>${eur(p.price)}</strong>
          </div>`).join("");
        const receipts = (meal.receipts || []).map((url, index) => `
          <a href="${esc(url)}" target="_blank" rel="noopener" title="Rechnung ${index + 1} öffnen">
            <img class="meal-receipt meal-receipt-large" src="${esc(url)}" alt="Rechnung ${index + 1}">
          </a>`).join("");
        const exportStatus = meal.exported
          ? `<span class="meal-exported">exportiert${meal.exportedAt ? ` · ${new Date(meal.exportedAt).toLocaleDateString("de-DE")}` : ""}</span>`
          : meal.runId ? "im offenen Buchungslauf" : '<span class="meal-open-export">noch nicht exportiert</span>';
        return `<details class="daygroup active-meal-manager" data-meal-id="${esc(meal.id)}">
          <summary>
            <span><strong>${esc(meal.identifier)}</strong> · ${esc(meal.name)}<br><span class="muted">${dateDe(meal.date)} · ausgelegt von ${esc(meal.payouts?.length ? meal.payouts.map(p=>p.name+" ("+eur(p.amount)+")").join(", ") : meal.payer ? meal.payer.name : "XXX-Karte")}</span></span>
            <span class="right"><strong>${eur(meal.total)}</strong>${meal.guestShare ? ` <span class="muted">Gäste ${eur(meal.guestShare)}</span>` : ""}${meal.subsidy ? ` <span class="muted">(Zuschuss ${eur(meal.subsidy)})</span>` : ""}<br>${exportStatus}</span>
          </summary>
          <div class="body">
            <div class="meal-manager-meta">
              <div><span class="muted">Buchungsnummer</span><strong>${esc(meal.identifier)}</strong></div>
              <div><span class="muted">Datum</span><strong>${dateDe(meal.date)}</strong></div>
              <div><span class="muted">Gesamtkosten</span><strong>${eur(meal.total)}</strong>${meal.guestShare ? ` <span class="muted">Gäste ${eur(meal.guestShare)}</span>` : ""}${meal.subsidy ? ` <span class="muted">(Zuschuss ${eur(meal.subsidy)})</span>` : ""}</div>
              <div><span class="muted">Quelle</span><strong>${meal.source==="GnuCash" ? "GnuCash" : meal.source === "account" ? "Mein Konto" : "Strichliste"}</strong></div>
            </div>
            <div class="card meal-payer-editor" ${meal.exported || meal.runId || meal.payouts?.length>1 ? "hidden" : ""}>
              <label>Ausgelegt von / Gegenkonto</label>
              <div class="row">
                <select class="grow" data-payer-select="${esc(meal.id)}">${payerOptions(meal)}</select>
                <button class="btn" type="button" data-save-payer="${esc(meal.id)}">Ausleger ändern</button>
              </div>
              <div class="muted" style="margin-top:6px">Beim Ändern wird die interne Gutschrift auf das neue Konto verschoben und der GnuCash-Status zurückgesetzt.</div>
            </div>
            <h4>Aufteilung</h4>
            ${participants}
            <h4>Rechnungsbilder</h4>
            <div class="meal-receipts">${receipts}</div>
            <div class="row meal-manager-actions">
              <button class="btn" type="button" data-pdf-meal="${esc(meal.id)}">Formular und Rechnungen als PDF</button>
              <button class="btn gold" type="button" ${meal.source==="GnuCash" ? "hidden" : ""} data-export-meal="${esc(meal.id)}">GnuCash CSV exportieren</button>
            </div>
          </div>
        </details>`;
      });

      list.querySelectorAll("[data-pdf-meal]").forEach(button => {
        button.onclick = () => {
          const meal = state.meals.find(m => m.id === button.dataset.pdfMeal);
          if (meal) downloadPdf("/api/admin/active-meals/" + encodeURIComponent(meal.id) + "/pdf",
            "Aktivenessen-" + meal.identifier, button);
        };
      });
      list.querySelectorAll("[data-export-meal]").forEach(button => {
        button.onclick = () => exportMeal(button.dataset.exportMeal, button);
      });
      list.querySelectorAll("[data-save-payer]").forEach(button => {
        button.onclick = () => savePayer(button.dataset.savePayer, button);
      });
    }

    async function downloadPdf(url, file, button) {
      const original = button.textContent;
      button.disabled = true;
      button.textContent = "PDF wird erstellt …";
      try {
        const response = await fetch(url, {headers:headers()});
        if (!response.ok) {
          const error = await response.json().catch(() => ({}));
          throw Error(error.error || "PDF-Export fehlgeschlagen.");
        }
        const link = document.createElement("a");
        link.href = URL.createObjectURL(await response.blob());
        link.download = file.replace(/[^a-z0-9_-]+/gi, "-") + ".pdf";
        link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 1000);
      } catch (error) {
        notify(error.message);
      } finally {
        button.disabled = false;
        button.textContent = original;
      }
    }

    async function exportMeal(id, button) {
      const original = button.textContent;
      button.disabled = true;
      button.textContent = "Export wird erstellt …";
      try {
        const r = await fetch(`/api/admin/active-meals/${encodeURIComponent(id)}/export`, { headers: headers(false) });
        if (!r.ok) {
          const d = await r.json().catch(() => ({}));
          throw new Error(d.error || "Export fehlgeschlagen");
        }
        const blob = await r.blob();
        const meal = state.meals.find(m => m.id === id);
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `${meal ? meal.identifier.replace(/\s+/g, "-") : "aktivenessen"}-aktivenessen.csv`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        notify("CSV heruntergeladen. Offenen Lauf nach dem Import im GnuCash-Bereich bestätigen.");
        await refresh();
        if (typeof options.onChanged === "function") options.onChanged();
      } catch (error) {
        notify(error.message);
      } finally {
        button.disabled = false;
        button.textContent = original;
      }
    }

    async function savePayer(id, button) {
      const select = list.querySelector(`[data-payer-select="${id}"]`);
      if (!select) return;
      const value = select.value;
      const body = value === "xxx-card"
        ? { payerKind: "xxx-card", payerAccountId: null }
        : { payerKind: "account", payerAccountId: value.replace(/^account:/, "") };
      button.disabled = true;
      try {
        const r = await fetch(`/api/admin/active-meals/${encodeURIComponent(id)}/payer`, {
          method: "PUT", headers: headers(true), body: JSON.stringify(body)
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || "Ausleger konnte nicht geändert werden");
        notify("Ausleger geändert ✓");
        await refresh();
        if (typeof options.onChanged === "function") options.onChanged();
      } catch (error) {
        notify(error.message);
      } finally {
        button.disabled = false;
      }
    }

    async function saveSettings() {
      if (!settingInput) return;
      const value = settingInput.value.trim();
      if (saveSetting) saveSetting.disabled = true;
      try {
        const r = await fetch("/api/admin/active-meals/settings", {
          method: "PUT", headers: headers(true),
          body: JSON.stringify({xxxCardAccountNumber:value, subsidyPerPerson:subsidyInput?.value.trim()})
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || "Kontonummer konnte nicht gespeichert werden");
        notify("Einstellungen gespeichert ✓");
        await refresh();
        if (typeof options.onChanged === "function") options.onChanged();
      } catch (error) {
        notify(error.message);
      } finally {
        if (saveSetting) saveSetting.disabled = false;
      }
    }

    if (saveSetting) saveSetting.onclick = saveSettings;
    if (options.autoLoad) refresh();
    return { refresh };
  }

  return { init };
})();
