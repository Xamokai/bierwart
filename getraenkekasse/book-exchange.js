"use strict";
const {eventMode, eventLabel, normalizedName} = require("./event-mode");
const {readBook,accountsCsv,splitCents}=require("./book-format");
const {planAccounts,planBookings,applyBookings,codeOf,leaf,parent,personKey,digest}=require("./book-sync");

// Allocate paths once and keep them stable across account and transaction files.
function prepareAccounts(db,g) {
  const catalog=db.settings.bookCatalog||{};
  if(!db.settings.bookTreeLoaded) return [];
  const known=new Map(Object.entries(catalog));
  const occupied=new Set([...known].flatMap(([path,a])=>[a.code,codeOf(path)]));
  const rows=[], people=new Set();
  for(const a of db.accounts) if(a.gnucashAccount)occupied.add(codeOf(a.gnucashAccount));
  function next(low,high,start) {
    for(let i=Math.max(low,start);i<=high;i++)if(!occupied.has(String(i))){occupied.add(String(i));return String(i);}
    throw Error("Kein freier Kontocode im vorgesehenen Nummernbereich.");
  }
  let start=Math.max(10500,...[...occupied].map(Number).filter(n=>n>=10000 && n<69999))+1;
  const work=[];
  const neededEvents = new Set(db.transactions
    .filter(t => t.type === "purchase" && !t.exported && t.eventId && t.eventId !== t.accountId)
    .map(t => t.eventId));
  for(const a of db.accounts.filter(a=>!a.isSystem && !a.fixedBookCode && !a.collectiveTarget && (!a.deleted || neededEvents.has(a.id)))){
    let path=a.gnucashAccount;
    if(!path){
      const base=a.isEvent?g.eventAccount:g.memberPrefix;
      const surname=a.surname||"";
      let name=a.name.trim();
      if(!a.isEvent && !name.includes(",") && surname && name.toLowerCase().endsWith(" "+surname.toLowerCase()))
        name=surname+", "+name.slice(0,-surname.length).trim();
      if(!name || /[:\r\n]/.test(name)) throw Error("Kontonamen oder Kontenzuordnung für "+a.name+" prüfen.");
      const eventName=name.replace(/\s+(?:(?:am\s+)?\d{1,2}\.\d{1,2}\.(?:\d{2,4})?|\d{4}-\d{2}-\d{2}|(?:SS|WS)\s?\d{2,4})$/i,"").replace(/^Diwali$/i,"Divali").trim();
      const hits=[...known.keys()].filter(p=>parent(p)===base && (personKey(leaf(p))===personKey(a.isEvent?eventName:name) ||
        (a.isEvent && normalizedName(eventLabel({isEvent:true, name:leaf(p).replace(/^\d+\s+/,"")})) === normalizedName(eventLabel(a)))));
      const alias=a.isEvent && /^(an|ab|fuxen|burschungs|stiftungsfest)kneipe(?:\s|$)/i.test(name)
        ? [...known.keys()].find(p=>parent(p)===base && codeOf(p)==="4150"):null;
      if(hits.length>1)throw Error("Mehrdeutiger Kontoname: "+name);
      if(hits.length || alias) path=hits[0] || alias;
      else {
        if (a.isEvent && ["personal","hidden"].includes(eventMode(a)) && !neededEvents.has(a.id) &&
            !db.transactions.some(t => t.accountId === a.id && !t.exported)) continue;
        if(!known.has(base))throw Error("Übergeordnetes Konto fehlt im eingelesenen Kontenbaum: "+base);
        const code=a.isEvent?next(4201,4599,4201):next(10000,69999,start);
        if(!a.isEvent)start=Number(code)+1;
        path=base+":"+code+" "+name;
      }
      work.push([a,path]);
    }
    if(!a.isEvent){
      if(people.has(path))throw Error("Zwei Personen haben denselben GnuCash-Pfad: "+path);
      people.add(path);
    }
    if(a.bookProposed && catalog[path] && db.accounts.some(other=>other.id!==a.id && !a.isEvent && other.gnucashAccount===path))
      throw Error("Doppelte Zuordnung prüfen: "+path);
    if(!catalog[path] && !rows.some(r=>r.path===path)){
      if(!catalog[parent(path)])throw Error("Übergeordnetes GnuCash-Konto fehlt: "+parent(path));
      const code=codeOf(path);
      if(code && [...known].some(([other,info])=>other!==path && (info.code===code || codeOf(other)===code)))
        throw Error("Kontonummer inzwischen belegt: "+code+" – bitte die Zuordnung prüfen.");
      const row={path,code,type:a.isEvent?"EXPENSE":"LIABILITY"};
      rows.push(row);known.set(path,row);
    }
  }
  for(const [a,path] of work){a.gnucashAccount=path; a.bookProposed=!catalog[path];}
  return rows;
}
const changeInCents = tx => (tx.type === "deposit" ? 1 : -1) * Math.round(tx.total * 100);

function statementCoverage(statement) {
  const ids = new Set(statement.covered);
  const receipts = new Set(statement.entries.map(entry => entry.id));
  return tx => ids.has(tx.id) || receipts.has(tx.sourceBookGuid || tx.bookImportId);
}

function statementBalance(statement, transactions) {
  const covered = statementCoverage(statement);
  let cents = statement.entries.reduce((total, entry) => total + entry.amount, 0);
  for (const tx of transactions) {
    if (!tx.eventSettled && !tx.balanceSync && !covered(tx)) cents += changeInCents(tx);
  }
  return cents;
}

function readPersonAccounts(book, plans, today) {
  const accounts = new Map();
  if (!/^[0-9a-f]{32}$/i.test(book.bookId || "")) return accounts;
  const liabilityPaths = new Set(book.accounts.filter(a => a.type === "LIABILITY" && a.commodity === "EUR").map(a => a.path));
  for (const plan of plans) {
    if (plan.kind === "person" && liabilityPaths.has(plan.path))
      accounts.set(plan.path, {balance:0, entries:[]});
  }
  // Older plugins supplied only the balances and a filtered list of bookings.
  if (book.snapshotDate) {
    if (book.snapshotDate !== today) throw Error("Die Saldenübersicht ist abgelaufen. Bitte die Vorschau erneut öffnen.");
    for (const [path, account] of accounts) {
      if (book.snapshot.has(path)) {
        account.balance = book.snapshot.get(path);
        account.entries = null;
      } else accounts.delete(path);
    }
    return accounts;
  }
  if (book.statementDate && book.statementDate !== today)
    throw Error("Der Kontoauszug ist abgelaufen. Bitte die Vorschau erneut öffnen.");
  for (const tx of book.transactions) {
    if (tx.voided || tx.date > today) continue;
    const bwId = tx.notes.match(/\bBW-ID ([0-9a-f]{32})\b/i)?.[1].toLowerCase();
    for (const split of tx.splits.filter(split => accounts.has(split.path))) {
      if (!split.quantity && !tx.eur) continue;
      const amount = -splitCents(split.quantity ? {fraction:split.quantity} : split);
      if (amount === 0) continue;
      const opposite = tx.splits.filter(other => other.path !== split.path &&
        Math.sign(Number(other.fraction?.split("/")[0])) === Math.sign(amount));
      const counterAccounts = [...new Set(opposite.map(other => leaf(other.path)))];
      const account = accounts.get(split.path);
      account.balance += amount;
      account.entries.push({
        id:tx.id, date:tx.date, number:tx.number, description:tx.description,
        memo:split.memo, counterAccounts, amount, bwId
      });
    }
  }
  return accounts;
}

function eventBookBalances(book, plans, today) {
  if (!/^[0-9a-f]{32}$/i.test(book.bookId || "")) return null;
  // Older filtered plugin exports lack complete data for event accounts.
  if (book.snapshotDate || (book.statementDate && !book.eventSnapshotDate)) return null;
  const paths = new Set(plans.filter(plan => plan.kind === "event").map(plan => plan.path));
  const debitTypes = new Set(["ASSET", "BANK", "CASH", "EXPENSE", "RECEIVABLE"]);
  const creditTypes = new Set(["LIABILITY", "CREDIT", "EQUITY", "INCOME", "PAYABLE"]);
  const signs = new Map();
  for (const a of book.accounts) {
    if (a.commodity !== "EUR" || a.placeholder || !paths.has(a.path)) continue;
    if (debitTypes.has(a.type)) signs.set(a.path, 1);
    else if (creditTypes.has(a.type)) signs.set(a.path, -1);
  }
  if (book.eventSnapshotDate) {
    if (book.eventSnapshotDate !== today) throw Error("Die Veranstaltungssalden sind abgelaufen. Bitte die Vorschau erneut öffnen.");
    return new Map([...book.eventSnapshot].filter(([path]) => signs.has(path)));
  }
  const balances = new Map([...signs.keys()].map(path => [path, 0]));
  for (const tx of book.transactions) {
    if (tx.voided || tx.date > today) continue;
    for (const split of tx.splits) {
      if (!signs.has(split.path) || (!split.quantity && !tx.eur)) continue;
      const amount = splitCents(split.quantity ? {fraction:split.quantity} : split);
      balances.set(split.path, balances.get(split.path) + signs.get(split.path) * amount);
    }
  }
  return balances;
}

function balanceChanges(db, plans, balances) {
  const meals = new Map(db.activeMeals.map(meal => [meal.id, meal]));
  const amounts = new Map();
  for (const tx of db.transactions) {
    if (tx.eventSettled) continue;
    const sum = amounts.get(tx.accountId) || {current:0, represented:0, open:0, covered:[], transactions:[]};
    const change = changeInCents(tx);
    sum.current += change;
    sum.transactions.push(tx);
    if (!tx.balanceSync) {
      const booked = tx.activeMealId ? meals.get(tx.activeMealId)?.exported : tx.exported;
      if (booked) {
        sum.represented += change;
        sum.covered.push(tx.id);
      }
      else sum.open += change;
    }
    amounts.set(tx.accountId, sum);
  }
  return plans.filter(a => balances.has(a.path)).map(a => {
    const {current = 0, represented = 0, open = 0, covered = [], transactions = []} = amounts.get(a.id) || {};
    const book = balances.get(a.path);
    const statement = db.settings.bookStatements?.[a.id];
    const previous = statement ? statementBalance(statement, transactions) : current;
    return {id:a.id, path:a.path, name:a.name, book, current:previous, open, target:book + open, correction:book - represented, covered};
  });
}

function mountExchange(app,ctx) {
  const {getDB,gnu,allow,newId,initialAccount,saveDB,addAudit,bookDate,localDate}=ctx;
  const route="/api/admin/gnucash/exchange";
  app.post(route,allow("gnucash"),(req,res)=>{
    try{
      const db=getDB(),g=gnu(),book=readBook(req.body);
      const {plans,conflicts,resolved}=planAccounts(book,db,g);
      const {candidates,notices,already}=planBookings(book,db,g,resolved,bookDate);
      const seen=book.accounts.map(a=>[a.path,a.code||"",a.type||"",a.guid||""]);
      const today = localDate(new Date().toISOString());
      const plannedIds = new Set(plans.map(plan => plan.id));
      const statementPlans = [...plans, ...[...resolved.values()].filter(plan => !plannedIds.has(plan.id))];
      const statements = readPersonAccounts(book, statementPlans, today);
      const eventBalances = eventBookBalances(book, statementPlans, today);
      const balances = new Map([...statements].map(([path, statement]) => [path, statement.balance]));
      const statementReady = [...statements.values()].some(statement => statement.entries !== null);
      const blocked = db.exportRuns.some(run => run.status === "open");
      const reconciliation = balanceChanges(db, statementPlans, balances);
      const preview=digest([seen,plans,candidates,db.settings.bookCatalog||{},conflicts,book.bookId,reconciliation,[...statements],eventBalances && [...eventBalances],blocked]);
      const signatures = new Map();
      const similar = new Set();
      for (const entry of candidates) {
        const first = signatures.get(entry.signature);
        if (first && first !== entry.id) similar.add(entry.signature);
        else signatures.set(entry.signature, entry.id);
      }
      for (const signature of similar) {
        const entry = candidates.find(e => e.signature === signature);
        notices.push([entry.date, entry.number, entry.description,
          "Mehrere GnuCash-Buchungen mit gleichen Beträgen und Konten. Belege vergleichen und höchstens eine davon auswählen."].filter(Boolean).join(" · "));
      }
      const token=req.query.preview;
      if(!token)return res.json({preview,tree:book.tree,changes:plans.filter(a=>a.action!=="known").map(a=>({kind:a.kind,name:a.name,path:a.path,action:a.action})),
        candidates:candidates.map(e=>({key:e.key,kind:e.kind,date:e.date,number:e.number,description:e.description,name:e.label,amount:e.amount})),conflicts,notices,already,balances:reconciliation.map(({covered, path, ...item}) => item),balanceBlocked:blocked,statementReady,eventBalanceCount:eventBalances?.size || 0});
      if(conflicts.length)return res.status(409).json({error:"Kontenzuordnung nicht eindeutig. Bitte zuerst die Konflikte in der Vorschau klären."});
      if(token!==preview)return res.status(409).json({error:"Bestand geändert. Datei erneut für die Vorschau auswählen."});
      // The file is sent as a binary request. Selected IDs are sent separately as
      // a short-lived server-side selection, scoped to the authenticated request.
      const selection=dbSelection(req,preview);
      const reconcile = selection.delete("balance-sync");
      if (reconcile && (blocked || (!balances.size && !eventBalances?.size)))
        return res.status(409).json({error:"Für den Saldenabgleich ein vollständiges Buch ohne offenen BW-Buchungslauf verwenden."});
      const expectedBook = db.settings.pluginBook || db.settings.balanceBook;
      if (reconcile && expectedBook && expectedBook !== book.bookId)
        return res.status(409).json({error:"Das BW-Programm ist mit einem anderen GnuCash-Buch verbunden."});
      const chosen=candidates.filter(e=>selection.has(e.key));
      if(chosen.length!==selection.size)throw Error("Auswahl passt nicht mehr zur Vorschau.");
      const selectedIds = new Map();
      for (const entry of chosen) {
        if (selectedIds.has(entry.signature) && selectedIds.get(entry.signature) !== entry.id)
          return res.status(409).json({error:"Gleiche Belegdaten für mehrere Buchungs-IDs ausgewählt. Belege prüfen und Auswahl wiederholen."});
        selectedIds.set(entry.signature, entry.id);
      }
      const now=new Date().toISOString();
      const staged=[];
      for(const a of plans){
        if(a.action==="known")continue;
        const acc=a.action==="link"?{...db.accounts.find(x=>x.id===a.id)}:a.kind==="person"?initialAccount(a.name,a.surname):
          {name:a.name,isEvent:true,permanent:true,customDrinks:[],createdAt:now};
        acc.id=a.id;acc.gnucashAccount=a.path;acc.bookProposed=false;
        if(a.collectiveSource)acc.collectiveSource=a.collectiveSource;
        if(a.guid)acc.bookGuid=a.guid;
        if(a.kind==="person"){
          if(personKey(acc.name)!==personKey(a.name))acc.name=a.name;
          if(acc.initialPassword && acc.surname!==a.surname)Object.assign(acc,{surname:a.surname,passwordHash:initialAccount(a.name,a.surname).passwordHash});
        }
        staged.push(acc);
      }
      for(const acc of staged){const i=db.accounts.findIndex(x=>x.id===acc.id);if(i<0)db.accounts.push(acc);else db.accounts[i]=acc;}
      const fullTree=book.tree && [g.memberPrefix,g.eventAccount].every(p=>book.accounts.some(a=>a.path===p));
      if(fullTree)db.settings.bookCatalog={};
      db.settings.bookCatalog ||= {};
      for(const [path,code,type,guid] of seen)db.settings.bookCatalog[path]={code,type,guid};
      for(const a of db.accounts)if(a.bookProposed && db.settings.bookCatalog[a.gnucashAccount])a.bookProposed=false;
      if(fullTree)db.settings.bookTreeLoaded=true;
      applyBookings(chosen,db,newId);
      if (reconcile) {
        db.settings.balanceBook = book.bookId;
        if (eventBalances) {
          db.settings.eventBookBalances = {date:today, balances:Object.fromEntries(eventBalances)};
        }
        const reconciled = balanceChanges(db, statementPlans, balances);
        const ids = new Set(reconciled.map(a => a.id));
        db.transactions = db.transactions.filter(t => !t.balanceSync || !ids.has(t.accountId));
        db.settings.bookStatements ||= {};
        for (const account of reconciled) {
          const statement = statements.get(account.path);
          if (statement.entries !== null) {
            db.settings.bookStatements[account.id] = {date:today, entries:statement.entries, covered:account.covered};
          } else {
            delete db.settings.bookStatements[account.id];
          }
          if (account.correction === 0) continue;
          db.transactions.push({id:newId(),accountId:account.id,date:now,items:[],
            type:account.correction > 0 ? "deposit" : "purchase",total:Math.abs(account.correction) / 100,
            description:"Saldenabgleich mit GnuCash",exported:true,balanceSync:true});
        }
        addAudit(req,"gnucash.balance_sync","Personensalden mit GnuCash abgeglichen",
          {type:"gnucash-import", id:newId()},null,{accounts:reconciled.length, date:today});
      }
      addAudit(req,"gnucash.exchange","Konten und ausgewählte Buchungen aus GnuCash übernommen",{type:"gnucash-import",id:newId()},null,
        {accounts:staged.length,bookings:chosen.length});
      saveDB(db);
      res.json({accounts:staged.length,bookings:chosen.length,balances:reconcile ? balances.size : 0, statements:reconcile && statementReady ? balances.size : 0, eventBalances:reconcile ? eventBalances?.size || 0 : 0});
    }catch(e){res.status(400).json({error:e.message});}
  });
  // Keeping selected rows out of a URL avoids browser/header limits for large books.
  const selections=new Map();
  const actor=req=>req.account?.id || "admin";
  app.post(route+"/selection",allow("gnucash"),(req,res)=>{
    if(!Array.isArray(req.body.keys)||!req.body.keys.every(k=>typeof k==="string")||typeof req.body.preview!=="string")return res.status(400).json({error:"Ungültige Importauswahl."});
    const handle=newId();
    for(const [id,s] of selections)if(s.until<Date.now())selections.delete(id);
    selections.set(handle,{keys:req.body.keys,preview:req.body.preview,actor:actor(req),until:Date.now()+300000});
    res.json({handle});
  });
  function dbSelection(req,preview){
    const selected=selections.get(req.query.selection);
    if(!selected || selected.until<Date.now() || selected.actor!==actor(req) || selected.preview!==preview)throw Error("Bitte Vorschau erneut öffnen.");
    selections.delete(req.query.selection);
    return new Set(selected.keys);
  }
  app.get(route+"/accounts.csv",allow("gnucash"),(req,res)=>{
    try{
      const db=getDB();
      if(!db.settings.bookTreeLoaded)throw Error("Zuerst eure GnuCash-Datei oder den vollständigen Kontenbaum einlesen.");
      const rows=prepareAccounts(db,gnu());saveDB(db);
      if(!rows.length)return res.status(204).end();
      res.attachment("BW-Neue-Konten.csv").type("text/csv").send(accountsCsv(rows));
    }catch(e){res.status(400).json({error:e.message});}
  });
}
module.exports={mountExchange,prepareAccounts,statementCoverage,statementBalance,changeInCents};
