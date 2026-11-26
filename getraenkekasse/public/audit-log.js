/* Unveränderliches Änderungsprotokoll für Admin und XXX. */
window.AuditLog = (() => {
  const esc = value => String(value ?? "").replace(/[&<>'"]/g, ch => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  })[ch]);
  const actionNames = {
    "account.created": "Konto angelegt",
    "account.password_changed": "Passwort geändert",
    "account.password_initialized": "Passwort erstmals gesetzt",
    "account.password_reset": "Passwort zurückgesetzt",
    "account.flags_changed": "Rechte geändert",
    "account.deposit": "Interne Buchung",
    "purchase.created": "Kauf gebucht",
    "active_meal.created": "Aktivenessen angelegt",
    "active_meal.payer_changed": "Ausleger geändert",
    "active_meal.settings_changed": "XXX-Karte geändert",
    "active_meal.exported": "Aktivenessen exportiert",
    "gnucash.import": "GnuCash importiert",
    "gnucash.export": "GnuCash exportiert",
    "bar.recipe_saved": "Rezept gespeichert",
    "bar.recipe_deleted": "Rezept gelöscht",
    "bar.event_changed": "Getränkekarte geändert",
    "stock.drink_created": "Zählgetränk angelegt",
    "stock.count_created": "Auszählung erfasst",
    "stock.count_updated": "Auszählung bearbeitet",
    "stock.difference_booked": "Zähldifferenz gebucht",
    "products.changed": "Produkte geändert",
    "product_image.uploaded": "Produktbild geändert",
    "event.created": "Veranstaltung angelegt",
    "event.deleted": "Veranstaltung gelöscht",
    "event.drink_added": "Getränk hinzugefügt",
    "event.drink_removed": "Getränk entfernt",
    "event_kind.created": "Veranstaltungsart angelegt",
    "event_kind.deleted": "Veranstaltungsart gelöscht"
  };

  function init(options = {}) {
    const host = document.getElementById(options.containerId);
    if (!host) return null;
    let entries = [];

    host.innerHTML = `
      <div class="card audit-toolbar">
        <div class="row">
          <input class="grow" type="search" data-audit-search placeholder="Protokoll durchsuchen …">
          <select data-audit-action><option value="">Alle Vorgänge</option></select>
          <button class="btn" type="button" data-audit-refresh>Aktualisieren</button>
        </div>
        <div class="muted" data-audit-count style="margin-top:8px"></div>
      </div>
      <div data-audit-list><div class="card muted">Änderungsprotokoll wird geladen …</div></div>`;

    const search = host.querySelector("[data-audit-search]");
    const action = host.querySelector("[data-audit-action]");
    const list = host.querySelector("[data-audit-list]");
    const count = host.querySelector("[data-audit-count]");

    function headers() {
      return typeof options.getHeaders === "function" ? { ...options.getHeaders() } : {};
    }

    function pretty(value) {
      if (value === null || value === undefined) return "";
      return JSON.stringify(value, null, 2);
    }

    function section(title, value) {
      if (value === null || value === undefined) return "";
      return `<div class="audit-detail"><strong>${esc(title)}</strong><pre>${esc(pretty(value))}</pre></div>`;
    }

    function render() {
      const q = search.value.trim().toLowerCase();
      const selectedAction = action.value;
      const filtered = entries.filter(entry => {
        if (selectedAction && entry.action !== selectedAction) return false;
        if (!q) return true;
        return JSON.stringify(entry).toLowerCase().includes(q);
      });
      count.textContent = `${filtered.length} von ${entries.length} Einträgen`;
      if (!filtered.length) {
        list.innerHTML = '<div class="card muted">Keine passenden Einträge.</div>';
        return;
      }
      list.innerHTML = filtered.map(entry => {
        const when = new Date(entry.createdAt).toLocaleString("de-DE");
        const actor = entry.actor && entry.actor.name ? entry.actor.name : "System";
        const target = entry.target && entry.target.label ? entry.target.label : "";
        const actionLabel = actionNames[entry.action] || entry.action;
        return `<details class="daygroup audit-entry">
          <summary>
            <span><strong>${esc(entry.summary || actionLabel)}</strong><br><span class="muted">${esc(when)} · ${esc(actor)} · ${esc(actionLabel)}</span></span>
            <span class="muted right">${esc(target)}</span>
          </summary>
          <div class="body">
            <div class="audit-meta"><span>Vorgang</span><strong>${esc(entry.action)}</strong><span>Ziel</span><strong>${esc(target || "–")}</strong></div>
            ${section("Vorher", entry.before)}
            ${section("Nachher", entry.after)}
            ${section("Zusatzinformationen", entry.meta)}
          </div>
        </details>`;
      }).join("");
    }

    async function refresh() {
      list.innerHTML = '<div class="card muted">Änderungsprotokoll wird geladen …</div>';
      try {
        const response = await fetch("/api/admin/audit-log?limit=1000", { headers: headers() });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "Protokoll konnte nicht geladen werden");
        entries = Array.isArray(data.entries) ? data.entries : [];
        const actions = [...new Set(entries.map(entry => entry.action))].sort();
        const oldValue = action.value;
        action.innerHTML = '<option value="">Alle Vorgänge</option>' + actions.map(value =>
          `<option value="${esc(value)}">${esc(actionNames[value] || value)}</option>`).join("");
        action.value = actions.includes(oldValue) ? oldValue : "";
        render();
      } catch (error) {
        list.innerHTML = `<div class="card muted">${esc(error.message)}</div>`;
      }
    }

    search.addEventListener("input", render);
    action.addEventListener("change", render);
    host.querySelector("[data-audit-refresh]").addEventListener("click", refresh);
    if (options.autoLoad !== false) refresh();
    return { refresh };
  }

  return { init };
})();
