"use strict";

function mountAccountNavigation() {
  const nav = document.getElementById("accountNav");
  const main = nav.closest("main");
  const title = document.getElementById("accountViewTitle");
  const more = document.getElementById("accountMore");
  const menu = document.getElementById("moreViews");
  const sheet = document.getElementById("moreDialog");
  const modal = BW.dialog(sheet);
  const views = Array.from(nav.querySelectorAll("button[aria-controls]:not(#accountMore)"), button => ({
    button,
    panels: button.getAttribute("aria-controls").split(" ").map(id => document.getElementById(id))
  }));
  let current = views[0];

  function showMenu(open) {
    if (open) {
      sheet.append(menu);
      modal.open();
      more.setAttribute("aria-expanded","true");
      menu.querySelector("button:not([hidden])").focus();
    } else if (sheet.open) modal.close();
  }
  sheet.addEventListener("close",() => {
    nav.append(menu);
    more.setAttribute("aria-expanded","false");
    if (more.offsetWidth) more.focus();
    else if (!nav.hidden) current.button.focus();
  });
  const desktop = matchMedia("(min-width:1000px)");
  const onResize = () => { if (desktop.matches) showMenu(false); };
  if (desktop.addEventListener) desktop.addEventListener("change",onResize);
  else desktop.addListener(onResize);
  function render() {
    for (const view of views) {
      const active = view === current;
      if (active) view.button.setAttribute("aria-current","page");
      else view.button.removeAttribute("aria-current");
      for (const panel of view.panels) {
        panel.classList.toggle("account-view-inactive",!active);
        if (view.panels.length === 1 && panel.tagName === "DETAILS") {
          panel.classList.toggle("account-view-expanded",active);
          panel.open = active;
        }
      }
    }
    main.dataset.view = current.panels[0].id;
    more.classList.toggle("selected",menu.contains(current.button));
    title.textContent = current.button.dataset.title || current.button.textContent;
  }
  function choose(view) {
    if (!view || view.button.hidden) return;
    current = view;
    showMenu(false);
    render();
    if (menu.contains(view.button) && more.offsetWidth) more.focus();
    window.scrollTo(0,0);
  }
  for (const view of views) view.button.onclick = () => choose(view);
  more.onclick = () => showMenu(true);

  return {
    refresh() {
      for (const {button,panels} of views) button.hidden = panels.some(panel=>panel.hidden || panel.style.display==="none");
      if (current.button.hidden) current = views[0];
      main.classList.add("account-desktop");
      nav.hidden = title.hidden = false;
      render();
    },
    select(panelId) {
      if (!nav.hidden) choose(views.find(v=>v.panels.some(p=>p.id===panelId)));
    },
    reset() {
      showMenu(false);
      main.classList.remove("account-desktop");
      delete main.dataset.view;
      nav.hidden = title.hidden = true;
      current = views[0];
      for (const {panels} of views) for (const panel of panels) {
        panel.classList.remove("account-view-expanded","account-view-inactive");
        if (panel.tagName==="DETAILS") panel.open=false;
      }
    }
  };
}
