"use strict";

function mountTemporaryDrinks({trigger, reload, getShared, getEvent}) {
  const sheet = document.createElement("dialog");
  sheet.className = "bw-dialog compact-dialog";
  sheet.setAttribute("aria-labelledby", "drinks-title");
  sheet.innerHTML = `
    <div class="dialog-head"><h2 id="drinks-title">Temporäre Getränke</h2>
      <button type="button" class="btn ghost small" data-close>Schließen</button></div>
    <form class="drink-form">
      <label>Getränkename<input name="name" required maxlength="120" placeholder="z. B. Apfelschorle"></label>
      <label>Preis in €<input name="price" required inputmode="decimal" placeholder="0,00"></label>
      <label class="scope-field" hidden><input type="checkbox" name="localOnly">Nur bei dieser Veranstaltung</label>
      <p class="muted drink-hint"></p>
      <button class="btn gold" type="submit">Hinzufügen</button>
    </form>
    <p class="form-feedback" role="status"></p>
    <div class="temporary-list"></div>`;
  document.body.append(sheet);
  const form = sheet.querySelector("form");
  const feedback = sheet.querySelector(".form-feedback");
  let busy = false;
  const modal = BW.dialog(sheet, () => !busy);
  const localEndpoint = () => "/api/events/" + encodeURIComponent(getEvent().id) + "/drinks";
  const hint = () => {
    sheet.querySelector(".drink-hint").textContent = form.elements.localOnly.checked
      ? "24 Stunden bei " + getEvent().name + " verfügbar."
      : "24 Stunden auf der Strichliste und bei allen Veranstaltungen verfügbar.";
  };
  form.elements.localOnly.onchange = hint;

  function render() {
    const list = sheet.querySelector(".temporary-list");
    list.replaceChildren();
    const append = (drink, local) => {
      const row = document.createElement("div");
      row.className = "list-item drink-line";
      const text = document.createElement("div");
      const name = document.createElement("strong");
      name.textContent = drink.name;
      const scope = document.createElement("small");
      scope.textContent = BW.money(drink.price) + " · " + (local ? "Nur hier" : "Alle Strichlisten");
      text.append(name, scope);
      const remove = document.createElement("button");
      remove.type = "button"; remove.className = "btn small"; remove.textContent = "Entfernen";
      remove.setAttribute("aria-label", drink.name + " entfernen");
      remove.onclick = () => {
        if (confirm("„" + drink.name + "“ " + (local ? "bei dieser Veranstaltung" : "auf allen Strichlisten") + " entfernen?"))
          change((local ? localEndpoint() : "/api/temporary-drinks") + "/remove", {name:drink.name}, "entfernt");
      };
      row.append(text, remove);
      list.append(row);
    };
    getShared().forEach(d => append(d, false));
    (getEvent()?.customDrinks || []).forEach(d => append(d, true));
    if (!list.childElementCount) list.textContent = "Keine temporären Getränke vorhanden.";
  }
  async function change(path, body, action) {
    if (busy) return;
    busy = true;
    sheet.setAttribute("aria-busy", "true");
    try {
      await BW.post(path, body);
      if (action === "hinzugefügt") { form.reset(); hint(); }
      feedback.textContent = body.name.trim() + " " + action + ".";
      await reload(); render();
    } catch (error) { feedback.textContent = error.message; }
    finally { busy = false; sheet.removeAttribute("aria-busy"); }
  }
  form.onsubmit = e => {
    e.preventDefault();
    change(form.elements.localOnly.checked && getEvent() ? localEndpoint() : "/api/temporary-drinks",
      {name:form.elements.name.value, price:form.elements.price.value}, "hinzugefügt");
  };
  trigger.onclick = async () => {
    trigger.disabled = true;
    try {
      await reload();
      form.reset(); feedback.textContent = "";
      sheet.querySelector(".scope-field").hidden = !getEvent();
      hint(); render(); modal.open();
    } catch (error) { BW.toast(error.message); }
    finally { trigger.disabled = false; }
  };
}
