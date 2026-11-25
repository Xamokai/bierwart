"use strict";

function mountDebtMails(panel, headers) {
  const list = panel.querySelector("[data-recipients]");
  const previews = panel.querySelector("[data-drafts]");
  const status = panel.querySelector("[data-status]");
  const count = panel.querySelector("[data-count]");
  const generate = panel.querySelector("[data-generate]");
  const refresh = panel.querySelector("[data-refresh]");
  let revision = 0;

  const selected = () => Array.from(list.querySelectorAll("input:checked"), box => box.value);
  function updateCount() {
    const n = selected().length;
    count.textContent = n ? n + " ausgewählt" : "";
    generate.disabled = n === 0;
  }
  function clear() {
    revision++;
    list.replaceChildren(); previews.replaceChildren(); status.textContent = "";
    refresh.disabled = false; updateCount();
  }

  async function load() {
    const prior = new Set(selected());
    clear();
    const version = revision;
    refresh.disabled = true; status.textContent = "Kontostände werden geladen …";
    try {
      const people = await BW.api("/api/xxx/debt-mails", {headers:headers(), cache:"no-store"});
      if (revision !== version) return;
      for (const person of people) {
        const row = document.createElement("label"); row.className = "debt-recipient";
        const box = document.createElement("input");
        box.type = "checkbox"; box.value = person.id; box.disabled = !person.email;
        box.checked = !!person.email && prior.has(person.id);
        const contact = document.createElement("span");
        const name = document.createElement("strong"); name.textContent = person.name;
        const address = document.createElement("small");
        address.textContent = person.email || "Adresse fehlt · im persönlichen Konto ergänzen";
        contact.append(name, address);
        const amount = document.createElement("span"); amount.className = "debt-amount";
        amount.textContent = BW.money(person.amountCents / 100);
        row.append(box, contact, amount); list.append(row);
      }
      updateCount();
      status.textContent = people.length ? "" : "Alle Personenkonten sind ausgeglichen oder im Guthaben.";
    } catch (error) {
      if (revision === version) status.textContent = error.message;
    } finally { if (revision === version) refresh.disabled = false; }
  }

  function renderDraft(draft) {
    const card = document.createElement("article"); card.className = "card debt-draft";
    const title = document.createElement("h4"); title.textContent = draft.name;
    const to = document.createElement("p"); to.textContent = "An: " + draft.to;
    const subject = document.createElement("p"); subject.textContent = "Betreff: " + draft.subject;
    const body = document.createElement("textarea"); body.readOnly = true; body.rows = 8;
    body.value = draft.body; body.setAttribute("aria-label", "Mailtext für " + draft.name);
    const actions = document.createElement("div"); actions.className = "row";
    const open = document.createElement("a"); open.className = "btn gold";
    open.textContent = "Im Mailprogramm öffnen";
    const [local, domain] = draft.to.split("@");
    open.href = "mailto:" + encodeURIComponent(local) + "@" + domain +
      "?subject=" + encodeURIComponent(draft.subject) + "&body=" + encodeURIComponent(draft.body.replace(/\n/g, "\r\n"));
    const copy = document.createElement("button"); copy.type = "button"; copy.className = "btn"; copy.textContent = "Mailtext kopieren";
    copy.onclick = async () => {
      try {
        if (!navigator.clipboard?.writeText) throw Error();
        await navigator.clipboard.writeText(draft.body);
        BW.toast("Mailtext kopiert.");
      } catch {
        body.focus(); body.select();
        BW.toast(document.execCommand("copy") ? "Mailtext kopiert." : "Mailtext markiert. Bitte über das Gerätemenü kopieren.");
      }
    };
    actions.append(open, copy);
    card.append(title, to, subject, body, actions); previews.append(card);
  }

  generate.onclick = async () => {
    const accountIds = selected();
    if (!accountIds.length || generate.disabled) return;
    const version = ++revision;
    previews.replaceChildren(); generate.disabled = true; status.textContent = "Entwürfe werden vorbereitet …";
    try {
      const result = await BW.post("/api/xxx/debt-mails/preview", {accountIds}, headers());
      if (version !== revision) return;
      result.drafts.forEach(renderDraft);
      const stamp = new Date(result.asOf).toLocaleString("de-DE", {timeZone:"Europe/Berlin", dateStyle:"short", timeStyle:"short"});
      status.textContent = result.drafts.length ? "Vorschau vom " + stamp + " Uhr." : "";
      if (result.skipped) status.textContent += " Auswahl inzwischen geändert: " + result.skipped +
        " ohne offenen Betrag, gültige Adresse oder aktives Konto. Bitte Liste aktualisieren.";
      if (result.drafts.length) {
        const heading = previews.querySelector("h4");
        heading.tabIndex = -1; heading.focus();
      }
    } catch (error) {
      if (version === revision) status.textContent = error.message;
    } finally { if (version === revision) updateCount(); }
  };
  list.onchange = () => { revision++; previews.replaceChildren(); status.textContent = ""; updateCount(); };
  refresh.onclick = load;
  panel.ontoggle = () => { if (panel.open && !panel.hidden) load(); else clear(); };
  return {clear};
}
