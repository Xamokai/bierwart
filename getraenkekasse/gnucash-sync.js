"use strict";
const crypto = require("node:crypto");

const header = ["Date","Transaction ID","Number","Description","Notes","Commodity/Currency","Void Reason","Action","Memo","Full Account Name","Account Name","Amount With Sym","Amount Num.","Value With Sym","Value Num.","Reconcile","Reconcile Date","Rate/Price"];
const quote = v => '"' + String(v ?? "").replaceAll('"','""') + '"';
const entryId = source => crypto.createHash("sha256").update("bierwart:" + source).digest("hex").slice(0,32);

function renderTransactions(groups) {
  const rows = [header];
  for (const {source, number, date, description, currency, postings} of groups) {
    const id = entryId(source);
    let total = 0;
    for (const [account, cents, memo] of postings) {
      if (!account || !Number.isSafeInteger(cents)) throw Error("Kontopfad oder Centbetrag fehlt.");
      total += cents;
      const amount = (cents / 100).toFixed(2);
      rows.push([date,id,number,description,"BW-ID " + id,"CURRENCY::"+currency,"","",memo,account,account.split(":").at(-1),"",amount,"",amount,"n","","1"]);
    }
    if (total !== 0) throw Error("Unausgeglichene Buchung.");
  }
  return rows.map(r => r.map(quote).join(",")).join("\r\n") + "\r\n";
}

// GnuCash can quote names and notes containing separators, newlines and quotes.
function readCsv(text) {
  text = text.replace(/^\uFEFF/, "");
  const first = text.split(/\r?\n/,1)[0];
  const sep = first.includes(";") ? ";" : ",";
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i=0; i<text.length; i++) {
    const c=text[i];
    if (c === '"') {
      if (quoted && text[i+1] === '"') { field += '"'; i++; }
      else quoted = !quoted;
    } else if (!quoted && c === sep) { row.push(field); field=""; }
    else if (!quoted && (c === "\r" || c === "\n")) {
      if (c === "\r" && text[i+1] === "\n") i++;
      row.push(field); if (row.some(Boolean)) rows.push(row);
      row=[]; field="";
    } else field+=c;
  }
  if (quoted) throw Error("CSV enthält ein offenes Anführungszeichen.");
  row.push(field); if (row.some(Boolean)) rows.push(row);
  return rows;
}

function readCents(value) {
  let s = value.trim();
  // Gruppierte deutsche und englische Zahlen eindeutig am Dezimalteil erkennen.
  if (/^-?\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/.test(s)) s=s.replaceAll(".","");
  else if (/^-?\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?$/.test(s)) s=s.replaceAll(",","");
  if (!/^-?\d+(?:[.,]\d{1,2})?$/.test(s)) throw Error("Unlesbarer EUR-Betrag: " + s);
  const cents = Math.round(Number(s.replace(",", ".")) * 100);
  if (!Number.isSafeInteger(cents)) throw Error("Betrag außerhalb des unterstützten Bereichs.");
  return cents;
}

// Match only unambiguous bank/cash payments to mapped member accounts.
// Other income, purchases, transfers, opening balances and own exports are skipped as a whole.
function paymentsFromBook(text, mappings, settings) {
  const [cols,...rows] = readCsv(text);
  if (!cols || cols.length !== 18 || !/(transaction|transaktion|buchung).*id/i.test(cols[1]) ||
      !/(account|konto)/i.test(cols[9])) throw Error("Mehrzeiligen GnuCash-5-Buchungsexport mit Kopfzeile wählen.");
  const bank = new Set([settings.cashAccount, settings.bankAccount]);
  const groups = new Map();
  let id;
  for (const row of rows) {
    if(row.length !== 18) throw Error("GnuCash-Zeile mit falscher Spaltenzahl.");
    id = row[1]?.toLowerCase() || id;
    if (!/^[a-f\d]{32}$/i.test(id || "")) throw Error("GnuCash-Buchungs-ID fehlt.");
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(row);
  }
  const payments = [];
  let skipped = 0;
  for (const [id, splits] of groups) {
    const first = splits[0];
    const monetary = splits.filter(r => bank.has(r[9]));
    const people = splits.filter(r => mappings.has(r[9]));
    if (!monetary.length || !people.length || people.length + monetary.length !== splits.length ||
        !["CURRENCY::EUR","EUR"].includes(first[5]) || splits.some(r => r[6] || /BW-ID [a-f\d]{32}/i.test(r[4]))) { skipped++; continue; }
    const receipts = monetary.map(r => readCents(r[14]));
    const shares = people.map(r => readCents(r[14]));
    if (receipts.some(n=>n<=0) || shares.some(n=>n>=0) ||
        [...receipts,...shares].reduce((s,n)=>s+n,0)!==0) { skipped++; continue; }
    const perMember=new Map();
    people.forEach((r,i)=>perMember.set(r[9],(perMember.get(r[9])||0)-shares[i]));
    for(const [account,cents] of perMember) payments.push({ id, accountId: mappings.get(account), cents, description:first[3], sourceDate:first[0] });
  }
  return { payments, skipped, seenIds: [...groups.keys()] };
}
module.exports={entryId,renderTransactions, paymentsFromBook,readCsv,readCents,quote};
