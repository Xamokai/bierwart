// Vor dem ersten Zeichnen anwenden, auch beim Wechsel zwischen Kasse und Update-Seite.
(function () {
  "use strict";
  var key = "bierwart.farbschema";
  var media = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)");
  var preference = "system";
  var toggle, automatic;

  function normalize(value) {
    return value === "dark" || value === "light" ? value : "system";
  }
  function apply() {
    var dark = preference === "dark" || (preference === "system" && media && media.matches);
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
    if (toggle) {
      toggle.setAttribute("aria-checked", String(!!dark));
      toggle.title = dark ? "Helles Farbschema einschalten" : "Dunkles Farbschema einschalten";
      automatic.hidden = preference === "system";
    }
  }
  try { preference = normalize(window.localStorage.getItem(key)); } catch (error) { /* Speicher kann im Kiosk gesperrt sein. */ }
  apply();
  if (media) {
    if (media.addEventListener) media.addEventListener("change", apply);
    else if (media.addListener) media.addListener(apply);
  }
  window.addEventListener("storage", function (event) {
    if (event.key === key || event.key === null) {
      preference = normalize(event.newValue);
      apply();
    }
  });
  document.addEventListener("DOMContentLoaded", function () {
    var header = document.querySelector("body > header");
    if (!header) return;
    toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "theme-switch";
    toggle.setAttribute("role", "switch");
    toggle.setAttribute("aria-label", "Dunkelmodus");
    toggle.innerHTML = '<span class="switch-track"><svg class="nav-icon" viewBox="0 0 24 24" focusable="false" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2" /><path d="M12 20v2" /><path d="m4.93 4.93 1.41 1.41" /><path d="m17.66 17.66 1.41 1.41" /><path d="M2 12h2" /><path d="M20 12h2" /><path d="m6.34 17.66-1.41 1.41" /><path d="m19.07 4.93-1.41 1.41" /></svg><svg class="nav-icon" viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" /></svg></span>';
    automatic = document.createElement("button");
    automatic.className = "theme-auto";
    automatic.type = "button";
    automatic.textContent = "Geräte-Farbschema verwenden";
    var footer = document.querySelector(".footer-nav") || document.body.appendChild(document.createElement("footer"));
    footer.appendChild(automatic);
    function choose(value) {
      preference = value;
      apply();
      try { window.localStorage.setItem(key, preference); } catch (error) { /* Gilt bei gesperrtem Speicher auf dieser Seite. */ }
    }
    toggle.onclick = function () { choose(toggle.getAttribute("aria-checked") === "true" ? "light" : "dark"); };
    automatic.onclick = function () { choose("system"); toggle.focus(); };
    header.appendChild(toggle);
    apply();
  });
})();
