"use strict";
const {gunzipSync} = require("node:zlib");
const {SaxesParser} = require("saxes");
const {readCsv, readCents, quote} = require("./gnucash-sync");
const columns = ["Type","Full Account Name","Account Name","Account Code","Description","Account Color","Notes","Symbol","Namespace","Hidden","Tax Info","Placeholder"];
function accountsCsv(accounts) {
  const rows = accounts.map(a=>[a.type,a.path,a.path.split(":").at(-1),a.code,"","","","EUR","CURRENCY","F","F","F"]);
  return [columns,...rows].map(r=>r.map(quote).join(",")).join("\r\n")+"\r\n";
}
function csvBook(text) {
  const [h,...rows] = readCsv(text);
  if (!h) throw Error("Die Datei ist leer.");
  if (/^(type|typ|kontoart|kontotyp|art)$/i.test(h[0]) && /konto|account/i.test(h[1])) {
    const accounts=rows.map(r=>{
      if(r.length!==h.length || !r[1]) throw Error("Ungültige Zeile im Kontenexport.");
      return {path:r[1],code:r[3],type:r[0],hidden:/^(T|true|1|j|w)$/i.test(r[9]),placeholder:/^(T|true|1|j|w)$/i.test(r[11])};
    });
    return {accounts,transactions:[],tree:true};
  }
  if(h.length!==18 || !/(buchung|transaction|transaktion).*id/i.test(h[1])) throw Error("GnuCash-Datei, Konten-CSV oder mehrzeilige Buchungs-CSV wählen (Simple Layout aus).");
  const accounts=new Map(), groups=new Map();
  let id;
  for(const r of rows) {
    id=r[1]?.toLowerCase() || id;
    if(r.length!==18 || !/^[a-f\d]{32}$/.test(id||"") || !r[9]) throw Error("Ungültige Splitzeile in der Buchungs-CSV.");
    if(!groups.has(id)) groups.set(id,{id,date:r[0],number:r[2],description:r[3],notes:r[4],eur:["CURRENCY::EUR","EUR"].includes(r[5]),voided:!!r[6],splits:[]});
    const tx=groups.get(id);
    tx.splits.push({path:r[9],raw:r[14],memo:r[8]});
    accounts.set(r[9],{path:r[9],code:r[10].match(/^(\d+) /)?.[1]||""});
  }
  return {accounts:[...accounts.values()],transactions:[...groups.values()],tree:false};
}
function xmlBook(text) {
  const parser=new SaxesParser(), stack=[], accounts=[], transactions=[];
  const snapshot = new Map(), eventSnapshot = new Map();
  let bookId = "", snapshotDate = "", statementDate = "", eventSnapshotDate = "";
  let current, split, books=0, root;
  parser.on("doctype",()=>{throw Error("Unerwarteter Dokumenttyp.");});
  parser.on("opentag",tag=>{
    if(!stack.length) root=tag.name;
    stack.push({name:tag.name,text:""});
    if(tag.name==="gnc:book") books++;
    if(tag.name==="gnc:account") current={kind:"account"};
    if(tag.name==="gnc:transaction") current={kind:"tx",splits:[]};
    if(tag.name==="trn:split" && current?.kind==="tx") split={};
  });
  parser.on("text",v=>{if(stack.length) stack.at(-1).text+=v;});
  parser.on("closetag",tag=>{
    const {text:v}=stack.pop(), n=tag.name, parent=stack.at(-1)?.name;
    if (parent === "gnc:book" && n === "book:id") bookId = v.trim();
    if (parent === "gnc:book" && n === "bw:snapshot-date") snapshotDate = v;
    if (parent === "gnc:book" && n === "bw:statement-date") statementDate = v;
    if (parent === "gnc:book" && n === "bw:event-snapshot-date") eventSnapshotDate = v;
    if (parent === "gnc:book" && (n === "bw:balance" || n === "bw:event-balance")) {
      const totals = n === "bw:balance" ? snapshot : eventSnapshot;
      const cents = Number(v);
      if (!Number.isSafeInteger(cents) || !/^-?\d+$/.test(v) || !tag.attributes.path || totals.has(tag.attributes.path))
        throw Error("Ungültiger GnuCash-Saldostand.");
      totals.set(tag.attributes.path, cents);
    }
    if(!current) return;
    if(current.kind==="account"){
      if(parent==="gnc:account") current[n]=v;
      if(parent==="act:commodity" && n==="cmdty:id") current.commodity=v;
      if(n==="slot:value" && ["hidden","placeholder"].includes(current.slot)) current[current.slot]=v==="true";
      if(n==="slot:key") current.slot=v;
      if(n==="slot") current.slot="";
      if(n==="gnc:account"){accounts.push(current);current=null;}
    } else {
      if(split && parent==="trn:split") split[n]=v;
      if(n==="trn:split"){current.splits.push(split);split=null;}
      if(parent==="gnc:transaction") current[n]=v;
      if(parent==="trn:date-posted" && n==="ts:date") current.date=v.slice(0,10);
      if(parent==="trn:currency" && n==="cmdty:id") current.eur=v==="EUR";
      if(n==="slot:key") current.slot=v;
      if(n==="slot:value" && current.slot==="notes" && !split) current.notes=v;
      if(n==="slot:value" && current.slot==="void-reason") current.voided=true;
      if(n==="slot") current.slot="";
      if(n==="gnc:transaction"){transactions.push(current);current=null;}
    }
  });
  parser.write(text).close();
  if(root!=="gnc-v2" || books!==1) throw Error("Eine GnuCash-XML-Datei mit genau einem Buch wählen.");
  const ids=new Map(accounts.map(a=>[a["act:id"],a]));
  function accountPath(a,depth=0) {
    if(!a || depth>80) throw Error("Unvollständiger Kontenbaum.");
    if(a.path!==undefined) return a.path;
    const parent=a["act:parent"];
    const prefix=parent?accountPath(ids.get(parent),depth+1):"";
    return a.path=a["act:type"]==="ROOT"?"":[prefix,a["act:name"]].filter(Boolean).join(":");
  }
  return {tree:true,bookAccounts:true,bookId,snapshot,snapshotDate,statementDate,eventSnapshot,eventSnapshotDate,accounts:accounts.filter(a=>a["act:type"]!=="ROOT").map(a=>({
    path:accountPath(a),code:a["act:code"]||"",type:a["act:type"],commodity:a.commodity,guid:a["act:id"],placeholder:a.placeholder,hidden:a.hidden})),
    transactions:transactions.map(t=>({id:t["trn:id"],date:t.date,number:t["trn:num"]||"",description:t["trn:description"]||"",
      notes:t.notes||"",eur:t.eur,voided:t.voided,splits:t.splits.map(s=>({path:accountPath(ids.get(s["split:account"])),fraction:s["split:value"],quantity:s["split:quantity"],memo:s["split:memo"]||""}))}))};
}
function readBook(buffer) {
  if(!Buffer.isBuffer(buffer)) throw Error("Datei wählen.");
  if(buffer[0]===31 && buffer[1]===139) buffer=gunzipSync(buffer,{maxOutputLength:64*1024*1024});
  const txt=buffer.toString("utf8").replace(/^\uFEFF/,"").trimStart();
  if(txt.startsWith("SQLite format")) throw Error("Für ein SQLite-Buch bitte den Konten- oder Buchungsexport als CSV verwenden.");
  return txt.startsWith("<")?xmlBook(txt):csvBook(txt);
}
function splitCents(s) {
  if(!s.fraction) return readCents(s.raw);
  const [num,den]=s.fraction.split("/").map(BigInt);
  if(!den || num*100n%den!==0n) throw Error("Betrag nicht in ganzen Cent.");
  const cents=Number(num*100n/den);
  if(!Number.isSafeInteger(cents)) throw Error("Betrag zu groß.");
  return cents;
}
module.exports={readBook,accountsCsv,splitCents};
