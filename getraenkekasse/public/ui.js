"use strict";

const BW = (() => {
  const money = value => value.toFixed(2).replace(".", ",") + " €";

  async function api(path, options) {
    let response;
    try { response = await fetch(path, options); }
    catch { throw Error("Keine Verbindung zum BW-Server. Bitte den Verbindungsstatus prüfen."); }
    const result = await response.json().catch(() => null);
    if (!response.ok || result === null) throw Error(result?.error || "Der BW-Server konnte die Anfrage nicht beantworten.");
    return result;
  }

  const post = (path, body, headers = {}) => api(path, {
    method: "POST", headers: {"Content-Type":"application/json", ...headers}, body: JSON.stringify(body)
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
  return {money, api, post, toast, dialog, mountAccountForm};
})();
