/**
 * Hijri date using the Umm al-Qura calendar built into the JavaScript runtime
 * (ICU). Local moon-sighting can differ by a day or two, so the user can set
 * an adjustment of -2…+2 days in Settings.
 */
export function hijriDate(date: string, adjustmentDays = 0): string {
  const [y, m, d] = date.split("-").map(Number);
  // Noon UTC avoids any day-boundary ambiguity.
  const instant = new Date(Date.UTC(y, m - 1, d + adjustmentDays, 12));
  const parts = new Intl.DateTimeFormat("en-u-ca-islamic-umalqura", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).formatToParts(instant);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("day")} ${get("month")} ${get("year")} AH`;
}
