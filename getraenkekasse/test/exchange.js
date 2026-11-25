"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const {accountsCsv,readBook}=require("../book-format");
const {planAccounts,planBookings,applyBookings}=require("../book-sync");
const {prepareAccounts}=require("../book-exchange");
const {renderTransactions}=require("../gnucash-sync");
const g={memberPrefix:"Konten:Debitoren",eventAccount:"Veranstaltungen",revenueDrinks:"Aufwand:2000 Bierwart",
  mealAccount:"Veranstaltungen:4600 Essen",guestAccount:"Veranstaltungen:4730 Gäste",cashAccount:"Aktiva:1050 Nebenkasse",bankAccount:"Aktiva:1200 Bank"};
const path=g.memberPrefix+":10510 Muster, Lisa";
const event=g.eventAccount+":4116 Divali";
const tree=[{path:g.memberPrefix,code:"",type:"LIABILITY"},{path:g.eventAccount,code:"4",type:"EXPENSE"},
  {path,code:"10510",type:"LIABILITY"},{path:event,code:"4116",type:"EXPENSE"}];
const asBook=rows=>readBook(Buffer.from(accountsCsv(rows)));
const state=()=>({accounts:[],transactions:[],activeMeals:[],ledgerEntries:[],settings:{bookCatalog:Object.fromEntries(tree.map(a=>[a.path,a])),bookTreeLoaded:true}});
test("Neue BW-Konten erhalten stabile Nummern und GnuCash-Kontotypen",()=>{
  const db=state();
  db.accounts.push({id:"1",name:"Lisa Muster",surname:"Muster"},{id:"2",name:"Lena Neue",surname:"Neue"},
    {id:"3",name:"Diwali 01.03.2026",isEvent:true},{id:"4",name:"Hoffest",isEvent:true});
  const delta=prepareAccounts(db,g);
  assert.equal(db.accounts[0].gnucashAccount,path);assert.equal(db.accounts[2].gnucashAccount,event);
  assert.deepEqual(delta.map(a=>[a.code,a.type]),[["10511","LIABILITY"]]);
  assert.deepEqual(prepareAccounts(db,g),delta);
  const back=planAccounts(asBook(delta),db,g);assert.equal(back.conflicts.length,0);
  assert(back.plans.every(a=>a.action==="known"));
  for(const r of delta)db.settings.bookCatalog[r.path]=r;
  assert.deepEqual(prepareAccounts(db,g),[]);
});
test("Ein Essen mit Gastanteil, Zuschuss und zwei Auslegern wird einmal gebucht",()=>{
  const db=state(), p2=g.memberPrefix+":10511 Probe, Tim";
  const csv=renderTransactions([{source:"test",date:"2026-03-01",number:"SS26 U1",description:"Aktivenessen Pizza",currency:"EUR",
    postings:[[path,400],[g.mealAccount,800],[g.guestAccount,200],[path,-900],[p2,-500]]}]).replace(/BW-ID [a-f0-9]{32}/g,"");
  const book=readBook(Buffer.from(csv)),a=planAccounts(book,db,g);
  db.accounts=a.plans.map(x=>({id:x.id,name:x.name,gnucashAccount:x.path,isEvent:x.kind!=="person"}));
  const scan=()=>planBookings(book,db,g,a.resolved,s=>s);
  const result=scan();assert.equal(result.notices.length,0);assert.equal(result.candidates.length,1);
  let id=0;applyBookings(result.candidates,db,()=>String(++id));
  assert.equal(db.activeMeals[0].total,14);assert.equal(db.activeMeals[0].subsidy,8);assert.equal(db.activeMeals[0].guestShare,2);
  assert.deepEqual(db.activeMeals[0].payouts.map(p=>p.amount),[9,5]);
  assert(db.transactions.every(t=>t.exported));assert.equal(scan().candidates.length,0);
});

test("Veranstaltungsgruppen gelten auch mit Semester, Datum oder bestehender Kontenzuordnung",()=>{
  const {eventMode,activeDrinks}=require("../event-mode");
  const mode=(name,path)=>eventMode({isEvent:true,name,gnucashAccount:path});
  assert.equal(mode("Stiftungsfestkneipe 09.07.2026"),"direct");
  assert.equal(mode("Pauktag","Konten:1800 Verrechnungskonto Philisterverein"),"direct");
  assert.equal(mode("Verrechnung Philister","Konten:1800 Verrechnungskonto Philisterverein"),"collective");
  assert.equal(mode("Halloweenparty WS26"),"personal");
  assert.equal(mode("E/A Cocktailabend/Sommerparty"),"hidden");
  assert.equal(mode("Dürnstein"),"hidden");
  const expired={name:"Abgelaufen",expiresAt:"2000-01-01T00:00:00Z"}, old={name:"Vorhanden"};
  assert.deepEqual(activeDrinks({customDrinks:[expired,old]}),[old]);
});

test("Kneipen-Vorlage bleibt bei den bereits zugeordneten Kürzeln eindeutig",()=>{
  const target=g.eventAccount+":4150 Kneipen";
  const db=state();
  db.accounts=[
    {id:"an",name:"Ankneipe",isEvent:true,gnucashAccount:target},
    {id:"ab",name:"Abkneipe",isEvent:true,gnucashAccount:target},
    {id:"alle",name:"Kneipen",isEvent:true,permanent:true}
  ];
  const result=planAccounts(asBook([{path:target,code:"4150",type:"EXPENSE"}]),db,g);
  assert.deepEqual(result.conflicts,[]);
  assert.equal(result.plans[0].id,"alle");
});


test("Essenszuschuss wird auf den Cent und höchstens bis zum eigenen Anteil berechnet", () => {
  const split = require("../public/meal-allocation");
  const people = [
    {name:"Voll", role:"voll", cents:null},
    {name:"Aktiv", role:"aktiv", cents:null},
    {name:"Gast", role:"voll", collective:true, cents:null}
  ];
  const cheap = split(1001, people, 400);
  assert.deepEqual(cheap.rows.map(person=>person.cents), [334, 0, 0]);
  assert.equal(cheap.subsidy,667);
  assert.equal(cheap.difference,0);
  assert.equal(cheap.guestShare,0);
  const individual = split(3000, people.map((person,i)=>({...person,cents:i===0 ? 1100 : i===1 ? 500 : null})), 400);
  assert.deepEqual(individual.rows.map(person=>person.cents),[1100,500,600]);
  assert.equal(individual.difference,0);
});

test("Standardadressen für BW- und GnuCash-Namen und eine einzelne persönliche Adresse", () => {
  const {mailProfile, validAddress} = require("../debt-mail");
  for (const [name, surname, expected] of [
    ["Lisa Muster","Muster","lisa.muster"], ["10525 Muster, Lisa",undefined,"lisa.muster"],
    ["Groß, Jörg-Étienne","Groß","joerg-etienne.gross"], ["Lena von der Brücke","von der Brücke","lena.von.der.bruecke"],
    ["Ada","Muster","ada.muster"], ["Mononym","Mononym",""], ["","Test",""]
  ]) assert.equal(mailProfile({name,surname}).email, expected ? expected+"@uttenruthia.de" : "");
  assert(validAddress("max+verein@example.org"));
  for (const bad of ["a@example.org,b@example.org","a@example.org\r\nBcc:x@example.org","a..b@example.de","a@b.de?cc=x","a@b","@x.de"])
    assert.equal(validAddress(bad), false);
});
