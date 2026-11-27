"use strict";
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const net = require("node:net");
const http = require("node:http");
const {fork,execFileSync} = require("node:child_process");
const {once} = require("node:events");
const {setTimeout:delay} = require("node:timers/promises");
const express = require("express");
const {lanConfig} = require("../lan");
const {repoAddress,listTags,prepare,hashPattern,newestFirst} = require("./releases");

const root = path.dirname(__dirname);
const storage = path.join(root,".bierwart");
const releases = path.join(storage,"versions");
const backups = path.join(storage,"backups");
const signers = path.join(storage,"release-signers");
const stateFile = path.join(storage,"state.json");
const journal = path.join(storage,"pending.json");
const builtin = {id:"initial",tag:"v"+require("../package.json").version,repo:"",commit:""};
const liveFiles = ["data","assets","config.json"];
let state, visibleTags = [], worker, busy = false, maintenance = true, requests = 0, shuttingDown = false;
let job = {message:"Kasse startet.",phase:"startup"};
let operation, lock, listener;

async function readJson(file,fallback) {
  try { return JSON.parse(await fs.readFile(file,"utf8")); }
  catch (err) { if (err.code === "ENOENT" && fallback !== undefined) return fallback; throw err; }
}
async function writeJson(file,data) {
  const tmp = file+".new";
  await fs.writeFile(tmp,JSON.stringify(data,null,2),{mode:0o600,flush:true});
  await fs.rename(tmp,file);
}
async function setState(change) {
  const next = {...state,...change};
  await writeJson(stateFile,next);
  state = next;
}
function describe(phase,message) { job = {phase,message}; }
function directory(id) {
  if (id === builtin.id) return root;
  if (!hashPattern.test(id)) throw Error("Ungültige lokale Versionskennung.");
  return path.join(releases,id);
}

async function startWorker(id) {
  const cwd = directory(id);
  if (cwd !== root) await fs.copyFile(path.join(root,"config.json"),path.join(cwd,"config.json"));
  const child = fork(path.join(__dirname,"worker.js"),[path.join(cwd,"server.js")],{
    cwd,execArgv:[],silent:true,env:{...process.env,BW_PORT:"0",BW_HOST:"127.0.0.1"}
  });
  const handle = {child,port:null};
  worker = handle;
  child.stderr.pipe(process.stderr,{end:false});
  child.on("exit",() => {
    if (worker !== handle) return;
    worker = null;
    if (!maintenance && !shuttingDown) {
      maintenance = true;
      describe("error","Der Kassenprozess wurde beendet. Eine gespeicherte Version kann wieder gestartet werden.");
    }
  });
  let onData,onExit,onError,timer;
  try {
    const port = await new Promise((resolve,reject) => {
      let output = "";
      timer = setTimeout(()=>reject(Error("Zeitüberschreitung beim Kassenstart.")),20000);
      onData = chunk => {
        output = (output+chunk).slice(-8192);
        const match = output.match(/Getränkekasse: http:\/\/127\.0\.0\.1:(\d+)\s/);
        if (match) resolve(Number(match[1]));
      };
      onExit = ()=>reject(Error("Die Kasse konnte mit dieser Version nicht starten. Details stehen im Serverprotokoll."));
      onError = reject;
      child.stdout.on("data",onData); child.once("exit",onExit); child.once("error",onError);
    });
    handle.port = port;
    for (const endpoint of ["/api/accounts","/api/products"]) {
      const response = await fetch("http://127.0.0.1:"+port+endpoint,{signal:AbortSignal.timeout(10000)});
      if (!response.ok || !Array.isArray(await response.json())) throw Error("Konten oder Produkte konnten nicht geladen werden.");
    }
    if (worker !== handle) throw Error("Die Kasse wurde beim Start beendet.");
  } finally {
    clearTimeout(timer);
    child.stdout.off("data",onData); child.stdout.resume();
    child.off("exit",onExit); child.off("error",onError);
  }
}
async function stopWorker() {
  const handle=worker;
  if (!handle) return;
  const child=handle.child;
  if (child.exitCode === null && child.signalCode === null) {
    const done=once(child,"exit");
    child.kill();
    const timer=setTimeout(()=>child.kill("SIGKILL"),5000);
    try { await done; } finally { clearTimeout(timer); }
  }
  if (worker===handle) worker=null;
}
async function drain() {
  maintenance=true;
  const until=Date.now()+20000;
  while (requests && Date.now()<until) await delay(50);
  if (requests) {
    maintenance=!worker;
    throw Error("Es laufen noch Anfragen. Bitte den Versionswechsel später erneut starten.");
  }
}
async function snapshot() {
  const dir=await fs.mkdtemp(path.join(backups,"stand-"));
  try {
    for (const name of liveFiles) await fs.cp(path.join(root,name),path.join(dir,name),{recursive:true,dereference:true});
    return path.basename(dir);
  } catch (err) { await fs.rm(dir,{recursive:true,force:true}); throw err; }
}
async function restore(name) {
  if (!/^stand-[a-zA-Z0-9]+$/.test(name)) throw Error("Ungültiger Sicherungspfad.");
  const saved = path.join(backups,name);
  for (const item of liveFiles) await fs.access(path.join(saved,item));
  for (const item of liveFiles) {
    await fs.rm(path.join(root,item),{recursive:true,force:true});
    await fs.cp(path.join(saved,item),path.join(root,item),{recursive:true});
  }
}
async function changeVersion(target) {
  if (await readJson(journal,null)) throw Error("Eine Wiederherstellung ist offen. Den Startdienst erneut starten.");
  if (target.id !== builtin.id && !state.cache.some(c=>c.id===target.id)) {
    describe("prepare","Release wird geladen und seine Signatur geprüft. Die Kasse ist weiter benutzbar.");
    const builtInKeys=await fs.readFile(path.join(__dirname,"trusted-signers"),"utf8");
    const localKeys=await fs.readFile(path.join(__dirname,"local-signers"),"utf8").catch(err=>{if(err.code==="ENOENT") return ""; throw err;});
    await fs.writeFile(signers,builtInKeys+"\n"+localKeys,{mode:0o600});
    await prepare(target,root,releases,signers);
    await setState({cache:[...state.cache,target]});
  }
  describe("switch","Laufende Buchungen werden abgeschlossen. Der Datenbestand wird gesichert.");
  await drain();
  const previous=state.active;
  let backup;
  let pending=false;
  try {
    await stopWorker();
    backup=await snapshot();
    await writeJson(journal,{previous,target:target.id,backup});
    pending=true;
    describe("switch",target.tag+" startet. Konten und Produkte werden geprüft.");
    await startWorker(target.id);
    // state.json is the commit point. Before it, the journal means "restore".
    await setState({active:target.id, activation:backup});
  } catch (err) {
    await stopWorker();
    if (pending) { await restore(backup); await fs.rm(journal,{force:true}); }
    await startWorker(previous);
    maintenance=false;
    throw Error(err.message+" Die vorherige Version ist wieder aktiv.");
  }
  await fs.rm(journal,{force:true});
  maintenance=false;
  describe("done",target.tag+" ist aktiv. Konten und Produkte wurden geladen.");
}
async function recover() {
  const saved=await readJson(journal,null);
  if (!saved) return;
  if (state.activation !== saved.backup) {
    if (state.active !== saved.previous) throw Error("Versionsstand und Sicherung widersprechen sich.");
    await restore(saved.backup);
  }
  await fs.rm(journal,{force:true});
}
function unavailable(req,res,message) {
  res.status(503).set("Retry-After","3");
  if (req.method !== "GET" || req.path.startsWith("/api/") || !req.get("Accept")?.includes("text/html"))
    return res.send(message);
  res.set("Cache-Control","no-store").type("html").send(`<!doctype html><html lang="de"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#14120d"><script src="/updates/theme.js"></script>
    <title>Kassenstatus · Bierwart</title><link rel="stylesheet" href="/updates/design.css"><link rel="stylesheet" href="/updates/page.css"></head>
    <body><header></header>
    <main><h1>Kassenstatus</h1><section><p role="status">${message}</p><div class="row"><a href="">Erneut laden</a><a href="/updates/">Software-Updates öffnen</a></div></section></main></body></html>`);
}
function relay(req,res) {
  if (maintenance || !worker?.port) return unavailable(req,res,"Die Getränkekasse startet. Bitte gleich erneut versuchen.");
  const port=worker.port;
  const headers={...req.headers, host:"127.0.0.1:"+port,connection:"close"};
  if (headers.origin) headers.origin="http://"+headers.host;
  const upstream=http.request({hostname:"127.0.0.1",port,path:req.originalUrl,method:req.method,headers},reply=>{
    if (res.destroyed) { reply.resume(); return; }
    res.writeHead(reply.statusCode,reply.headers); reply.pipe(res);
    res.once("close",()=>reply.resume());
    reply.once("error",()=>res.destroy());
  });
  requests++;
  upstream.once("close",()=>{ requests--; });
  upstream.once("error",()=>{ if (!res.headersSent) unavailable(req,res,"Kasse vorübergehend nicht erreichbar."); else res.destroy(); });
  req.once("aborted",()=>upstream.destroy());
  res.once("close",()=>{if (!req.complete) upstream.destroy();});
  req.pipe(upstream);
}
function setOperation(task) {
  busy=true;
  operation=task().catch(err=>{describe("error",err.message);console.error("[Updates]",err.message);})
    .finally(()=>{busy=false;});
}
async function main() {
  let cfg;
  try { cfg=await readJson(path.join(root,"config.json")); }
  catch (err) {
    const pending=await readJson(journal,null);
    if (!/^stand-[a-zA-Z0-9]+$/.test(pending?.backup || "")) throw err;
    cfg=await readJson(path.join(backups,pending.backup,"config.json"));
  }
  const host=process.env.BW_HOST || cfg.host || "127.0.0.1", port=Number(process.env.BW_PORT || cfg.port || 3000);
  const access=lanConfig(host);
  await fs.mkdir(storage,{recursive:true,mode:0o700});
  // One writer per installation, even if another launcher chooses a different HTTP port.
  if (process.platform==="linux") {
    lock=await fs.open(path.join(storage,"manager.lock"),"a",0o600);
    try { execFileSync("flock",["-n","3"],{stdio:["ignore","ignore","pipe",lock.fd]}); }
    catch(err) { throw Error(err.code==="ENOENT" ? "Zum Start fehlt flock (util-linux)." : "Diese Installation wird bereits ausgeführt."); }
  } else {
    lock=net.createServer(s=>s.destroy());
    const token=crypto.createHash("sha256").update(await fs.realpath(root)).digest("hex").slice(0,32);
    const address=process.platform==="win32" ? String.raw`\\.\pipe\bierwart-`+token : path.join(storage,"manager.sock");
    lock.listen(address); await once(lock,"listening");
  }
  const app=express(); app.disable("x-powered-by"); app.use(access);
  app.use("/updates",(req,res,next)=>{ res.set({"Cache-Control":"no-store","X-Content-Type-Options":"nosniff","Content-Security-Policy":"default-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'"}); next(); });
  app.get(["/updates","/updates/"],(req,res)=>res.sendFile(path.join(__dirname,"page.html")));
  for (const asset of ["design.css", "theme.js"]) {
    app.get("/updates/" + asset, (req, res) => res.sendFile(path.join(root, "public", asset)));
  }
  for(const f of ["page.js","page.css"]) app.get("/updates/"+f,(req,res)=>res.sendFile(path.join(__dirname,f)));
  app.use("/updates/api",async(req,res,next)=>{
    const configured=String(process.env.BW_ADMIN_PIN || cfg.adminPin || "").trim();
    const pin=configured && configured!=="1234" ? configured : (await fs.readFile(path.join(root,"data","admin-pin"),"utf8").catch(()=>"")).trim();
    const hash=value=>crypto.createHash("sha256").update(value).digest();
    if(!pin || !crypto.timingSafeEqual(hash(req.get("X-Admin-Pin") || ""),hash(pin))) return res.status(401).json({error:"Verwaltungs-PIN erforderlich."});
    if (!state) return res.status(503).json({error:"Verwaltung startet."});
    next();
  },express.json({limit:"4kb"}));
  app.get("/updates/api/status",(req,res)=>res.json({repo:state.repo,active:state.active,installed:[builtin,...state.cache],available:visibleTags,busy,job,online:!maintenance && !!worker}));
  app.use("/updates/api",(req,res,next)=>{
    if(req.method!=="POST") return res.sendStatus(404);
    if (!req.is("application/json")) return res.sendStatus(415);
    if (busy || shuttingDown) return res.status(409).json({error:"Ein Vorgang läuft bereits."});
    next();
  });
  app.post("/updates/api/repo",async(req,res)=>{
    const repo=repoAddress(req.body?.repo);
    busy=true;
    try { await setState({repo}); visibleTags=[]; describe("ready","Repository gespeichert."); res.json({ok:true}); }
    finally { busy=false; }
  });
  app.post("/updates/api/check",(req,res)=>{
    if (!state.repo) throw Error("Zuerst ein Repository speichern.");
    visibleTags=[]; describe("check","Git fragt die veröffentlichten Versionen ab.");
    setOperation(async()=>{
      visibleTags=await listTags(state.repo,storage);
      const latest=visibleTags[0], active=[builtin,...state.cache].find(v=>v.id===state.active);
      let message="Keine Versions-Tags im Format v1.2.3 gefunden.";
      if (latest) {
        message = newestFirst(latest,active)<0 ? "Update verfügbar: "+latest.tag+" (installiert: "+active.tag+")." :
          "Keine höhere Versionsnummer verfügbar. Installiert ist "+active.tag+".";
      }
      describe("done",message);
    });
    res.sendStatus(202);
  });
  app.post("/updates/api/install",(req,res)=>{
    const {source,id,repo}=req.body || {};
    const remote=source==="repo" && repo===state.repo && visibleTags.find(t=>t.oid===id);
    const target=remote ? {...remote,id:remote.oid} : source==="local" && [builtin,...state.cache].find(c=>c.id===id);
    if(!target) return res.status(409).json({error:"Diese Version ist nicht mehr ausgewählt. Bitte die Liste aktualisieren."});
    if(target.id===state.active && !maintenance) return res.status(409).json({error:"Diese Version ist bereits aktiv."});
    setOperation(()=>changeVersion(target)); res.sendStatus(202);
  });
  app.use("/updates",(req,res)=>res.sendStatus(404));
  app.use(relay);
  app.use((err,req,res,next)=>res.status(400).json({error:err.message}));
  listener=app.listen(port,host); await once(listener,"listening");
  await fs.mkdir(releases,{recursive:true}); await fs.mkdir(backups,{recursive:true});
  state=await readJson(stateFile,{repo:"",active:builtin.id,cache:[]});
  busy=true;
  await recover();
  try { await startWorker(state.active); maintenance=false; describe("ready","Kasse ist bereit."); }
  catch(err) { await stopWorker(); describe("error",err.message); console.error(err.message); }
  busy=false;
  console.log("Getränkekasse: http://"+host+":"+listener.address().port);
}
async function close() {
  if(shuttingDown) return;
  shuttingDown=true;
  if(operation) await operation;
  if(listener) listener.close();
  await drain().catch(()=>{});
  await stopWorker();
  process.exit(0);
}
process.once("SIGTERM",close); process.once("SIGINT",close);
main().catch(err=>{console.error("Bierwart konnte nicht starten:",err.message);process.exit(1);});
