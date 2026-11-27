// Derselbe Gerätetyp bestimmt den Einstieg beim automatischen Seitenwechsel.
function bierwartDevice() {
  const ua = navigator.userAgent;
  if (/iPad/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1)) return "tablet";
  if (/\bKF[A-Z0-9]{3,}\b/i.test(ua)) return "tablet";
  if (/iPhone|iPod|Windows Phone|Android.*Mobile/i.test(ua)) return "phone";
  if (/Tablet|PlayBook|Silk\/|Android/i.test(ua)) return "tablet";
  if (matchMedia("(pointer: coarse)").matches) return Math.min(screen.width, screen.height) < 600 ? "phone" : "tablet";
  return "desktop";
}
