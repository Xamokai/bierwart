"use strict";

function mountAccountNavigation() {
  const desktop = bierwartDevice() === "desktop";
  const nav = document.getElementById("accountNav");
  const main = nav.closest("main");
  const title = document.getElementById("accountViewTitle");
  const views = Array.from(nav.querySelectorAll("button[aria-controls]"), button => ({
    button,
    panels: button.getAttribute("aria-controls").split(" ").map(id => document.getElementById(id))
  }));
  let current = views[0];

  function render() {
    for (const view of views) {
      const active = view === current;
      if (active) view.button.setAttribute("aria-current", "page");
      else view.button.removeAttribute("aria-current");
      for (const panel of view.panels) {
        panel.classList.toggle("account-view-inactive", !active);
        if (view.panels.length === 1 && panel.tagName === "DETAILS") {
          panel.classList.toggle("account-view-expanded", active);
          panel.open = active;
        }
      }
    }
    title.textContent = current.button.textContent;
  }

  for (const view of views) {
    view.button.addEventListener("click", () => {
      current = view;
      render();
      window.scrollTo(0, 0);
    });
  }

  return {
    refresh() {
      if (!desktop) return;
      // applyRoles() hat die freigegebenen Bereiche bereits gesetzt.
      for (const {button, panels} of views) {
        button.hidden = panels.some(panel => panel.hidden || panel.style.display === "none");
      }
      if (current.button.hidden) current = views[0];
      main.classList.add("account-desktop");
      nav.hidden = title.hidden = false;
      render();
    },
    select(panelId) {
      if (!desktop || nav.hidden) return;
      const view = views.find(view => view.panels.some(panel => panel.id === panelId));
      if (view && !view.button.hidden) {
        current = view;
        render();
      }
    },
    reset() {
      if (!desktop || nav.hidden) return;
      main.classList.remove("account-desktop");
      nav.hidden = title.hidden = true;
      current = views[0];
      for (const {panels} of views) {
        for (const panel of panels) {
          panel.classList.remove("account-view-expanded", "account-view-inactive");
          if (panel.tagName === "DETAILS") panel.open = false;
        }
      }
    }
  };
}
