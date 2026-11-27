"use strict";

function mountEventCard(trigger,getEvent,reload) {
  const dialog=document.createElement("dialog");
  dialog.className="bw-dialog compact-dialog";
  dialog.setAttribute("aria-labelledby","bar-card-title");
  dialog.innerHTML=`<div class="dialog-head"><h2 id="bar-card-title">Getränkekarte</h2><button type="button" class="btn small" aria-label="Schließen" title="Schließen" data-close><svg class="nav-icon" aria-hidden="true" focusable="false"><use xlink:href="icons/navigation.svg#x"></use></svg></button></div>
    <h3 data-event-name></h3><div class="bar-actions" data-prints></div>
    <h3>Aus dem Rezeptkatalog hinzufügen</h3><div class="bar-list"></div>
    <div class="bar-actions"><button class="btn gold" data-submit disabled>Auswahl hinzufügen</button></div>
    <p role="status"></p>`;
  document.body.append(dialog);
  const list=dialog.querySelector(".bar-list"), prints=dialog.querySelector("[data-prints]");
  const button=dialog.querySelector("[data-submit]"), status=dialog.querySelector('[role="status"]');
  let busy=false, eventId="";
  const modal=BW.dialog(dialog,()=>!busy);
  async function render() {
    await reload();
    const ev=getEvent();if (!ev || ev.id!==eventId) throw Error("Veranstaltung nicht mehr verfügbar.");
    const recipes=await BW.api("/api/bar/offer");
    dialog.querySelector("[data-event-name]").textContent=ev.name;
    prints.textContent = ""; list.textContent = ""; button.disabled = true;
    const assigned=new Set(ev.barDrinks.map(r=>r.recipeId));
    if (assigned.size) {
      for(const [key,label] of [["mixliste","Mixliste (PDF)"],["preisliste","Preisliste (PDF)"]]) {
        const a=document.createElement("a");a.className="btn";a.href="/api/events/"+encodeURIComponent(ev.id)+"/bar/print/"+key;a.textContent=label;
        a.download=key+".pdf";prints.append(a);
      }
    } else prints.textContent="Für diese Veranstaltung sind noch keine Rezepte ausgewählt.";
    for(const [key,label] of Object.entries(BarTypes.categories)) {
      const group=recipes.filter(r=>r.category===key);if(!group.length) continue;
      const heading=document.createElement("h4");heading.textContent=label;list.append(heading);
      for(const r of group) {
        const row=document.createElement("label");row.className="bar-choice";
        const cb=document.createElement("input");cb.type="checkbox";cb.value=r.recipeId;
        cb.checked=cb.disabled=assigned.has(r.recipeId);
        cb.onchange=()=>{button.disabled=!list.querySelector("input:checked:enabled");};
        const text=document.createElement("span");text.textContent=r.name+" · "+BW.money(r.price)+(cb.checked?" · Auf der Karte":"");
        row.append(cb,text);list.append(row);
      }
    }
    if(!recipes.length) list.textContent="Der Rezeptkatalog ist leer.";
  }
  trigger.onclick=async()=>{
    if(busy || !getEvent()) return;
    eventId=getEvent().id;busy=true;trigger.disabled=true;status.textContent="";
    try {await render();modal.open();} catch(e){BW.toast(e.message);}
    finally {busy=false;trigger.disabled=false;}
  };
  button.onclick=async()=>{
    if(busy) return;
    busy=true;button.disabled=true;
    const ids=Array.from(list.querySelectorAll("input:checked:enabled"),el=>el.value);
    try {await BW.post("/api/events/"+encodeURIComponent(eventId)+"/bar",{ids});
      await render();status.textContent="Getränkekarte gespeichert.";}
    catch(e){status.textContent=e.message;button.disabled=!list.querySelector("input:checked:enabled");}
    finally {busy=false;}
  };
}
