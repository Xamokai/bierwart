"use strict";
const ICAL = require("ical.js");
const {eventLabel, eventMode, normalizedName} = require("./event-mode");

// Öffentlicher Abonnementlink aus dem iCal-Export, Kategorie Semesterprogramm, alle Jahre.
const feedUrl = "https://uttenruthia.de/index.php?option=com_jevents&task=icals.export&format=ical&catids=33&years=0&Itemid=134&k=116577f9cfb6ead983c2a52f0944e7a6";
const berlin = new Intl.DateTimeFormat("sv-SE", {timeZone:"Europe/Berlin", dateStyle:"short", timeStyle:"medium"});
const dayInBerlin = stamp => berlin.format(new Date(stamp)).slice(0,10);
function semesterStart(stamp) {
  const [year, month] = dayInBerlin(stamp).split("-").map(Number);
  if (month < 3) return (year-1) + "-09-01";
  return year + (month < 9 ? "-03-01" : "-09-01");
}
function berlinInstant(local) {
  // Interpret the calendar's wall clock in Berlin independently of the host timezone.
  const target = Date.parse(local + "Z");
  const wallTime = ms => Date.parse(berlin.format(new Date(ms)).replace(" ","T") + "Z");
  // On the autumn transition RFC 5545 means the first occurrence. In the
  // skipped spring hour it uses the offset that preceded the gap.
  const before = target - 864e5, after = target + 864e5;
  const first = target - (wallTime(before)-before);
  if (wallTime(first) === target) return new Date(first).toISOString();
  const second = target - (wallTime(after)-after);
  return new Date(wallTime(second) === target ? second : first).toISOString();
}
function dateWindow(date) {
  const next = new Date(date + "T12:00:00Z");
  next.setUTCDate(next.getUTCDate()+1);
  return {startsAt:berlinInstant(date+"T00:00:00"), endsAt:berlinInstant(next.toISOString().slice(0,10)+"T00:00:00"), allDay:true};
}
function instant(time) {
  if (time.isDate || time.zone.tzid === "floating" || time.zone.tzid === "Europe/Berlin")
    return berlinInstant(time.toString().slice(0,19) + (time.isDate ? "T00:00:00" : ""));
  return time.toJSDate().toISOString();
}
function excluded(name) {
  return /\b(?:burschenconvent\w*|bc|pst|philisterstammtisch\w*|wa|wissenschaftliche[rnms]?\s+abend\w*)\b/i.test(normalizedName(name));
}
function parseProgram(text, now = Date.now()) {
  if (!/^BEGIN:VCALENDAR\s/i.test(text.trim()) || !/END:VCALENDAR\s*$/i.test(text)) throw Error("Unvollständiger Kalender");
  // JEvents emits unescaped physical newlines in descriptions. Only timetable
  // properties are needed; unfold RFC lines before discarding the free text.
  const fields = /^(?:BEGIN|END|VERSION|UID|SUMMARY|DTSTART|DTEND|DURATION|RRULE|RDATE|EXDATE|RECURRENCE-ID|STATUS|TZID|TZOFFSETFROM|TZOFFSETTO)[;:]/i;
  const timetable = text.replace(/\r?\n[ \t]/g,"").split(/\r?\n/).filter(line=>fields.test(line)).join("\r\n");
  const calendar = new ICAL.Component(ICAL.parse(timetable));
  const entries = new Map(), earliest = semesterStart(now), horizon = now + 2 * 366 * 864e5;
  const components = calendar.getAllSubcomponents("vevent");
  const series = new Map();
  for (const component of components) {
    const event = new ICAL.Event(component, {exceptions:[]});
    if (!event.uid) throw Error("Kalendereintrag ohne Kennung");
    if (!series.has(event.uid)) series.set(event.uid,[]);
    series.get(event.uid).push(event);
  }
  for (const events of series.values()) {
    const master = events.find(e=>!e.isRecurrenceException());
    if (!master || master.component.getFirstPropertyValue("status")==="CANCELLED" || excluded(master.summary)) continue;
    for (const exception of events.filter(e=>e.isRecurrenceException())) master.relateException(exception);
    const iterator = master.iterator();
    for (let i=0; i<10000; i++) {
      const next = iterator.next();
      if (!next || Date.parse(instant(next)) > horizon) break;
      const {item, startDate, endDate} = master.getOccurrenceDetails(next);
      const name = String(item.summary || "").trim();
      if (!name || excluded(name) || item.component.getFirstPropertyValue("status")==="CANCELLED") continue;
      const startsAt = instant(startDate);
      let endsAt = instant(endDate);
      if (endsAt <= startsAt) endsAt = dateWindow(dayInBerlin(startsAt)).endsAt;
      if (dayInBerlin(Date.parse(endsAt)-1) < earliest) continue;
      const calendarKey = JSON.stringify([master.uid,master.isRecurring() ? next.toString() : ""]);
      entries.set(calendarKey,{calendarKey,name,startsAt,endsAt,allDay:startDate.isDate});
    }
  }
  return entries;
}
function newEvent(db, name, bookingMode, newId) {
  const key = normalizedName(name);
  const templateName = {semesterantrittskneipe:"ankneipe",semesterabschlusskneipe:"abkneipe"}[key] || key;
  const template = db.accounts.find(a=>a.isEvent && !a.deleted && !a.startsAt &&
    ["personal","direct"].includes(eventMode(a)) && normalizedName(eventLabel(a))===templateName);
  return {id:newId(), name, isEvent:true, createdAt:new Date().toISOString(), customDrinks:[],
    bookingMode:bookingMode || (template && eventMode(template)) ||
      (eventMode({name,isEvent:true})==="direct" || /kneipe\b/i.test(name) ? "direct" : "personal"),
    ...(template?.gnucashAccount ? {gnucashAccount:template.gnucashAccount} : {}),
    ...(template?.barRecipes ? {barRecipes:template.barRecipes.slice()} : {})};
}
function applyProgram(db, entries, newId, now) {
  const byKey = new Map(db.accounts.filter(a=>a.calendarKey).map(a=>[a.calendarKey,a]));
  for (const [key, data] of entries) {
    let a = byKey.get(key);
    if (!a) { a = newEvent(db,data.name,null,newId); db.accounts.push(a); }
    Object.assign(a,data,{calendarRemoved:false});
  }
  for (const [key,a] of byKey)
    if (!entries.has(key) && dayInBerlin(Date.parse(a.endsAt)-1)>=semesterStart(now)) a.calendarRemoved = true;
}
function startCalendar(getDB, newId, saveDB) {
  let pending, error = false;
  async function sync() {
    if (pending) return pending;
    if (Date.now()-Date.parse(getDB().settings.calendarSyncedAt) < 6*3600e3) return;
    pending = (async () => {
      try {
        const response = await fetch(feedUrl, {signal:AbortSignal.timeout(10000)});
        if (!response.ok) throw Error("HTTP "+response.status);
        const now = Date.now();
        const entries = parseProgram(await response.text(),now);
        const db = getDB();
        applyProgram(db,entries,newId,now);
        db.settings.calendarSyncedAt = new Date(now).toISOString();
        saveDB(db); error = false;
      } catch (e) { error = true; console.warn("Semesterprogramm konnte nicht geladen werden:", e.message); }
      finally { pending = null; }
    })();
    return pending;
  }
  if (process.env.BW_CALENDAR_OFFLINE !== "1") {
    sync(); setInterval(sync,15*60e3).unref();
  }
  return () => ({loading:!!pending,error,syncedAt:getDB().settings.calendarSyncedAt || null});
}
module.exports = {dateWindow, semesterStart, dayInBerlin, excluded, parseProgram, applyProgram, newEvent, startCalendar};
