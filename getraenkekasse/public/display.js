const hyphenateGerman = createHyphenator(hyphenationPatternsDe1996, {minWordLength:7});
function wrapName(name) {
  // Prefer a longer last syllable group on narrow tiles, even with a browser
  // that lacks a German dictionary or ignores CSS hyphenation limits.
  return hyphenateGerman(name).replace(/\u00ad(?=\p{L}{1,2}(?![\p{L}\u00ad]))/gu, "");
}

function displayText(value) {
  return String(value ?? "").replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
document.addEventListener("error", event => {
  if (event.target instanceof HTMLImageElement) event.target.style.visibility="hidden";
}, true);

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
