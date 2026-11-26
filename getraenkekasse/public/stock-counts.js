"use strict";

// Keep a closing count with its opening, including events that span a semester boundary.
function groupStockCounts(records, all) {
  const byId = new Map(all.map(r => [r.id,r]));
  const anchor = r => byId.get(r.beforeId) || r;
  const sorted = [...records].sort((a,b) => {
    const x = anchor(a), y = anchor(b);
    return y.date.localeCompare(x.date) || y.createdAt.localeCompare(x.createdAt) ||
      x.id.localeCompare(y.id) || Number(!!a.beforeId) - Number(!!b.beforeId);
  });
  const semesters = new Map();
  for (const r of sorted) {
    const first = anchor(r), semester = semesterOf(first.date), key = r.eventId || "stock";
    if (!semesters.has(semester)) semesters.set(semester,{semester,count:0,events:new Map()});
    const group = semesters.get(semester);
    if (!group.events.has(key)) group.events.set(key,{key,name:first.eventName || "Lagerzählungen",entries:[]});
    group.events.get(key).entries.push(r);
    group.count++;
  }
  return [...semesters.values()].map(g => ({...g,events:[...g.events.values()]}));
}

function mountStockCounts(root, headers) {
  const api = "/api/stock-counts";
  const areas = {spirits:"Schnaps & Barzutaten", drinks:"Bierwart-Getränke", cash:"Barkasse"};
  const esc = displayText;
  const money = cents => BW.money(cents/100);
  const today = () => {
    const now = new Date();
    return new Date(now - now.getTimezoneOffset()*60000).toISOString().slice(0,10);
  };
  root.innerHTML = `
    <form class="card stock-form">
      <h2>Zählung erfassen</h2>
      <div class="stock-fields">
        <label>Name der Zählung<input name="title" required maxlength="120" placeholder="z. B. Semesterabschluss"></label>
        <label>Datum<input name="date" type="date" required></label>
        <label>Bereich<select name="area"></select></label>
        <label>Anlass<select name="scope"><option value="stock">Lagerzählung</option><option value="event">Veranstaltung</option></select></label>
        <label data-event hidden>Veranstaltung<select name="eventId"></select></label>
        <label data-phase hidden>Zeitpunkt<select name="phase"><option value="before">Vorzählung</option><option value="after">Nachzählung</option></select></label>
        <label data-opening hidden>Zugehörige Vorzählung<select name="beforeId"></select></label>
      </div>
      <h3 data-items-title>Getränke zählen</h3>
      <div data-picker>
        <label>Getränk suchen<input name="search" type="search" placeholder="Name oder Flaschengröße" autocomplete="off"></label>
        <div class="stock-options" data-options></div>
      </div>
      <div class="stock-lines" data-lines></div>
      <div class="stock-total"><span>Gesamtwert <strong data-total>0,00 €</strong></span><span class="row"><button class="btn" type="button" data-cancel-edit hidden>Abbrechen</button><button class="btn gold" type="submit">Zählung speichern</button></span></div>
    </form>
    <details class="daygroup" data-new hidden><summary><strong>Getränk zum Zählkatalog hinzufügen</strong></summary>
      <form class="body stock-fields"><label>Getränkename<input name="name" required maxlength="120"></label>
        <label>Flaschenpreis (€)<input name="price" inputmode="decimal" required placeholder="0,00"></label>
        <button class="btn" type="submit">Getränk anlegen</button></form>
    </details>
    <p role="status" data-status></p>
    <section class="card" data-archive hidden>
      <div class="section-head"><h2>Gespeicherte Zählungen</h2><button class="btn small" type="button" data-print-all>Alle drucken</button></div>
      <div data-records></div>
    </section>`;
  const find = key => root.querySelector("[data-"+key+"]");
  const form = root.querySelector(".stock-form"), f = form.elements;
  const productForm = find("new").querySelector("form");
  const status = find("status");
  let options, records = [], drafts = new Map(), generation = 0, requestId, saving = false;
  let editing = null, editRows;
  const selected = () => editing ? editRows : drafts.get(f.area.value);
  const opening = () => f.scope.value === "event" && f.phase.value === "after" && records.find(r => r.id === f.beforeId.value);
  const hasRestock = () => f.scope.value === "event" && f.phase.value === "before" && f.area.value !== "cash";
  function products() {
    const prices = new Map(options.catalogs[f.area.value].map(p=>[p.name,p]));
    const closing = editing && records.find(r=>r.beforeId === editing.id);
    for (const source of [closing,editing,opening()]) {
      for (const p of source?.items || []) prices.set(p.name,{name:p.name,priceCents:p.priceCents});
    }
    return prices;
  }
  function resetId() {
    requestId = Array.from(crypto.getRandomValues(new Uint8Array(16)), n => n.toString(16).padStart(2,"0")).join("");
  }
  function reset() {
    generation++; options = null; records = []; drafts = new Map();
    stopEdit(); form.reset(); f.date.value = today(); form.querySelector("button[type=submit]").disabled = true;
    find("archive").hidden = find("new").hidden = true;
    find("records").textContent = find("options").textContent = find("lines").textContent = status.textContent = "";
    productForm.reset(); resetId();
  }
  function renderPicker() {
    const q = f.search.value.trim().toLocaleLowerCase("de");
    const matches = [...products().values()].filter(p => p.name.toLocaleLowerCase("de").includes(q));
    find("options").innerHTML = matches.map(p => `<button type="button" data-add="${esc(p.name)}" ${selected().has(p.name) ? "disabled" : ""}>
      <span>${esc(p.name)}</span><small>${p.priceCents === null ? "Preis offen" : money(p.priceCents)}</small></button>`).join("") || '<p class="muted">Kein passendes Getränk gefunden.</p>';
  }
  const blank = value => String(value).trim() === "";
  function unitCents(row) {
    if (row.priceCents !== null) return row.priceCents;
    const price = String(row.price || "").trim().replace(",",".");
    return /^\d{1,5}([.]\d{1,2})?$/.test(price) ? Math.round(Number(price)*100) : NaN;
  }
  function readLines() {
    const items = [];
    let totalCents = 0;
    for (const row of selected().values()) {
      if (blank(row.quantity) && f.area.value === "cash") continue;
      const value = String(row.quantity).trim().replace(",",".");
      const quantity = Number(value), priceCents = unitCents(row);
      if (!(f.area.value === "cash" ? /^\d{1,5}$/ : /^\d{1,5}(\.\d{1,3})?$/).test(value) || !Number.isFinite(priceCents)) return null;
      const added = String(hasRestock() && row.restocked || 0).trim().replace(",",".");
      if (!/^\d{1,5}(\.\d{1,3})?$/.test(added)) return null;
      const restocked = Number(added);
      totalCents += Math.round((Math.round(quantity*1000)+Math.round(restocked*1000))*priceCents/1000);
      items.push({name:row.name,quantity,priceCents,restocked});
    }
    return {items,totalCents};
  }
  function total() {
    const draft = readLines();
    find("total").textContent = draft ? money(draft.totalCents) : "–";
    form.querySelector("button[type=submit]").disabled = saving || !draft || !draft.items.length;
  }
  function renderLines() {
    const cash = f.area.value === "cash";
    find("lines").innerHTML = Array.from(selected().values(), row => `
      <div class="stock-line" data-name="${esc(row.name)}">
        <div><strong>${esc(row.name)}</strong>${cash || row.priceCents === null ? "" : "<small>"+money(row.priceCents)+" / Stück</small>"}</div>
        ${row.priceCents === null ? '<label>Stückpreis (€)<input data-price inputmode="decimal" required value="'+esc(row.price || "")+'"></label>' : ""}
        <label>${cash ? "Stück" : "Anzahl"}<input data-qty aria-label="Anzahl ${esc(row.name)}" inputmode="${cash ? "numeric" : "decimal"}" value="${esc(row.quantity)}" placeholder="0"${cash ? "" : " required"}></label>
        ${hasRestock() ? '<label>Nachgeholt<input data-restock inputmode="decimal" aria-label="Nachgeholt '+esc(row.name)+'" value="'+esc(row.restocked || "")+'" placeholder="0"></label>' : ""}
        ${cash ? "" : '<button class="btn small" data-remove type="button" aria-label="'+esc(row.name)+' entfernen">Entfernen</button>'}
      </div>`).join("");
    total();
  }
  function areaChanged(preferredBeforeId) {
    const area = f.area.value, cash = area === "cash";
    if (!drafts.has(area)) drafts.set(area, new Map(cash ? options.catalogs.cash.map(p => [p.name,{...p,quantity:""}]) : []));
    find("new").hidden = area !== "spirits";
    find("picker").hidden = cash;
    find("items-title").textContent = cash ? "Münzen und Scheine zählen" : "Getränke zählen";
    scopeChanged(preferredBeforeId);
  }
  function updateLines() {
    const prices = products();
    for (const row of selected().values()) {
      if (prices.has(row.name)) row.priceCents = prices.get(row.name).priceCents;
      else selected().delete(row.name);
    }
    if (f.area.value !== "cash") renderPicker();
    renderLines();
  }
  function useOpening() {
    const before = opening();
    if (before && !editing) {
      for (const item of before.items) {
        if (!selected().has(item.name)) selected().set(item.name,{...item,quantity:"",restocked:0});
      }
    }
    updateLines();
  }
  function scopeChanged(preferredBeforeId) {
    const event = f.scope.value === "event", after = event && f.phase.value === "after";
    find("phase").hidden = find("event").hidden = !event; f.eventId.required = event;
    find("opening").hidden = !after; f.beforeId.required = after;
    const old = preferredBeforeId || f.beforeId.value;
    const used = new Set(records.filter(r => r.id !== editing?.id && r.beforeId).map(r=>r.beforeId));
    const choices = records.filter(r => r.phase === "before" && r.eventId === f.eventId.value && r.area === f.area.value && !used.has(r.id));
    f.beforeId.replaceChildren(new Option(choices.length ? "Bitte auswählen" : "Keine offene Vorzählung",""),
      ...choices.map(r => new Option(dateDe(r.date)+" · "+r.name,r.id)));
    f.beforeId.value = choices.some(r=>r.id === old) ? old : choices.length === 1 ? choices[0].id : "";
    useOpening();
  }
  function stopEdit() {
    editing = null; editRows = null;
    f.area.disabled = f.scope.disabled = f.eventId.disabled = f.phase.disabled = f.beforeId.disabled = false;
    find("cancel-edit").hidden = true;
    form.querySelector("h2").textContent = "Zählung erfassen";
    form.querySelector("button[type=submit]").textContent = "Zählung speichern";
  }
  function clearForm() {
    stopEdit(); form.reset(); f.date.value = today(); resetId(); areaChanged();
  }
  find("cancel-edit").onclick = clearForm;
  function startFrom(record, closeCount) {
    if ((editing || (selected() && [...selected().values()].some(r=>String(r.quantity) !== ""))) &&
        !confirm("Aktuelle Eingaben durch diese Zählung ersetzen?")) return;
    stopEdit();
    f.area.value = record.area; f.scope.value = "event"; f.eventId.value = record.eventId;
    f.phase.value = closeCount ? "after" : (record.phase || "before");
    f.title.value = record.name; f.date.value = closeCount ? (today() < record.date ? record.date : today()) : record.date;
    f.search.value = "";
    const rows = new Map(record.area === "cash" ? options.catalogs.cash.map(p => [p.name,{...p,quantity:""}]) : []);
    for (const item of record.items) rows.set(item.name,{...item,restocked:closeCount ? 0 : item.restocked,quantity:closeCount ? "" : item.quantity});
    if (closeCount) {
      drafts.set(record.area,rows);
    } else {
      editing = record; editRows = rows;
      f.area.disabled = f.scope.disabled = f.eventId.disabled = true;
      f.phase.disabled = f.beforeId.disabled = !!record.phase;
      form.querySelector("h2").textContent = "Zählung bearbeiten";
      form.querySelector("button[type=submit]").textContent = "Änderungen speichern";
      find("cancel-edit").hidden = false;
    }
    areaChanged(closeCount ? record.id : record.beforeId);
    resetId(); form.scrollIntoView({block:"start"}); f.title.focus({preventScroll:true});
  }
  f.area.onchange = () => { f.search.value = ""; areaChanged(); };
  f.scope.onchange = f.phase.onchange = f.eventId.onchange = () => scopeChanged();
  f.beforeId.onchange = useOpening;
  f.search.oninput = renderPicker;
  f.search.onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); const first = find("options").querySelector("button:enabled"); if (first) first.click(); } };
  find("options").onclick = e => {
    const button = e.target.closest("button[data-add]");
    if (!button || saving) return;
    const p = products().get(button.dataset.add);
    selected().set(p.name,{...p,quantity:"1"});
    renderPicker(); renderLines();
    const input = find("lines").lastElementChild.querySelector("[data-qty]");
    input.focus(); input.select(); resetId();
  };
  find("lines").oninput = e => {
    const row = selected().get(e.target.closest("[data-name]").dataset.name);
    if (e.target.hasAttribute("data-qty")) row.quantity = e.target.value;
    else if (e.target.hasAttribute("data-restock")) row.restocked = e.target.value;
    else row.price = e.target.value;
    total();
  };
  find("lines").onclick = e => {
    if (!e.target.closest("[data-remove]") || saving) return;
    selected().delete(e.target.closest("[data-name]").dataset.name);
    resetId(); renderLines(); renderPicker();
  };
  form.addEventListener("input", e => { if (e.target !== f.search) resetId(); });

  const dateDe = iso => iso.split("-").reverse().join(".");
  const phaseName = r => r.scope === "stock" ? "Lagerzählung" : ({before:"Vorzählung",after:"Nachzählung"}[r.phase] || "Veranstaltungszählung");
  function context(record) {
    return [dateDe(record.date),areas[record.area],record.eventName,phaseName(record),record.countedBy].filter(Boolean).join(" · ");
  }
  function table(record) {
    const added = record.phase === "before" && record.area !== "cash";
    return `<table><thead><tr><th>Position</th><th>Anzahl</th>${added ? "<th>Nachgeholt</th>" : ""}<th>Stückpreis</th><th>Wert</th></tr></thead><tbody>${record.items.map(item =>
      `<tr><td>${esc(item.name)}</td><td>${item.quantity.toLocaleString("de-DE")}</td>${added ? "<td>"+(item.restocked || 0).toLocaleString("de-DE")+"</td>" : ""}<td>${money(item.priceCents)}</td><td>${money(item.valueCents)}</td></tr>`).join("")}</tbody>
      <tfoot><tr><th colspan="${added ? 4 : 3}">Gesamtwert</th><td>${money(record.totalCents)}</td></tr></tfoot></table>`;
  }
  function difference(record) {
    const diff = record.comparison;
    if (!diff) return "";
    const cash = record.area === "cash";
    return `<h4>${cash ? "Barkassendifferenz" : "Getränkeverbrauch"}</h4>
      <div class="stock-table"><table><thead><tr><th>Position</th><th>Vorher</th>${cash ? "" : "<th>Nachgeholt</th>"}<th>Nachher</th><th>Differenz</th><th>Wert</th></tr></thead>
      <tbody>${diff.lines.map(i => `<tr><td>${esc(i.name)}</td><td>${i.first.toLocaleString("de-DE")}</td>${cash ? "" : "<td>"+i.added.toLocaleString("de-DE")+"</td>"}<td>${i.last.toLocaleString("de-DE")}</td><td>${i.quantity.toLocaleString("de-DE")}</td><td>${money(i.valueCents)}</td></tr>`).join("")}</tbody></table></div>
      <p>Gesamt <strong>${money(diff.differenceCents)}</strong> · Bereits gebucht ${money(diff.bookedCents)} · Offen <strong>${money(diff.pendingCents)}</strong></p>`;
  }
  function print(list) {
    const win = window.open("", "_blank");
    if (!win) { status.textContent = "Bitte das Druckfenster im Browser zulassen."; return; }
    const body = groupStockCounts(list,records).map(group => '<section><h1>'+esc(group.semester)+'</h1>'+
      group.events.map(event => '<h2>'+esc(event.name)+'</h2>'+event.entries.map(r =>
        '<article><h3>'+esc(r.name)+'</h3><p>'+esc(context(r))+'</p>'+table(r)+difference(r)+'</article>').join("")).join("")+'</section>').join("");
    win.document.write('<!doctype html><html lang="de"><meta charset="utf-8"><title>Auszählungen</title><style>body{font:11pt sans-serif;color:#221f18;margin:12mm}section+section{break-before:page}h1,h2,h3,h4{break-after:avoid}table{width:100%;border-collapse:collapse}th,td{padding:5pt;text-align:right;border-bottom:1px solid #bbb}th:first-child,td:first-child{text-align:left}tr{break-inside:avoid}tfoot{display:table-row-group}</style><body>'+body+'</body></html>');
    win.addEventListener("load", () => win.print(), {once:true});
    win.document.close();
  }
  find("print-all").onclick = () => print(records);
  function recordView(r, byOpening) {
    const editable = r.scope === "event" && !!options.catalogs[r.area] && options.events.some(e => e.id === r.eventId);
    const actions = [];
    if (editable) actions.push(`<button class="btn small" type="button" data-edit="${esc(r.id)}">Bearbeiten</button>`);
    if (editable && r.phase === "before" && !byOpening.has(r.id))
      actions.push(`<button class="btn small" type="button" data-close-count="${esc(r.id)}">Nachzählung erfassen</button>`);
    if (r.comparison?.pendingCents && (editable || options.canReview) && options.events.some(e => e.id === r.eventId))
      actions.push(`<button class="btn gold" type="button" data-book="${esc(r.id)}">${money(r.comparison.pendingCents)} auf Veranstaltung buchen</button>`);
    if (options.canReview) actions.push(`<button class="btn small" type="button" data-print="${esc(r.id)}">Drucken</button>`);
    return `<details class="daygroup stock-record" data-key="r-${esc(r.id)}"><summary><strong>${esc(phaseName(r))} · ${esc(r.name)}</strong><span>${dateDe(r.date)} · ${money(r.totalCents)}</span></summary>
      <div class="body"><p>${esc(context(r))}</p><div class="stock-table">${table(r)}</div>${difference(r)}<div class="row">${actions.join("")}</div></div></details>`;
  }
  async function history(stamp, revealId) {
    const saved = await BW.api(options.canReview ? api : api+"/events",{headers:headers()});
    if (stamp !== generation) return;
    records = saved;
    const byOpening = new Map(records.filter(r=>r.beforeId).map(r=>[r.beforeId,r]));
    const list = find("records");
    const open = new Map([...list.querySelectorAll("details[data-key]")].map(d => [d.dataset.key,d.open]));
    find("print-all").disabled = !records.length;
    find("print-all").hidden = !options.canReview;
    find("archive").hidden = false;
    list.innerHTML = groupStockCounts(records,records).map(g => `<details class="daygroup semgroup" data-key="s-${esc(g.semester)}" ${g.semester === semesterOf(today()) ? "open" : ""}>
      <summary><strong>${esc(g.semester)}</strong><span>${g.count} ${g.count === 1 ? "Zählung" : "Zählungen"}</span></summary><div class="body">${g.events.map(event =>
        `<details class="daygroup stock-event" data-key="${esc(g.semester+"-"+event.key)}"><summary><strong>${esc(event.name)}</strong><span>${event.entries.length} ${event.entries.length === 1 ? "Zählung" : "Zählungen"}</span></summary>
         <div class="body">${event.entries.map(r => recordView(r,byOpening)).join("")}</div></details>`).join("")}</div></details>`).join("") || '<p class="muted">Noch keine Zählungen gespeichert.</p>';
    for (const d of list.querySelectorAll("details[data-key]")) {
      if (open.has(d.dataset.key)) d.open = open.get(d.dataset.key);
    }
    if (revealId) {
      let d = [...list.querySelectorAll(".stock-record")].find(el=>el.dataset.key === "r-"+revealId);
      while (d) { d.open = true; d = d.parentElement.closest("details[data-key]"); }
    }
  }
  find("records").onclick = async e => {
    const b = e.target.closest("button");
    if (!b || saving || b.disabled) return;
    const id = b.dataset.edit || b.dataset.closeCount || b.dataset.book || b.dataset.print;
    const record = records.find(r => r.id === id);
    if (!record) return;
    if (b.dataset.print) return print([record]);
    if (b.dataset.edit || b.dataset.closeCount) return startFrom(record,!!b.dataset.closeCount);
    const diff = record.comparison;
    if (!diff || !confirm(money(diff.pendingCents)+" auf „"+record.eventName+"“ buchen?")) return;
    const stamp = generation;
    b.disabled = true;
    try {
      const result = await BW.post(api+"/"+record.id+"/book",{beforeVersion:diff.beforeVersion,afterVersion:diff.afterVersion,pendingCents:diff.pendingCents},headers());
      if (stamp === generation) status.textContent = result.amountCents ? "Auf "+record.eventName+" gebucht · "+money(result.amountCents) : "Differenz bereits ausgeglichen.";
    } catch (error) { if (stamp === generation) status.textContent = error.message; }
    finally { b.disabled = false; if (stamp === generation) await history(stamp,id).catch(err => {status.textContent=err.message;}); }
  };
  async function refresh() {
    const stamp = ++generation;
    try {
      const data = await BW.api(api+"/options",{headers:headers()});
      if (stamp !== generation) return;
      const area = f.area.value, eventId = f.eventId.value;
      options = data;
      f.area.textContent = ""; f.area.append(...Object.keys(data.catalogs).map(k => new Option(areas[k],k)));
      if (Object.prototype.hasOwnProperty.call(data.catalogs,area)) f.area.value = area;
      f.eventId.textContent = ""; f.eventId.append(new Option("Bitte auswählen",""),...data.events.map(e => new Option(e.name,e.id)));
      f.eventId.value = eventId;
      for (const key of drafts.keys()) if (!data.catalogs[key]) drafts.delete(key);
      await history(stamp);
      if (stamp === generation) areaChanged();
    } catch (error) { if (stamp === generation) status.textContent = error.message; }
  }
  productForm.onsubmit = async e => {
    e.preventDefault();
    const button = productForm.querySelector("button"); if (button.disabled) return;
    button.disabled = true;
    try {
      const entry = await BW.post(api+"/drinks",{name:productForm.elements.name.value,price:productForm.elements.price.value},headers());
      if (!options) return;
      productForm.reset(); find("new").open = false; f.search.value = entry.name;
      await refresh(); status.textContent = "Getränk zum Zählkatalog hinzugefügt.";
    } catch (error) { status.textContent = error.message; }
    finally { button.disabled = false; }
  };
  form.onsubmit = async e => {
    e.preventDefault(); if (saving || !options) return;
    const area = f.area.value, draft = readLines();
    if (!draft || !draft.items.length) return;
    const stamp = generation;
    saving = true; form.inert = true; total();
    try {
      const data = {name:f.title.value,date:f.date.value,area,scope:f.scope.value,phase:f.phase.value,
        beforeId:f.beforeId.value,eventId:f.eventId.value,items:draft.items,version:editing?.version,requestId};
      const result = await BW.api(editing ? api+"/"+editing.id : api,{method:editing ? "PUT" : "POST",headers:headers(),body:JSON.stringify(data)});
      if (stamp !== generation) return;
      if (!editing) drafts.delete(area);
      clearForm();
      status.textContent = "Zählung gespeichert · "+money(result.totalCents);
      await history(stamp,result.id);
      if (stamp === generation) scopeChanged();
    } catch (error) {
      if (stamp === generation) { status.textContent = error.message; await refresh(); }
    } finally { saving = false; form.inert = false; if (options) total(); }
  };
  reset();
  return {refresh, reset};
}
