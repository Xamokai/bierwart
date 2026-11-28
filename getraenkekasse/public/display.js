const hyphenateGerman = typeof createHyphenator === "function" && typeof hyphenationPatternsDe1996 !== "undefined"
  ? createHyphenator(hyphenationPatternsDe1996, {minWordLength:7}) : null;
function wrapName(name) {
  // Prefer a longer last syllable group on narrow tiles, even with a browser
  // that lacks a German dictionary or ignores CSS hyphenation limits.
  if (!hyphenateGerman) return name;
  return hyphenateGerman(name).replace(/\u00ad(?=[A-Za-zÀ-ÖØ-öø-ÿẞ]{1,2}(?![A-Za-zÀ-ÖØ-öø-ÿẞ\u00ad]))/g, "");
}

function displayText(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
document.addEventListener("error", event => {
  if (event.target instanceof HTMLImageElement) event.target.style.visibility="hidden";
}, true);

function transactionAmount(tx, formatMoney) {
  const amount = tx.type === "deposit" ? tx.total : -tx.total;
  return `<span class="${amount >= 0 ? "amount-pos" : "amount-neg"}">${amount >= 0 ? "+" : "−"}${formatMoney(Math.abs(amount))}</span>`;
}

function semesterOf(dateStr) {
  const date = dateStr.length === 10 ? dateStr : new Intl.DateTimeFormat("sv-SE", {
    timeZone:"Europe/Berlin"
  }).format(new Date(dateStr));
  const [year, month] = date.split("-").map(Number);
  if (month >= 3 && month <= 8) return `Sommersemester ${year}`;
  const start = month >= 9 ? year : year - 1;
  return `Wintersemester ${start}/${String(start + 1).slice(-2)}`;
}

function renderMealsBySemester(meals, renderMeal) {
  const groups = new Map();
  for (const meal of [...meals].sort((a, b) => b.date.localeCompare(a.date))) {
    const semester = semesterOf(meal.date);
    if (!groups.has(semester)) groups.set(semester, []);
    groups.get(semester).push(meal);
  }
  const current = semesterOf(new Date().toISOString());
  return [...groups].map(([semester, entries]) => `
    <details class="daygroup semgroup" ${semester === current ? "open" : ""}>
      <summary><span>${semester}</span><span>${entries.length} Essen</span></summary>
      <div class="body">${entries.map(renderMeal).join("")}</div>
    </details>`).join("");
}


function eventBalanceLabel(account, formatMoney) {
  if (account.mode !== "direct" && account.mode !== "personal") return "";
  const open = "Offen in BW " + formatMoney(account.eventPending);
  return account.eventBookBalance === null ? open :
    open + " · GnuCash-Saldo " + formatMoney(account.eventBookBalance);
}


function activeMealRoleLabel(role) {
  return {aktiv:"Aktiv", kgast:"K-Gast", voll:"Vollpreis"}[role] || "";
}

const accountNumberOrder = new Intl.Collator("de", {numeric:true});
function compareAccounts(a, b) {
  if (Boolean(a.accountNumber) !== Boolean(b.accountNumber)) return a.accountNumber ? -1 : 1;
  return accountNumberOrder.compare(a.accountNumber, b.accountNumber) || a.name.localeCompare(b.name, "de");
}


// Die Themen steuern nur die Auswahl im Kiosk und im Rezeptkatalog.
function groupEventsByTheme(events) {
  const themes = [
    ["Kneipen", /kneipen?\b/],
    ["Bummel und Ausflüge", /(?:bummel|ausfl(?:u|ü)ge?|wanderung|fahrt)\b/],
    ["Partys und Barabende", /(?:party|partys|parties|cocktailabend|barabend|tresenbachelor|halloween|di[wv]ali)\b/],
    ["Feste und Bälle", /(?:fest(?:ball)?|ball|bälle|stiftungstag|feier|jubiläum)\b/]
  ];
  const other = "Weitere Veranstaltungen";
  const groups = new Map([...themes.map(([title]) => title), other].map(title => [title, []]));
  const collator = new Intl.Collator("de", {numeric:true, sensitivity:"base"});
  for (const event of [...events].sort((a,b) => collator.compare(a.name, b.name))) {
    const name = event.name.normalize("NFC").toLocaleLowerCase("de");
    const match = themes.find(([, pattern]) => pattern.test(name));
    groups.get(match ? match[0] : other).push(event);
  }
  return [...groups].filter(([, entries]) => entries.length);
}

function overviewName(account) {
  return account.startsAt ? account.name+" · "+new Date(account.startsAt).toLocaleDateString("de-DE",{timeZone:"Europe/Berlin"}) : account.name;
}
function overviewTransactions(transactions) {
  const groups = new Map();
  function add(id,row) {
    if (!groups.has(id)) groups.set(id,[]);
    groups.get(id).push(row);
  }
  for (const tx of transactions) {
    add(tx.accountId,tx);
    if (tx.eventId && tx.eventId!==tx.accountId)
      add(tx.eventId,{...tx,description:tx.accountName+" · "+tx.description});
  }
  return groups;
}

const historyDate = new Intl.DateTimeFormat("sv-SE",{timeZone:"Europe/Berlin"});
const historyTime = new Intl.DateTimeFormat("de-DE",{timeZone:"Europe/Berlin",hour:"2-digit",minute:"2-digit"});
function appendAccountHistory(body,tx,eur) {
  if (!tx.length) {
    body.insertAdjacentHTML("beforeend",'<p class="muted">Keine Buchungen.</p>');
    return;
  }
  const bySem = {};
  tx.forEach(t => { const s = semesterOf(t.date); (bySem[s] = bySem[s] || []).push(t); });
  const curSem = semesterOf(new Date().toISOString());
  Object.entries(bySem).forEach(([sem, stx]) => {
    const semSum = stx.reduce((s, t) => s + (t.type === "deposit" ? t.total : -t.total), 0);
    const semDet = document.createElement("details");
    semDet.className = "daygroup semgroup";
    if (sem === curSem) semDet.open = true;
    semDet.innerHTML = `<summary><span>${sem}</span>
      <span class="${semSum >= 0 ? "amount-pos" : "amount-neg"}">${semSum >= 0 ? "+" : "−"}${eur(Math.abs(semSum))}</span></summary>
      <div class="body"></div>`;
    const semBody = semDet.querySelector(".body");
    body.appendChild(semDet);
    const byDay = {};
    stx.forEach(t => { const d = historyDate.format(new Date(t.date)); (byDay[d] = byDay[d] || []).push(t); });
    Object.entries(byDay).forEach(([day, list]) => {
      const sum = list.reduce((s, t) => s + (t.type === "deposit" ? t.total : -t.total), 0);
      semBody.insertAdjacentHTML("beforeend", `
        <div class="list-item"><strong class="gold-text">${new Date(day).toLocaleDateString("de-DE")}</strong>
          <span class="${sum >= 0 ? "amount-pos" : "amount-neg"}">${sum >= 0 ? "+" : "−"}${eur(Math.abs(sum))}</span></div>
        ${list.map(t => `<div class="list-item" style="padding-left:18px">
          <span>${t.bookingContext ? "<strong class=\"booking-context\">"+displayText(t.bookingContext)+"</strong>" : ""}${displayText(t.description)} <span class="muted">${historyTime.format(new Date(t.date))} Uhr${t.exported ? " · exportiert" : ""}</span></span>
          ${transactionAmount(t,eur)}
        </div>`).join("")}`);
    });
  });
}
