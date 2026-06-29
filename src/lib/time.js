// Utilitaires de dates et d'heures partagés (Dispatch, Feuilles de temps)

export const DAYS = ["lun", "mar", "mer", "jeu", "ven", "sam", "dim"];
export const PERIODS = ["AM", "PM"];

export function startOfWeek(d) {
  const date = new Date(d);
  const day = (date.getDay() + 6) % 7; // lundi = 0
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - day);
  return date;
}

export function addDays(d, n) {
  const date = new Date(d);
  date.setDate(date.getDate() + n);
  return date;
}

export function iso(d) {
  const date = new Date(d);
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${m}-${day}`;
}

export function fmtDay(d) {
  return new Date(d).getDate();
}

export function isToday(d) {
  return iso(d) === iso(new Date());
}

// "HH:MM[:SS]" -> minutes depuis minuit
function toMinutes(t) {
  if (!t) return null;
  const [h, m] = String(t).split(":").map(Number);
  return h * 60 + (m || 0);
}

// Heures décimales entre début et fin (0 si fin manquante)
export function hoursBetween(debut, fin) {
  const a = toMinutes(debut);
  const b = toMinutes(fin);
  if (a == null || b == null) return 0;
  const diff = b - a;
  return diff > 0 ? diff / 60 : 0;
}

export function fmtHours(h) {
  if (!h) return "—";
  return `${h.toFixed(2).replace(".", ",")} h`;
}

export function money(n) {
  return (n || 0).toLocaleString("fr-CA", {
    style: "currency",
    currency: "CAD",
  });
}

export function weekLabel(weekStart) {
  const end = addDays(weekStart, 6);
  return `${fmtDay(weekStart)} – ${fmtDay(end)} ${weekStart.toLocaleDateString(
    "fr-CA",
    { month: "long", year: "numeric" }
  )}`;
}
