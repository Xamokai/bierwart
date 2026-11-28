"use strict";

function mountBarManager(root, headers) {
  root.classList.add("bar-manager");
  root.innerHTML = `
    <div class="section-head"><h3>Rezeptkatalog</h3><button class="btn gold" type="button" data-new>Rezept anlegen</button></div>
    <div class="card">
      <div class="section-head"><h3>Getränke auswählen</h3><button class="btn small" type="button" data-all>Alle auswählen</button></div>
      <div class="bar-list"></div>
      <div class="bar-actions"><strong data-count>0 ausgewählt</strong>
        <button class="btn" data-print="mixliste" disabled>Mixliste (PDF)</button><button class="btn" data-print="preisliste" disabled>Preisliste (PDF)</button></div>
    </div>
    <div class="card"><label>Veranstaltung<select data-event></select></label>
      <div class="bar-actions"><button class="btn" data-load>Karte der Veranstaltung auswählen</button>
      <button class="btn" data-attach>Auswahl hinzufügen</button><button class="btn" data-detach>Auswahl von Karte nehmen</button></div>
    </div>
    <p role="status" data-message></p>`;
  const editor = document.createElement("dialog");
  editor.className="bw-dialog compact-dialog"; editor.setAttribute("aria-labelledby","recipeEditorTitle");
  editor.innerHTML = `<div class="dialog-head"><h2 id="recipeEditorTitle">Rezept anlegen</h2>
    <button type="button" class="btn small" aria-label="Schließen" title="Schließen" data-close><svg class="nav-icon" aria-hidden="true" focusable="false"><use xlink:href="icons/navigation.svg#x"></use></svg></button></div>
    <form class="stack-form"><label>Getränkename<input name="name" required maxlength="80"></label>
      <div class="bar-fields"><label>Kategorie<select name="category"></select></label>
      <label>Glas<select name="glass"></select></label></div>
      <label>Preis in €<input name="price" required inputmode="decimal" placeholder="0,00"></label>
      <fieldset class="bar-ingredients"><legend>Zutaten pro Glas</legend><div data-rows></div>
      <button type="button" class="btn small" data-add>Zutat hinzufügen</button></fieldset>
      <p role="status" data-error></p><div class="bar-actions"><button class="btn gold" type="submit">Rezept speichern</button>
      <button type="button" class="btn" data-delete>Rezept löschen</button></div></form>`;
  document.body.append(editor);
  const form=editor.querySelector("form"), fields=form.elements;
  const list=root.querySelector(".bar-list"), picker=root.querySelector("[data-event]");
  const status=root.querySelector("[data-message]"), error=editor.querySelector("[data-error]");
  const modal=BW.dialog(editor,()=>!saving);
  for (const [key,label] of Object.entries(BarTypes.categories)) fields.category.add(new Option(label,key));
  for (const [key,label] of Object.entries(BarTypes.glasses)) fields.glass.add(new Option(label,key));
  let recipes=[],events=[],chosen=new Set(),editing=null,revision=0,session=0,saving=false,working=false;
  const target=()=>events.find(e=>e.id===picker.value);
  const has=(event,id)=>event?.barDrinks.some(r=>r.recipeId===id);
  function buttons() {
    const count=chosen.size, event=target();
    root.querySelector("[data-count]").textContent=count+" ausgewählt";
    root.querySelector("[data-all]").textContent=count && count===recipes.length?"Auswahl aufheben":"Alle auswählen";
    root.querySelector("[data-all]").disabled=!recipes.length || working;
    for(const b of root.querySelectorAll("[data-print]")) b.disabled=!count || working;
    root.querySelector("[data-load]").disabled=!event || working;
    root.querySelector("[data-attach]").disabled=working || !event || ![...chosen].some(id=>!has(event,id));
    root.querySelector("[data-detach]").disabled=working || !event || ![...chosen].some(id=>has(event,id));
  }
  function render() {
    list.replaceChildren();
    for (const [key,label] of Object.entries(BarTypes.categories)) {
      const group=recipes.filter(r=>r.category===key);
      if (!group.length) continue;
      const heading=document.createElement("h4");heading.textContent=label;list.append(heading);
      for (const r of group) {
        const row=document.createElement("div");row.className="bar-row";
        row.innerHTML='<label><input type="checkbox"><span><strong></strong><small></small></span></label><button type="button" class="btn small">Bearbeiten</button>';
        const cb=row.querySelector("input"); cb.value=r.id;cb.checked=chosen.has(r.id);
        cb.onchange=()=>{if (cb.checked) chosen.add(r.id);else chosen.delete(r.id);buttons();};
        row.querySelector("strong").textContent=r.name;
        row.querySelector("small").textContent=BW.money(r.price)+" · "+BarTypes.glasses[r.glass];
        row.querySelector("button").setAttribute("aria-label",r.name+" bearbeiten");
        row.querySelector("button").onclick=()=>openEditor(r);
        list.append(row);
      }
    }
    if (!recipes.length) list.textContent="Noch keine Rezepte angelegt.";
    buttons();
  }
  async function refresh() {
    const stamp=++revision;
    try {
      const [rows,parties]=await Promise.all([BW.api("/api/bar/recipes",{headers:headers(),cache:"no-store"}),BW.api("/api/bar/events",{headers:headers()})]);
      if (stamp!==revision) return;
      recipes=rows;events=parties;
      const previous=picker.value;
      const groups = groupEventsByTheme(events).map(([theme, entries]) => {
        const group = document.createElement("optgroup");
        group.label = theme;
        group.append(...entries.map(e => new Option(e.name+" · "+new Date(e.startsAt).toLocaleDateString("de-DE",{timeZone:"Europe/Berlin"}),e.id)));
        return group;
      });
      picker.replaceChildren(new Option("Veranstaltung wählen",""), ...groups);
      if (events.some(e=>e.id===previous)) picker.value=previous;
      chosen=new Set([...chosen].filter(id=>recipes.some(r=>r.id===id)));render();
    } catch(e) {if(stamp===revision) status.textContent=e.message;}
  }
  function reset() {
    session++; revision++;recipes=[];events=[];chosen.clear();editing=null;
    if(editor.open) editor.close(); form.reset();status.textContent="";picker.replaceChildren();render();
  }
  root.querySelector("[data-all]").onclick=()=>{chosen=chosen.size===recipes.length?new Set():new Set(recipes.map(r=>r.id));render();};
  picker.onchange=()=>{status.textContent="";buttons();};
  root.querySelector("[data-load]").onclick=()=>{
    chosen=new Set(target().barDrinks.map(r=>r.recipeId));render();
    status.textContent="Auswahl aus der Karte von „"+target().name+"“ übernommen.";
  };
  async function action(callback) {
    if(working) return;
    const stamp=session;
    working=true;buttons();status.textContent="";
    try {await callback(stamp);} catch(e){if(stamp===session) status.textContent=e.message;}
    finally {working=false;buttons();}
  }
  for (const op of ["attach","detach"]) root.querySelector("[data-"+op+"]").onclick=()=>action(async stamp=>{
    const ev=target(),remove=op==="detach";
    const ids=[...chosen].filter(id=>remove?has(ev,id):!has(ev,id));
    if(remove && !confirm(ids.length+" Getränke von der Karte „"+ev.name+"“ nehmen? Die Rezepte bleiben im Katalog.")) return;
    await BW.post("/api/events/"+encodeURIComponent(ev.id)+"/bar"+(remove?"/remove":""),{ids},headers());
    if(stamp!==session) return;
    status.textContent="Getränkekarte für „"+ev.name+"“ gespeichert.";await refresh();
  });
  for (const b of root.querySelectorAll("[data-print]")) b.onclick=()=>action(async stamp=>{
    const kind=b.dataset.print;
    const res=await fetch("/api/bar/print/"+kind,{method:"POST",headers:headers(),body:JSON.stringify({ids:[...chosen]})});
    if(!res.ok) throw Error((await res.json()).error || "PDF konnte nicht erstellt werden.");
    const blob=await res.blob();if (stamp!==session) return;
    const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=(kind==="mixliste"?"Mixliste":"Preisliste")+".pdf";
    document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),60000);
    status.textContent="PDF erstellt.";
  });
  function ingredient(value={amount:"",name:""}) {
    const row=document.createElement("div");row.className="ingredient-row";
    row.innerHTML='<label>Menge<input maxlength="24" placeholder="z. B. 4 cl"></label><label>Zutat<input maxlength="100" placeholder="z. B. Gin"></label><button type="button" class="btn small" aria-label="Zutat entfernen">×</button>';
    const [amount,name]=row.querySelectorAll("input");
    amount.value=value.amount;name.value=value.name;
    row.querySelector("button").onclick=()=>row.remove();editor.querySelector("[data-rows]").append(row);
    return amount;
  }
  function openEditor(r) {
    editing=r; form.reset();error.textContent="";
    editor.querySelector("h2").textContent=r?"Rezept bearbeiten":"Rezept anlegen";
    fields.name.value=r?.name || "";fields.category.value=r?.category || "cocktail";
    fields.glass.value=r?.glass || "cocktail";fields.price.value=r?String(r.price).replace(".",","):"";
    editor.querySelector("[data-rows]").replaceChildren();
    if (r?.ingredients.length) r.ingredients.forEach(ingredient);else ingredient();
    editor.querySelector("[data-delete]").hidden=!r;modal.open();fields.name.focus();
  }
  fields.category.onchange=()=>{fields.glass.value=BarTypes.defaultGlass[fields.category.value];};
  root.querySelector("[data-new]").onclick=()=>openEditor(null);
  editor.querySelector("[data-add]").onclick=()=>{
    if(editor.querySelectorAll(".ingredient-row").length>=24) {error.textContent="Höchstens 24 Zutaten pro Rezept.";return;}
    ingredient().focus();
  };
  async function save(remove) {
    if (saving) return;
    const r=editing, stamp=session;
    if(remove && !confirm("„"+r.name+"“ dauerhaft aus dem Katalog und allen Veranstaltungskarten löschen? Bisherige Buchungen bleiben erhalten.")) return;
    const ingredients=[];
    for(const row of editor.querySelectorAll(".ingredient-row")) {
      const [amount,name]=Array.from(row.querySelectorAll("input"),i=>i.value.trim());
      if(!remove && amount && !name){error.textContent="Bitte die Zutat zur Menge angeben.";row.querySelectorAll("input")[1].focus();return;}
      if(name) ingredients.push({name,amount});
    }
    const data={name:fields.name.value,category:fields.category.value,glass:fields.glass.value,price:fields.price.value,ingredients,version:r?.version};
    saving=true;error.textContent="";
    const controls=[...form.querySelectorAll("button")];controls.forEach(b=>b.disabled=true);
    try {
      await BW.api("/api/bar/recipes"+(r?"/"+encodeURIComponent(r.id):""),{
        method:remove?"DELETE":r?"PUT":"POST",headers:headers(),body:JSON.stringify(remove?{version:r.version}:data)});
      if(stamp!==session) return;
      editor.close();status.textContent=remove?"Rezept gelöscht.":"Rezept gespeichert.";await refresh();
    } catch(e) {if(stamp===session) {error.textContent=e.message;await refresh();}}
    finally {saving=false;controls.forEach(b=>b.disabled=false);}
  }
  form.onsubmit=e=>{e.preventDefault();save(false);};
  editor.querySelector("[data-delete]").onclick=()=>save(true);
  return {refresh,reset};
}
