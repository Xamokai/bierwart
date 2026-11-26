"use strict";

(function () {
  function splitMeal(total, participants, subsidyPerPerson) {
    if (!Number.isSafeInteger(total) || total <= 0) throw Error("Gesamtkosten eingeben.");
    if (!participants.length) throw Error("Mindestens eine Person hinzufügen.");
    if (!Number.isSafeInteger(subsidyPerPerson) || subsidyPerPerson < 0) throw Error("Zuschuss prüfen.");

    const counts = participants.map(p => p.portions === undefined ? 1 : p.portions);
    if (counts.some(n => !Number.isSafeInteger(n) || n < 1 || n > 999))
      throw Error("Je Person 1 bis 999 ganze Portionen eingeben.");
    const portions = counts.reduce((sum, n) => sum + n, 0);
    const base = Math.floor(total / portions);
    let extra = total % portions;
    const rows = participants.map((person, index) => {
      const rounding = Math.min(extra, counts[index]);
      extra -= rounding;
      const fullShare = base * counts[index] + rounding;
      const role = person.collective ? "kgast" : person.role;
      const grant = role === "aktiv" || role === "kgast" ? Math.min(fullShare, subsidyPerPerson) : 0;
      const manual = person.cents !== null;
      if (manual && (!Number.isSafeInteger(person.cents) || person.cents < 0))
        throw Error("Betrag für " + person.name + " prüfen.");
      return Object.assign({}, person, {role, portions:counts[index], manual, grant, cents:manual ? person.cents : fullShare - grant});
    });
    const subsidy = rows.reduce((sum, row) => sum + row.grant, 0);
    const guestShare = rows.reduce((sum, row) => sum + (row.collective ? row.cents : 0), 0);
    const difference = total - subsidy - rows.reduce((sum, row) => sum + row.cents, 0);
    return {rows, subsidy, guestShare, difference};
  }

  if (typeof module === "object" && module.exports) module.exports = splitMeal;
  else window.splitActiveMeal = splitMeal;
})();
