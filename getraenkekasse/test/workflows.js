"use strict";
const assert = require("node:assert/strict");
const {test} = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {spawn} = require("node:child_process");
const {once} = require("node:events");
const {lanConfig} = require("../lan");
const {renderTransactions} = require("../gnucash-sync");
const {readBook, splitCents} = require("../book-format");
const { PDFDocument } = require("pdf-lib");
const root = path.resolve(__dirname,"..");

test("Lokale Schnittstelle und Netzmaske", () => {
  assert.throws(()=>lanConfig("0.0.0.0"));
  const allow = lanConfig("192.168.9.3",{lan:[{family:"IPv4",address:"192.168.9.3",netmask:"255.255.255.0"}]});
  const status = ip => {
    let result;
    allow({socket:{remoteAddress:ip},headers:{host:"192.168.9.3:3000"}},{status(n){result=n;return this},send(){}},()=>result=200);
    return result;
  };
  assert.equal(status("192.168.9.10"),200);
  assert.equal(status("192.168.10.10"),403);
});
async function startTestServer(t, db) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(),"bierwart-test-"));
  for (const item of ["server.js","bar-catalog.js","bar-pdf.js","pdf-text.js","debt-mail.js","meal-pdf.js","forms","fonts","event-mode.js","book-format.js","book-sync.js","book-exchange.js","lan.js","gnucash-sync.js","config.json","public","assets"]) fs.cpSync(path.join(root,item),path.join(tmp,item),{recursive:true});
  fs.mkdirSync(path.join(tmp,"data"));
  if (db) fs.writeFileSync(path.join(tmp, "data/db.json"), JSON.stringify(db));
  const server = spawn(process.execPath,["server.js"],{cwd:tmp,env:{...process.env,BW_PORT:"0",BW_HOST:"127.0.0.1",BW_ADMIN_PIN:"778899",NODE_PATH:path.join(root,"node_modules")},stdio:["ignore","pipe","inherit"]});
  t.after(async () => { if(server.exitCode===null){server.kill();await once(server,"exit");} fs.rmSync(tmp,{recursive:true,force:true}); });
  const [line] = await once(server.stdout,"data");
  const base = String(line).match(/http:\/\/\S+/)[0];
  const admin = {"X-Admin-Pin":"778899"};
  async function call(endpoint,body,headers=admin,method=body===undefined?"GET":"POST",status=200) {
    const r=await fetch(base+endpoint,{method,headers:{"Content-Type":"application/json",...headers},body:body===undefined?undefined:JSON.stringify(body)});
    const result = r.headers.get("content-type")?.includes("json")?await r.json():await r.text();
    assert.equal(r.status,status,JSON.stringify(result));
    return result;
  }
  return {call, base, admin, tmp};
}

test("Strichliste gruppiert Altbestände, Couleur bucht auf GnuCash 1800", async t => {
  const people = ["Anna", "Beat", "Clara", "Dora", "Eva", "Fritz"];
  const path1800 = "Bestandskonten:Philisterverein";
  const accounts = people.map(name => ({id:name, name, priority:name === "Anna"}));
  const events = ["Gast / Mitgliederwerbung", "Löschbier / Grillkohle", "Verrechnung Philister", "Divali"];
  accounts.push(...events.map(name => ({id:name, name, isEvent:true, permanent:true})));
  const purchase = (accountId, days, fields = {}) => ({
    id:accountId, accountId, type:"purchase", date:new Date(Date.now() - days * 864e5).toISOString(),
    items:[], total:1, exported:true, ...fields
  });
  const transactions = [purchase("Anna", 1), purchase("Beat", 6.99), purchase("Clara", 7.01),
    purchase("Dora", 0, {type:"deposit"}), purchase("Eva", -1), purchase("Fritz", 0, {sourceBookGuid:"import"})];
  const {call, admin} = await startTestServer(t, {accounts, transactions, settings:{bookCatalog:{[path1800]:{code:"1800"}}}});
  const tally = await call("/api/tally/accounts");
  assert.deepEqual(tally.map(a => [a.name, a.group]), [
    ["Couleur","collective"], ["Gast","collective"], ["Löschbier","collective"], ["Philister","collective"],
    ["Anna","priority"], ["Beat","recent"], ...people.slice(2).map(name => [name,"other"])]);
  assert.equal(tally.find(a => a.name === "Gast").id, events[0]);
  assert.equal(tally.find(a => a.name === "Beat").activeLast24Hours, false);
  assert.deepEqual((await call("/api/tally/accounts?event=Divali")).map(a => a.name), people);
  const couleur = tally[0];
  const mapping = "/api/admin/gnucash/accounts";
  assert.equal((await call(mapping)).find(a => a.id === couleur.id).path, path1800);
  await call(mapping + "/" + couleur.id, {path:"Konten:1801 Falsch"}, admin, "PUT", 400);
  await call("/api/purchase", {accountId:couleur.id, items:[{name:"Bier",qty:1}]});
  const endpoint = "/api/admin/export-runs";
  const run = await call(endpoint, {});
  const book = readBook(Buffer.from(await call(endpoint + "/" + run.id + "/csv")));
  const debit = book.transactions[0].splits.find(s => s.path === path1800);
  assert.equal(splitCents(debit), 150);
});

test("Konto, Buchungslauf und GnuCash-Rückimport", async t => {
  const {call, base, admin, tmp} = await startTestServer(t);
  const dummy=await call("/api/accounts",{name:"Temporärer Test",surname:"Test"});
  const login=await call("/api/login",{name:"Temporärer Test",password:"Test"});
  const del="/api/admin/accounts/"+dummy.id;
  const authDummy={Authorization:"Bearer "+login.token};
  await call(del,undefined,authDummy,"DELETE",401);
  await call(del,undefined,admin,"DELETE");
  assert(!(await call("/api/accounts")).some(a=>a.id===dummy.id));
  await call("/api/me",undefined,authDummy,"GET",401);
  await call("/api/login",{name:"Temporärer Test",password:"Test"},{},"POST",401);
  const used=await call("/api/accounts",{name:"Test mit Buchung",surname:"Buchung"});
  for(const amount of [1,-1])await call("/api/admin/deposit",{accountId:used.id,amount});
  await call("/api/admin/accounts/"+used.id,undefined,admin,"DELETE",409);
  const catalog=await call("/api/admin/accounts");
  for(const account of [catalog.find(a=>a.isSystem),catalog.find(a=>a.isEvent)]){
    await call("/api/admin/accounts/"+account.id,undefined,admin,"DELETE",409);
  }
  // Commit the two independent test deposits before the original workflow.
  const deposits=await call("/api/admin/export-runs",{});
  await call("/api/admin/export-runs/"+deposits.id+"/commit",{});
  const name="Ada von Test";
  const a=await call("/api/accounts",{name,surname:"von Test"});
  await call("/api/login",{name,password:"Test"},{}, "POST",401);
  const {token}=await call("/api/login",{name,password:"von Test"});
  const auth={Authorization:"Bearer "+token};
  assert.equal((await call("/api/me",undefined,auth)).account.initialPassword,true);
  await call("/api/me/password",{oldPassword:"von Test",newPassword:"persönlich"},auth);
  assert.equal((await call("/api/me",undefined,auth)).account.initialPassword,false);
  const reminderPath = "/api/xxx/debt-mails";
  const previewPath = reminderPath + "/preview";
  assert.equal((await call("/api/me",undefined,auth)).account.email,"ada.von.test@uttenruthia.de");
  await call("/api/me/email",{email:"a@example.de"},{},"PUT",401);
  await call("/api/me/email",{email:"a@example.de,b@example.de"},auth,"PUT",400);
  const ownMail = await call("/api/me/email",{email:"ada+privat@example.org",accountId:used.id},auth,"PUT");
  assert(ownMail.customEmail);
  assert.equal((await call("/api/me",undefined,auth)).account.email,ownMail.email);
  assert(!(await call("/api/accounts")).some(row => row.email || row.emailOverride));
  await call(reminderPath,undefined,{},"GET",401);
  await call(reminderPath,undefined,auth,"GET",403);
  await call(previewPath,{accountIds:[a.id]},auth,"POST",403);
  await call("/api/admin/flags",{accountId:a.id,uebersicht:true});
  await call(reminderPath,undefined,auth,"GET",403);
  await call("/api/admin/flags",{accountId:a.id,gnucash:true});
  assert.deepEqual(await call(reminderPath,undefined,auth),[]);
  await call("/api/admin/deposit",{accountId:a.id,amount:"-9,87"});
  const [candidate] = await call(reminderPath,undefined,auth);
  assert.equal(candidate.amountCents,987);
  const reminder = await call(previewPath,{accountIds:[a.id,a.id,used.id],amountCents:1,email:"fake@example.org"},auth);
  assert.equal(reminder.skipped,1);
  assert.deepEqual(reminder.drafts.map(d=>d.to),[ownMail.email]);
  assert.match(reminder.drafts[0].body,/9,87\s€ offen/);
  await call("/api/admin/deposit",{accountId:a.id,amount:"9,87"});
  assert.deepEqual((await call(previewPath,{accountIds:[a.id]},auth)).drafts,[]);
  assert.equal((await call("/api/me/email",{email:""},auth,"PUT")).email,ownMail.defaultEmail);
  const mailTestRun=await call("/api/admin/export-runs",{});
  await call("/api/admin/export-runs/"+mailTestRun.id+"/commit",{});
  await call("/api/admin/flags",{accountId:a.id,gnucash:false,uebersicht:false});
  await call(reminderPath,undefined,auth,"GET",403);
  const personal="Personen:10001 Test, Ada";
  await call("/api/admin/gnucash/accounts/"+a.id,{path:personal},admin,"PUT");
  const endpoint="/api/admin/export-runs";
  await call("/api/purchase",{accountId:a.id,items:[{name:"Bier",qty:2}]});
  await call("/api/admin/deposit",{accountId:a.id,amount:"5,00"});
  const run=await call(endpoint,{});
  assert.deepEqual(run.counts,{purchases:1,deposits:1,ledger:0,meals:0,rows:4});
  const output=await call(endpoint+"/"+run.id+"/csv");
  assert.equal(output,await call("/api/admin/export"));
  await call(endpoint,{},admin,"POST",409);
  await call("/api/purchase",{accountId:a.id,items:[{name:"Bier",qty:1}]});
  const plugin="/api/admin/bw-plugin";
  const book="a".repeat(32), client="b".repeat(32);
  const hash=require("node:crypto").createHash("sha256").update(output).digest("hex");
  const proof={book,client,hash,run:run.id};
  assert.equal((await call(plugin+"/state",{book})).paired,false);
  await call(plugin+"/pair",{book});
  await call(plugin+"/state",{book:"c".repeat(32)},admin,"POST",409);
  await call(plugin+"/claim",{...proof,hash:"old"},admin,"POST",409);
  await call(plugin+"/ack",proof,admin,"POST",409);
  await call(plugin+"/claim",proof);
  await call(plugin+"/claim",{...proof,client:"d".repeat(32)},admin,"POST",409);
  await call(endpoint+"/"+run.id+"/discard",{},admin,"POST",409);
  await call(endpoint+"/"+run.id+"/commit",{},admin,"POST",409);
  await call(plugin+"/claim",proof);
  await call(plugin+"/ack",proof);
  assert.equal((await call(plugin+"/ack",proof)).committed,true);
  assert.equal((await call(endpoint)).pending.purchases,1);
  const second=await call(endpoint,{});
  await call(endpoint+"/"+second.id+"/discard",{});
  assert.equal((await call(endpoint)).pending.purchases,1);
  const settings=(await call("/api/admin/gnucash/settings")).settings;
  const payments="/api/admin/gnucash/payments";
  assert.equal((await call(payments,{csv:output})).candidates.length,0);
  function external(amount){
    return renderTransactions([{source:"native-test-id",number:"",date:"2026-08-31",description:'BW, "bar"',currency:"EUR",postings:[[settings.bankAccount,amount],[personal,-amount]]}]).replace(/BW-ID [a-f0-9]{32}/g,"");
  }
  const csv=external(1500);
  const preview=await call(payments,{csv});
  assert.equal(preview.candidates[0].cents,1500);
  const body={csv,preview:preview.preview,selected:[preview.candidates[0].key]};
  assert.equal((await call(payments,body)).booked,1);
  assert.equal((await call(payments,{csv})).known,1);
  await call(payments,body,admin,"POST",409);
  await call(payments,{csv:external(1600)},admin,"POST",409);
  assert.equal((await call("/api/me",undefined,auth)).account.balance,15.5);
  assert.equal((await call(endpoint)).pending.deposits,0);
  // An Aktivenessen spans multiple postings and keeps its own semester reference.
  const image=fs.readFileSync(path.join(tmp,"assets/res/Bier_Foto.png"));
  const uploaded=await fetch(base+"/api/active-meals/upload?type=image/png",{method:"POST",body:image,headers:{"Content-Type":"application/octet-stream"}});
  const receipt=await uploaded.json();
  const meals="/api/admin/active-meals/";
  for(const [date,semester] of [["2026-02-28","WS25"],["2026-03-01","SS26"],["2026-08-31","SS26"],["2026-09-01","WS26"]]){
    const {meal}=await call("/api/active-meals",{name:"Testessen",date,total:3,participants:[{accountId:a.id}],payerKind:"account",payerAccountId:a.id,receipts:[receipt.file]});
    assert.ok(meal.identifier.startsWith(semester));
    const single=await call(meals+meal.id+"/export");
    const active=(await call(endpoint)).open;
    assert.equal(single,await call(endpoint+"/"+active.id+"/csv"));
    await call(meals+meal.id+"/payer",{payerKind:"account",payerAccountId:a.id},admin,"PUT",409);
    await call(endpoint+"/"+active.id+"/commit",{});
  }
  const party=(await call("/api/events")).find(a=>a.name==="Divali");
  const direct=(await call("/api/events")).find(a=>a.name==="Abkneipe");
  const income="Veranstaltungen:4116 Divali";
  await call("/api/admin/gnucash/accounts/"+party.id,{path:income},admin,"PUT");
  await call("/api/admin/gnucash/accounts/"+direct.id,{path:"Veranstaltungen:4150 Kneipen"},admin,"PUT");
  for (const id of [direct.id, party.id]) {
    const where = "/api/events/" + id + "/drinks";
    const before = Date.now();
    const added = await call(where, {name:"Nur hier", price:"3,00"});
    const expiry = Date.parse(added.customDrinks.find(d => d.name === "Nur hier").expiresAt);
    assert(expiry >= before + 864e5 && expiry <= Date.now() + 864e5);
    await call("/api/temporary-drinks", {name:"Nur hier", price:"2,00"}, admin, "POST", 409);
    await call(where + "/remove", {name:"Nur hier"});
  }
  await call("/api/purchase", {accountId:a.id, items:[{name:"Bier", qty:1, price:0.01}]}, admin, "POST", 409);
  await call("/api/events/"+party.id+"/drinks",{name:"Testcocktail",price:"4,50"});
  const buy=(accountId,eventId,name)=>call("/api/purchase",{accountId,eventId,items:[{name,qty:1}]});
  await buy(a.id,party.id,"Testcocktail");
  await call("/api/purchase",{accountId:a.id,items:[{name:"Testcocktail",qty:1}]},admin,"POST",400);
  const outputFor=async run=>readBook(Buffer.from(await call(endpoint+"/"+run.id+"/csv"))).transactions;
  const partySale=(await outputFor(await call(endpoint,{}))).find(t=>t.description.includes("Testcocktail"));
  assert.deepEqual(partySale.splits.map(x=>x.path),[personal,income]);
  const previous=(await call(endpoint)).open;
  await call(endpoint+"/"+previous.id+"/discard",{});
  await buy(a.id,undefined,"Bier");
  await buy(direct.id,undefined,"Bier");
  const today=new Intl.DateTimeFormat("sv-SE",{timeZone:"Europe/Berlin"}).format(new Date());
  const batch=await call(endpoint,{summaryDate:today});
  const entries=await outputFor(batch);
  assert.equal(entries.length,2);
  const eventEntry=entries.find(t=>t.description.includes("Divali"));
  assert.deepEqual(eventEntry.splits.map(x=>x.path),[personal,income]);
  assert.deepEqual(eventEntry.splits.map(splitCents),[450,-450]);
  const normal=entries.find(t=>t.description==="BW-Schuldenabrechnung");
  assert.deepEqual(new Set(normal.splits.map(x=>x.path)),new Set([personal,"Veranstaltungen:4150 Kneipen",settings.revenueDrinks]));

  await call("/api/admin/gnucash/settings",{memberPrefix:"Personen",eventAccount:"Veranstaltungen"},admin,"PUT");
  const exchange="/api/admin/gnucash/exchange";
  const snapshot=`<gnc-v2><gnc:book>
    <book:id>${book}</book:id><bw:statement-date>${today}</bw:statement-date>
    <bw:event-snapshot-date>${today}</bw:event-snapshot-date><bw:event-balance path="${income}">0</bw:event-balance>
    <gnc:account><act:name>Veranstaltungen</act:name><act:id>4</act:id><act:type>EXPENSE</act:type></gnc:account>
    <gnc:account><act:name>4116 Divali</act:name><act:id>5</act:id><act:parent>4</act:parent>
      <act:code>4116</act:code><act:type>EXPENSE</act:type><act:commodity><cmdty:id>EUR</cmdty:id></act:commodity>
    </gnc:account>
    <gnc:account><act:name>Personen</act:name><act:id>1</act:id><act:type>LIABILITY</act:type></gnc:account>
    <gnc:account><act:name>10001 Test, Ada</act:name><act:id>2</act:id><act:parent>1</act:parent>
      <act:code>10001</act:code><act:type>LIABILITY</act:type><act:commodity><cmdty:id>EUR</cmdty:id></act:commodity>
    </gnc:account>
    <gnc:account><act:name>4730 Mitgliederwerbungskosten</act:name><act:id>6</act:id><act:parent>4</act:parent>
      <act:code>4730</act:code><act:type>EXPENSE</act:type><act:commodity><cmdty:id>EUR</cmdty:id></act:commodity>
    </gnc:account>
    <gnc:account><act:name>Anfangsbestand</act:name><act:id>3</act:id><act:type>EQUITY</act:type></gnc:account>
    <gnc:transaction><trn:id>aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaab</trn:id><trn:description>Anfangsbestand</trn:description>
      <trn:date-posted><ts:date>${today} 12:00:00 +0000</ts:date></trn:date-posted>
      <trn:currency><cmdty:id>EUR</cmdty:id></trn:currency>
      <trn:splits>
        <trn:split><split:account>2</split:account><split:value>-21352/100</split:value></trn:split>
        <trn:split><split:account>3</split:account><split:value>21352/100</split:value></trn:split>
      </trn:splits>
    </gnc:transaction></gnc:book></gnc-v2>`;

  async function readSnapshot(query="",status=200) {
    const response=await fetch(base+exchange+query,{method:"POST",headers:{...admin,"Content-Type":"application/octet-stream"},body:snapshot});
    const data=await response.json();
    assert.equal(response.status,status,JSON.stringify(data));
    return data;
  }
  async function useSnapshot(preview,status=200) {
    const selection=await call(exchange+"/selection",{preview:preview.preview,keys:["balance-sync"]});
    return readSnapshot("?preview="+preview.preview+"&selection="+selection.handle,status);
  }
  const locked=await readSnapshot();
  assert(locked.balanceBlocked);
  await useSnapshot(locked,409);
  await call(endpoint+"/"+batch.id+"/discard",{});
  const pending=(await call(endpoint)).pending;
  for (let attempt=0;attempt<2;attempt++) {
    const preview=await readSnapshot();
    assert(!preview.balanceBlocked);
    const match=preview.balances.find(account=>account.id===a.id);
    assert.equal(match.book,21352);
    assert(match.open<0);
    assert.equal(preview.eventBalanceCount,1);
    await useSnapshot(preview);
    const figures=(await call("/api/admin/accounts")).find(account=>account.id===party.id);
    assert.equal(figures.eventBookBalance,0);
    assert.equal(figures.eventPending,4.5);
    assert.equal(figures.eventTurnover,4.5);
    const me=await call("/api/me",undefined,auth);
    assert.equal(me.account.balance,match.target/100);
    const rows=me.statement.entries;
    const opening=rows.filter(entry=>entry.description==="Anfangsbestand");
    assert.equal(opening.length,1);
    assert.deepEqual(opening[0].counterAccounts,["Anfangsbestand"]);
    assert.equal(opening[0].amount,21352);
    assert.equal(rows[0].balance,match.target);
    assert(rows.some(entry=>entry.source==="Offen in BW"));
    assert(!rows.some(entry=>entry.description==="Saldenabgleich mit GnuCash"));
  }
  assert.deepEqual((await call(endpoint)).pending,pending);

  const mealOptions=await call("/api/active-meals/options");
  const guest=mealOptions.accounts.find(account=>account.collective);
  assert.equal(guest.name,"Gast / Mitgliederwerbung");
  assert.equal(mealOptions.subsidyPerPerson,4);
  await call("/api/admin/flags",{accountId:a.id,gnucash:true});
  const {meal: mixed}=await call("/api/active-meals",{name:"Äpfel und Käse",date:today,total:"30,01",allocation:"roles",
    participants:[{accountId:a.id,role:"voll"},{accountId:used.id,role:"aktiv"},{accountId:guest.id,role:"voll"}],
    payerKind:"account",payerAccountId:a.id,receipts:[receipt.file]});
  assert.equal(mixed.subsidy,8);
  assert.equal(mixed.guestShare,6);
  assert.deepEqual(mixed.participants.map(person=>[person.role,person.price]),[["voll",10.01],["aktiv",6],["kgast",6]]);
  assert.equal(mixed.subsidyPerPerson,4);
  await call("/api/admin/active-meals/settings",{subsidyPerPerson:"4,50"},auth,"PUT");
  assert.equal((await call("/api/active-meals/options")).subsidyPerPerson,4.5);
  await call("/api/active-meals",{name:"Alte Vorschau",date:today,total:30,allocation:"roles",subsidyPerPerson:4},
    admin,"POST",409);
  await call("/api/admin/active-meals/settings",{subsidyPerPerson:"-2"},auth,"PUT",400);
  const pdfRoute="/api/admin/active-meals/"+mixed.id+"/pdf";
  await call(pdfRoute,undefined,{},"GET",401);
  for (const headers of [admin,auth]) {
    const pdf=await fetch(base+pdfRoute,{headers});
    assert.equal(pdf.headers.get("content-type"),"application/pdf");
    assert.equal((await PDFDocument.load(await pdf.arrayBuffer())).getPageCount(),2);
  }
  const term=await fetch(base+"/api/admin/active-meals/pdf?semester="+mixed.identifier.split(" ")[0],{headers:auth});
  assert.equal(term.status,200);
  assert((await PDFDocument.load(await term.arrayBuffer())).getPageCount()>=2);
  const exportedMeal=await call(meals+mixed.id+"/export");
  const exportedSplits=readBook(Buffer.from(exportedMeal)).transactions[0].splits;
  assert.equal(exportedSplits.filter(split=>split.path===settings.guestAccount).length,1);
  assert.equal(splitCents(exportedSplits.find(split=>split.path===settings.guestAccount)),600);
  assert.equal(splitCents(exportedSplits.find(split=>split.path===settings.mealAccount)),800);
  await t.test("Dauerhafter Rezeptkatalog, Rechte, Druck und Veranstaltungsbuchung", async () => {
    const path = "/api/bar/recipes", recipes = await call(path);
    assert.equal(recipes.length,12);
    const gin = recipes.find(r=>r.name==="Gin Tonic");
    const event = (await call("/api/events")).find(e=>e.mode==="personal");
    const direct = (await call("/api/events")).find(e=>e.mode==="direct");
    const barPath = e => "/api/events/"+e.id+"/bar";
    await call(path,gin,{}, "POST",401);
    await call(path,gin,auth,"POST",401); // XXX alleine
    await call("/api/admin/flags",{accountId:a.id,uebersicht:true});
    await call(path+"/"+gin.id,{version:1},auth,"DELETE",401); // auch BW alleine genügt nicht
    await call("/api/admin/flags",{accountId:a.id,schnapswart:true});
    const entry = await call(path,{...gin,name:"Test-Fizz",price:"4,25"},auth);
    const source = {name:entry.name,qty:1,price:entry.price,recipeId:entry.id};
    const purchase = {accountId:a.id, eventId:event.id, items:[source]};
    await call("/api/purchase",purchase,{},"POST",400);
    await call(barPath(event),{ids:[entry.id]},{}); // Helfer dürfen hinzufügen
    await call(barPath(event),{ids:[entry.id]},{});
    assert.equal((await call("/api/events")).find(e=>e.id===event.id).barDrinks.filter(d=>d.recipeId===entry.id).length,1);
    await call("/api/temporary-drinks",{name:entry.name,price:1},{},"POST",409);
    await call("/api/events/"+event.id+"/drinks/remove",{name:entry.name},{});
    const original=await call("/api/purchase",purchase,{});
    assert.equal(original.transaction.items[0].price,4.25);
    assert.equal(original.transaction.eventId,event.id);
    await call("/api/purchase",{...purchase,eventId:undefined},{},"POST",400);
    await call(barPath(direct),{ids:[entry.id]},admin);
    assert.equal((await call("/api/purchase",{accountId:direct.id,items:[source]},{})).transaction.eventId,direct.id);
    await call(barPath(event)+"/remove",{ids:[entry.id]},{},"POST",401);
    const changed = await call(path+"/"+entry.id,{...entry,price:"5,50"},auth,"PUT");
    await call(path+"/"+entry.id,{...entry,price:3},admin,"PUT",409);
    await call("/api/purchase",purchase,{},"POST",409);
    for (const kind of ["mixliste","preisliste"]) {
      const printed=await fetch(base+barPath(event)+"/print/"+kind);
      assert.equal(printed.status,200);
      assert.equal((await PDFDocument.load(await printed.arrayBuffer())).getPageCount(),1);
    }
    await call(barPath(direct)+"/remove",{ids:[entry.id]},auth);
    await call("/api/purchase",{accountId:direct.id,items:[source]},{},"POST",400);
    assert((await call(path,undefined,auth)).some(r=>r.id===entry.id));
    await call("/api/admin/flags",{accountId:a.id,schnapswart:false});
    await call(path+"/"+entry.id,{version:changed.version},auth,"DELETE",401);
    await call(path+"/"+entry.id,{version:changed.version},admin,"DELETE");
    assert(!(await call("/api/events")).find(e=>e.id===event.id).barDrinks.some(d=>d.recipeId===entry.id));
    const past=(await call("/api/me",undefined,auth)).transactions.find(tx=>tx.id===original.transaction.id);
    assert.equal(past.items[0].price,4.25);
    assert.equal(past.items[0].name,entry.name);
  });

});

test("Startseite unterscheidet Geräte und respektiert direkte Strichlistenlinks", () => {
  const vm = require("node:vm");
  const script = ["device.js", "start.js"].map(file => fs.readFileSync(path.join(root, "public", file), "utf8")).join("\n");
  function destination(userAgent, width, height, touch, search = "", coarsePointer = touch) {
    let target;
    vm.runInNewContext(script, {
      navigator:{userAgent, maxTouchPoints:touch ? 5 : 0},
      screen:{width, height}, matchMedia:() => ({matches:coarsePointer}),
      location:{search, hash:"", replace:value => { target = value; }}, URLSearchParams
    });
    return target;
  }
  assert.equal(destination("Linux x86_64", 400, 900, false), "admin.html");
  assert.equal(destination("iPhone", 844, 390, true), "user.html");
  assert.equal(destination("Android 15 Mobile Safari", 915, 412, true), "user.html");
  assert.equal(destination("Android 13 Tablet", 600, 960, true), "strichliste.html");
  assert.equal(destination("Macintosh", 1366, 1024, true), "strichliste.html");
  assert.equal(destination("Macintosh", 1366, 1024, true, "", false), "strichliste.html");
  assert.equal(destination("Other", 800, 1280, true), "strichliste.html");
  assert.equal(destination("iPhone", 390, 844, true, "?strichliste=1"), "strichliste.html?strichliste=1");
  assert.equal(destination("Macintosh", 1440, 900, false, "?event=abc"), "strichliste.html?event=abc");
});

test("Aktivenessen auf dem Originalformular mit genau 18 Zeilen und Fortsetzung", async () => {
  const {buildMealPdf} = require("../meal-pdf");
  const meal = {
    date:"2026-11-17", identifier:"WS26 A1", name:"Beispielessen", total:100, subsidy:0,
    participants:Array.from({length:18}, (_, i) => ({name:"Person " + (i + 1), price:5})), receipts:[]
  };
  const extra = {...meal, participants:[...meal.participants, {name:"Weitere Person", role:"kgast", price:5}]};
  const only = await PDFDocument.load(await buildMealPdf([meal], "", "Einzelausgabe"));
  assert.equal(only.getPageCount(), 1);
  const semester = await PDFDocument.load(await buildMealPdf([extra, meal], "", "Semester"));
  assert.equal(semester.getPageCount(), 3);
  for (const page of semester.getPages()) {
    assert(Math.abs(page.getWidth() - 595.3) < 0.1 && Math.abs(page.getHeight() - 841.9) < 0.1);
  }
});
