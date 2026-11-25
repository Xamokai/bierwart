// Nur der gemeinsame Einstieg wählt eine Ansicht. Direkte Links bleiben auf ihrem Ziel.
(() => {
  const query = new URLSearchParams(location.search);
  const destinations = {desktop: "admin.html", tablet: "strichliste.html", phone: "user.html"};
  const page = query.has("event") || query.has("strichliste") ? "strichliste.html" : destinations[bierwartDevice()];
  location.replace(page + location.search + location.hash);
})();
