"use strict";
const crypto=require("node:crypto");
const {eventLabel, normalizedName} = require("./event-mode");
const {splitCents}=require("./book-format");
const digest=value=>crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
const norm=s=>String(s||"").normalize("NFC").trim().replace(/\s+/g," ").toLocaleLowerCase("de");
const leaf=p=>p.split(":").at(-1);
const codeOf=p=>leaf(p).match(/^(\d+)\s/)?.[1] || "";
const parent=p=>p.slice(0,p.lastIndexOf(":"));
const specialNames={"1800":"Verrechnung Philister","4620":"Arbeitseinsatz","4640":"Grillkohle / Löschbier","4730":"Gast / Mitgliederwerbung"};
function kindOf(a,g){
  if(a.hidden || a.placeholder) return "";
  const code=a.code||codeOf(a.path);
  if(parent(a.path)===g.memberPrefix && /^\d{5}$/.test(code)) return "person";
  if(parent(a.path)===g.eventAccount && /^4[0-5]\d\d$/.test(code)) return "event";
  if((parent(a.path)===g.eventAccount && specialNames[code]) || (code==="1800" && /Verrechnungskonto Phil/i.test(leaf(a.path))) || a.path===g.cashAccount) return "collective";
  return "";
}
function descriptor(a,g) {
  const kind=kindOf(a,g), code=a.code || codeOf(a.path), label=leaf(a.path).replace(/^\d+\s+/,"");
  const name=kind==="collective"?(a.path===g.cashAccount?"Barzahler":specialNames[code]):label;
  const surname=name.includes(",")?name.split(",")[0].trim():name.split(/\s+/).at(-1);
  return {kind,name,surname,code,path:a.path,guid:a.guid||""};
}
function personKey(name) {
  const plain=name.replace(/^\d+\s+/,"");
  const comma=plain.indexOf(",");
  return norm(comma<0?plain:plain.slice(comma+1)+" "+plain.slice(0,comma));
}
function planAccounts(book,db,g) {
  const input=book.accounts.filter(a=>kindOf(a,g)), plans=[], conflicts=[], resolved=new Map(), used=new Map();
  const counts=new Map();
  for(const a of input){const d=descriptor(a,g); const k=d.kind+":"+d.code; counts.set(k,(counts.get(k)||0)+1);}
  for(const a of input){
    const d=descriptor(a,g);
    const uniqueCode=counts.get(d.kind+":"+d.code)===1;
    const pool=db.accounts.filter(x=>!x.isSystem && Boolean(x.isEvent)===(d.kind!=="person"));
    const reserved=pool.find(x=>x.bookProposed && x.gnucashAccount!==d.path && parent(x.gnucashAccount)===parent(d.path) && codeOf(x.gnucashAccount)===d.code);
    if(reserved)conflicts.push("Nummer "+d.code+" auch für "+reserved.name+" vorgemerkt. Vor dem BW-Export dessen Kontenzuordnung korrigieren.");
    const samePath=pool.filter(x=>x.gnucashAccount===d.path);
    const sameIdentity=pool.filter(x=>(d.guid && x.bookGuid===d.guid) || (uniqueCode && !x.bookGuid && !x.bookProposed && x.gnucashAccount && parent(x.gnucashAccount)===parent(d.path) && codeOf(x.gnucashAccount)===d.code));
    const sameName=pool.filter(x=>(personKey(x.name)===personKey(d.name) ||
      (d.kind==="event" && x.permanent && normalizedName(eventLabel(x))===normalizedName(eventLabel(d)))) &&
      (!x.gnucashAccount || x.gnucashAccount===d.path));
    // A Kneipen account can have several shortcuts already mapped to 4150.
    // Link its canonical, as yet unmapped template before adding another event.
    const namedEvent = d.kind === "event" && samePath.length && sameName.length === 1 &&
      !samePath.some(x => personKey(x.name) === personKey(d.name)) ? sameName : null;
    let matches=namedEvent || (samePath.length?samePath:sameIdentity.length?sameIdentity:sameName);
    if(d.kind!=="person" && matches.length>1){
      const exact=matches.filter(x=>norm(x.name)===norm(d.name));
      if(exact.length===1)matches=exact;
      else if(matches.every(x=>x.gnucashAccount===d.path))matches=[]; // add one canonical event in addition to register shortcuts
    }
    const match=matches[0];
    if(matches.length>1 || (match && (match.deleted || used.has(match.id))) || (!match && db.accounts.some(x=>norm(x.name)===norm(d.name)))){
      conflicts.push(d.path+" (Name oder Zuordnung nicht eindeutig)");continue;
    }
    const id=match?.id || digest(["book-account",d.path]).slice(0,24);
    used.set(id,d.path);
    const action=!match?"create":match.gnucashAccount!==d.path || (d.kind==="person" && personKey(match.name)!==personKey(d.name)) || (d.guid && match.bookGuid!==d.guid)?"link":"known";
    plans.push({...d,id,action});resolved.set(d.path,{...d,id});
  }
  // Explicit manual assignments may live outside the standard chart.
  for(const a of db.accounts.filter(a=>a.gnucashAccount && !a.deleted && !a.isSystem))
    if(!resolved.has(a.gnucashAccount) && !input.some(x=>x.path===a.gnucashAccount))
      resolved.set(a.gnucashAccount,{kind:a.isEvent?"event":"person",id:a.id,name:a.name,path:a.gnucashAccount});
  return {plans,conflicts,resolved};
}
function planBookings(book,db,g,resolved,bookDate) {
  const candidates=[], notices=[], known=db.settings.bookEntries||{};
  const oldDeposits=new Map();
  for(const t of db.transactions.filter(t=>t.bookImportId))oldDeposits.set(t.bookImportId+"/"+t.accountId,t);
  let already=0;
  for(const t of book.transactions){
    if(!t.eur || t.voided || /BW-ID [0-9a-f]{32}/i.test(t.notes)) continue;
    const paths=t.splits.map(s=>s.path);
    const isMeal=/(aktiven\s*essen|aktiven[- ]?mahl)/i.test(t.description) || (paths.includes(g.mealAccount) && paths.every(p=>p===g.mealAccount || resolved.get(p)?.kind==="person" || p===db.settings.xxxCardAccountNumber));
    const bw=paths.includes(g.revenueDrinks);
    const money=p=>p===g.cashAccount || p===g.bankAccount;
    const isPayment=!bw && !isMeal && paths.some(money) && paths.some(p=>resolved.get(p)?.kind==="person") && paths.every(p=>money(p)||resolved.get(p)?.kind==="person");
    if(!bw && !isMeal && !isPayment) continue;
    if(/semesterabschluss|abschlussbuchung|eröffnungsbilanz/i.test(t.description))continue;
    try{
      const date=bookDate(t.date);
      const parts=t.splits.map(s=>({path:s.path,cents:splitCents(s),memo:s.memo||"",account:resolved.get(s.path)})).filter(s=>s.cents!==0);
      if(!parts.length || parts.reduce((n,s)=>n+s.cents,0)!==0) throw Error("Buchung unvollständig oder unausgeglichen");
      const hash=digest([date,t.number,t.description,parts.map(s=>[s.path,s.cents,s.memo]).sort()]);
      if(known[t.id]){
        if(known[t.id]!==hash) throw Error("bereits übernommene Buchung wurde in GnuCash geändert");
        already++;continue;
      }
      const signature=digest([date,t.number.trim(),norm(t.description),parts.map(s=>[s.path,s.cents]).sort()]);
      const other=db.settings.bookSignatures?.[signature];
      if(other && other!==t.id)throw Error("gleiche Buchung bereits mit anderer ID übernommen – Beleg prüfen");
      const common={id:t.id,date,number:t.number,description:t.description,hash,signature};
      const adjustment=isMeal && parts.some(s=>s.cents<0 && s.path===g.mealAccount);
      if(adjustment || (bw && parts.some(s=>s.path!==g.revenueDrinks && !s.account))){
        const ref=adjustment?g.mealAccount:g.revenueDrinks;
        const amount=parts.filter(s=>s.path===ref).reduce((v,s)=>v+s.cents,0);
        candidates.push({...common,key:t.id,kind:"ledger",amount,ref,lines:[],parts:parts.map(s=>({path:s.path,cents:s.cents,memo:s.memo}))});
      }else if(isMeal){
        const payer=parts.filter(s=>s.cents<0);
        const isCard=p=>p===db.settings.xxxCardAccountNumber && p;
        if(!payer.length || payer.some(s=>!(s.account?.kind==="person" || isCard(s.path) || money(s.path) || codeOf(s.path)==="0350"))) throw Error("Ausleger bitte prüfen");
        const payouts=payer.map(s=>({id:isCard(s.path)?db.settings.xxxCardInternalAccountId:s.account?.kind==="person"?s.account.id:null,
          name:s.account?.kind==="person"?s.account.name:leaf(s.path),path:s.path,cents:-s.cents,kind:isCard(s.path)?"card":s.account?.kind==="person"?"person":"external"}));
        const debit=parts.filter(s=>s.cents>0);
        if(debit.some(s=>s.path!==g.mealAccount && s.path!==g.guestAccount && s.account?.kind!=="person")) throw Error("zusätzliches Gegenkonto im Essen");
        const contributions=debit.filter(s=>s.account?.kind==="person");
        candidates.push({...common,key:t.id,kind:"meal",guestShare:debit.filter(s=>s.path===g.guestAccount).reduce((v,s)=>v+s.cents,0),amount:payouts.reduce((n,s)=>n+s.cents,0),subsidy:debit.filter(s=>s.path===g.mealAccount).reduce((v,s)=>v+s.cents,0),
          payouts,
          lines:contributions.map(s=>({id:s.account.id,cents:s.cents,memo:s.memo}))});
      }else if(bw){
        const rest=parts.filter(s=>s.path!==g.revenueDrinks);
        if(!rest.length || rest.some(s=>!s.account)) throw Error("Gegenkonto außerhalb der eingerichteten BW-Konten");
        candidates.push({...common,key:t.id,kind:"bw",amount:rest.reduce((v,s)=>v+s.cents,0),lines:rest.map(s=>({id:s.account.id,cents:s.cents,memo:s.memo,event:s.account.kind!=="person"}))});
      }else{
        if(parts.some(s=>money(s.path)?s.cents<=0:s.cents>=0)) continue;
        const per=new Map();
        for(const s of parts.filter(s=>!money(s.path)))per.set(s.account.id,(per.get(s.account.id)||0)-s.cents);
        for(const [id,amount] of per){
          const key=t.id+"/"+id, old=oldDeposits.get(key);
          if(old){if(Math.round(old.total*100)!==amount || date!==old.date.slice(0,10))throw Error("übernommene Einzahlung geändert");already++;continue;}
          const person=db.accounts.find(a=>a.id===id)||[...resolved.values()].find(a=>a.id===id);
          candidates.push({...common,key,kind:"payment",label:person.name,amount,lines:[{id,cents:-amount}]});
        }
      }
    }catch(err){notices.push([t.number,t.description,err.message].filter(Boolean).join(" · "));}
  }
  return {candidates,notices,already};
}
function applyBookings(entries,db,newId){
  db.settings.bookEntries ||= {};
  db.settings.bookSignatures ||= {};
  for(const e of entries){
    const mealId=e.kind==="meal"?newId():undefined;
    const base={date:e.date+"T12:00:00.000Z",description:e.description,items:[],exported:true,sourceBookGuid:e.id};
    for(const line of e.lines)db.transactions.push({...base,id:newId(),accountId:line.id,type:line.cents>=0?"purchase":"deposit",
      total:Math.abs(line.cents)/100,activeMealId:mealId,eventSettled:line.event||undefined,bookImportId:e.kind==="payment"?e.id:undefined});
    if(e.kind==="ledger"){
      db.ledgerEntries.push({id:newId(),date:e.date,number:e.number,description:e.description,account:e.ref,
        counterAccount:[...new Set(e.parts.map(s=>s.path).filter(p=>p!==e.ref))].join(" + "),amount:e.amount/100,
        bookSplits:e.parts,note:e.parts.map(s=>s.path+" "+(s.cents/100).toFixed(2)).join(" | "),createdAt:base.date,exported:true,bookGuid:e.id});
    }
    if(mealId){
      const payouts=e.payouts.map(p=>({type:p.kind==="card"?"xxx-card":p.kind==="person"?"account":"external",accountId:p.id,name:p.name,gnucashAccount:p.path,amount:p.cents/100}));
      const payer=payouts[0];
      db.activeMeals.push({id:mealId,identifier:e.number || "GnuCash",name:e.description,date:e.date,total:e.amount/100,subsidy:e.subsidy/100,guestShare:e.guestShare/100,
        participants:e.lines.map(l=>({accountId:l.id,name:db.accounts.find(a=>a.id===l.id).name,price:l.cents/100,manual:true})),
        receipts:[],payer,payouts,exported:true,exportedAt:new Date().toISOString(),source:"GnuCash",createdAt:base.date,bookGuid:e.id});
      for(const pay of payouts.filter(p=>p.accountId))db.transactions.push({...base,id:newId(),accountId:pay.accountId,type:"deposit",total:pay.amount,activeMealId:mealId,activeMealPayout:true});
    }
    if(e.kind!=="payment"){db.settings.bookEntries[e.id]=e.hash;db.settings.bookSignatures[e.signature]=e.id;}
  }
}
module.exports={planAccounts,planBookings,applyBookings,codeOf,leaf,parent,personKey,digest};
