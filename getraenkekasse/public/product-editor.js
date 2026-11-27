"use strict";

function mountProductEditor(root, getHeaders, onSaved = () => {}) {
  const icon = name => '<svg class="nav-icon" aria-hidden="true" focusable="false"><use xlink:href="icons/navigation.svg#'+name+'"></use></svg>';
  root.className = "product-editor";
  root.innerHTML = `<fieldset><legend class="sr-only">Produktkatalog bearbeiten</legend>
    <div class="catalog-tools"><button class="btn" type="button" id="btnAddProd">${icon("plus")}Hinzufügen</button>
      <button class="btn" type="button" id="productOrder" aria-label="Reihenfolge ändern" title="Reihenfolge ändern">${icon("arrow-down-up")}Reihenfolge</button></div>
    <div class="catalog-list"></div>
    <div class="catalog-save" hidden><span>Ungespeicherte Änderungen</span><button class="btn gold" type="button" id="btnSaveProd">Speichern</button></div>
    <input type="file" hidden accept="image/png,image/jpeg,image/webp,image/gif">
  </fieldset>`;
  const list = root.querySelector(".catalog-list"), footer = root.querySelector(".catalog-save");
  const fileInput = root.querySelector("[type=file]"), order = root.querySelector("#productOrder");
  const add = root.querySelector("#btnAddProd"), fieldset = root.querySelector("fieldset");
  let items = [], selected = null, uploadItem = null, dragged = null, dirty = false, session = 0;
  let loaded = false;
  fieldset.disabled = true;

  function priceNumber(value) {
    const text = String(value).trim().replace(",",".");
    const number = Number(text);
    return /^-?\d+(?:\.\d{1,2})?$/.test(text) && Number.isSafeInteger(Math.round(number*100)) ? number : NaN;
  }
  function priceLabel(value) {
    const amount = priceNumber(value);
    return Number.isFinite(amount) ? BW.money(amount).replace(/\./g,".<wbr>") : "Preis fehlt";
  }
  function changed() {
    dirty = true;
    footer.hidden = false;
  }
  function rowMarkup(item, index) {
    const image = item.image ? '<img src="/assets/res/'+encodeURIComponent(item.image)+'" loading="lazy" alt="">' : "";
    return `<div class="catalog-row" data-row="${index}">
      <div class="catalog-line"><span class="catalog-grip" draggable="true" title="Zum Sortieren ziehen">${icon("grip-vertical")}</span>
        <button type="button" class="catalog-item" aria-expanded="false" aria-controls="product-fields-${index}">
          <span class="catalog-thumb">${icon("beer")}${image}</span>
          <span class="catalog-data"><strong>${displayText(item.name || "Neues Produkt")}</strong><span class="catalog-price">${priceLabel(item.price)}</span></span>
          ${icon("chevron-down")}
        </button></div><div id="product-fields-${index}" class="catalog-fields" hidden></div></div>`;
  }
  function render(focus = false) {
    list.innerHTML = items.length ? items.map(rowMarkup).join("") : '<p class="catalog-empty">Noch keine Produkte angelegt.</p>';
    order.disabled = items.length < 2;
    footer.hidden = !dirty;
    if (selected && items.includes(selected)) expand(list.children[items.indexOf(selected)],focus);
  }
  function expand(row, focus) {
    const item = items[Number(row.dataset.row)];
    selected = item;
    const body = row.querySelector(".catalog-fields");
    body.hidden = false;
    row.querySelector(".catalog-item").setAttribute("aria-expanded","true");
    body.innerHTML = `<div class="catalog-pair"><label>Produktname<input name="name" required></label>
      <label>Preis (€)<input name="price" inputmode="decimal" required></label></div>
      <div class="catalog-pair"><label class="catalog-check"><input name="tally" type="checkbox">Auf Papier-Strichliste</label>
      <label>Striche auf Papier<select name="ticks"><option>10</option><option>20</option></select></label></div>
      <div class="catalog-file"><label>Bilddatei<input name="image"></label><button class="btn" type="button" data-upload>${icon("upload")}Bild hochladen</button></div>
      <button class="btn small danger-action" type="button" data-remove>Produkt entfernen</button>`;
    body.querySelector("[name=name]").value = item.name;
    body.querySelector("[name=price]").value = typeof item.price === "number" ? item.price.toFixed(2).replace(".",",") : item.price;
    body.querySelector("[name=tally]").checked = item.tally;
    body.querySelector("[name=ticks]").value = Number(item.ticks) === 10 ? "10" : "20";
    body.querySelector("[name=image]").value = item.image || "";
    if (focus) body.querySelector("[name=name]").focus();
  }
  function collapse() {
    const button = list.querySelector('[aria-expanded="true"]');
    if (!button) return;
    button.setAttribute("aria-expanded","false");
    const fields = button.closest("[data-row]").querySelector(".catalog-fields");
    fields.hidden = true;
    fields.textContent = "";
    selected = null;
  }
  list.onclick = event => {
    const row = event.target.closest("[data-row]");
    if (!row || fieldset.disabled) return;
    const index = Number(row.dataset.row), item = items[index];
    if (event.target.closest(".catalog-item")) {
      const alreadyOpen = selected === item;
      collapse();
      if (!alreadyOpen) expand(row,false);
    } else if (event.target.closest("[data-upload]")) {
      uploadItem = item; fileInput.click();
    } else if (event.target.closest("[data-remove]")) {
      selected = null;
      items.splice(index,1);
      changed(); render();
      (list.children[Math.min(index,items.length-1)]?.querySelector(".catalog-item") || add).focus();
    }
  };
  list.oninput = event => {
    const input = event.target, row = input.closest("[data-row]");
    if (!input.name || !row) return;
    const item = items[Number(row.dataset.row)];
    item[input.name] = input.type === "checkbox" ? input.checked : input.name === "ticks" ? Number(input.value) : input.value;
    if (input.name === "name") {
      input.setCustomValidity("");
      row.querySelector(".catalog-data strong").textContent = item.name || "Neues Produkt";
    }
    if (input.name === "price") {
      input.setCustomValidity("");
      row.querySelector(".catalog-price").innerHTML = priceLabel(item.price);
    }
    changed();
  };
  function moved() { changed(); render(); }
  BW.mountProductOrder(order, () => items, moved);
  list.ondragstart = event => {
    const grip = event.target.closest(".catalog-grip");
    if (!grip || fieldset.disabled) { event.preventDefault(); return; }
    dragged = grip.closest("[data-row]");
    dragged.classList.add("dragging");
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain",dragged.dataset.row);
  };
  list.ondragover = event => {
    const row = event.target.closest("[data-row]");
    if (row && dragged) { event.preventDefault(); row.classList.add("over"); }
  };
  list.ondragleave = event => event.target.closest("[data-row]")?.classList.remove("over");
  list.ondragend = () => {
    dragged = null;
    list.querySelectorAll(".over,.dragging").forEach(row=>row.classList.remove("over","dragging"));
  };
  list.ondrop = event => {
    const row = event.target.closest("[data-row]");
    if (!dragged || !row) return;
    event.preventDefault();
    const from = Number(dragged.dataset.row), to = Number(row.dataset.row);
    list.ondragend();
    if (from === to) return;
    items.splice(to,0,items.splice(from,1)[0]); moved();
  };
  add.onclick = () => {
    selected = {name:"",price:0,image:"",tally:false,ticks:20};
    items.push(selected); changed(); render(true);
  };
  fileInput.onchange = async () => {
    const file = fileInput.files[0], item = uploadItem, stamp = session;
    fileInput.value = "";
    if (!file || !items.includes(item)) return;
    fieldset.disabled = true;
    try {
      const safe = file.name.replace(/[^\w.\-äöüÄÖÜß]/g,"_");
      const response = await BW.api("/api/admin/upload?name="+encodeURIComponent(safe), {
        method:"POST",headers:{...getHeaders(),"Content-Type":"application/octet-stream"},body:file
      });
      if (stamp !== session) return;
      item.image = response.file; changed(); render();
      BW.toast("Bild hochgeladen. Änderungen speichern.");
    } catch (error) { if (stamp === session) BW.toast(error.message); }
    finally { if (stamp === session) fieldset.disabled = false; }
  };
  root.querySelector("#btnSaveProd").onclick = async () => {
    const invalid = items.find(item=>!item.name.trim() || !Number.isFinite(priceNumber(item.price)));
    if (invalid) {
      selected = invalid; render();
      const input = list.querySelector('.catalog-fields:not([hidden]) [name='+(!invalid.name.trim() ? 'name' : 'price')+']');
      input.setCustomValidity(input.name === "price" ? "Bitte einen Betrag mit höchstens zwei Nachkommastellen eingeben." : "Bitte einen Produktnamen eingeben.");
      input.focus(); input.reportValidity(); return;
    }
    const stamp = session;
    fieldset.disabled = true;
    try {
      const saved = await BW.api("/api/admin/products",{method:"PUT",headers:getHeaders(),body:JSON.stringify({products:items})});
      if (stamp !== session) return;
      dirty = false; replaceItems(saved.products); onSaved(saved.products);
      BW.toast("Produkte und Preise gespeichert.");
    } catch (error) { if (stamp === session) BW.toast(error.message); }
    finally { if (stamp === session) fieldset.disabled = false; }
  };
  function replaceItems(products) {
    selected = null; items = products.map(item=>({...item})); render();
  }
  return {
    load(products) {
      if (dirty || (loaded && fieldset.disabled)) return;
      replaceItems(products);
      loaded = true; fieldset.disabled = false;
    },
    reset() {
      session++; dirty = loaded = false; fieldset.disabled = true; replaceItems([]);
    }
  };
}
