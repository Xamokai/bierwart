"use strict";
function mountEventForm(trigger, headers, afterSave) {
  const dialog = document.createElement("dialog");
  dialog.className = "bw-dialog compact-dialog";
  dialog.setAttribute("aria-labelledby","event-title");
  dialog.innerHTML = `<div class="dialog-head"><h2 id="event-title">Termin anlegen</h2>
    <button type="button" class="btn small ghost" aria-label="Schließen" data-close><svg class="nav-icon" aria-hidden="true"><use xlink:href="icons/navigation.svg#x"></use></svg></button></div>
    <form class="stack-form"><label>Veranstaltung<input name="name" id="evNewName" list="event-kinds" placeholder="z. B. Sommerabend" maxlength="120" required></label><datalist id="event-kinds"></datalist>
    <label>Datum<input name="date" type="date" required></label>
    <label>Getränke buchen auf<select name="mode"><option value="personal">Personenkonten</option><option value="direct">Veranstaltungskonto</option></select></label>
    <p class="muted">Am gewählten Tag kann von 0 bis 24 Uhr gebucht werden.</p>
    <p class="form-error" role="alert" hidden></p><button type="submit" class="btn gold">Termin speichern</button></form>`;
  document.body.append(dialog);
  const form = dialog.querySelector("form"), fields = form.elements, submit = form.querySelector("[type=submit]");
  const modal = BW.dialog(dialog,()=>!submit.disabled), error = form.querySelector("[role=alert]");
  trigger.onclick = () => {
    form.reset(); error.hidden = true;
    fields.date.value = new Intl.DateTimeFormat("sv-SE",{timeZone:"Europe/Berlin"}).format(new Date());
    modal.open();
    BW.api("/api/eventkinds").then(kinds=>{
      const list = dialog.querySelector("datalist");
      list.textContent = "";
      for (const kind of kinds) list.append(new Option(kind));
    }).catch(()=>{});
  };
  form.onsubmit = async e => {
    e.preventDefault();
    if (submit.disabled) return;
    submit.disabled = true; error.hidden = true;
    try {
      const event = await BW.post("/api/events",{name:fields.name.value,date:fields.date.value,mode:fields.mode.value},headers());
      dialog.close(); BW.toast("Termin gespeichert.");
      await afterSave(event).catch(err=>BW.toast(err.message));
    } catch (err) { error.textContent = err.message; error.hidden = false; }
    finally { submit.disabled = false; }
  };
}
