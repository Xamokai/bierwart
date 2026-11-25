"use strict";

function mountSoftwareUpdates(getHeaders) {
  const repo = document.getElementById("updateRepo");
  const versions = document.getElementById("updateVersions");
  const save = document.getElementById("updateSave");
  const check = document.getElementById("updateCheck");
  const install = document.getElementById("updateInstall");
  const message = document.getElementById("updateMessage");
  let state, choices = [], pending = false, visible = false, timer;

  function updateControls() {
    const locked = !state || state.busy || pending;
    const choice = choices[versions.selectedIndex];
    repo.disabled = versions.disabled = locked;
    save.disabled = locked || !repo.value.trim() || repo.value.trim() === state.repo;
    check.disabled = locked || !state.repo || repo.value.trim() !== state.repo;
    install.disabled = locked || !choice || (state.online && choice.id === state.active);
    document.getElementById("updateDetail").textContent = choice ? origin(choice) : "";
  }

  function origin(release) {
    return release.repo ? release.repo + " · " + release.commit.slice(0, 12) : "Mitgelieferte Version";
  }

  function render(next, resetRepo) {
    if (!state || resetRepo || repo.value === state.repo) repo.value = next.repo;
    state = next;
    const active = state.installed.find(v => v.id === state.active);
    document.getElementById("updateActive").textContent = active.tag + (state.online ? " · in Betrieb" : " · Kasse pausiert");
    document.getElementById("updateOrigin").textContent = origin(active);

    const selected = versions.value;
    const remote = state.available.map(v => ({...v, id: v.oid, source: "repo"}));
    const local = state.installed.filter(v => !remote.some(r => r.id === v.id));
    choices = [...remote, ...local.map(v => ({...v, source: "local"}))];
    versions.replaceChildren(...choices.map(v => {
      const label = v.id === state.active ? " · aktiv" : v.source === "local" ? " · lokal verfügbar" : "";
      return new Option(v.tag + label, v.id);
    }));
    if (selected !== state.active && choices.some(v => v.id === selected)) versions.value = selected;
    showMessage(state.job.message, state.job.phase === "error");
  }

  function showMessage(text, error) {
    message.textContent = text;
    message.classList.toggle("amount-neg", error);
  }

  async function refresh(action, body) {
    if (pending) return;
    clearTimeout(timer);
    pending = true;
    updateControls();
    try {
      if (action) {
        const response = await fetch("/updates/api/" + action, {
          method: "POST", headers: getHeaders(), body: JSON.stringify(body)
        });
        if (!response.ok) {
          const result = await response.json().catch(() => ({}));
          throw Error(result.error || "Update-Anfrage fehlgeschlagen.");
        }
      }
      const next = await BW.api("/updates/api/status", {headers: getHeaders(), cache: "no-store"});
      render(next, action === "repo");
      if (next.busy && visible) timer = setTimeout(() => refresh(), 600);
    } catch (error) {
      showMessage(error.message, true);
    } finally {
      pending = false;
      updateControls();
    }
  }

  document.getElementById("updateSource").onsubmit = event => {
    event.preventDefault();
    if (!save.disabled) refresh("repo", {repo: repo.value.trim()});
  };
  repo.oninput = versions.onchange = updateControls;
  check.onclick = () => refresh("check", {});
  install.onclick = () => {
    const choice = choices[versions.selectedIndex];
    if (confirm(choice.tag + " aktivieren? Laufende Anfragen werden abgeschlossen. Anschließend wird der aktuelle Datenbestand gesichert und die Kasse kurz neu gestartet.")) {
      refresh("install", {source: choice.source, id: choice.id, repo: choice.repo});
    }
  };
  return {
    setVisible(value) {
      visible = value;
      clearTimeout(timer);
      if (visible) refresh();
    }
  };
}
