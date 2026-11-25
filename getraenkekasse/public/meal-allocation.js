"use strict";

(function () {
  function splitMeal(total, participants, subsidyPerPerson) {
    if (!Number.isSafeInteger(total) || total <= 0) throw Error("Gesamtkosten eingeben.");
    if (!participants.length) throw Error("Mindestens eine Person hinzufügen.");
    if (!Number.isSafeInteger(subsidyPerPerson) || subsidyPerPerson < 0) throw Error("Zuschuss prüfen.");

    const base = Math.floor(total / participants.length);
    const extra = total % participants.length;
    const rows = participants.map((person, index) => {
      const fullShare = base + (index < extra ? 1 : 0);
      const role = person.collective ? "kgast" : person.role;
      const grant = role === "aktiv" || role === "kgast" ? Math.min(fullShare, subsidyPerPerson) : 0;
      const manual = person.cents !== null;
      if (manual && (!Number.isSafeInteger(person.cents) || person.cents < 0))
        throw Error("Betrag für " + person.name + " prüfen.");
      return {...person, role, manual, grant, cents:manual ? person.cents : fullShare - grant};
    });
    const subsidy = rows.reduce((sum, row) => sum + row.grant, 0);
    const guestShare = rows.reduce((sum, row) => sum + (row.collective ? row.cents : 0), 0);
    const difference = total - subsidy - rows.reduce((sum, row) => sum + row.cents, 0);
    return {rows, subsidy, guestShare, difference};
  }

  if (typeof module === "object" && module.exports) module.exports = splitMeal;
  else window.splitActiveMeal = splitMeal;
})();
