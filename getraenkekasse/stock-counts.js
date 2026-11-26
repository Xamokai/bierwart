"use strict";

const {createHash} = require("node:crypto");
const baseSpirits = require("./stock-drinks.json");
const denominations = [50000,20000,10000,5000,2000,1000,500,200,100,50,20,10,5,2,1];
const roles = {spirits:["kneipwart","schnapswart"], drinks:["uebersicht"], cash:["gnucash"]};
const cleanName = value => typeof value === "string" && value.trim().length > 0 &&
  value.trim().length <= 120 && !/[\x00-\x1f\x7f]/.test(value);
const normalized = name => name.trim().normalize("NFC").toLocaleLowerCase("de");

const milli = qty => Math.round(qty * 1000);
const valued = (units, cents) => Math.sign(units) * Math.round(Math.abs(units)*cents/1000);
const version = row => row.version || 1;

function comparison(before, after) {
  const opening = new Map(before.items.map(i => [i.name,i]));
  const closing = new Map(after.items.map(i => [i.name,i]));
  const cash = before.area === "cash";
  const lines = Array.from(new Set([...opening.keys(),...closing.keys()]), name => {
    const start = opening.get(name), end = closing.get(name);
    const first = start?.quantity || 0, added = start?.restocked || 0, last = end?.quantity || 0;
    const units = cash ? milli(last)-milli(first) : milli(first)+milli(added)-milli(last);
    const priceCents = (start || end).priceCents;
    return {name,first,added,last,quantity:units/1000,priceCents,valueCents:valued(units,priceCents)};
  });
  const differenceCents = lines.reduce((n,i) => n+i.valueCents,0);
  const bookedCents = (after.bookings || []).reduce((n,b) => n+b.amountCents,0);
  return {beforeId:before.id,beforeVersion:version(before),afterVersion:version(after),
    lines,differenceCents,bookedCents,pendingCents:differenceCents-bookedCents};
}

function mountStockCounts(app, {getDB, allow, newId, saveDB, addAudit, loadProducts, validDateOnly, eventMode, eventLabel, parseMoneyCents}) {
  const root = "/api/stock-counts";
  const guard = allow(...Object.values(roles).flat());
  const permitted = (req, area) => typeof area === "string" && Object.hasOwn(roles, area) && (!req.account || roles[area].some(role => req.account.roles[role]));
  function catalog(area) {
    if (area === "cash") return denominations.map(cents => ({name:cents >= 100 ? cents/100 + " €" : cents + " Cent", priceCents:cents}));
    if (area === "drinks") return loadProducts().map(p => ({name:p.name, priceCents:Math.round(p.price*100)}));
    return Object.entries(baseSpirits).map(([name,priceCents]) => ({name,priceCents}))
      .concat(getDB().stockDrinks || []).sort((a,b) => a.name.localeCompare(b.name,"de"));
  }
  const countableEvent = a => a.isEvent && !a.deleted && ["direct","personal"].includes(eventMode(a));
  app.get(root + "/options", guard, (req,res) => {
    const catalogs = Object.fromEntries(Object.keys(roles).filter(k => permitted(req,k)).map(k => [k,catalog(k)]));
    res.json({catalogs, canReview:permitted(req,"cash"), events:getDB().accounts.filter(countableEvent)
      .map(a => ({id:a.id, name:eventLabel(a)})).sort((a,b) => a.name.localeCompare(b.name,"de"))});
  });

  app.post(root + "/drinks", allow(...roles.spirits), (req,res) => {
    const {name, price} = req.body || {};
    const priceCents = parseMoneyCents(price);
    if (!cleanName(name) || !Number.isSafeInteger(priceCents) || priceCents < 1 || priceCents > 9999999)
      return res.status(400).json({error:"Bitte einen Namen und einen positiven Flaschenpreis bis 99.999,99 € eingeben."});
    if (catalog("spirits").some(p => normalized(p.name) === normalized(name)))
      return res.status(409).json({error:"Dieses Getränk ist bereits im Zählkatalog."});
    const db = getDB(), entry = {name:name.trim(),priceCents};
    (db.stockDrinks ||= []).push(entry);
    addAudit(req,"stock.drink_created","Zählgetränk angelegt",{type:"stock-drink",label:entry.name},null,entry);
    saveDB(db); res.status(201).json(entry);
  });

  function list(req,res,eventsOnly) {
    const counts = getDB().stockCounts || [];
    const byId = new Map(counts.map(c => [c.id,c]));
    const visible = counts.filter(c => !eventsOnly || (c.scope === "event" && permitted(req,c.area)));
    res.json(visible.map(c => {
      const before = c.beforeId && byId.get(c.beforeId);
      return {...c,version:version(c),comparison:before ? comparison(before,c) : undefined};
    }).sort((a,b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)));
  }
  app.get(root, allow(...roles.cash), (req,res) => list(req,res,false));
  app.get(root+"/events", guard, (req,res) => list(req,res,true));

  function store(req,res) {
    const db = getDB(), counts = db.stockCounts || [];
    const old = req.params.id && counts.find(c => c.id === req.params.id);
    if (req.params.id && !old) return res.status(404).json({error:"Zählung nicht gefunden."});
    const {area,name,date,scope,eventId,items,requestId} = req.body || {};
    const phase = scope === "event" ? req.body.phase : null;
    if (!permitted(req,area) || (old && !permitted(req,old.area)))
      return res.status(403).json({error:"Keine Berechtigung für diesen Zählbereich."});
    if (!cleanName(name) || typeof date !== "string" || !validDateOnly(date) || !["stock","event"].includes(scope) ||
        !Array.isArray(items) || !items.length || items.length > 1000 || typeof requestId !== "string" || !/^[\da-f]{32}$/.test(requestId))
      return res.status(400).json({error:"Name, Datum, Anlass und mindestens eine Zählposition sind erforderlich."});
    if (scope === "event" && !["before","after"].includes(phase))
      return res.status(400).json({error:"Bitte Vorzählung oder Nachzählung auswählen."});
    const beforeId = phase === "after" ? req.body.beforeId : null;
    const actorId = req.account?.id || null;
    const fingerprint = createHash("sha256").update(JSON.stringify([name,date,scope,scope === "event" ? eventId : null,area,phase,beforeId,items])).digest("hex");
    const previous = old || counts.find(c => c.requestId === requestId && c.actorId === actorId);
    if (!old && previous) {
      if (previous.fingerprint !== fingerprint) return res.status(409).json({error:"Diese Zählung wurde bereits mit anderen Angaben gespeichert."});
      return res.json({id:previous.id,totalCents:previous.totalCents});
    }
    if (old) {
      if (old.scope !== "event" || scope !== old.scope || eventId !== old.eventId || area !== old.area ||
          (old.phase && (phase !== old.phase || beforeId !== (old.beforeId || null))))
        return res.status(400).json({error:"Veranstaltung, Bereich und bestehende Zuordnung bleiben beim Bearbeiten fest."});
      if (old.editRequestId === requestId && old.editFingerprint === fingerprint)
        return res.json({id:old.id,totalCents:old.totalCents});
      if (req.body.version !== version(old)) return res.status(409).json({error:"Zählung inzwischen geändert. Bitte erneut zum Bearbeiten öffnen."});
    }
    const event = scope === "event" && db.accounts.find(a => a.id === eventId && countableEvent(a));
    if (scope === "event" && !event) return res.status(400).json({error:"Bitte eine vorhandene Veranstaltung auswählen."});
    const before = phase === "after" && counts.find(c => c.id === beforeId && c.phase === "before" && c.eventId === eventId && c.area === area);
    if (phase === "after" && !before) return res.status(400).json({error:"Die passende Vorzählung dieser Veranstaltung auswählen."});
    const after = counts.find(c => c.phase === "after" && c.beforeId === (before ? before.id : old?.id));
    if (before && after && after !== old) return res.status(409).json({error:"Zu dieser Vorzählung gibt es bereits eine Nachzählung."});
    if ((before && date < before.date) || (phase === "before" && after && date > after.date))
      return res.status(400).json({error:"Die Nachzählung darf nicht vor der Vorzählung liegen."});

    const prices = new Map(catalog(area).map(p => [p.name,p.priceCents]));
    // Historical counts keep their prices even if a catalog entry is renamed or repriced.
    for (const source of [after,old,before]) {
      for (const i of source?.items || []) prices.set(i.name,i.priceCents);
    }
    const lines = [];
    let totalCents = 0;
    for (const item of items) {
      if (!item || !prices.has(item.name)) return res.status(400).json({error:"Unbekannte oder doppelte Zählposition."});
      const qty = String(item.quantity ?? "").replace(",",".");
      const added = String(item.restocked ?? 0).replace(",",".");
      const amountPattern = area === "cash" ? /^\d{1,5}$/ : /^\d{1,5}(\.\d{1,3})?$/;
      if (!amountPattern.test(qty) || !amountPattern.test(added) || (Number(added) && (area === "cash" || phase !== "before")))
        return res.status(400).json({error:"Bitte gültige Mengen eingeben. Nachgeholte Getränke gehören zur Vorzählung."});
      const quantity = Number(qty), restocked = Number(added);
      const priceCents = prices.get(item.name) ?? item.priceCents;
      if (!Number.isSafeInteger(priceCents) || priceCents < 0 || priceCents > 9999999)
        return res.status(400).json({error:"Für „"+item.name+"“ fehlt ein gültiger Stückpreis."});
      if (priceCents !== item.priceCents)
        return res.status(409).json({error:"Der Preis für „"+item.name+"“ hat sich geändert. Bitte die Zählung mit dem aktuellen Preis prüfen."});
      prices.delete(item.name);
      const valueCents = valued(milli(quantity)+milli(restocked),priceCents);
      totalCents += valueCents;
      lines.push({name:item.name,quantity,...(restocked ? {restocked} : {}),priceCents,valueCents});
    }
    const values = {name:name.trim(),date,phase,beforeId,items:lines,totalCents};
    if (old) {
      const snapshot = {...old};
      Object.assign(old,values,{version:version(old)+1,editRequestId:requestId,editFingerprint:fingerprint});
      addAudit(req,"stock.count_updated","Zählung „"+old.name+"“ bearbeitet",{type:"stock-count",id:old.id,label:old.name},
        {date:snapshot.date,items:snapshot.items,totalCents:snapshot.totalCents},values);
      saveDB(db); return res.json({id:old.id,totalCents});
    }
    const record = {id:newId(),requestId,fingerprint,area,scope,...values,version:1,eventId:event?.id || null,eventName:event ? eventLabel(event) : "",
      actorId,countedBy:req.account?.name || "Verwaltung",createdAt:new Date().toISOString()};
    (db.stockCounts ||= []).push(record);
    addAudit(req,"stock.count_created","Zählung „"+record.name+"“ erfasst",{type:"stock-count",id:record.id,label:record.name},
      null,{area,scope,phase,beforeId,date,totalCents});
    saveDB(db); res.status(201).json({id:record.id,totalCents});
  }
  app.post(root, guard, store);
  app.put(root+"/:id", guard, store);
  app.post(root+"/:id/book", guard, (req,res) => {
    const db = getDB(), counts = db.stockCounts || [];
    const after = counts.find(c => c.id === req.params.id && c.phase === "after");
    const before = after && counts.find(c => c.id === after.beforeId && c.phase === "before" && c.area === after.area && c.eventId === after.eventId);
    if (!before) return res.status(404).json({error:"Zusammengehörige Vor- und Nachzählung fehlen."});
    if (!permitted(req,after.area) && !permitted(req,"cash")) return res.status(403).json({error:"Keine Berechtigung für diesen Zählbereich."});
    const event = db.accounts.find(a => a.id === after.eventId && countableEvent(a));
    if (!event) return res.status(409).json({error:"Diese Veranstaltung ist nicht mehr verfügbar."});
    const diff = comparison(before,after);
    const {beforeVersion,afterVersion,pendingCents} = req.body || {};
    if (diff.beforeVersion !== beforeVersion || diff.afterVersion !== afterVersion)
      return res.status(409).json({error:"Die Zählung wurde geändert. Bitte die neue Differenz prüfen."});
    if (!diff.pendingCents) return res.json({amountCents:0});
    if (pendingCents !== diff.pendingCents)
      return res.status(409).json({error:"Der offene Betrag hat sich geändert. Bitte die Differenz erneut prüfen."});
    const now = new Date().toISOString(), cash = after.area === "cash", correction = !!after.bookings?.length;
    const description = (correction ? "Korrektur " : "") + (cash ? "Barkassendifferenz" : "Getränkeverbrauch") + " · " + after.name + " · " + eventLabel(event);
    const tx = {id:newId(),accountId:event.id,eventId:event.id,eventName:eventLabel(event),stockCountId:after.id,
      type:cash ? "deposit" : "purchase",total:pendingCents/100,date:now,description,items:[],exported:false};
    db.transactions.push(tx);
    (after.bookings ||= []).push({transactionId:tx.id,amountCents:pendingCents,date:now,by:req.account?.name || "Verwaltung",beforeVersion,afterVersion});
    addAudit(req,"stock.difference_booked",description,{type:"transaction",id:tx.id,label:description},null,
      {beforeId:before.id,afterId:after.id,eventId:event.id,beforeVersion,afterVersion,amountCents:pendingCents});
    saveDB(db); res.json({transactionId:tx.id,amountCents:pendingCents});
  });
}

module.exports = {mountStockCounts};
