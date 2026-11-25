"use strict";
const byId = id=>document.getElementById(id);
let pin=sessionStorage.getItem("kasse_pin") || "", state, options=[], timer, submitting=false;
function message(text,error=false) {
  byId("message").textContent=text; byId("message").classList.toggle("error",error);
}
async function request(action,body) {
  const response=await fetch("/updates/api/"+action,{method:body===undefined?"GET":"POST",cache:"no-store",
    headers:{"X-Admin-Pin":pin,"Content-Type":"application/json"},body:body===undefined?undefined:JSON.stringify(body)});
  if(response.status===401) {
    byId("panel").hidden=true; byId("login").hidden=false;
    throw Error("Bitte mit der Verwaltungs-PIN anmelden.");
  }
  if(!response.ok) throw Error((await response.json().catch(()=>({}))).error || "Anfrage fehlgeschlagen.");
  if(response.status===202) return;
  return response.json();
}
function selection() {
  const choice=options[byId("versions").selectedIndex];
  byId("detail").textContent=choice?.description || "";
  byId("install").disabled=!choice || choice.id===state.active && state.online || state.busy || submitting;
}
function render() {
  const active=state.installed.find(v=>v.id===state.active);
  byId("active").textContent=active.tag+(state.online?" · in Betrieb":" · Kasse pausiert");
  byId("activeRepo").textContent=active.repo ? active.repo+" · "+active.commit.slice(0,12) : "Mitgelieferte Version";
  const old=byId("versions").value;
  options=[...state.available.map(r=>({id:r.oid,tag:r.tag,source:"repo",repo:r.repo,description:r.repo+" · "+r.commit.slice(0,12)})),
    ...state.installed.filter(local=>!state.available.some(r=>r.oid===local.id)).map(r=>({...r,source:"local",description:r.repo ? r.repo+" · "+r.commit.slice(0,12) : "Startversion aus dem Installationspaket"}))];
  byId("versions").replaceChildren(...options.map(r=>{
    const label=r.id===state.active ? " · aktiv" : r.source==="local" ? " · lokal verfügbar" : "";
    return new Option(r.tag+label,r.source+"-"+r.id);
  }));
  if(options.some(r=>r.source+"-"+r.id===old) && !(old==="local-initial" && state.available.length)) byId("versions").value=old;
  byId("check").disabled=!state.repo || state.busy || submitting || byId("repo").value.trim()!==state.repo;
  byId("save").disabled=state.busy || submitting || byId("repo").value.trim()===state.repo;
  byId("versions").disabled=state.busy || submitting;
  selection(); message(state.job.message,state.job.phase==="error");
}
async function refresh(resetAddress=false) {
  clearTimeout(timer); state=await request("status");
  byId("panel").hidden=false; byId("login").hidden=true;
  if(resetAddress) byId("repo").value=state.repo;
  render();
  if(state.busy) timer=setTimeout(()=>refresh().catch(e=>message(e.message,true)),600);
}
async function act(action,body) {
  if(submitting) return;
  try {
    submitting=true;render();await request(action,body);
    submitting=false;await refresh(action==="repo");
  } catch(e) { submitting=false;if(state) render();message(e.message,true); }
}
byId("login").onsubmit=async e=>{
  e.preventDefault();pin=byId("pin").value;
  try {await refresh(true);sessionStorage.setItem("kasse_pin",pin);byId("pin").value="";} catch(err){message(err.message,true);}
};
byId("source").onsubmit=e=>{e.preventDefault();act("repo",{repo:byId("repo").value.trim()});};
byId("repo").oninput=()=>render();
byId("check").onclick=()=>act("check",{});
byId("versions").onchange=selection;
byId("install").onclick=()=>{
  const v=options[byId("versions").selectedIndex];
  if(v && confirm(v.tag+" aktivieren? Laufende Anfragen werden abgeschlossen. Anschließend wird der aktuelle Datenbestand gesichert und die Kasse kurz neu gestartet."))
    act("install",{source:v.source,id:v.id,repo:v.repo});
};
refresh(true).catch(e=>message(e.message,true));
