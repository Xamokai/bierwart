"use strict";
// Isolierte Abnahmekasse mit dem echten Update-Manager und ausschließlich Beispieldaten.
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const {spawn, execFileSync} = require("node:child_process");
const {scryptSync, randomBytes} = require("node:crypto");
const app = path.resolve(__dirname,"..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(),"bw-ui-"));
const port = process.argv[2] || "3182";
for (const f of fs.readdirSync(app)) {
  if ([".bierwart","assets","config.json","data","test","public","update-manager"].includes(f) || f.startsWith(".")) continue;
  if (f === "server.js") fs.copyFileSync(path.join(app,f),path.join(tmp,f));
  else fs.symlinkSync(path.join(app,f),path.join(tmp,f));
}
for (const dir of ["public","update-manager"]) {
  fs.mkdirSync(path.join(tmp,dir));
  for (const f of fs.readdirSync(path.join(app,dir))) {
    if (["manager.js","init.js"].includes(f)) fs.copyFileSync(path.join(app,dir,f),path.join(tmp,dir,f));
    else fs.symlinkSync(path.join(app,dir,f),path.join(tmp,dir,f));
  }
}
execFileSync(process.execPath,["update-manager/init.js"],{cwd:tmp});
const dbFile=path.join(tmp,"data","db.json");
const db=JSON.parse(fs.readFileSync(dbFile));
const salt=randomBytes(16).toString("hex"), passwordHash=salt+":"+scryptSync("Probe",salt,32).toString("hex");
const samples=["Marlene Hofmann","Aleksandra Wiśniewska-Kowalczyk","Jo","J","Lea Wagner","Paul Steiner","Đặng Thị Ngọc Hân","Seán O'Brien-Ó Súilleabháin","Lena Becker","Felix Hartmann","Anton Ritter","Luise Weber","Max Berg"];
const roleSamples={4:"gnucash",5:"uebersicht",6:"kneipwart",7:"schnapswart"};
const stamp=new Date();
function date(days) {const d=new Date(stamp); d.setDate(d.getDate()-days); if(days) d.setHours(18,42,0,0); else d.setTime(stamp.getTime()-60000); return d.toISOString();}
samples.forEach((name,i)=>db.accounts.push({id:"demo"+i,name,surname:"Probe",passwordHash,initialPassword:false,priority:i<2 || i===7,roles:i===0?{gnucash:true,schnapswart:true,kneipwart:true,uebersicht:true}:roleSamples[i]?{[roleSamples[i]]:true}:{}}));
function entry(id,accountId,days,type,total,description) {
  return {id,accountId,date:date(days),description,type,total,items:[],exported:false};
}
db.transactions ||= [];
for (const [i,name] of samples.entries()) {
  if (i===2) continue;
  const id="demo"+i;
  db.transactions.push(entry(id+"-in",id,i===3?0:10,"deposit",i===1?1234567.89:50,"Einzahlung in die Barkasse"));
  if (i===3) continue;
  for(let j=0;j<(i===1?1000:i===0?6:1);j++) {
    const descriptions=i===1?["Erstattung der Getränke für den gemeinsamen Abschlussabend der Semesterantrittsveranstaltung mit der Altherrenschaft","Abrechnung Getränke – Öffentlichkeitsarbeitsausschusssitzung"]:["Getränke zur Fuxenkneipe","Aktivenessen · Pastaabend","Bier und Limo","Getränke zur Ankneipe","Mineralwasser","Apfelschorle"];
    db.transactions.push(entry(id+"-"+j,id,i===1?j%170:j,"purchase",j===0?4.5:1.5,descriptions[j%descriptions.length]));
  }
}
fs.writeFileSync(dbFile,JSON.stringify(db));
for (const fixture of ["ui-fixtures.html","catalog-fixtures.html","gnucash-fixtures.html"]) {
  fs.copyFileSync(path.join(__dirname,fixture),path.join(tmp,"public",fixture));
}
const server=spawn(process.execPath,["update-manager/manager.js"],{cwd:tmp,env:{...process.env,BW_HOST:"127.0.0.1",BW_PORT:port,BW_ADMIN_PIN:"246810"},stdio:"inherit"});
process.on("SIGTERM",()=>server.kill()); process.on("SIGINT",()=>server.kill());
server.on("exit",code=>{fs.rmSync(tmp,{recursive:true,force:true});process.exitCode=code || 0;});
