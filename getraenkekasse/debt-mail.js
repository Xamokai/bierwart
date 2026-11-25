"use strict";

const addressDomain = "uttenruthia.de";
const currency = new Intl.NumberFormat("de-DE", {style:"currency", currency:"EUR"});
const formatDate = new Intl.DateTimeFormat("de-DE", {timeZone:"Europe/Berlin", dateStyle:"long"});

function nameParts(account) {
  const name = String(account.name || "").normalize("NFC").trim().replace(/^\d{5}\s+/, "").replace(/\s+/g, " ");
  const parts = name.split(",").map(part => part.trim());
  if (parts.length === 2) return {first:parts[1], last:parts[0]};
  if (parts.length !== 1) return {first:"", last:""};

  const words = name.split(" ");
  const surname = String(account.surname || "").normalize("NFC").trim().replace(/\s+/g, " ");
  if (surname && name.toLowerCase().endsWith(" " + surname.toLowerCase()))
    return {first:name.slice(0, -(surname.length + 1)), last:surname};
  if (words.length === 1 && surname && name.toLowerCase() !== surname.toLowerCase())
    return {first:name, last:surname};
  if (words.length < 2 || surname) return {first:"", last:""};
  return {first:words.slice(0, -1).join(" "), last:words.at(-1)};
}

function validAddress(address) {
  if (typeof address !== "string" || address.length > 254 || /\s|[\x00-\x1f\x7f]/.test(address)) return false;
  const parts = address.split("@");
  if (parts.length !== 2) return false;
  const [local, domain] = parts;
  const atom = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+$/;
  const labels = domain.split(".");
  return local.length <= 64 && local.split(".").every(part => atom.test(part)) &&
    labels.length >= 2 && labels.every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label));
}

function nameForAddress(text) {
  return text.toLowerCase().replace(/[äöüß]/g, c => ({ä:"ae", ö:"oe", ü:"ue", ß:"ss"})[c])
    .normalize("NFKD").replace(/\p{M}/gu, "").replace(/['’]/g, "").replace(/\s+/g, ".");
}

function mailProfile(account) {
  const {first, last} = nameParts(account);
  const parts = [first, last].map(nameForAddress);
  const candidate = parts.join(".") + "@" + addressDomain;
  const defaultEmail = parts.every(s => /^[a-z]+(?:[.-][a-z]+)*$/.test(s)) && validAddress(candidate) ? candidate : "";
  const email = account.emailOverride || defaultEmail;
  return {defaultEmail, email:validAddress(email) ? email : "", customEmail:!!account.emailOverride};
}

function draftFor(person, now) {
  const date = formatDate.format(now);
  const greeting = person.first ? "Hallo " + person.first + "," : "Hallo,";
  return {id:person.id, name:person.name, to:person.email, subject:"Dein offener Betrag bei der Getränkekasse",
    body:[greeting, "", "auf deinem BW-Konto ist mit Stand vom " + date + " ein Betrag von " +
      currency.format(person.amountCents / 100) + " offen. Bitte gleiche dein Konto aus.",
      "", "Die einzelnen Buchungen findest du im Bierwart-Programm unter „Mein Konto“ → „Meine Buchungen“. Wenn dir etwas unklar ist, melde dich gerne bei mir.",
      "", "Viele Grüße", "XXX"].join("\n")};
}

module.exports = {mailProfile, validAddress, nameParts, draftFor};
