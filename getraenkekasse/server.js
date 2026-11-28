/* Getränkekasse – kleiner interner Kiosk-Server
 * Start:  node server.js   (Standard-Port 3000, siehe config.json)
 */
const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const calendar = require("./semester-calendar");
const {eventMode, eventLabel, tallyLabel, bookableEvent, activeDrinks, normalizedName} = require("./event-mode");
const {initialRecipes, eventRecipes, listedRecipe, offer, mountBar} = require("./bar-catalog");
const splitActiveMeal = require("./public/meal-allocation");
const {mailProfile, validAddress, nameParts, draftFor} = require("./debt-mail");
const { buildMealPdf } = require("./meal-pdf");
const ROOT = __dirname;
const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, "config.json"), "utf8"));
const {mountExchange,prepareAccounts,statementCoverage,statementBalance,changeInCents}=require("./book-exchange");
const {accountsCsv}=require("./book-format");
const {codeOf, leaf} = require("./book-sync");
const {lanConfig,listenLan,logListeners} = require("./lan");
const { entryId, renderTransactions, paymentsFromBook } = require("./gnucash-sync");
const host = process.env.BW_HOST || CONFIG.host || "127.0.0.1";
// The update manager terminates TLS and starts its worker on loopback over HTTP.
const httpsConfig = require.main === module ? CONFIG.https : null;
const localOnly = lanConfig(host,undefined,httpsConfig?.hostname);
function adminPin() {
  const configured = String(process.env.BW_ADMIN_PIN || CONFIG.adminPin || "").trim();
  if (configured && configured !== "1234") return configured;
  const file = path.join(ROOT, "data", "admin-pin");
  fs.mkdirSync(path.dirname(file), {recursive: true});
  if (!fs.existsSync(file)) fs.writeFileSync(file, String(crypto.randomInt(10000000,100000000)), {flag:"wx",mode:0o600});
  const pin = fs.readFileSync(file,"utf8").trim();
  if (!pin) throw Error("Die Datei data/admin-pin ist leer.");
  return pin;
}
const ADMIN_PIN = adminPin();
const DB_FILE = path.join(ROOT, "data", "db.json");
const PRODUCTS_CSV = path.join(ROOT, "assets", "res", "products.csv");
const RECEIPTS_DIR = path.join(ROOT, "assets", "receipts");

/* ---------- Datenbank (einfache JSON-Datei) ---------- */
function loadDB() {
  if (!fs.existsSync(DB_FILE)) return { accounts: [], transactions: [] };
  return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
}
function saveDB(state) {
  const tmp = DB_FILE + ".tmp";
  try {
    fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), {mode:0o600});
    fs.renameSync(tmp, DB_FILE);
  } catch (err) {
    // A rejected request must not leak its unsaved changes into the next write.
    db = loadDB();
    throw err;
  }
}
let db = loadDB();
if (db.barRecipes === undefined) db.barRecipes = initialRecipes();
if (!Array.isArray(db.eventKinds))
  db.eventKinds = ["Ankneipe", "Abkneipe", "Stiftungsfest", "Fuxenkneipe"];
if (!Array.isArray(db.activeMeals)) db.activeMeals = [];
if (!Array.isArray(db.auditLog)) db.auditLog = [];
if (!Array.isArray(db.ledgerEntries)) db.ledgerEntries = [];
if (!Array.isArray(db.exportRuns)) db.exportRuns = [];
if (!db.settings || typeof db.settings !== "object") db.settings = {};
if (typeof db.settings.xxxCardAccountNumber !== "string") db.settings.xxxCardAccountNumber = "";
if (typeof db.settings.xxxCardInternalAccountId !== "string") db.settings.xxxCardInternalAccountId = "";

/* ---------- GnuCash: Kontenzuordnung ---------- */
const GNUCASH_DEFAULTS = {
  memberPrefix: "9 Statistik- & Vortragskonten:9999 PERSONENKONTEN:10000-69999 Debitoren",
  useMemberPrefix: true,
  guestAccount: "4 Aufwands- & Ertragskonten:4730 Mitgliederwerbungskosten",
  mealAccount: "4 Aufwands- & Ertragskonten:4600 Gemeinsame Essen",
  revenueDrinks: "2 Aufwandskonten:2000 Bierwart",
  eventAccount: "4 Aufwands- & Ertragskonten",
  cashAccount: "1 Bestandskonten:1000-1400 AKTIVE Bestandskonten:1000-1250 Kasse, Bank:1000-1050 Kasse:1050 Nebenkassen (KW, BW)",
  bankAccount: "1 Bestandskonten:1000-1400 AKTIVE Bestandskonten:1000-1250 Kasse, Bank:1200-1250 Bank:1200 Sparkasse Girokonto",
  expenseAccount: "2 Aufwandskonten:2000 Bierwart",
  currency: "EUR",
  numberPrefix: "GK"
};
if (!db.settings.gnucash || typeof db.settings.gnucash !== "object") db.settings.gnucash = {};
for (const [k, v] of Object.entries(GNUCASH_DEFAULTS)) {
  if (db.settings.gnucash[k] === undefined) db.settings.gnucash[k] = v;
}
function gnu() { return db.settings.gnucash; }

function bookCode(path) {
  const code = db.settings.bookCatalog?.[path]?.code;
  return String(code || "").trim() || codeOf(path) || (/^\d+$/.test(leaf(path)) ? leaf(path) : "");
}

function resolveCollectiveTarget(target, preferredPath) {
  if (!/^\d+$/.test(target)) return target;
  const matches = path => path && bookCode(path) === target;
  if (matches(preferredPath)) return preferredPath;
  const paths = Object.keys(db.settings.bookCatalog || {}).filter(matches);
  if (!paths.length && !db.settings.bookTreeLoaded) {
    const assigned = db.accounts.filter(a => !a.deleted).flatMap(a => [a.gnucashAccount, a.collectiveTarget]);
    paths.push(...new Set(assigned.filter(path => matches(path) && path !== target)));
  }
  return paths.length === 1 ? paths[0] : "";
}

/* Kontopfad eines Mitglieds-/Veranstaltungskontos für GnuCash */
function gnucashAccountPath(acc) {
  if (!acc) return "?";
  const target = acc.collectiveTarget || acc.fixedBookCode;
  if (target) return resolveCollectiveTarget(target, acc.gnucashAccount);
  if (acc.gnucashAccount) return acc.gnucashAccount;          // manuell überschrieben
  if (acc.isEvent) return `${gnu().eventAccount}:${acc.name}`;
  return gnu().useMemberPrefix ? `${gnu().memberPrefix}:${acc.name}` : acc.name;
}
fs.mkdirSync(RECEIPTS_DIR, { recursive: true });

function balanceOf(accountId) {
  const statement = db.settings.bookStatements?.[accountId];
  if (statement) return statementBalance(statement, db.transactions.filter(tx => tx.accountId === accountId)) / 100;
  let sum = 0;
  for (const t of db.transactions) {
    if (t.accountId !== accountId || t.eventSettled) continue;
    sum += t.type === "deposit" ? t.total : -t.total;
  }
  return Math.round(sum * 100) / 100;
}
function accountView(a) {
  return { id: a.id, name: a.name, balance: balanceOf(a.id) };
}
function newId() {
  return crypto.randomBytes(6).toString("hex");
}

function safeSnapshot(value) {
  if (value === undefined) return null;
  return JSON.parse(JSON.stringify(value));
}

function auditActor(req, fallback) {
  if (req && req.account) {
    return { type: "account", accountId: req.account.id, name: req.account.name };
  }
  if (req && req.get && req.get("X-Admin-Pin") === ADMIN_PIN) {
    return { type: "admin", accountId: null, name: "Admin" };
  }
  return fallback || { type: "system", accountId: null, name: "System" };
}

function addAudit(req, action, summary, target, before, after, meta, fallbackActor) {
  db.auditLog.push({
    id: newId(),
    createdAt: new Date().toISOString(),
    actor: auditActor(req, fallbackActor),
    action,
    summary,
    target: safeSnapshot(target),
    before: safeSnapshot(before),
    after: safeSnapshot(after),
    meta: safeSnapshot(meta)
  });
}

function ensureXxxCardInternalAccount() {
  let account = db.accounts.find(a => a.id === db.settings.xxxCardInternalAccountId && !a.deleted && !a.isEvent);
  if (!account) account = db.accounts.find(a => a.systemKind === "xxx-card" && !a.deleted && !a.isEvent);
  if (!account) {
    account = db.accounts.find(a => !a.deleted && !a.isEvent && String(a.name).toLowerCase() === "xxx-karte");
    if (account) {
      account.isSystem = true;
      account.systemKind = "xxx-card";
    }
  }
  if (!account) {
    account = {
      id: newId(), name: "XXX-Karte", isSystem: true, systemKind: "xxx-card",
      priority: false, roles: {}, createdAt: new Date().toISOString()
    };
    db.accounts.push(account);
  }
  account.isSystem = true;
  account.systemKind = "xxx-card";
  db.settings.xxxCardInternalAccountId = account.id;
  return account;
}

function xxxCardInternalAccount() {
  return ensureXxxCardInternalAccount();
}

ensureXxxCardInternalAccount();
saveDB(db);

/* Aktivenessen: Semester-Kürzel und fortlaufende Buchungsnummer, z. B. WS25 A1 */
function activeMealSemesterCode(dateStr) {
  const [year, month] = String(dateStr).split("-").map(Number);
  const startYear = month >= 9 ? year : (month <= 2 ? year - 1 : year);
  return `${month >= 3 && month <= 8 ? "SS" : "WS"}${String(startYear).slice(-2)}`;
}
function nextActiveMealIdentifier(dateStr) {
  const prefix = activeMealSemesterCode(dateStr);
  let max = 0;
  for (const meal of db.activeMeals || []) {
    const m = String(meal.identifier || "").match(new RegExp(`^${prefix} A(\\d+)$`));
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix} A${max + 1}`;
}
function validDateOnly(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return false;
  const d = new Date(`${value}T12:00:00Z`);
  return !isNaN(d) && d.toISOString().slice(0, 10) === value;
}
function activeMealView(meal, accountId) {
  const participants = (meal.participants || []).map(p => ({ ...p }));
  const own = participants.find(p => p.accountId === accountId);
  const card = xxxCardInternalAccount();
  const payer = meal.payer || {
    type: "xxx-card",
    accountId: card.id,
    name: card.name,
    gnucashAccount: db.settings.xxxCardAccountNumber || "XXX-Karte"
  };
  return {
    id: meal.id, identifier: meal.identifier, name: meal.name, date: meal.date,
    total: meal.total, subsidy:meal.subsidy || 0,guestShare:meal.guestShare || 0, subsidyPerPerson:meal.subsidyPerPerson,
    responsible:db.accounts.find(a => a.id === meal.createdByAccountId)?.name || (payer.type === "account" ? payer.name : ""),
    payouts:meal.payouts || [], participants, receipts: (meal.receipts || []).map(f => `/assets/receipts/${f}`),
    createdAt: meal.createdAt, createdByAccountId: meal.createdByAccountId || null,
    source: meal.source || "unknown", payer: { ...payer },
    runId:meal.runId || null, exported: !!meal.exported, exportedAt: meal.exportedAt || null,
    ownPrice: own ? own.price : null
  };
}

function activeMealPayerFrom(body, creatorAccount) {
  if (body && body.payerKind === "xxx-card") {
    const card = xxxCardInternalAccount();
    return {
      type: "xxx-card", accountId: card.id, name: card.name,
      gnucashAccount: db.settings.xxxCardAccountNumber || "XXX-Karte"
    };
  }
  if(body?.payerKind==="bank") return {type:"external",accountId:null,name:"Bank",gnucashAccount:gnu().bankAccount};
  const requestedId = String((body && body.payerAccountId) || "");
  const requested = db.accounts.find(a => a.id === requestedId && !a.isEvent && !a.deleted && !a.isSystem);
  const payerAccount = requested || (creatorAccount && !creatorAccount.isSystem ? creatorAccount : null) || null;
  if (payerAccount) {
    return {
      type: "account", accountId: payerAccount.id, name: payerAccount.name,
      gnucashAccount: gnucashAccountPath(payerAccount)
    };
  }
  const card = xxxCardInternalAccount();
  return {
    type: "xxx-card", accountId: card.id, name: card.name,
    gnucashAccount: db.settings.xxxCardAccountNumber || "XXX-Karte"
  };
}

function removeActiveMealPayout(mealId) {
  db.transactions = db.transactions.filter(t => !(t.activeMealId === mealId && t.activeMealPayout));
}

function addActiveMealPayout(meal) {
  const payers=meal.payouts || [{...meal.payer,amount:meal.total}];
  for(const pay of payers.filter(p=>p.accountId)) db.transactions.push({
    id: newId(), accountId: pay.accountId, type: "deposit",
    date: `${meal.date}T12:00:00.000Z`, items: [], total: pay.amount,
    description: `${meal.identifier} · Auslage Aktivenessen: ${meal.name}`,
    exported: true, activeMealId: meal.id, activeMealPayout: true
  });
}

function migrateActiveMeals() {
  let changed = false;
  const card = xxxCardInternalAccount();
  for (const meal of db.activeMeals || []) {
    if (!meal.payer) {
      meal.payer = {
        type: "xxx-card", accountId: card.id, name: card.name,
        gnucashAccount: db.settings.xxxCardAccountNumber || "XXX-Karte"
      };
      changed = true;
    }
    if (meal.payer.type === "xxx-card" && meal.payer.accountId !== card.id) {
      meal.payer.accountId = card.id;
      meal.payer.name = card.name;
      if (!meal.exported) meal.payer.gnucashAccount = db.settings.xxxCardAccountNumber || "XXX-Karte";
      changed = true;
    }
    if (typeof meal.exported !== "boolean") {
      const linked = db.transactions.filter(t => t.activeMealId === meal.id && !t.activeMealPayout);
      meal.exported = linked.length > 0 && linked.every(t => !!t.exported);
      meal.exportedAt = null;
      changed = true;
    }
    if (!meal.payouts && meal.payer && meal.payer.accountId && !db.transactions.some(t => t.activeMealId === meal.id && t.activeMealPayout)) {
      addActiveMealPayout(meal);
      changed = true;
    }
  }
  if (changed) saveDB(db);
}
migrateActiveMeals();

/* Standard-Veranstaltungen einmalig anlegen */
function ensureSeedEvents() {
  if (db.seededEvents) return;
  db.seededEvents = true;
  if (!db.accounts.some(a => a.isEvent)) {
    for (const name of ["Ankneipe", "Abkneipe", "Stiftungsfest", "Fuxenkneipe"]) {
      db.accounts.push({ id: newId(), name, isEvent: true, permanent: true, customDrinks: [], createdAt: new Date().toISOString() });
    }
  }
  saveDB(db);
}

function ensureEventTemplates() {
  if (db.settings.eventTemplates15) return;
  const names = ["Abkneipe", "Ankneipe", "Fuxenkneipe", "Stiftungsfestkneipe", "Himmelfahrtsbummel",
    "Kneipen", "Stempferbummel", "Stiftungstag", "Stockwerksparty", "Cocktailabend/Sommerparty",
    "Divali", "Halloweenparty", "Tresenbachelor", "Stiftungsfestball"];
  const existing = new Set(db.accounts.filter(a => a.isEvent && a.permanent).map(a => normalizedName(eventLabel(a))));
  for (const name of names) {
    if (!existing.has(normalizedName(name)) && !db.accounts.some(a => !a.isEvent && a.name === name))
      db.accounts.push({id:newId(), name, isEvent:true, permanent:true, customDrinks:[], createdAt:new Date().toISOString()});
  }
  db.settings.eventTemplates15 = true;
  saveDB(db);
}

const collectiveSources = {SHV:"1800", Gast:"4730", Löschbier:"4640", Arbeitseinsatz:"4620", Barzahler:"cash"};
function migrateCollectiveAccounts() {
  if (db.settings.collectiveAccounts114) return;
  for (const account of db.accounts.filter(a => eventMode(a) === "collective")) {
    const label = tallyLabel(account);
    if (label !== "SHV" && Object.hasOwn(collectiveSources, label)) account.collectiveSource = collectiveSources[label];
  }
  for (const name of ["Couleur", "SHV"]) {
    const existing = db.accounts.filter(a => a.isEvent && tallyLabel(a) === name);
    let account = existing.find(a => !a.deleted && a.gnucashAccount) || existing.find(a => !a.deleted);
    if (!account) {
      account = {id:newId(), name, isEvent:true, customDrinks:[], createdAt:new Date().toISOString()};
      db.accounts.push(account);
    } else if (name === "SHV") preserveCollectivePostings(account, "1800");
    account.permanent = true;
    account.fixedBookCode = "1800";
    if (name === "SHV") {
      account.name = "SHV";
      account.collectiveSource = "1800";
      for (const previous of existing) {
        if (previous !== account) previous.deleted = true;
      }
    }
  }
  db.settings.collectiveAccounts114 = true;
  saveDB(db);
}
function updateCollectiveAccounts() {
  if (db.settings.collectiveBookingDetails) return;
  for (const a of db.accounts.filter(a=>a.isEvent && tallyLabel(a)==="SHV")) {
    a.deleted = true;
    a.retiredSHV = true;
  }
  for (const name of ["Gast","Arbeitseinsatz"]) {
    if (db.accounts.some(a=>a.isEvent && (a.collectiveSource===collectiveSources[name] || tallyLabel(a)===name))) continue;
    db.accounts.push({id:newId(), name:name==="Gast" ? "Gast / Mitgliederwerbung" : name, isEvent:true, permanent:true,
      collectiveSource:collectiveSources[name], fixedBookCode:collectiveSources[name], createdAt:new Date().toISOString()});
  }
  for (const a of db.accounts.filter(a=>!a.deleted && eventMode(a)==="collective" && tallyLabel(a)==="Couleur")) a.contextKind = "name";
  db.settings.collectiveBookingDetails = true;
  saveDB(db);
}

function contextLabel(a) {
  if (eventMode(a) !== "collective") return null;
  if (a.collectiveSource === "4620" || tallyLabel(a) === "Arbeitseinsatz") return "Arbeitseinsatz";
  if (a.contextKind === "name" || a.collectiveSource === "4730" || ["Gast","Couleur"].includes(tallyLabel(a))) return "Name";
  return null;
}

/* ---------- Produkte aus CSV (assets/res/products.csv) ---------- */
function parsePrice(s) {
  const value = String(s ?? "").trim().replace(",", ".");
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(value)) return NaN;
  const units = Math.round(Number(value) * 100);
  return Number.isSafeInteger(units) ? units / 100 : NaN;
}
function parseMoneyCents(s) {
  const value = String(s ?? "").trim().replace(",", ".");
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) return NaN;
  return Math.round(Number(value) * 100);
}
function loadProducts() {
  if (!fs.existsSync(PRODUCTS_CSV)) return [];
  const lines = fs.readFileSync(PRODUCTS_CSV, "utf8").split(/\r?\n/).filter(l => l.trim());
  const out = [];
  for (const line of lines) {
    const [name, preis, bild, strich, striche] = line.split(";").map(x => (x || "").trim());
    if (!name || name.toLowerCase() === "name") continue; // Kopfzeile
    const price = parsePrice(preis);
    if (isNaN(price)) continue;
    out.push({ name, price, image: bild || "", tally: strich === "1", ticks: Number(striche) === 10 ? 10 : 20 });
  }
  return out;
}
function saveProducts(products) {
  const lines = ["name;preis;bild;strichliste;striche"];
  for (const p of products) {
    lines.push([p.name, p.price.toFixed(2).replace(".", ","), p.image || "", p.tally ? "1" : "0", Number(p.ticks) === 10 ? "10" : "20"].join(";"));
  }
  fs.writeFileSync(PRODUCTS_CSV, lines.join("\n") + "\n");
}

/* ---------- App ---------- */
const app = express();
app.disable("x-powered-by");
app.use(localOnly);
const hashes = new Set();
for (const file of fs.readdirSync(path.join(ROOT,"public")).filter(n => n.endsWith(".html"))) {
  const html = fs.readFileSync(path.join(ROOT,"public",file),"utf8");
  for (const [, code] of html.matchAll(/<script>([\s\S]*?)<\/script>/gi))
    hashes.add("'sha256-" + crypto.createHash("sha256").update(code.replace(/\r\n/g,"\n")).digest("base64") + "'");
}
app.use((req,res,next) => {
  res.set("X-Content-Type-Options","nosniff");
  res.set("Content-Security-Policy", "default-src 'self'; script-src 'self' " + [...hashes].join(" ") + "; script-src-attr 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; object-src 'none'; frame-ancestors 'self'; base-uri 'none'; form-action 'self'");
  next();
});
app.use(express.json({ limit: "5mb" }));
app.use(express.text({ type: ["text/csv", "text/plain"], limit: "10mb" }));
app.use(express.raw({ type: "application/octet-stream", limit: "15mb" }));
const hyphenFiles = {root:path.dirname(require.resolve("hyphen/hyphen.js")), maxAge:"1d"};
app.get("/vendor/hyphen.js", (req,res) => res.sendFile("hyphen.js", hyphenFiles));
app.get("/vendor/hyphen-de.js", (req,res) => res.sendFile("patterns/de-1996.js", hyphenFiles));
app.use("/assets", express.static(path.join(ROOT, "assets")));
app.use(express.static(path.join(ROOT, "public")));
ensureSeedEvents();
ensureEventTemplates();
migrateCollectiveAccounts();
updateCollectiveAccounts();
const calendarStatus = calendar.startCalendar(()=>db,newId,saveDB);

function requirePin(req, res, next) {
  if (req.get("X-Admin-Pin") === ADMIN_PIN) return next();
  res.status(401).json({ error: "Falsche PIN" });
}

/* Erlaubt Admin-PIN ODER ein Nutzerkonto mit passender Rolle
 * Rollen: "gnucash" (XXX – Import/Export), "uebersicht" (BW – Dashboard) */
function allow(...roles) {
  return (req, res, next) => {
    if (req.get("X-Admin-Pin") === ADMIN_PIN) return next();
    const token = (req.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const acc = db.accounts.find(a => a.id === tokens.get(token));
    if (acc && !acc.deleted && !acc.isEvent && !acc.isSystem && acc.roles && roles.some(role => acc.roles[role])) { req.account = acc; return next(); }
    res.status(401).json({ error: "Keine Berechtigung" });
  };
}

/* ---------- Passwörter & Login-Tokens ---------- */
function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(String(pw), salt, 32).toString("hex");
  return `${salt}:${hash}`;
}
function checkPassword(pw, stored) {
  if (typeof pw !== "string" || !stored || !/^[a-f0-9]{32}:[a-f0-9]{64}$/.test(stored)) return false;
  const [salt, hash] = stored.split(":");
  const test = crypto.scryptSync(String(pw), salt, 32).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(test, "hex"));
}
const tokens = new Map(); // token -> accountId (im Speicher; Server-Neustart = neu anmelden)

function initialAccount(name, surname) {
  const inferred = name.includes(",") ? name.split(",")[0].trim() : name.split(/\s+/).at(-1);
  const initial = String(surname || inferred || name).trim().normalize("NFC");
  return { id: newId(), name, surname: initial, passwordHash: hashPassword(initial), initialPassword: true,
    priority: false, roles: {}, createdAt: new Date().toISOString() };
}
for (const a of db.accounts) {
  if (!a.passwordHash && !a.isSystem && !a.isEvent && !a.deleted) {
    const initial = initialAccount(a.name, a.surname);
    Object.assign(a, {surname:initial.surname, passwordHash:initial.passwordHash, initialPassword:true});
  }
}
saveDB(db);
function revokeSessions(id, keep) {
  for (const [token, account] of tokens) if (account === id && token !== keep) tokens.delete(token);
}

function requireUser(req, res, next) {
  const token = (req.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const accId = tokens.get(token);
  const acc = db.accounts.find(a => a.id === accId && !a.deleted && !a.isEvent && !a.isSystem);
  if (!acc) return res.status(401).json({ error: "Bitte anmelden" });
  req.account = acc;
  next();
}
function optionalUser(req, res, next) {
  const token = (req.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const accId = tokens.get(token);
  const acc = db.accounts.find(a => a.id === accId && !a.deleted && !a.isEvent);
  if (acc) req.account = acc;
  next();
}

/* --- öffentlich (Strichliste) --- */
app.get("/api/products", (req, res) => res.json(loadProducts()));

/* Nur Namen – keine Guthaben für nicht angemeldete Geräte */
app.get("/api/accounts", (req, res) => {
  res.json(db.accounts
    .filter(a => !a.isEvent && !a.deleted && !a.isSystem)
    .map(a => ({ id: a.id, name: a.name }))
    .sort((a, b) => a.name.localeCompare(b.name, "de")));
});

/* Vollständige, durchsuchbare Namensliste mit Sichtbarkeit für die Startansicht. */
app.get("/api/tally/accounts", (req, res) => {
  const eventId = req.query.event;
  const event = eventId && db.accounts.find(a => a.id === eventId);
  if (eventId && (!bookableEvent(event) || eventMode(event) !== "personal"))
    return res.status(404).json({error:"Diese Veranstaltungsstrichliste ist nicht verfügbar."});
  res.json(tallyAccounts(event));
});

function tallyAccounts(event) {
  const now = Date.now();
  const weekStart = now - 7 * 864e5;
  const latest = new Map();
  for (const tx of db.transactions) {
    if (tx.type !== "purchase" || tx.balanceSync || tx.sourceBookGuid || tx.activeMealId) continue;
    const time = Date.parse(tx.date);
    if (time >= weekStart && time <= now && time > (latest.get(tx.accountId) || 0)) latest.set(tx.accountId, time);
  }
  const ranks = {collective:0, priority:1, recent:2, other:3};
  const accounts = [];
  for (const a of db.accounts) {
    if (a.deleted || a.isSystem) continue;
    const collective = eventMode(a) === "collective";
    if (a.isEvent && (event || !collective)) continue;
    const name = tallyLabel(a);
    const group = collective ? "collective" : a.priority ? "priority" : latest.has(a.id) ? "recent" : "other";
    accounts.push({id:a.id, name, fullName:name !== a.name ? a.name : undefined, group,
      contextLabel:contextLabel(a), priority:!!a.priority || collective, activeLast24Hours:latest.get(a.id) >= now - 864e5});
  }
  return accounts.sort((a,b) => ranks[a.group] - ranks[b.group] || a.name.localeCompare(b.name, "de"));
}

app.get("/api/tally/accounts/:id/contexts", (req,res) => {
  const account = activeCollective(req.params.id);
  if (!account || !contextLabel(account)) return res.status(404).json({error:"Konto nicht verfügbar."});
  const now = Date.now(), recent = new Map();
  for (const tx of db.transactions) {
    if (tx.accountId !== account.id || !tx.bookingContext) continue;
    const time = Date.parse(tx.date), key = tx.bookingContext.toLocaleLowerCase("de");
    if (time > now-864e5 && time <= now && (!recent.has(key) || time > recent.get(key).time))
      recent.set(key,{name:tx.bookingContext,time});
  }
  res.json([...recent.values()].sort((a,b)=>b.time-a.time).map(r=>r.name));
});

app.post("/api/accounts", (req, res) => {
  const name = String(req.body.name || "").trim();
  const surname = String(req.body.surname || "").trim();
  if (!name || name.length > 120 || surname.length > 120 || /[<>]/.test(name + surname))
    return res.status(400).json({error:"Gültigen Namen und Nachnamen angeben."});
  if (db.accounts.some(a => a.name.toLowerCase() === name.toLowerCase()))
    return res.status(409).json({ error: "Name existiert bereits" });
  const acc = initialAccount(name, surname);
  db.accounts.push(acc);
  addAudit(req, "account.created", `Konto „${name}“ angelegt`,
    { type: "account", id: acc.id, label: acc.name }, null,
    { name: acc.name }, null,
    { type: "tally", accountId: null, name: "Strichliste" });
  saveDB(db);
  res.json({ id: acc.id, name: acc.name });
});

/* --- Nutzer-Login --- */
app.post("/api/login", (req, res) => {
  const name = String(req.body.name || "").trim();
  const password = String(req.body.password || "");
  const acc = db.accounts.find(a => !a.isEvent && !a.deleted && !a.isSystem && a.name.toLowerCase() === name.toLowerCase());
  if (!acc) return res.status(401).json({ error: "Name oder Passwort falsch" });
  if (!checkPassword(acc.initialPassword ? password.normalize("NFC") : password, acc.passwordHash)) {
    return res.status(401).json({ error: "Name oder Passwort falsch" });
  }
  const token = crypto.randomBytes(24).toString("hex");
  tokens.set(token, acc.id);
  res.json({ token, account: { ...accountView(acc), roles: acc.roles || {} } });
});

app.post("/api/logout", requireUser, (req, res) => {
  const token = (req.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  tokens.delete(token);
  res.json({ ok: true });
});

function personalStatement(id, transactions, personalMeals) {
  const statement = db.settings.bookStatements?.[id];
  const covered = statement ? statementCoverage(statement) : () => false;
  const bookEntries = statement?.entries || [];
  const meals = new Map(db.activeMeals.map(meal => [meal.id, meal]));
  const runs = new Map(db.exportRuns.map(run => [run.id, run.number]));
  const byGnuCashId = new Map(personalMeals.filter(meal => meal.bookGuid).map(meal => [meal.bookGuid, meal]));
  const byBWId = new Map(personalMeals.map(meal => [entryId("meal:" + meal.id), meal]));
  const seenMeals = new Set();
  const entries = bookEntries.map(entry => {
    const looksLikeMeal = /aktiven[-\s]*(?:es+en|mahl)/i.test(entry.description);
    const matches = looksLikeMeal && entry.number
      ? personalMeals.filter(meal => meal.date === entry.date && meal.identifier === entry.number)
      : [];
    const meal = byGnuCashId.get(entry.id) || byBWId.get(entry.bwId) || (matches.length === 1 ? matches[0] : null);
    if (meal) seenMeals.add(meal.id);
    return {...entry, source:"GnuCash", mealId:meal?.id};
  });
  const localDetails = [];
  for (const tx of transactions) {
    if (tx.eventSettled || (statement && tx.balanceSync)) continue;
    const meal = meals.get(tx.activeMealId);
    const linked = tx.sourceBookGuid || tx.bookImportId;
    const booked = meal ? meal.exported : tx.exported;
    const run = runs.get(tx.exportRunId || meal?.exportRunId);
    const counterAccount = tx.eventName || (meal || linked || tx.balanceSync ? "" :
      (tx.type === "deposit" ? gnu().cashAccount : gnu().revenueDrinks).split(":").at(-1));
    const entry = {
      date:localDate(tx.date), time:tx.activeMealId || tx.sourceBookGuid || tx.balanceSync ? "" :
        new Intl.DateTimeFormat("de-DE",{timeZone:"Europe/Berlin", hour:"2-digit", minute:"2-digit"}).format(new Date(tx.date)),
      description:tx.description, memo:"",
      amount:changeInCents(tx), items:tx.items || [], mealId:meal?.id,
      number:meal?.identifier || run || "",
      counterAccounts:counterAccount ? [counterAccount] : [],
      source:tx.balanceSync ? "Saldenabgleich" : booked ? "Bereits gebucht" : "Offen in BW"
    };
    if (covered(tx)) {
      if (!linked && !meal && !tx.balanceSync) localDetails.push(entry);
    } else {
      if (meal) seenMeals.add(meal.id);
      entries.push(entry);
    }
  }
  for (const meal of personalMeals) {
    if (seenMeals.has(meal.id)) continue;
    entries.push({mealId:meal.id, date:meal.date, description:meal.name, counterAccounts:[],
      number:meal.identifier, amount:0, infoOnly:true, source:"Aktivenessen"});
  }
  entries.sort((a,b) => (a.date + (a.time || "")).localeCompare(b.date + (b.time || "")));
  let balance = 0;
  for (const entry of entries) {
    balance += entry.amount;
    entry.balance = balance;
  }
  return {date:statement?.date, entries:entries.reverse(), localDetails};
}

app.get("/api/me", requireUser, (req, res) => {
  const tx = db.transactions
    .filter(t => t.accountId === req.account.id)
    .sort((a, b) => b.date.localeCompare(a.date));
  const id = req.account.id;
  const personalMeals = db.activeMeals
    .filter(meal => meal.createdByAccountId === id || meal.payer?.accountId === id ||
      meal.payouts?.some(payer => payer.accountId === id) || meal.participants?.some(person => person.accountId === id));
  const activeMeals = personalMeals
    .sort((a, b) => (b.date + b.createdAt).localeCompare(a.date + a.createdAt))
    .map(meal => activeMealView(meal, id));
  res.set("Cache-Control", "private, no-store");
  res.json({ account: { ...accountView(req.account), ...mailProfile(req.account), roles: req.account.roles || {}, initialPassword: !!req.account.initialPassword },
    transactions: tx, activeMeals, statement:personalStatement(id, tx, personalMeals) });
});

app.put("/api/me/email", requireUser, (req, res) => {
  const raw = req.body?.email;
  if (typeof raw !== "string" || /[\r\n]/.test(raw))
    return res.status(400).json({error:"Bitte eine einzelne E-Mail-Adresse eingeben."});
  const address = raw.trim();
  if (address && !validAddress(address))
    return res.status(400).json({error:"Bitte eine gültige E-Mail-Adresse eingeben."});
  if (address) req.account.emailOverride = address;
  else delete req.account.emailOverride;
  saveDB(db);
  res.set("Cache-Control", "private, no-store").json(mailProfile(req.account));
});

app.use("/api/xxx/debt-mails", requireUser, (req, res, next) => {
  res.set("Cache-Control", "private, no-store");
  if (!req.account.roles?.gnucash) return res.status(403).json({error:"Diese Funktion ist für XXX freigegeben."});
  next();
});

function debtRecipient(account) {
  if (account.deleted || account.isEvent || account.isSystem) return null;
  const amountCents = -Math.round(balanceOf(account.id) * 100);
  if (amountCents <= 0) return null;
  const {email} = mailProfile(account);
  return {id:account.id, name:account.name, email, amountCents};
}

app.get("/api/xxx/debt-mails", (req, res) => {
  const recipients = db.accounts.map(debtRecipient).filter(Boolean);
  res.json(recipients.sort((a,b) => a.name.localeCompare(b.name, "de")));
});

app.post("/api/xxx/debt-mails/preview", (req, res) => {
  const ids = req.body?.accountIds;
  if (!Array.isArray(ids) || !ids.length || !ids.every(id => typeof id === "string"))
    return res.status(400).json({error:"Bitte mindestens eine Person auswählen."});
  const selected = new Set(ids);
  const now = new Date();
  const drafts = [];
  for (const account of db.accounts) {
    if (!selected.has(account.id)) continue;
    const person = debtRecipient(account);
    if (person && person.email) drafts.push(draftFor({...person, first:nameParts(account).first}, now));
  }
  drafts.sort((a,b) => a.name.localeCompare(b.name, "de"));
  res.json({asOf:now.toISOString(), drafts, skipped:selected.size - drafts.length});
});

app.post("/api/me/password", requireUser, (req, res) => {
  const { oldPassword, newPassword } = req.body;
  if (!checkPassword(req.account.initialPassword ? String(oldPassword || "").normalize("NFC") : oldPassword, req.account.passwordHash))
    return res.status(401).json({ error: "Aktuelles Passwort ist falsch" });
  if (String(newPassword || "").length < 4)
    return res.status(400).json({ error: "Neues Passwort braucht mindestens 4 Zeichen" });
  if (typeof newPassword !== "string" || (req.account.initialPassword && checkPassword(newPassword.normalize("NFC"), req.account.passwordHash)))
    return res.status(400).json({error:"Bitte ein anderes Passwort wählen."});
  req.account.passwordHash = hashPassword(newPassword);
  req.account.initialPassword = false;
  revokeSessions(req.account.id, (req.get("Authorization") || "").replace(/^Bearer\s+/i, ""));
  addAudit(req, "account.password_changed", `Passwort für „${req.account.name}“ geändert`,
    { type: "account", id: req.account.id, label: req.account.name }, null, null);
  saveDB(db);
  res.json({ ok: true });
});

app.post("/api/purchase", optionalUser, (req, res) => {
  const acc = db.accounts.find(a => a.id === req.body.accountId && !a.deleted && !a.isSystem);
  if (!acc) return res.status(404).json({ error: "Konto nicht gefunden" });
  const mode = eventMode(acc);
  if (mode === "personal" || mode === "hidden" || (mode === "direct" && !bookableEvent(acc)))
    return res.status(400).json({error:"Für diesen Anlass ist keine Direktbuchung möglich."});
  const label = contextLabel(acc);
  const bookingContext = label && typeof req.body.bookingContext === "string" ? req.body.bookingContext.trim().normalize("NFC") : "";
  if (label && (!bookingContext || bookingContext.length > 120 || /[\x00-\x1f]/.test(bookingContext)))
    return res.status(400).json({error:label + " mit höchstens 120 Zeichen eingeben."});
  let event = mode === "direct" ? acc : null;
  if (req.body.eventId) {
    event = db.accounts.find(a => a.id === req.body.eventId);
    if (!bookableEvent(event) || eventMode(event) !== "personal" || acc.isEvent)
      return res.status(400).json({error:"Bitte eine gültige Veranstaltung und ein Personenkonto auswählen."});
  }
  const pool = loadProducts().concat(activeDrinks(db.settings), event ? activeDrinks(event) : [], eventRecipes(db,event).map(offer));
  const items = [];
  for (const it of req.body.items || []) {
    const p = pool.find(x => x.name === it.name && x.recipeId === it.recipeId);
    const qty = Math.floor(Number(it.qty));
    if (!p || !Number.isSafeInteger(qty) || qty <= 0 || qty > 10000)
      return res.status(400).json({error:"Getränk oder Menge nicht mehr verfügbar. Bitte die Auswahl neu laden."});
    if (it.price !== undefined && it.price !== p.price)
      return res.status(409).json({error:"Der Preis hat sich geändert. Bitte die Auswahl prüfen."});
    items.push({ name: p.name, price: p.price, qty, ...(p.recipeId ? {recipeId:p.recipeId} : {}) });
  }
  if (!items.length) return res.status(400).json({ error: "Keine Artikel" });
  const total = Math.round(items.reduce((s, i) => s + i.price * i.qty, 0) * 100) / 100;
  const tx = {
    id: newId(), accountId: acc.id, type: "purchase",
    date: new Date().toISOString(), items, total,
    ...(bookingContext ? {bookingContext} : {}),
    ...(event ? {eventId:event.id, eventName:eventLabel(event)} : {}),
    description: (req.body.eventId ? eventLabel(event) + " · " : "") + items.map(i => `${i.qty}x ${i.name}`).join(", "),
    exported: false
  };
  db.transactions.push(tx);
  addAudit(req, "purchase.created", `Kauf über ${total.toFixed(2).replace(".", ",")} € auf „${acc.name}“ gebucht`,
    { type: "transaction", id: tx.id, label: tx.description }, null,
    { accountId: acc.id, accountName: acc.name, total, items: tx.items }, null,
    req.account ? null : { type: "tally", accountId: null, name: "Strichliste" });
  saveDB(db);
  res.json({ ok: true, transaction: tx, balance: balanceOf(acc.id) });
});


/* ---------- Aktivenessen ---------- */
const RECEIPT_TYPES = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif",
  "image/heic": "heic", "image/heif": "heif"
};
function receiptTypeFrom(req) {
  const declared = String(req.query.type || "").toLowerCase();
  if (RECEIPT_TYPES[declared]) return declared;
  const ext = path.extname(String(req.query.name || "")).toLowerCase();
  return ({ ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif", ".heic": "image/heic", ".heif": "image/heif" })[ext];
}
function imageSignatureMatches(buf, type) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return false;
  if (type === "image/jpeg") return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  if (type === "image/png") return buf.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]));
  if (type === "image/gif") return ["GIF87a", "GIF89a"].includes(buf.subarray(0, 6).toString("ascii"));
  if (type === "image/webp") return buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP";
  if (type === "image/heic" || type === "image/heif") return buf.subarray(4, 8).toString("ascii") === "ftyp";
  return false;
}

/* Bilder werden einzeln hochgeladen; Kamera kann dadurch mehrfach benutzt werden. */
app.post("/api/active-meals/upload", optionalUser, (req, res) => {
  const type = receiptTypeFrom(req);
  if (!type) return res.status(400).json({ error: "Nur Bilddateien sind erlaubt" });
  if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: "Kein Bild empfangen" });
  if (!imageSignatureMatches(req.body, type)) return res.status(400).json({ error: "Die Datei ist kein gültiges Bild" });
  const filename = `${Date.now()}-${newId()}.${RECEIPT_TYPES[type]}`;
  fs.writeFileSync(path.join(RECEIPTS_DIR, filename), req.body);
  res.json({ ok: true, file: filename, url: `/assets/receipts/${filename}` });
});

/* Auswahl für das Formular. Vom eigenen Konto aus wird dieses Konto vorausgewählt,
 * von der öffentlichen Strichliste aus die konfigurierte XXX-Karte. */
const mealSubsidyCents = () => db.settings.mealSubsidyCents ?? 400;
function mealGuestAccount(account) {
  return account.isEvent && (account.collectiveSource === "4730" || account.gnucashAccount === gnu().guestAccount ||
    ["gast", "gast mitgliederwerbung", "mitgliederwerbung"].includes(normalizedName(account.name)));
}

app.get("/api/active-meals/options", optionalUser, (req, res) => {
  res.json({
    accounts: db.accounts
      .filter(a => !a.deleted && !a.isSystem && (!a.isEvent || mealGuestAccount(a)))
      .map(a => ({ id: a.id, name: a.name, collective:mealGuestAccount(a) }))
      .sort((a, b) => a.name.localeCompare(b.name, "de")),
    subsidyPerPerson:mealSubsidyCents() / 100,
    creatorAccountId: req.account ? req.account.id : null,
    xxxCard: {
      name: "XXX-Karte",
      accountNumber: db.settings.xxxCardAccountNumber || "",
      configured: !!db.settings.xxxCardAccountNumber
    }
  });
});

app.post("/api/active-meals", optionalUser, (req, res) => {
  const name = String(req.body.name || "").trim();
  const date = String(req.body.date || "").trim();
  const totalCents = parseMoneyCents(req.body.total);
  const rawParticipants = Array.isArray(req.body.participants) ? req.body.participants : [];
  const roleAllocation = req.body.allocation === "roles" || rawParticipants.some(p => p?.role !== undefined || p?.portions !== undefined);
  let subsidyCents = roleAllocation ? 0 : parseMoneyCents(req.body.subsidy || "0");
  let guestCents = roleAllocation ? 0 : parseMoneyCents(req.body.guestShare || "0");
  if (!name) return res.status(400).json({ error: "Name des Aktivenessens fehlt" });
  if (name.length > 120 || /[<>]/.test(name)) return res.status(400).json({ error: "Name ist zu lang oder enthält ungültige Zeichen" });
  if (!validDateOnly(date)) return res.status(400).json({ error: "Ungültiges Datum" });
  if (!Number.isSafeInteger(totalCents) || totalCents <= 0) return res.status(400).json({ error: "Gesamtkosten müssen größer als 0 sein" });

  if (roleAllocation && req.body.subsidyPerPerson !== undefined &&
      parseMoneyCents(req.body.subsidyPerPerson) !== mealSubsidyCents())
    return res.status(409).json({error:"Der Zuschuss wurde geändert. Bitte die neue Aufteilung prüfen.",
      subsidyPerPerson:mealSubsidyCents()/100});

  const rawReceipts = Array.isArray(req.body.receipts) ? req.body.receipts : [];
  const receipts = [...new Set(rawReceipts.map(x => String(x)))];
  if (!receipts.length) return res.status(400).json({ error: "Mindestens ein Rechnungsfoto ist nötig" });
  if (receipts.length > 10) return res.status(400).json({ error: "Maximal 10 Rechnungsfotos" });
  for (const file of receipts) {
    if (!/^\d+-[a-f0-9]{12}\.(jpg|png|webp|gif|heic|heif)$/.test(file) || !fs.existsSync(path.join(RECEIPTS_DIR, file)))
      return res.status(400).json({ error: "Ein Rechnungsfoto wurde nicht gefunden" });
  }

  const seen = new Set();
  let participants = [];
  for (const raw of rawParticipants) {
    const accountId = String(raw?.accountId || "");
    if (seen.has(accountId)) continue;
    const acc = db.accounts.find(a => a.id === accountId && !a.deleted && !a.isSystem &&
      (!a.isEvent || (roleAllocation && mealGuestAccount(a))));
    if (!acc) return res.status(400).json({ error: "Ein ausgewähltes Konto existiert nicht mehr" });
    const collective = mealGuestAccount(acc);
    const role = collective ? "kgast" : (raw.role ?? "voll");
    if (!["voll","aktiv","kgast"].includes(role)) return res.status(400).json({error:"Ungültige Teilnehmergruppe."});
    seen.add(accountId);
    const manual = raw.price !== null && raw.price !== undefined && String(raw.price).trim() !== "";
    const cents = manual ? parseMoneyCents(raw.price) : null;
    if (manual && (!Number.isInteger(cents) || cents < 0)) return res.status(400).json({ error: `Ungültiger Betrag für ${acc.name}` });
    participants.push({ accountId: acc.id, name: acc.name, manual, cents, collective, role, portions:raw.portions });
  }
  if (roleAllocation) {
    try {
      const split = splitActiveMeal(totalCents, participants, mealSubsidyCents());
      if (split.difference !== 0) return res.status(400).json({error:"Die Teilnehmerbeträge und der Zuschuss müssen zusammen die Rechnungssumme ergeben."});
      participants = split.rows;
      subsidyCents = split.subsidy;
      guestCents = split.guestShare;
    } catch (error) {
      return res.status(400).json({error:error.message});
    }
  } else {
    if (!Number.isSafeInteger(guestCents) || !Number.isSafeInteger(subsidyCents) || guestCents + subsidyCents > totalCents)
      return res.status(400).json({error:"Gastanteil und Zuschuss dürfen die Rechnungssumme nicht überschreiten."});
    if (!participants.length && subsidyCents+guestCents!==totalCents) return res.status(400).json({ error: "Mindestens eine Person auswählen" });
  
    const manualTotal = participants.reduce((sum, p) => sum + (p.manual ? p.cents : 0), 0);
    const automatic = participants.filter(p => !p.manual);
    let remaining = totalCents - subsidyCents - guestCents - manualTotal;
    if (remaining < 0) return res.status(400).json({ error: `Die Einzelbeträge sind ${(Math.abs(remaining) / 100).toFixed(2).replace(".", ",")} € höher als die Gesamtkosten` });
    if (!automatic.length && remaining !== 0)
      return res.status(400).json({ error: `Noch ${(remaining / 100).toFixed(2).replace(".", ",")} € offen – einen Betrag leeren oder anpassen` });
    if (automatic.length) {
      const base = Math.floor(remaining / automatic.length);
      let extra = remaining % automatic.length;
      automatic.forEach(p => { p.cents = base + (extra-- > 0 ? 1 : 0); });
      remaining = 0;
    }
  }

  if (req.body.payerKind === "account") {
    const requestedPayer = db.accounts.find(a => a.id === String(req.body.payerAccountId || "") && !a.isEvent && !a.deleted && !a.isSystem);
    if (!requestedPayer) return res.status(400).json({ error: "Der ausgewählte Ausleger existiert nicht mehr" });
  }

  const identifier = nextActiveMealIdentifier(date);
  const mealId = newId();
  const now = new Date().toISOString();
  const bookedAt = `${date}T${now.slice(11)}`;
  const payer = activeMealPayerFrom(req.body, req.account || null);
  const meal = {
    id: mealId, identifier, name, date, total: totalCents / 100, subsidy:subsidyCents/100,guestShare:guestCents/100,
    ...(roleAllocation ? {subsidyPerPerson:mealSubsidyCents()/100} : {}),
    participants: participants.map(p => ({accountId:p.accountId, name:p.name, price:p.cents/100, manual:p.manual,
      ...(roleAllocation ? {role:p.role, portions:p.portions, collective:p.collective, grant:p.grant/100} : {})})),
    receipts, createdAt: new Date().toISOString(),
    createdByAccountId: req.account ? req.account.id : null,
    source: req.account ? "account" : "tally",
    payer, exported: false, exportedAt: null
  };
  if(req.body.extraPayers?.length){
    if(!Array.isArray(req.body.extraPayers))return res.status(400).json({error:"Ungültige Ausleger."});
    const shares=[],used=new Set([payer.accountId || payer.gnucashAccount]);
    let extra=0;
    for(const row of req.body.extraPayers){
      const acc=db.accounts.find(a=>a.id===row.accountId && !a.isEvent && !a.isSystem && !a.deleted);
      const n=parseMoneyCents(row.amount);
      if(!acc || used.has(acc.id) || !Number.isSafeInteger(n) || n<=0)return res.status(400).json({error:"Zweite Auslage und Betrag prüfen."});
      used.add(acc.id);extra+=n;
      shares.push({...activeMealPayerFrom({payerAccountId:acc.id},null),amount:n/100});
    }
    if(extra>=totalCents)return res.status(400).json({error:"Für den ersten Ausleger muss ein positiver Rest verbleiben."});
    meal.payouts=[{...payer,amount:(totalCents-extra)/100},...shares];
  }
  db.activeMeals.push(meal);
  for (const p of meal.participants.filter(person => !person.collective)) {
    db.transactions.push({
      id: newId(), accountId: p.accountId, type: "purchase", date: bookedAt,
      items: [], total: p.price,
      description: `${identifier} · Aktivenessen: ${name}`,
      exported: false, activeMealId: mealId
    });
  }
  /* Der Ausleger bekommt intern den Gesamtbetrag gutgeschrieben. Seine eigene
   * Beteiligung wird durch seine normale Teilnehmer-Buchung wieder abgezogen. */
  addActiveMealPayout(meal);
  addAudit(req, "active_meal.created", `${identifier} · Aktivenessen „${name}“ angelegt`,
    { type: "active-meal", id: meal.id, label: `${identifier} · ${name}` }, null,
    {
      identifier, name, date, total: meal.total,
      payer: meal.payer,
      participants: meal.participants,
      receiptCount: meal.receipts.length,
      receipts: meal.receipts.slice()
    },
    { source: meal.source },
    req.account ? null : { type: "tally", accountId: null, name: "Strichliste" });
  saveDB(db);
  res.json({ ok: true, meal: activeMealView(meal, req.account && req.account.id) });
});

/* Admin und XXX sehen alle Aktivenessen samt Rechnungsbildern. */
app.get("/api/admin/active-meals", allow("gnucash"), (req, res) => {
  res.json((db.activeMeals || [])
    .slice()
    .sort((a, b) => (b.date + b.createdAt).localeCompare(a.date + a.createdAt))
    .map(m => activeMealView(m, req.account && req.account.id)));
});

async function sendMealPdf(meals, label, res) {
  try {
    const views = meals.map(meal => activeMealView(meal));
    views.forEach((view, index) => { view.receipts = meals[index].receipts || []; });
    const pdf = await buildMealPdf(views, RECEIPTS_DIR, label);
    const filename = label.replace(/[^a-z0-9_-]+/gi, "-") + ".pdf";
    res.set("Cache-Control", "private, no-store");
    res.attachment(filename).type("application/pdf").send(Buffer.from(pdf));
  } catch (error) {
    console.error("Aktivenessen-PDF:", error.message);
    res.status(422).json({error:error.message});
  }
}

app.get("/api/admin/active-meals/pdf", allow("gnucash"), async (req, res) => {
  const semester = String(req.query.semester || "");
  if (!/^(SS|WS)\d{2}$/.test(semester)) return res.status(400).json({error:"Ein Semester auswählen."});
  const meals = db.activeMeals.filter(meal => activeMealSemesterCode(meal.date) === semester)
    .sort((a, b) => a.date.localeCompare(b.date) || a.identifier.localeCompare(b.identifier, "de", {numeric:true}));
  if (!meals.length) return res.status(404).json({error:"Keine Aktivenessen in diesem Semester."});
  await sendMealPdf(meals, "Aktivenessen-" + semester, res);
});

app.get("/api/admin/active-meals/:id/pdf", allow("gnucash"), async (req, res) => {
  const meal = db.activeMeals.find(entry => entry.id === req.params.id);
  if (!meal) return res.status(404).json({error:"Aktivenessen nicht gefunden."});
  await sendMealPdf([meal], "Aktivenessen-" + meal.identifier, res);
});

app.get("/api/admin/active-meals/settings", allow("gnucash"), (req, res) => {
  const card = xxxCardInternalAccount();
  res.json({
    xxxCardAccountNumber: db.settings.xxxCardAccountNumber || "",
    xxxCardInternalAccountId: card.id,
    xxxCardInternalAccountName: card.name,
    xxxCardBalance: balanceOf(card.id), subsidyPerPerson: mealSubsidyCents() / 100
  });
});

app.put("/api/admin/active-meals/settings", allow("gnucash"), (req, res) => {
  const value = String(req.body.xxxCardAccountNumber ?? db.settings.xxxCardAccountNumber).trim();
  if (value.length > 120 || /[<>\r\n]/.test(value))
    return res.status(400).json({ error: "Ungültige Kontonummer" });
  const nextSubsidy = req.body.subsidyPerPerson === undefined ? mealSubsidyCents() : parseMoneyCents(req.body.subsidyPerPerson);
  if (!Number.isSafeInteger(nextSubsidy) || nextSubsidy < 0)
    return res.status(400).json({error:"Gültigen Zuschuss pro Person eingeben."});
  const before = {xxxCardAccountNumber: db.settings.xxxCardAccountNumber || "", subsidyPerPerson:mealSubsidyCents()/100};
  db.settings.mealSubsidyCents = nextSubsidy;
  db.settings.xxxCardAccountNumber = value;
  /* Nicht exportierte Karten-Buchungen folgen der aktuellen Einstellung. */
  for (const meal of db.activeMeals || []) {
    if (meal.payer && meal.payer.type === "xxx-card" && !meal.exported)
      meal.payer.gnucashAccount = value || "XXX-Karte";
  }
  const card = xxxCardInternalAccount();
  addAudit(req, "active_meal.settings_changed", "Einstellungen für Aktivenessen geändert",
    { type: "setting", id: "xxxCardAccountNumber", label: "XXX-Karte" }, before,
    { xxxCardAccountNumber: value, subsidyPerPerson:nextSubsidy/100, internalAccountId: card.id, internalAccountName: card.name });
  saveDB(db);
  res.json({
    ok: true, xxxCardAccountNumber: value,
    xxxCardInternalAccountId: card.id, xxxCardInternalAccountName: card.name,
    xxxCardBalance: balanceOf(card.id), subsidyPerPerson: mealSubsidyCents() / 100
  });
});

/* Falsch gewählten Ausleger korrigieren. Dabei wird die interne Gutschrift
 * vollständig auf das neue Konto verschoben. */
app.put("/api/admin/active-meals/:id/payer", allow("gnucash"), (req, res) => {
  const meal = (db.activeMeals || []).find(m => m.id === req.params.id);
  if (!meal) return res.status(404).json({ error: "Aktivenessen nicht gefunden" });
  if (meal.exported || meal.runId) return res.status(409).json({error:"Das Essen ist bereits in einem Buchungslauf. Offenen Lauf zuerst verwerfen, gebuchte Auslagen per Korrekturbuchung berichtigen."});
  if (req.body.payerKind === "account") {
    const requestedPayer = db.accounts.find(a => a.id === String(req.body.payerAccountId || "") && !a.isEvent && !a.deleted && !a.isSystem);
    if (!requestedPayer) return res.status(400).json({ error: "Der ausgewählte Ausleger existiert nicht mehr" });
  }
  if(meal.payouts?.length>1)return res.status(409).json({error:"Dieses Essen hat mehrere Ausleger. Einzelwechsel nicht möglich."});
  const beforePayer = { ...(meal.payer || {}) };
  const payer = activeMealPayerFrom(req.body, null);
  removeActiveMealPayout(meal.id);
  meal.payer = payer;
  delete meal.payouts;
  addActiveMealPayout(meal);
  meal.exported = false;
  meal.exportedAt = null;
  for (const t of db.transactions) {
    if (t.activeMealId === meal.id && !t.activeMealPayout) t.exported = false;
  }
  addAudit(req, "active_meal.payer_changed", `${meal.identifier} · Ausleger geändert`,
    { type: "active-meal", id: meal.id, label: `${meal.identifier} · ${meal.name}` },
    { payer: beforePayer }, { payer: meal.payer }, { exportStatusReset: true });
  saveDB(db);
  res.json({ ok: true, meal: activeMealView(meal, req.account && req.account.id) });
});

/* Ein Aktivenessen ist eine eigene GnuCash-Buchungsgruppe. Alle Zeilen tragen
 * dieselbe eindeutige Buchungsnummer (z. B. WS25 A1) und dasselbe Gegenkonto. */
app.get("/api/admin/active-meals/:id/export", allow("gnucash"), (req, res) => {
  const meal = (db.activeMeals || []).find(m => m.id === req.params.id);
  if (!meal) return res.status(404).json({ error: "Aktivenessen nicht gefunden" });
  const previous = db.exportRuns.find(r => r.id === (meal.runId || meal.exportRunId));
  if (previous && previous.mealIds.length === 1 && !previous.purchaseIds.length && !previous.ledgerIds.length)
    return sendRun(res, previous);
  if (previous || meal.exported) return res.status(409).json({error:"Bereits erfasst. Bitte den ursprünglichen Lauf im GnuCash-Arbeitsbereich öffnen."});
  stageRun(req,res,meal,true);
});

/* ---------- Papier-Strichliste als ODS (Backup) ---------- */
function odsEscape(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function buildBackupOds() {
  const prio = tallyAccounts().filter(a => a.priority).map(a => a.name);
  const drinks = loadProducts().filter(p => p.tally).slice(0, 5)
    .map(d => ({ name: d.name, price: d.price, cols: d.ticks === 10 ? 5 : 10 })); // 20 Striche=10 Spalten, 10 Striche=5 Spalten
  const BLANK_ROWS = 18;
  const today = new Date().toLocaleDateString("de-DE");
  const totalCols = 1 + drinks.reduce((s, d) => s + d.cols, 0);

  const numCell = (val) =>
    `<table:table-cell table:style-name="${val % 5 === 0 ? "cTickFive" : "cTick"}" office:value-type="float" office:value="${val}"><text:p>${val}</text:p></table:table-cell>`;
  const cellEmpty = (style, n = 1) =>
    `<table:table-cell table:style-name="${style}"${n > 1 ? ` table:number-columns-repeated="${n}"` : ""}/>`;

  let rows = "<table:table-header-rows>";

  rows += `<table:table-row>` +
    `<table:table-cell table:style-name="cTitle" office:value-type="string"><text:p>Strichliste – Backup</text:p></table:table-cell>` +
    cellEmpty("cTitle", totalCols - 1) + `</table:table-row>`;
  rows += `<table:table-row>` +
    `<table:table-cell table:style-name="cMeta" office:value-type="string"><text:p>Stand: ${odsEscape(today)}   ·   Nummer: __________</text:p></table:table-cell>` +
    cellEmpty("cMeta", totalCols - 1) + `</table:table-row>`;
  rows += `<table:table-row></table:table-row>`;

  // Kopfzeile: "Name" + je Getränk Überschrift über seine Spalten
  let head = `<table:table-cell table:style-name="cHead" office:value-type="string"><text:p>Name</text:p></table:table-cell>`;
  drinks.forEach(d => {
    head += `<table:table-cell table:style-name="cDrink" table:number-columns-spanned="${d.cols}" office:value-type="string"><text:p>${odsEscape(d.name)} (${d.price.toFixed(2).replace(".", ",")} €)</text:p></table:table-cell>`;
    if (d.cols > 1) head += `<table:covered-table-cell table:number-columns-repeated="${d.cols - 1}"/>`;
  });
  rows += `<table:table-row>${head}</table:table-row></table:table-header-rows>`;

  // Datenzeilen: pro Person zwei Zeilen (obere 1..cols, untere cols+1..2*cols)
  const names = prio.concat(Array.from({ length: BLANK_ROWS }, () => ""));
  names.forEach(name => {
    let top = `<table:table-cell table:style-name="cName" table:number-rows-spanned="2" office:value-type="string"><text:p>${odsEscape(name)}</text:p></table:table-cell>`;
    drinks.forEach(d => { for (let i = 1; i <= d.cols; i++) top += numCell(i); });
    rows += `<table:table-row table:style-name="rData">${top}</table:table-row>`;
    let bot = `<table:covered-table-cell/>`;
    drinks.forEach(d => { for (let i = d.cols + 1; i <= 2 * d.cols; i++) bot += numCell(i); });
    rows += `<table:table-row table:style-name="rData">${bot}</table:table-row>`;
  });

  const columns =
    `<table:table-column table:style-name="colName"/>` +
    drinks.map(d => `<table:table-column table:style-name="colBox" table:number-columns-repeated="${d.cols}"/>`).join("");

  const content = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" office:version="1.2">
<office:automatic-styles>
<style:style style:name="tallySheet" style:family="table" style:master-page-name="Default"/>
<style:style style:name="colName" style:family="table-column"><style:table-column-properties style:column-width="5.4cm"/></style:style>
<style:style style:name="colBox" style:family="table-column"><style:table-column-properties style:column-width="0.62cm"/></style:style>
<style:style style:name="rData" style:family="table-row"><style:table-row-properties style:row-height="0.6cm"/></style:style>
<style:style style:name="cTitle" style:family="table-cell"><style:text-properties fo:font-size="15pt" fo:font-weight="bold"/></style:style>
<style:style style:name="cMeta" style:family="table-cell"><style:text-properties fo:font-size="9pt" fo:color="#555555"/></style:style>
<style:style style:name="cHead" style:family="table-cell"><style:table-cell-properties fo:background-color="#f4efe2" fo:border="0.5pt solid #999999" style:vertical-align="middle"/><style:text-properties fo:font-size="9pt" fo:font-weight="bold"/></style:style>
<style:style style:name="cDrink" style:family="table-cell"><style:table-cell-properties fo:background-color="#f4efe2" fo:border="0.5pt solid #999999"/><style:paragraph-properties fo:text-align="center"/><style:text-properties fo:font-size="9pt" fo:font-weight="bold"/></style:style>
<style:style style:name="cName" style:family="table-cell"><style:table-cell-properties fo:wrap-option="wrap" fo:border="0.5pt solid #999999" style:vertical-align="middle"/><style:text-properties fo:font-size="10pt"/></style:style>
<style:style style:name="cTick" style:family="table-cell"><style:table-cell-properties fo:background-color="#fcfbf7" fo:border="0.4pt solid #cccccc"/><style:paragraph-properties fo:text-align="center"/><style:text-properties fo:font-size="7pt" fo:color="#b0b0b0"/></style:style>
<style:style style:name="cTickFive" style:family="table-cell"><style:table-cell-properties fo:background-color="#faf3df" fo:border="0.5pt solid #d4af37"/><style:paragraph-properties fo:text-align="center"/><style:text-properties fo:font-size="7pt" fo:color="#9a7d1e" fo:font-weight="bold"/></style:style>
</office:automatic-styles>
<office:body><office:spreadsheet>
<table:table table:name="Strichliste" table:style-name="tallySheet">
${columns}
${rows}
</table:table>
</office:spreadsheet></office:body>
</office:document-content>`;

  const styles = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-styles xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" office:version="1.2">
<office:automatic-styles>
<style:page-layout style:name="pm1"><style:page-layout-properties fo:page-width="21cm" fo:page-height="29.7cm" style:print-orientation="portrait" fo:margin-top="1cm" fo:margin-bottom="1cm" fo:margin-left="1cm" fo:margin-right="1cm" style:scale-to-X="1" style:scale-to-Y="0" style:table-centering="horizontal"/></style:page-layout>
</office:automatic-styles>
<office:master-styles><style:master-page style:name="Default" style:page-layout-name="pm1"/></office:master-styles>
</office:document-styles>`;

  const manifest = `<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2">
<manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.spreadsheet"/>
<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>
<manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/>
<manifest:file-entry manifest:full-path="meta.xml" manifest:media-type="text/xml"/>
</manifest:manifest>`;

  const meta = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-meta xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0" office:version="1.2"><office:meta><meta:generator>Getraenkekasse</meta:generator></office:meta></office:document-meta>`;

  return { content, styles, manifest, meta };
}

app.get("/api/admin/backup-tally.ods", allow("uebersicht"), (req, res) => {
  const parts = buildBackupOds();
  const dir = fs.mkdtempSync(path.join(require("os").tmpdir(), "ods-"));
  try {
    fs.mkdirSync(path.join(dir, "META-INF"));
    fs.writeFileSync(path.join(dir, "mimetype"), "application/vnd.oasis.opendocument.spreadsheet");
    fs.writeFileSync(path.join(dir, "content.xml"), parts.content);
    fs.writeFileSync(path.join(dir, "styles.xml"), parts.styles);
    fs.writeFileSync(path.join(dir, "meta.xml"), parts.meta);
    fs.writeFileSync(path.join(dir, "META-INF", "manifest.xml"), parts.manifest);
    const { execFileSync } = require("child_process");
    const out = path.join(dir, "out.ods");
    // mimetype muss als erste Datei und unkomprimiert in der ZIP liegen
    execFileSync("zip", ["-X", "-0", out, "mimetype"], { cwd: dir });
    execFileSync("zip", ["-rX", out, "content.xml", "styles.xml", "meta.xml", "META-INF"], { cwd: dir });
    const buf = fs.readFileSync(out);
    res.setHeader("Content-Type", "application/vnd.oasis.opendocument.spreadsheet");
    res.setHeader("Content-Disposition", `attachment; filename="strichliste-backup-${new Date().toISOString().slice(0, 10)}.ods"`);
    res.send(buf);
  } catch (e) {
    res.status(500).json({ error: "ODS-Erzeugung fehlgeschlagen: " + e.message });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
require("./stock-counts").mountStockCounts(app,{getDB:()=>db, allow, newId, saveDB, addAudit, loadProducts, validDateOnly, eventMode, eventLabel, parseMoneyCents});
mountBar(app,{getDB:()=>db, allow, optionalUser, saveDB, newId, parsePrice, loadProducts, addAudit});
function eventView(a) {
  return {id:a.id, name:eventLabel(a), mode:eventMode(a), startsAt:a.startsAt, endsAt:a.endsAt, allDay:a.allDay,
    customDrinks:activeDrinks(a), barDrinks:eventRecipes(db,a).map(offer)};
}
app.get("/api/events", (req,res) => res.json(db.accounts.filter(bookableEvent).map(eventView)));
app.get("/api/events/calendar", optionalUser, (req,res) => {
  const now = Date.now(), first = calendar.semesterStart(now);
  const entries = db.accounts.filter(a=>a.isEvent && !a.deleted && !a.calendarRemoved && a.startsAt &&
    calendar.dayInBerlin(Date.parse(a.endsAt)-1)>=first).map(a=>({
      id:a.id, name:eventLabel(a), mode:eventMode(a), startsAt:a.startsAt, endsAt:a.endsAt, allDay:a.allDay,
      status:Date.parse(a.startsAt)>now ? "upcoming" : Date.parse(a.endsAt)<=now ? "past" : "active"
    })).sort((a,b)=>a.startsAt.localeCompare(b.startsAt) || a.name.localeCompare(b.name,"de"));
  const roles = req.account?.roles || {};
  res.json({entries,canCreate:!!(roles.uebersicht || roles.schnapswart || roles.kneipwart),...calendarStatus()});
});
app.post("/api/events", allow("uebersicht","schnapswart","kneipwart"), (req,res) => {
  const {date,mode} = req.body, name = typeof req.body.name === "string" ? req.body.name.trim() : "";
  if (!name || name.length > 120 || /[\r\n]/.test(name) || !validDateOnly(date) || !["direct","personal"].includes(mode))
    return res.status(400).json({error:"Bitte Namen, Datum und Buchungsart angeben."});
  if (db.accounts.some(a=>!a.deleted && !a.calendarRemoved && a.startsAt && normalizedName(a.name)===normalizedName(name) && calendar.dayInBerlin(a.startsAt)===date))
    return res.status(409).json({error:"Diesen Termin gibt es an diesem Tag bereits."});
  const ev = {...calendar.newEvent(db,name,mode,newId),...calendar.dateWindow(date)};
  db.accounts.push(ev);
  addAudit(req,"event.created","Veranstaltung „"+name+"“ angelegt",{type:"event",id:ev.id,label:name},null,{name,date,mode});
  saveDB(db);
  res.json(eventView(ev));
});

/* Zeitlich begrenzter Zusatz zur Getränkekarte für beide Strichlisten und Direktbuchungen. */
app.get("/api/temporary-drinks", (req, res) => res.json(activeDrinks(db.settings)));
app.post("/api/temporary-drinks", (req, res) => {
  const name = String(req.body.name || "").trim();
  const price = parsePrice(req.body.price);
  if (!name || name.length > 120 || !Number.isFinite(price) || price <= 0)
    return res.status(400).json({error:"Name (maximal 120 Zeichen) und Preis über 0 € eingeben."});
  const drinks = activeDrinks(db.settings);
  if (listedRecipe(db,name) || drinks.concat(loadProducts()).some(drink => drink.name === name))
    return res.status(409).json({error:"Ein Getränk mit diesem Namen ist bereits verfügbar."});
  const event = db.accounts.find(a => bookableEvent(a) && activeDrinks(a).some(drink => drink.name === name));
  if (event)
    return res.status(409).json({error:`„${name}“ ist bereits bei „${eventLabel(event)}“ angelegt.`});
  const drink = {name, price, expiresAt:new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()};
  db.settings.customDrinks = [...drinks, drink];
  addAudit(req, "drink.temporary_added", "Temporäres Getränk angelegt",
    {type:"product", label:name}, null, drink, null, {type:"tally", name:"Strichliste"});
  saveDB(db);
  res.json(db.settings.customDrinks);
});
app.post("/api/temporary-drinks/remove", (req, res) => {
  const drinks = activeDrinks(db.settings);
  const drink = drinks.find(d => d.name === req.body.name);
  if (drink) {
    db.settings.customDrinks = drinks.filter(d => d !== drink);
    addAudit(req, "drink.temporary_removed", "Temporäres Getränk entfernt",
      {type:"product", label:drink.name}, drink, null, null, {type:"tally", name:"Strichliste"});
    saveDB(db);
  }
  res.json(activeDrinks(db.settings));
});

/* Temporäres "Getränk" (z. B. Cocktail) nur mit Name + Preis, je Veranstaltung */
app.post("/api/events/:id/drinks", (req, res) => {
  const ev = db.accounts.find(a => a.id === req.params.id && a.isEvent && !a.deleted);
  if (!bookableEvent(ev)) return res.status(404).json({ error: "Veranstaltung nicht verfügbar" });
  const name = String(req.body.name || "").trim();
  const price = parsePrice(req.body.price);
  if (!name || name.length > 120 || !Number.isFinite(price) || price <= 0)
    return res.status(400).json({error:"Name (maximal 120 Zeichen) und Preis über 0 € eingeben."});
  ev.customDrinks = activeDrinks(ev);
  if (listedRecipe(db,name,ev) || ev.customDrinks.concat(loadProducts(), activeDrinks(db.settings)).some(d => d.name === name))
    return res.status(409).json({ error: "Name existiert bereits" });
  ev.customDrinks.push({name, price, expiresAt:new Date(Date.now() + 864e5).toISOString()});
  addAudit(req, "event.drink_added", `Getränk „${name}“ zu „${ev.name}“ hinzugefügt`,
    { type: "event", id: ev.id, label: ev.name }, null,
    { drink: { name, price } }, null,
    { type: "tally", accountId: null, name: "Veranstaltungsseite" });
  saveDB(db);
  res.json({ ok: true, customDrinks: ev.customDrinks });
});

app.post("/api/events/:id/drinks/remove", (req, res) => {
  const ev = db.accounts.find(a => a.id === req.params.id && a.isEvent && !a.deleted);
  if (!bookableEvent(ev)) return res.status(404).json({ error: "Veranstaltung nicht verfügbar" });
  const removed = (ev.customDrinks || []).find(d => d.name === req.body.name) || null;
  ev.customDrinks = (ev.customDrinks || []).filter(d => d.name !== req.body.name);
  if (removed) addAudit(req, "event.drink_removed", `Getränk „${removed.name}“ aus „${ev.name}“ entfernt`,
    { type: "event", id: ev.id, label: ev.name }, { drink: removed }, null, null,
    { type: "tally", accountId: null, name: "Veranstaltungsseite" });
  saveDB(db);
  res.json({ ok: true, customDrinks: ev.customDrinks });
});

/* Arten von Veranstaltungen: Liste für die Schnellauswahl */
app.get("/api/eventkinds", (req, res) => res.json(db.eventKinds.filter(name => !["hidden","collective"].includes(eventMode({name,isEvent:true})))));
app.post("/api/admin/eventkinds", requirePin, (req, res) => {
  const name = String(req.body.name || "").trim();
  if (!name) return res.status(400).json({ error: "Name fehlt" });
  if (!db.eventKinds.some(k => k.toLowerCase() === name.toLowerCase())) {
    db.eventKinds.push(name);
    addAudit(req, "event_kind.created", `Veranstaltungsart „${name}“ angelegt`,
      { type: "event-kind", id: name, label: name }, null, { name });
    saveDB(db);
  }
  res.json(db.eventKinds);
});
app.post("/api/admin/eventkinds/delete", requirePin, (req, res) => {
  const name = String(req.body.name);
  const existed = db.eventKinds.includes(name);
  db.eventKinds = db.eventKinds.filter(k => k !== name);
  if (existed) addAudit(req, "event_kind.deleted", `Veranstaltungsart „${name}“ gelöscht`,
    { type: "event-kind", id: name, label: name }, { name }, null);
  saveDB(db);
  res.json(db.eventKinds);
});

/* Löschen (Admin-PIN oder BW): Buchungen bleiben für den Export erhalten */
app.post("/api/admin/events/delete", allow("uebersicht"), (req, res) => {
  const ev = db.accounts.find(a => a.id === req.body.id && a.isEvent && ["direct","personal"].includes(eventMode(a)));
  if (!ev) return res.status(404).json({ error: "Veranstaltung nicht gefunden" });
  const before = { deleted: !!ev.deleted, permanent: !!ev.permanent };
  ev.deleted = true;
  addAudit(req, "event.deleted", `Veranstaltung „${ev.name}“ gelöscht`,
    { type: "event", id: ev.id, label: ev.name }, before,
    { deleted: true, permanent: !!ev.permanent });
  saveDB(db);
  res.json({ ok: true });
});

/* --- Admin --- */
app.post("/api/admin/login", (req, res) => {
  if (String(req.body.pin) === ADMIN_PIN) return res.json({ ok: true });
  res.status(401).json({ error: "Falsche PIN" });
});

function eventTotals() {
  const totals = new Map();
  for (const tx of db.transactions) {
    if (tx.balanceSync || tx.activeMealId) continue;
    const cashCount = tx.type === "deposit" && tx.stockCountId;
    if (tx.type !== "purchase" && !cashCount) continue;
    const amount = cashCount ? -cents(tx.total) : cents(tx.total);
    const id = tx.eventId || tx.accountId;
    const total = totals.get(id) || {all:0, pending:0};
    total.all += amount;
    if (!tx.exported && !tx.eventSettled) total.pending += amount;
    totals.set(id, total);
  }
  return totals;
}

function adminAccountNumber(account) {
  if (account.collectiveTarget) return bookCode(account.collectiveTarget);
  if (account.fixedBookCode) return account.fixedBookCode;
  const path = account.gnucashAccount || (account.systemKind === "xxx-card" ? db.settings.xxxCardAccountNumber : "");
  if (!path) return "";
  return bookCode(path);
}

app.get("/api/admin/accounts", allow("uebersicht","gnucash"), (req, res) => {
  const totals = eventTotals();
  const snapshot = db.settings.eventBookBalances;
  res.json(db.accounts
    .filter(a => !a.deleted || (a.retiredSHV && db.transactions.some(t=>t.accountId===a.id)))
    .map(a => {
      const mode = eventMode(a);
      const result = {...accountView(a), accountNumber:adminAccountNumber(a), hasPassword:!!a.passwordHash, initialPassword:!!a.initialPassword,
        priority:!!a.priority, roles:a.roles || {}, isEvent:!!a.isEvent, mode, eventLabel:eventLabel(a),
        isSystem:!!a.isSystem, systemKind:a.systemKind || null, permanent:!!a.permanent, createdAt:a.createdAt, startsAt:a.startsAt, endsAt:a.endsAt, calendarRemoved:!!a.calendarRemoved};
      if (mode !== "direct" && mode !== "personal") return result;
      const amounts = totals.get(a.id);
      const bookBalance = snapshot && Object.hasOwn(snapshot.balances, a.gnucashAccount)
        ? snapshot.balances[a.gnucashAccount] : undefined;
      return {...result, eventTurnover:(amounts?.all || 0) / 100, eventPending:(amounts?.pending || 0) / 100,
        eventBookBalance:bookBalance === undefined ? null : bookBalance / 100,
        eventBookDate:bookBalance === undefined ? null : snapshot.date};
    })
    .sort((a, b) => (b.isEvent - a.isEvent) || a.name.localeCompare(b.name, "de")));
});

app.delete("/api/admin/accounts/:id", requirePin, (req, res) => {
  const id = req.params.id;
  const account = db.accounts.find(a => a.id === id && !a.deleted);
  if (!account) return res.status(404).json({error: "Konto nicht gefunden."});
  if (account.isSystem || account.isEvent || id === db.settings.xxxCardInternalAccountId)
    return res.status(409).json({error: "Hier können nur Personenkonten gelöscht werden."});
  if (db.transactions.some(t => t.accountId === id))
    return res.status(409).json({error: "Das Konto hat bereits Buchungen und kann deshalb nicht gelöscht werden."});
  const usedInMeal = db.activeMeals.some(meal => meal.createdByAccountId === id ||
    meal.payer?.accountId === id || meal.payouts?.some(p => p.accountId === id) ||
    meal.participants?.some(p => p.accountId === id));
  if (usedInMeal)
    return res.status(409).json({error: "Das Konto wird in einem Aktivenessen verwendet."});
  const accountPath = gnucashAccountPath(account);
  if (db.ledgerEntries.some(entry => entry.account === accountPath || entry.counterAccount === accountPath ||
      entry.bookSplits?.some(split => split.path === accountPath)))
    return res.status(409).json({error: "Im Kassenbuch ist dieser Kontopfad schon belegt."});
  db.accounts = db.accounts.filter(a => a.id !== id);
  addAudit(req, "account.deleted", "Unbenutztes Personenkonto gelöscht",
    {type: "account", id, label: account.name}, {name: account.name}, null);
  saveDB(db);
  revokeSessions(id);
  res.json({ok: true});
});

/* Priorität & Rollen setzen/entziehen (nur Admin-PIN) */
app.post("/api/admin/flags", requirePin, (req, res) => {
  const acc = db.accounts.find(a => a.id === req.body.accountId);
  if (!acc) return res.status(404).json({ error: "Konto nicht gefunden" });
  if (acc.isSystem) return res.status(400).json({ error: "Systemkonto kann keine Rollen erhalten" });
  const before = { priority: !!acc.priority, roles: { ...(acc.roles || {}) } };
  if (typeof req.body.priority === "boolean") acc.priority = req.body.priority;
  acc.roles = acc.roles || {};
  if (typeof req.body.gnucash === "boolean") acc.roles.gnucash = req.body.gnucash;
  if (typeof req.body.kneipwart === "boolean") acc.roles.kneipwart = req.body.kneipwart;
  if (typeof req.body.schnapswart === "boolean") acc.roles.schnapswart = req.body.schnapswart;
  if (typeof req.body.uebersicht === "boolean") acc.roles.uebersicht = req.body.uebersicht;
  addAudit(req, "account.flags_changed", `Rechte oder Priorität für „${acc.name}“ geändert`,
    { type: "account", id: acc.id, label: acc.name }, before,
    { priority: !!acc.priority, roles: { ...(acc.roles || {}) } });
  saveDB(db);
  res.json({ ok: true });
});

app.post("/api/admin/password", requirePin, (req, res) => {
  const acc = db.accounts.find(a => a.id === req.body.accountId);
  if (!acc) return res.status(404).json({ error: "Konto nicht gefunden" });
  if (acc.isSystem) return res.status(400).json({ error: "Systemkonto ist nicht anmeldbar" });
  if (String(req.body.newPassword || "").length < 4)
    return res.status(400).json({ error: "Passwort braucht mindestens 4 Zeichen" });
  acc.passwordHash = hashPassword(String(req.body.newPassword).normalize("NFC"));
  acc.initialPassword = true;
  revokeSessions(acc.id);
  addAudit(req, "account.password_reset", `Passwort für „${acc.name}“ durch Admin zurückgesetzt`,
    { type: "account", id: acc.id, label: acc.name }, null, null);
  saveDB(db);
  res.json({ ok: true });
});

app.get("/api/admin/audit-log", allow("gnucash"), (req, res) => {
  const limit = Math.min(1000, Math.max(1, Number(req.query.limit) || 300));
  const action = String(req.query.action || "").trim();
  const search = String(req.query.search || "").trim().toLowerCase();
  let entries = (db.auditLog || []).slice().reverse();
  if (action) entries = entries.filter(entry => entry.action === action);
  if (search) entries = entries.filter(entry => JSON.stringify(entry).toLowerCase().includes(search));
  res.json({ total: entries.length, entries: entries.slice(0, limit) });
});

app.get("/api/admin/transactions", allow("uebersicht","gnucash"), (req, res) => {
  const byName = Object.fromEntries(db.accounts.map(a => [a.id, a.name]));
  const tx = db.transactions
    .map(t => ({ ...t, accountName: byName[t.accountId] || "?" }))
    .sort((a, b) => b.date.localeCompare(a.date));
  res.json(tx);
});

app.put("/api/admin/products", allow("uebersicht"), (req, res) => {
  const before = loadProducts();
  const list = (req.body.products || [])
    .map(p => ({ name: String(p.name || "").trim(), price: parsePrice(p.price), image: String(p.image || "").trim(), tally: !!p.tally, ticks: Number(p.ticks) === 10 ? 10 : 20 }))
    .filter(p => p.name && !isNaN(p.price));
  const added = list.find(p => activeDrinks(db.settings).some(drink => drink.name === p.name));
  if (added) return res.status(409).json({error:`„${added.name}“ ist bereits als temporäres Getränk verfügbar.`});
  if (list.some(p => listedRecipe(db,p.name))) return res.status(409).json({error:"Ein Produktname ist bereits auf einer Veranstaltungskarte vergeben."});
  saveProducts(list);
  const after = loadProducts();
  addAudit(req, "products.changed", "Produktliste und Preise geändert",
    { type: "products", id: "products.csv", label: "Produkte & Preise" }, before, after,
    { beforeCount: before.length, afterCount: after.length });
  saveDB(db);
  res.json({ ok: true, products: after });
});

/* Produktbild hochladen (neu oder bestehendes ersetzen) -> assets/res/ */
app.post("/api/admin/upload", allow("uebersicht"), (req, res) => {
  let name = String(req.query.name || "").trim().replace(/[^\w.\-äöüÄÖÜß]/g, "_");
  if (name.startsWith(".") || !/^[\w.\-äöüÄÖÜß]+\.(png|jpe?g|webp|gif)$/i.test(name))
    return res.status(400).json({ error: "Nur Bilddateien (png, jpg, webp, gif)" });
  if (!Buffer.isBuffer(req.body) || !req.body.length)
    return res.status(400).json({ error: "Keine Datei empfangen" });
  const existed = fs.existsSync(path.join(ROOT, "assets", "res", name));
  fs.writeFileSync(path.join(ROOT, "assets", "res", name), req.body);
  addAudit(req, "product_image.uploaded", `Produktbild „${name}“ ${existed ? "ersetzt" : "hochgeladen"}`,
    { type: "product-image", id: name, label: name },
    existed ? { existed: true } : null, { existed: true, size: req.body.length }, { replaced: existed });
  saveDB(db);
  res.json({ ok: true, file: name });
});

app.post("/api/admin/deposit", requirePin, (req, res) => {
  const acc = db.accounts.find(a => a.id === req.body.accountId);
  const amount = parsePrice(req.body.amount);
  if (!acc) return res.status(404).json({ error: "Konto nicht gefunden" });
  if (!Number.isSafeInteger(cents(amount)) || amount === 0) return res.status(400).json({ error: "Ungültiger Betrag" });
  const tx = {
    id: newId(), accountId: acc.id, type: "deposit",
    date: new Date().toISOString(), items: [], total: amount,
    description: req.body.note || "Einzahlung", exported: false
  };
  db.transactions.push(tx);
  addAudit(req, "account.deposit", `Interne Buchung über ${amount.toFixed(2).replace(".", ",")} € für „${acc.name}“`,
    { type: "transaction", id: tx.id, label: tx.description }, null,
    { accountId: acc.id, accountName: acc.name, amount, description: tx.description });
  saveDB(db);
  res.json({ ok: true, balance: balanceOf(acc.id) });
});

/* CSV-Import: Zeilen "Name;Betrag" (Betrag mit , oder .) – verbucht Einzahlungen */
app.post("/api/admin/import", allow("gnucash"), (req, res) => {
  const text = typeof req.body === "string" ? req.body : String(req.body.csv || "");
  const createMissing = req.query.createMissing === "1";
  const fingerprint = crypto.createHash("sha256").update(text.trim().replace(/\r\n/g,"\n")).digest("hex");
  db.settings.legacyImports ||= [];
  if (db.settings.legacyImports.includes(fingerprint)) return res.status(409).json({error:"Diese Liste wurde bereits übernommen."});
  const report = { booked: 0, created: [], skipped: [] };
  const bookedEntries = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.replace(/"/g, "").match(/^(.+?)\s*[;,\t]\s*(-?\d+(?:[.,]\d+)?)\s*$/);
    if (!m) { report.skipped.push(line); continue; }
    const name = m[1].trim();
    const amount = parsePrice(m[2]);
    if (!name || isNaN(amount)) { report.skipped.push(line); continue; }
    let acc = db.accounts.find(a => a.name.toLowerCase() === name.toLowerCase());
    if (acc && (acc.isEvent || acc.isSystem || acc.deleted)) { report.skipped.push(line + " (kein aktives Personenkonto)"); continue; }
    if (!acc) {
      if (!createMissing) { report.skipped.push(line + "  (Konto unbekannt)"); continue; }
      acc = initialAccount(name);
      db.accounts.push(acc);
      report.created.push(name);
    }
    const tx = {
      id: newId(), accountId: acc.id, type: "deposit",
      date: new Date().toISOString(), items: [], total: amount,
      description: "Import / Guthaben", exported: true /* kommt aus der Buchhaltung */
    };
    db.transactions.push(tx);
    bookedEntries.push({ transactionId: tx.id, accountId: acc.id, accountName: acc.name, amount });
    report.booked++;
  }
  if (report.booked) db.settings.legacyImports.push(fingerprint);
  addAudit(req, "gnucash.import", `${report.booked} interne GnuCash-Buchung(en) importiert`,
    { type: "gnucash-import", id: newId(), label: "GnuCash-Import" }, null,
    { booked: bookedEntries, createdAccounts: report.created, skippedCount: report.skipped.length },
    { createMissing });
  saveDB(db);
  res.json(report);
});

/* ======================================================================
 * GnuCash-Arbeitsbereich
 *  - Kontenzuordnung (welcher GnuCash-Kontopfad für was)
 *  - Kassenbuch: freie Buchungen (Einkauf, Bank, Korrekturen ...)
 *  - Buchungsläufe: Export in zwei Schritten, damit parallel weiter
 *    gebucht werden kann und nichts verloren geht
 * ==================================================================== */

const localDate = iso => new Intl.DateTimeFormat("sv-SE",{timeZone:"Europe/Berlin"}).format(new Date(iso));
const cents = value => Math.round(Number(value) * 100);
function accountPath(id, previousTarget) {
  const a = db.accounts.find(a => a.id === id);
  if (!a) throw Error("Unbekanntes BW-Konto: " + id);
  const path = previousTarget ? resolveCollectiveTarget(previousTarget, a.gnucashAccount) : gnucashAccountPath(a);
  if (!path) throw Error("Für " + a.name + " den GnuCash-Kontopfad " + (previousTarget || a.collectiveTarget || a.fixedBookCode) + " zuordnen oder den Kontenbaum einlesen.");
  return path;
}
function groupsFor(sel, number, summaryDate) {
  const groups = [];
  const currency = gnu().currency;
  function add(source, date, description, postings, ref = number) {
    groups.push({source, date, description, postings, number:ref, currency});
  }
  const consumption = new Map();
  const accounts = new Map(db.accounts.map(account => [account.id, account]));
  for (const t of sel.purchases) {
    const amount = cents(t.total);
    const member = accountPath(t.accountId, t.collectivePostingTarget);
    const deposit = t.type === "deposit";
    let income = gnu().revenueDrinks;
    let eventName = "";
    if (!deposit && t.eventId && t.eventId !== t.accountId && !accounts.get(t.accountId)?.isEvent) {
      const event = accounts.get(t.eventId);
      eventName = t.eventName || (event && eventLabel(event)) || t.eventId;
      if (!event?.isEvent || !event.gnucashAccount || [member, income].includes(event.gnucashAccount))
        throw Error("Für „" + eventName + "“ ein eigenes GnuCash-Gegenkonto zuordnen oder zuerst den Kontenbaum abgleichen.");
      income = event.gnucashAccount;
    }
    if (summaryDate && !deposit && !t.stockCountId) {
      // Keep each event's revenue separate from other events and regular BW purchases.
      const key = eventName ? t.eventId : null;
      if (!consumption.has(key))
        consumption.set(key, {income, eventName, members:new Map(), ids:[]});
      const batch = consumption.get(key);
      batch.members.set(member, (batch.members.get(member) || 0) + amount);
      batch.ids.push(t.id);
      continue;
    }
    add(t.type + ":" + t.id,localDate(t.date),t.description,deposit ?
      [[gnu().cashAccount,amount],[member,-amount]] : [[member,amount],[income,-amount]]);
  }
  for (const {members, ids, eventName, income} of consumption.values()) {
    const splits = [...members].map(([path, amount]) => [path, amount, "Verbrauch"]);
    splits.push([income, -splits.reduce((sum, split) => sum + split[1], 0),
      eventName ? "Einnahmen " + eventName : "Sammelgegenbuchung"]);
    add("consumption:" + ids.sort().join(","), summaryDate,
      eventName ? "Veranstaltungseinnahmen: " + eventName : "BW-Schuldenabrechnung", splits);
  }
  for (const m of sel.meals) {
    const splits = m.participants.filter(p => !p.collective && cents(p.price)).map(p => [accountPath(p.accountId),cents(p.price),p.name]);
    if(m.guestShare)splits.push([gnu().guestAccount,cents(m.guestShare),"Gäste"]);
    if(m.subsidy)splits.push([gnu().mealAccount,cents(m.subsidy),"Zuschüsse gesamt"]);
    for(const pay of m.payouts || [{...m.payer,amount:m.total}]){
      const path=pay.type==="account"?accountPath(pay.accountId):pay.type==="external"?pay.gnucashAccount:db.settings.xxxCardAccountNumber;
      if(!path)throw Error("Den vollständigen GnuCash-Kontopfad der XXX-Karte hinterlegen.");
      splits.push([path,-cents(pay.amount),"Auslage "+pay.name]);
    }
    add("meal:"+m.id,m.date,"Aktivenessen: "+m.name,splits,m.identifier);
  }
  for (const e of sel.ledger) add("ledger:"+e.id,e.date,e.description,
    [[e.account,cents(e.amount),e.note],[e.counterAccount,-cents(e.amount)]],e.number || number);
  return groups.sort((a,b) => a.date.localeCompare(b.date));
}
function exportCandidates(cutoffIso, includeExported) {
  const free = x => includeExported ? !x.runId : (!x.exported && !x.runId);
  return {
    purchases: db.transactions
      .filter(t => ["purchase","deposit"].includes(t.type) && !t.balanceSync && !t.activeMealId && free(t) && t.date <= cutoffIso)
      .sort((a, b) => a.date.localeCompare(b.date)),
    meals: (db.activeMeals || [])
      .filter(m => free(m) && m.date <= localDate(cutoffIso))
      .sort((a, b) => (a.date + a.createdAt).localeCompare(b.date + b.createdAt)),
    ledger: (db.ledgerEntries || [])
      .filter(e => !e.deleted && free(e) && e.date <= localDate(cutoffIso))
      .sort((a, b) => a.date.localeCompare(b.date))
  };
}

function openRun() { return db.exportRuns.find(r => r.status === "open") || null; }

function runView(r) {
  return {
    id: r.id, number: r.number, status: r.status, cutoff: r.cutoff,
    createdAt: r.createdAt, createdBy: r.createdBy,
    committedAt: r.committedAt || null, closedBy: r.closedBy || null,
    hasAccountCsv:!!r.accountCsv, counts: r.counts, total: r.total
  };
}

/* --- Kontenzuordnung --- */
app.get("/api/admin/gnucash/settings", allow("gnucash"), (req, res) => {
  res.json({ settings: gnu(), defaults: GNUCASH_DEFAULTS });
});

app.put("/api/admin/gnucash/settings", allow("gnucash"), (req, res) => {
  const before = { ...gnu() };
  if (req.body.currency && req.body.currency !== "EUR") return res.status(400).json({error:"Die Getränkekasse rechnet in EUR."});
  for (const key of Object.keys(GNUCASH_DEFAULTS)) {
    const v = req.body[key];
    if (typeof GNUCASH_DEFAULTS[key] === "string" && typeof v === "string") db.settings.gnucash[key] = v.trim() || GNUCASH_DEFAULTS[key];
    else if (typeof GNUCASH_DEFAULTS[key] === "boolean" && typeof v === "boolean") db.settings.gnucash[key] = v;
  }
  addAudit(req, "gnucash.settings_changed", "GnuCash-Kontenzuordnung geändert",
    { type: "gnucash-settings", id: "gnucash", label: "Kontenzuordnung" }, before, { ...gnu() });
  saveDB(db);
  res.json({ settings: gnu() });
});

function assignableAccounts() {
  return db.accounts.filter(a => !a.deleted && !a.isSystem);
}

function collectiveView(a) {
  return {id:a.id, name:tallyLabel(a), target:a.collectiveTarget || a.fixedBookCode || a.gnucashAccount || gnucashAccountPath(a)};
}
function activeCollective(id) {
  return db.accounts.find(a => a.id === id && !a.deleted && !a.isSystem && eventMode(a) === "collective");
}
function preserveCollectivePostings(account, newTarget) {
  const previous = gnucashAccountPath(account) || account.collectiveTarget || account.fixedBookCode;
  if (/^\d+$/.test(previous) && bookCode(newTarget) === previous) return;
  if (previous === newTarget || previous === resolveCollectiveTarget(newTarget, account.gnucashAccount)) return;
  for (const tx of db.transactions) {
    if (tx.accountId === account.id && !tx.exported && !tx.collectivePostingTarget) tx.collectivePostingTarget = previous;
  }
}
const collectivesUrl = "/api/admin/collectives";
app.get(collectivesUrl, allow("gnucash"), (req,res) => {
  res.json(assignableAccounts().filter(a => eventMode(a) === "collective").map(collectiveView)
    .sort((a,b) => a.name.localeCompare(b.name,"de")));
});
function saveCollective(req,res) {
  const account = req.params.id ? activeCollective(req.params.id) : null;
  if (req.params.id && !account) return res.status(404).json({error:"Sammelkonto nicht gefunden."});
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  const target = typeof req.body?.target === "string" ? req.body.target.trim() : "";
  if (!name || name.length > 120 || /[\r\n]/.test(name))
    return res.status(400).json({error:"Bitte einen Namen mit höchstens 120 Zeichen eingeben."});
  if (!target || target.length > 800 || /[\r\n]/.test(target) || target.split(":").some(part => !part.trim()))
    return res.status(400).json({error:"Bitte eine GnuCash-Kontonummer oder einen vollständigen Kontopfad eingeben."});
  const key = value => value.trim().normalize("NFC").toLocaleLowerCase("de");
  if (db.accounts.some(a => a !== account && !a.deleted && [a.name, tallyLabel(a)].some(n => key(n) === key(name))))
    return res.status(409).json({error:"Dieser Kontoname ist bereits vergeben."});
  const before = account ? collectiveView(account) : null;
  const a = account || {id:newId(), isEvent:true, permanent:true, customDrinks:[], createdAt:new Date().toISOString()};
  if (!account && Object.hasOwn(collectiveSources, name) && !db.accounts.some(other => other.collectiveSource === collectiveSources[name]))
    a.collectiveSource = collectiveSources[name];
  if (account) preserveCollectivePostings(account, target);
  if (!account || before.name !== name) {
    a.isCollective = true;
    a.name = name;
  }
  if (contextLabel(a)==="Name") a.contextKind = "name";
  a.collectiveTarget = target;
  if (!account) db.accounts.push(a);
  const after = collectiveView(a);
  addAudit(req, account ? "collective.updated" : "collective.created", "Sammelkonto „" + name + "“ " + (account ? "geändert" : "angelegt"),
    {type:"account", id:a.id, label:name}, before, after);
  saveDB(db);
  res.json(after);
}
app.post(collectivesUrl, allow("gnucash"), saveCollective);
app.put(collectivesUrl + "/:id", allow("gnucash"), saveCollective);
app.delete(collectivesUrl + "/:id", allow("gnucash"), (req,res) => {
  const a = activeCollective(req.params.id);
  if (!a) return res.status(404).json({error:"Sammelkonto nicht gefunden."});
  a.deleted = true;
  addAudit(req, "collective.deleted", "Sammelkonto „" + a.name + "“ gelöscht",
    {type:"account", id:a.id, label:a.name}, collectiveView(a), null);
  saveDB(db);
  res.json({ok:true});
});
app.get("/api/admin/gnucash/accounts",allow("gnucash"),(req,res) => {
  res.json(assignableAccounts().map(a=>({id:a.id, name:a.startsAt ? a.name+" · "+calendar.dayInBerlin(a.startsAt).split("-").reverse().join(".") : a.name, isEvent:!!a.isEvent, custom:a.collectiveTarget || a.gnucashAccount || "", path:gnucashAccountPath(a)})));
});
app.put("/api/admin/gnucash/accounts/:id",allow("gnucash"),(req,res) => {
  const a = assignableAccounts().find(a=>a.id===req.params.id);
  if (!a) return res.status(404).json({error:"BW-Konto fehlt."});
  const value = String(req.body.path || "").trim();
  if (value.length > 800 || /[\r\n]/.test(value)) return res.status(400).json({error:"Ungültiger Kontopfad."});
  if (value && !a.collectiveTarget && a.fixedBookCode && bookCode(value) !== a.fixedBookCode)
    return res.status(400).json({error:"Für " + a.name + " den Kontopfad mit der Nummer " + a.fixedBookCode + " wählen."});
  if (value && assignableAccounts().some(b=>b.id!==a.id && !b.isEvent && !a.isEvent && gnucashAccountPath(b)===value))
    return res.status(409).json({error:"Pfad schon einer anderen Person zugeordnet."});
  const old = a.collectiveTarget || a.gnucashAccount || "";
  if (eventMode(a) === "collective") {
    if (!value && !a.collectiveSource && !a.fixedBookCode && !a.gnucashAccount)
      return res.status(400).json({error:"Bitte ein GnuCash-Ziel für dieses Sammelkonto eingeben."});
    preserveCollectivePostings(a, value || a.gnucashAccount || a.fixedBookCode || gnu().eventAccount + ":" + a.name);
    a.collectiveTarget = value;
  } else a.gnucashAccount = value;
  addAudit(req,"gnucash.account_mapping","GnuCash-Zuordnung geändert",{type:"account",id:a.id,label:a.name},{path:old},{path:value});
  saveDB(db);
  res.json({ok:true});
});

function bookDate(raw) {
  const german = raw.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  const iso = german ? [german[3],german[2].padStart(2,"0"),german[1].padStart(2,"0")].join("-") : raw;
  if (!validDateOnly(iso)) throw Error("Bitte GnuCash-Datumsformat ISO oder TT.MM.JJJJ verwenden: " + raw);
  return iso;
}
app.post("/api/admin/gnucash/payments", allow("gnucash"), (req,res) => {
  try {
    const byPath = new Map();
    for (const a of assignableAccounts().filter(a=>!a.isEvent && a.gnucashAccount)) {
      if (byPath.has(a.gnucashAccount) || [gnu().bankAccount,gnu().cashAccount].includes(a.gnucashAccount))
        throw Error("Mehrdeutige Kontenzuordnung: " + a.gnucashAccount);
      byPath.set(a.gnucashAccount,a.id);
    }
    if (!byPath.size) throw Error("Zuerst unter Kontenzuordnung mindestens ein Personenkonto ausdrücklich zuordnen.");
    const {payments, skipped, seenIds} = paymentsFromBook(String(req.body.csv || ""), byPath, gnu());
    const old = db.transactions.filter(t=>t.bookImportId);
    const key = p => p.id + "/" + p.accountId;
    const current = new Map(payments.map(p=>[key(p),p]));
    const seen = new Set(seenIds);
    const known = new Set();
    for (const t of old) {
      if (!seen.has(t.bookImportId)) continue;
      const k = t.bookImportId + "/" + t.accountId;
      const p = current.get(k);
      if (!p || cents(t.total)!==p.cents || t.date.slice(0,10)!==bookDate(p.sourceDate))
        return res.status(409).json({error:"Bereits übernommene Buchung wurde geändert. Bitte manuell abgleichen: " + t.bookImportId});
      known.add(k);
    }
    const candidates = payments.filter(p=>!known.has(key(p))).map(p=>({...p,key:key(p),date:bookDate(p.sourceDate),
      name:db.accounts.find(a=>a.id===p.accountId).name}));
    const preview = crypto.createHash("sha256").update(JSON.stringify(candidates)).digest("hex");
    if (req.body.selected === undefined) return res.json({candidates,preview,known:known.size,skipped});
    if (req.body.preview!==preview) return res.status(409).json({error:"Daten inzwischen geändert. Vorschau erneut laden."});
    if (!Array.isArray(req.body.selected)) throw Error("Ungültige Auswahl.");
    const selected = new Set(req.body.selected);
    const accepted = candidates.filter(p=>selected.has(p.key));
    if (!accepted.length || accepted.length!==selected.size) throw Error("Mindestens eine gültige Einzahlung auswählen.");
    for (const p of accepted) db.transactions.push({id:newId(),bookImportId:p.id,accountId:p.accountId,type:"deposit",
      date:p.date+"T12:00:00.000Z",items:[],total:p.cents/100,description:p.description || "Einzahlung aus GnuCash",exported:true});
    addAudit(req,"gnucash.payments","GnuCash-Einzahlungen übernommen",{type:"gnucash-import",id:newId()},null,
      {entries:accepted.map(p=>({bookId:p.id,accountId:p.accountId,cents:p.cents}))});
    saveDB(db);
    res.json({booked:accepted.length});
  } catch (err) { res.status(400).json({error:err.message}); }
});

mountExchange(app,{getDB:()=>db,gnu,allow,newId,initialAccount,saveDB,addAudit,bookDate,localDate});

/* --- Kassenbuch: freie Buchungen --- */
app.get("/api/admin/ledger", allow("gnucash"), (req, res) => {
  const showAll = req.query.all === "1";
  const runs = Object.fromEntries(db.exportRuns.map(r => [r.id, r.number]));
  res.json((db.ledgerEntries || [])
    .filter(e => !e.deleted && (showAll || !e.exported))
    .sort((a, b) => (b.date + b.createdAt).localeCompare(a.date + a.createdAt))
    .map(e => ({ ...e, runNumber: e.exportRunId ? runs[e.exportRunId] : (e.runId ? runs[e.runId] : null), locked: !!e.runId || !!e.exported })));
});

function readLedgerBody(body) {
  const date = String(body.date || "").trim();
  const description = String(body.description || "").trim();
  const account = String(body.account || "").trim();
  const counterAccount = String(body.counterAccount || "").trim();
  const amount = parsePrice(body.amount);
  if (!validDateOnly(date)) return { error: "Datum muss JJJJ-MM-TT sein" };
  if (!description) return { error: "Beschreibung fehlt" };
  if (!account) return { error: "Konto fehlt" };
  if (!counterAccount) return { error: "Gegenkonto fehlt" };
  if (!Number.isSafeInteger(cents(amount)) || amount === 0) return { error: "Betrag ungültig" };
  return {
    entry: {
      date, description, account, counterAccount, amount,
      number: String(body.number || "").trim(),
      note: String(body.note || "").trim()
    }
  };
}

app.post("/api/admin/ledger", allow("gnucash"), (req, res) => {
  const parsed = readLedgerBody(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const entry = {
    id: newId(), ...parsed.entry,
    createdAt: new Date().toISOString(),
    createdBy: auditActor(req, "XXX").name,
    exported: false, runId: null, exportRunId: null
  };
  db.ledgerEntries.push(entry);
  addAudit(req, "ledger.created", `Kassenbuch-Buchung „${entry.description}“ über ${entry.amount.toFixed(2).replace(".", ",")} €`,
    { type: "ledger", id: entry.id, label: entry.description }, null, entry);
  saveDB(db);
  res.json(entry);
});

app.put("/api/admin/ledger/:id", allow("gnucash"), (req, res) => {
  const entry = db.ledgerEntries.find(e => e.id === req.params.id && !e.deleted);
  if (!entry) return res.status(404).json({ error: "Buchung nicht gefunden" });
  if (entry.exported) return res.status(409).json({ error: "Bereits exportiert – nicht mehr änderbar" });
  if (entry.runId) return res.status(409).json({ error: "Steckt in einem offenen Buchungslauf" });
  const parsed = readLedgerBody(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const before = { ...entry };
  Object.assign(entry, parsed.entry);
  addAudit(req, "ledger.updated", `Kassenbuch-Buchung „${entry.description}“ geändert`,
    { type: "ledger", id: entry.id, label: entry.description }, before, { ...entry });
  saveDB(db);
  res.json(entry);
});

app.post("/api/admin/ledger/:id/delete", allow("gnucash"), (req, res) => {
  const entry = db.ledgerEntries.find(e => e.id === req.params.id && !e.deleted);
  if (!entry) return res.status(404).json({ error: "Buchung nicht gefunden" });
  if (entry.exported) return res.status(409).json({ error: "Bereits exportiert – nicht mehr löschbar" });
  if (entry.runId) return res.status(409).json({ error: "Steckt in einem offenen Buchungslauf" });
  entry.deleted = true;
  addAudit(req, "ledger.deleted", `Kassenbuch-Buchung „${entry.description}“ gelöscht`,
    { type: "ledger", id: entry.id, label: entry.description }, { ...entry, deleted: false }, null);
  saveDB(db);
  res.json({ ok: true });
});

/* --- Buchungsläufe --- */
app.get("/api/admin/export-runs", allow("gnucash"), (req, res) => {
  const cutoff = new Date().toISOString();
  const c = exportCandidates(cutoff, false);
  res.json({
    open: openRun() ? runView(openRun()) : null,
    pending: {
      purchases: c.purchases.filter(t=>t.type==="purchase").length,
      deposits: c.purchases.filter(t=>t.type==="deposit").length,
      meals: c.meals.length,
      ledger: c.ledger.length,
      total: Math.round((c.purchases.reduce((s, t) => s + t.total, 0)
        + c.meals.reduce((s, m) => s + Number(m.total || 0), 0)
        + c.ledger.reduce((s, e) => s + Number(e.amount || 0), 0)) * 100) / 100
    },
    runs: db.exportRuns.slice(-25).reverse().map(runView)
  });
});

/* Schritt 1: Lauf anlegen – bindet die Buchungen bis zum Stichzeitpunkt.
 * Alles, was danach gebucht wird, bleibt unberührt und kommt in den nächsten Lauf. */
function stageRun(req, res, meal, download = false) {
  const existing = openRun();
  if (existing) return res.status(409).json({ error: "Es ist bereits ein Buchungslauf offen", run: runView(existing) });

  const cutoff = new Date().toISOString();
  const sel = meal ? {purchases:[], meals:[meal], ledger:[]} : exportCandidates(cutoff,false);
  const summaryDate=String(req.body?.summaryDate || "");
  if(summaryDate){
    if(!validDateOnly(summaryDate) || summaryDate>localDate(cutoff))return res.status(400).json({error:"Gültigen Stichtag bis heute wählen."});
    sel.purchases=sel.purchases.filter(t=>localDate(t.date)<=summaryDate);
    sel.meals=sel.meals.filter(m=>m.date<=summaryDate);
    sel.ledger=sel.ledger.filter(e=>e.date<=summaryDate);
  }
  if (!sel.purchases.length && !sel.meals.length && !sel.ledger.length)
    return res.status(400).json({ error: "Nichts Neues zu exportieren" });

  const seq = db.exportRuns.length + 1;
  const reference = String(req.body?.number || "").trim();
  if (reference && (!/^[\p{L}\p{N} ._-]{1,48}$/u.test(reference) || db.exportRuns.some(r=>r.number===reference && r.status!=="discarded")))
    return res.status(400).json({error:"Belegnummer ungültig oder bereits in Verwendung."});
  const number = reference || `${gnu().numberPrefix}-${cutoff.slice(0, 7)}-${String(seq).padStart(4, "0")}`;
  const run = {
    id: newId(), number, status: "open", cutoff,
    createdAt: cutoff, createdBy: auditActor(req, "XXX").name,
    purchaseIds: sel.purchases.map(t => t.id),
    mealIds: sel.meals.map(m => m.id),
    ledgerIds: sel.ledger.map(e => e.id)
  };

  try {
    const missing=prepareAccounts(db,gnu());
    const groups = groupsFor(sel,number,summaryDate);
    const used=new Set(groups.flatMap(g=>g.postings.map(s=>s[0])));
    const needed=missing.filter(r=>used.has(r.path));
    if(needed.length)run.accountCsv=accountsCsv(needed);
    run.csv = renderTransactions(groups);
    run.counts = {purchases:sel.purchases.filter(t=>t.type==="purchase").length, deposits:sel.purchases.filter(t=>t.type==="deposit").length,
      ledger:sel.ledger.length, meals:sel.meals.length, rows:groups.reduce((n,g)=>n+g.postings.length,0)};
  } catch (err) { return res.status(400).json({error:err.message}); }
  run.total = (sel.purchases.reduce((n,t)=>n+cents(t.total),0) + sel.meals.reduce((n,m)=>n+cents(m.total),0) + sel.ledger.reduce((n,e)=>n+cents(e.amount),0))/100;
  for (const item of [...sel.purchases,...sel.meals,...sel.ledger]) item.runId = run.id;
  db.exportRuns.push(run);
  addAudit(req, "gnucash.run_created", `Buchungslauf ${number} erstellt (${run.counts.rows} Zeilen)`,
    { type: "gnucash-run", id: run.id, label: number }, null,
    { counts: run.counts, total: run.total, cutoff });
  saveDB(db);
  return download ? sendRun(res,run) : res.json(runView(run));
}
app.post("/api/admin/export-runs", allow("gnucash"), (req,res)=>stageRun(req,res));

/* Datei jederzeit erneut herunterladen – ohne Nebenwirkungen */
app.get("/api/admin/export-runs/:id/csv", allow("gnucash"), (req, res) => {
  const run = db.exportRuns.find(r => r.id === req.params.id);
  if (!run) return res.status(404).json({ error: "Buchungslauf nicht gefunden" });
  if (run.status === "discarded") return res.status(409).json({error:"Lauf verworfen."});
  sendRun(res,run);
});
function sendRun(res,run) {
  res.attachment(String(run.number).replace(/[^a-z0-9_. -]/ig,"_")+".csv").type("text/csv").send(run.csv);
}

app.get("/api/admin/export-runs/:id/accounts.csv",allow("gnucash"),(req,res)=>{
  const r=db.exportRuns.find(x=>x.id===req.params.id);
  if(!r?.accountCsv || r.status==="discarded")return res.status(404).end();
  res.attachment("BW-Neue-Konten.csv").type("text/csv").send(r.accountCsv);
});

/* Schritt 2a: als gebucht bestätigen */
app.post("/api/admin/export-runs/:id/commit", allow("gnucash"), (req,res)=>{
  const r=db.exportRuns.find(r=>r.id===req.params.id);
  if(r?.pluginBook)return res.status(409).json({error:"Das GnuCash-Plugin bestätigt diesen Lauf nach dem Speichern."});
  return commitRun(req,res);
});
function commitRun(req,res) {
  const run = db.exportRuns.find(r => r.id === req.params.id);
  if (!run) return res.status(404).json({ error: "Buchungslauf nicht gefunden" });
  if (run.status !== "open") return res.status(409).json({ error: "Lauf ist nicht offen" });
  const now = new Date().toISOString();

  const mark = (x) => { x.exported = true; x.exportedAt = now; x.exportRunId = run.id; delete x.runId; };
  db.transactions.filter(t => run.purchaseIds.includes(t.id)).forEach(mark);
  (db.activeMeals || []).filter(m => run.mealIds.includes(m.id)).forEach(mark);
  (db.ledgerEntries || []).filter(e => run.ledgerIds.includes(e.id)).forEach(mark);
  db.transactions.forEach(t => {
    if (t.activeMealId && !t.activeMealPayout && run.mealIds.includes(t.activeMealId)) mark(t);
  });

  /* Veranstaltungen zurücksetzen – aber nur die Buchungen aus DIESEM Lauf.
   * Was während des Laufs gebucht wurde, bleibt erhalten. */
  const inRun = new Set(run.purchaseIds);
  const eventIds = new Set(db.accounts.filter(a => a.isEvent).map(a => a.id));
  const involvedEvents = new Set(db.transactions.filter(t => inRun.has(t.id)).map(t=>t.accountId));
  const closed = db.transactions.filter(t=>eventIds.has(t.accountId) && inRun.has(t.id));
  for (const t of closed) t.eventSettled = true;
  const pendingEvents = new Set(db.transactions.filter(t=>!t.eventSettled).map(t=>t.accountId));
  // Zählpaare müssen auch nach einem Export für Nachträge erreichbar bleiben.
  const countedEvents = new Set((db.stockCounts || []).map(count => count.eventId));
  for (const a of db.accounts)
    if (a.isEvent && !a.permanent && involvedEvents.has(a.id) && !pendingEvents.has(a.id) && !countedEvents.has(a.id)) a.deleted = true;

  run.status = "committed";
  run.committedAt = now;
  run.closedBy = auditActor(req, "XXX").name;
  addAudit(req, "gnucash.run_committed", `Buchungslauf ${run.number} als gebucht bestätigt`,
    { type: "gnucash-run", id: run.id, label: run.number }, { status: "open" },
    { status: "committed", counts: run.counts, settledEventTransactions: closed.length });
  saveDB(db);
  res.json({ ok: true, run: runView(run) });
}

/* Schritt 2b: verwerfen – alles wieder freigeben, nichts ist passiert */
app.post("/api/admin/export-runs/:id/discard", allow("gnucash"), (req, res) => {
  const run = db.exportRuns.find(r => r.id === req.params.id);
  if (!run) return res.status(404).json({ error: "Buchungslauf nicht gefunden" });
  if (run.status !== "open") return res.status(409).json({ error: "Lauf ist nicht offen" });
  if(run.pluginBook)return res.status(409).json({error:"Lauf wird von GnuCash übernommen. Dort den Import fortsetzen."});
  const clear = x => { if (x.runId === run.id) delete x.runId; };
  db.transactions.forEach(clear);
  (db.activeMeals || []).forEach(clear);
  (db.ledgerEntries || []).forEach(clear);
  run.status = "discarded";
  run.closedBy = auditActor(req, "XXX").name;
  addAudit(req, "gnucash.run_discarded", `Buchungslauf ${run.number} verworfen`,
    { type: "gnucash-run", id: run.id, label: run.number }, { status: "open" }, { status: "discarded" });
  saveDB(db);
  res.json({ ok: true, run: runView(run) });
});

app.get("/api/admin/export", allow("gnucash"), (req,res) => {
  if (req.query.all === "1") return res.status(400).json({error:"Frühere Läufe einzeln im Verlauf öffnen."});
  if (openRun()) return sendRun(res,openRun());
  stageRun(req,res,null,true);
});

/* The plugin claims the exact downloaded snapshot before touching the book.
 * A lost acknowledgement can be retried without releasing the original items. */
const pluginApi="/api/admin/bw-plugin";
function pluginBook(req,res,next){
  const id=req.body?.book;
  if(typeof id!=="string" || !/^[a-f0-9]{32}$/.test(id))return res.status(400).json({error:"Ungültige Buch-ID."});
  if(db.settings.pluginBook && db.settings.pluginBook!==id)return res.status(409).json({error:"Dieser BW-Server ist mit einem anderen GnuCash-Buch verbunden."});
  next();
}
app.post(pluginApi+"/state",allow("gnucash"),pluginBook,(req,res)=>res.json({protocol:1,paired:!!db.settings.pluginBook,tree:!!db.settings.bookTreeLoaded, today:localDate(new Date().toISOString())}));
app.post(pluginApi+"/pair",allow("gnucash"),pluginBook,(req,res)=>{
  if(!db.settings.pluginBook){db.settings.pluginBook=req.body.book;saveDB(db);}
  res.json({ok:true});
});
for(const action of ["claim","ack"]){
  app.post(pluginApi+"/"+action,allow("gnucash"),pluginBook,(req,res)=>{
    const r=db.exportRuns.find(x=>x.id===req.body.run);
    if(db.settings.pluginBook!==req.body.book || !r || crypto.createHash("sha256").update(r.csv).digest("hex")!==req.body.hash)
      return res.status(409).json({error:"Buch oder Buchungslauf stimmt nicht mit der Vorschau überein."});
    if(r.status==="committed" && r.pluginBook===req.body.book)return res.json({ok:true,committed:true});
    if(r.status!=="open")return res.status(409).json({error:"Lauf ist nicht mehr offen."});
    if(!/^[a-f0-9]{32}$/.test(req.body.client||""))return res.status(400).json({error:"Gerätekennung fehlt."});
    if(r.pluginClient && r.pluginClient!==req.body.client && !(action==="claim" && req.body.alreadySaved===true))
      return res.status(409).json({error:"Ein anderer GnuCash-Rechner übernimmt diesen Lauf. Dort fortsetzen oder dieselbe bereits gespeicherte Buchdatei öffnen."});
    if(action==="claim"){
      if(r.pluginBook && r.pluginBook!==req.body.book)return res.status(409).json({error:"Anderes Buch hat diesen Lauf übernommen."});
      r.pluginBook=req.body.book;r.pluginClient=req.body.client;saveDB(db);return res.json({ok:true});
    }
    if(r.pluginBook!==req.body.book)return res.status(409).json({error:"Kein bestätigter Übernahmeauftrag."});
    req.params.id=r.id;
    return commitRun(req,res);
  });
}
app.post(pluginApi+"/confirm-accounts",allow("gnucash"),pluginBook,(req,res)=>{
  if(db.settings.pluginBook!==req.body.book || !Array.isArray(req.body.accounts))return res.status(400).json({error:"Buchzuordnung fehlt."});
  const pending=new Map(prepareAccounts(db,gnu()).map(a=>[a.path,a]));
  const updates=[];
  for(const a of req.body.accounts){
    const known=db.settings.bookCatalog?.[a.path], expected=pending.get(a.path)||known;
    if(!expected || expected.code!==a.code || expected.type!==a.type || (known?.guid && known.guid!==a.guid) || !/^[a-f0-9]{32}$/.test(a.guid))
      return res.status(409).json({error:"Kontenzuordnung hat sich geändert – Vorschau erneuern."});
    updates.push(a);
  }
  for(const a of updates){
    db.settings.bookCatalog[a.path]={code:a.code,type:a.type,guid:a.guid};
    for(const local of db.accounts.filter(x=>x.gnucashAccount===a.path)){
      local.bookGuid=a.guid;local.bookProposed=false;
    }
  }
  saveDB(db);res.json({ok:true});
});
const port = Number(process.env.BW_PORT || CONFIG.port || 3000);
listenLan(app,host,port,httpsConfig,ROOT).then(logListeners).catch(err => {
  console.error("Getränkekasse konnte nicht starten:",err.message);
  process.exit(1);
});
