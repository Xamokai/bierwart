"use strict";

// GnuCash accounts remain available for historical postings. Only the kiosk
// placement and the recipient of new purchases depend on the type of event.
const directNames = new Set([
  "abkneipe", "ankneipe", "stiftungsfestkneipe", "fuxenkneipe", "burschungskneipe",
  "himmelfahrtsbummel", "kneipen", "stempferbummel", "stiftungstag", "stockwerksparty"
]);
const collectiveLabels = new Map([
  ["arbeitseinsatz", "Arbeitseinsatz"], ["barzahler", "Barzahler"], ["bahrzahler", "Barzahler"],
  ["gast", "Gast"], ["gast mitgliederwerbung", "Gast"], ["mitgliederwerbung", "Gast"],
  ["loschbier", "Löschbier"], ["grillkohle", "Löschbier"], ["grillkohle loschbier", "Löschbier"],
  ["loschbier grillkohle", "Löschbier"], ["verrechnung philister", "Philister"],
  ["verrechnung philisterium", "Philister"], ["verrechnungskonto philisterverein", "Philister"],
  ["couleur", "Couleur"]
]);
function tallyLabel(account) {
  return (account.isEvent && collectiveLabels.get(normalizedName(account.name))) || account.name;
}
const hiddenNames = new Set([
  "aktivenfahrt", "berg", "durnstein", "feuerzangenbowle", "gansessen", "totengedenken",
  "weihnachten", "wissenschaftliche abende"
]);
function normalizedName(value) {
  return String(value || "").normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase()
    .replace(/^\d+\s+/, "").replace(/\s+(?:(?:am\s+)?\d{1,2}\.\d{1,2}\.(?:\d{2,4})?|\d{4}-\d{2}-\d{2}|(?:ss|ws)\s?\d{2,4})$/, "")
    .replace(/[^\p{L}\d]+/gu, " ").trim();
}
function eventMode(a) {
  if (!a.isEvent) return "person";
  const leaf = (a.gnucashAccount || "").split(":").at(-1);
  const name = normalizedName(a.name);
  const mappedName = normalizedName(leaf);
  if ([name, mappedName].some(n => n.startsWith("e a ") || n === "e a" || hiddenNames.has(n))) return "hidden";
  if (collectiveLabels.has(name)) return "collective";
  if (directNames.has(name) || /^(1800|4150)\b/.test(leaf)) return "direct";
  return "personal";
}
function eventLabel(a) {
  return (a.isEvent || a.kind === "event") && a.name === "Stiftungsfest" ? "Stiftungsfestball" : a.name;
}
function visibleEvent(a) {
  if (!a || !a.isEvent || a.deleted) return false;
  const mode = eventMode(a);
  return (mode === "direct" || mode === "personal") &&
    (a.permanent || Date.parse(a.createdAt) >= Date.now() - 7 * 864e5);
}
function activeDrinks(event) {
  return (event.customDrinks || []).filter(d => !d.expiresAt || Date.parse(d.expiresAt) > Date.now());
}
module.exports = {eventMode, eventLabel, tallyLabel, visibleEvent, activeDrinks, normalizedName};
