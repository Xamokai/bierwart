"use strict";

const BW = (() => {
  const figures = new Intl.NumberFormat("de-DE",{minimumFractionDigits:2, maximumFractionDigits:2});
  const money = value => figures.format(value) + " €";

  async function api(path, options) {
    let response;
    try { response = await fetch(path, options); }
    catch (error) { throw Error("Keine Verbindung zum BW-Server. Bitte den Verbindungsstatus prüfen."); }
    const result = await response.json().catch(() => null);
    if (!response.ok || result === null) throw Error((result && result.error) || "Der BW-Server konnte die Anfrage nicht beantworten.");
    return result;
  }

  const post = (path, body, headers = {}) => api(path, {
    method: "POST", headers: Object.assign({"Content-Type":"application/json"}, headers), body: JSON.stringify(body)
  });

  let timer;
  function toast(message) {
    const el = document.getElementById("toast");
    const host = document.querySelector("dialog[open]") || document.body;
    host.append(el);
    el.textContent = message;
    el.style.display = "block";
    clearTimeout(timer);
    timer = setTimeout(() => { el.style.display = "none"; }, 4000);
  }

  function printDocument(win,title,content) {
    win.document.write(`<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
      <link rel="stylesheet" href="/design.css"><title>${displayText(title)}</title></head>
      <body class="print-page">${content}</body></html>`);
    win.addEventListener("load",()=>win.print(),{once:true});
    win.document.close();
  }

  function retryMessage(container,message,retry) {
    const status = document.createElement("p");
    status.setAttribute("role","status"); status.textContent = message;
    const button = document.createElement("button");
    button.className = "btn"; button.textContent = "Erneut laden"; button.type = "button";
    button.onclick = () => { button.disabled = true; retry(); };
    container.textContent = ""; container.append(status,button);
  }

  function dialog(el, canClose = () => true) {
    const close = () => { if (canClose()) el.close(); };
    el.querySelector("[data-close]").addEventListener("click", close);
    el.addEventListener("cancel", e => { if (!canClose()) e.preventDefault(); });
    el.addEventListener("click", e => {
      if (e.target !== el) return;
      const r = el.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) close();
    });
    return {open() { if (!el.open) { el.showModal(); el.scrollTop = 0; } }, close};
  }

  function mountAccountForm(form, onCreated) {
    form.onsubmit = async e => {
      e.preventDefault();
      const button = form.querySelector('[type="submit"]');
      if (button.disabled) return;
      button.disabled = true;
      const fields = new FormData(form);
      try {
        const account = await post("/api/accounts", {name: fields.get("name"), surname: fields.get("surname")});
        form.reset();
        await onCreated(account);
      } catch (error) { toast(error.message); }
      finally { button.disabled = false; }
    };
  }
  function mountProductOrder(trigger, products, render) {
    const sheet = document.createElement("dialog");
    sheet.className = "bw-dialog compact-dialog";
    sheet.setAttribute("aria-labelledby","order-title");
    sheet.innerHTML = '<div class="dialog-head"><h2 id="order-title">Reihenfolge ändern</h2><button class="btn small ghost" type="button" aria-label="Schließen" title="Schließen" data-close><svg class="nav-icon" aria-hidden="true" focusable="false"><use xlink:href="icons/navigation.svg#x"></use></svg></button></div>' +
      '<form class="stack-form"><label><span id="order-product-label">Produkt</span><select name="product" aria-labelledby="order-product-label"></select></label><label><span id="order-position-label">Neue Position</span><select name="position" aria-labelledby="order-position-label"></select></label><button class="btn gold" type="submit">Verschieben</button></form>';
    document.body.appendChild(sheet);
    const modal = dialog(sheet), form = sheet.querySelector("form");
    const {product,position} = form.elements;
    trigger.onclick = () => {
      product.textContent = position.textContent = "";
      products().forEach((p,i) => {
        product.add(new Option(p.name || "Produkt "+(i+1), i));
        position.add(new Option(String(i+1), i));
      });
      modal.open();
    };
    product.onchange = () => { position.value = product.value; };
    form.onsubmit = e => {
      e.preventDefault();
      const list = products(), from = product.selectedIndex, to = position.selectedIndex;
      if (from >= 0 && to >= 0 && from !== to) {
        const [moved] = list.splice(from,1);
        list.splice(to,0,moved);
        render();
      }
      modal.close();
    };
  }
  return {money, api, post, toast, dialog, printDocument, retryMessage, mountAccountForm, mountProductOrder};
})();
