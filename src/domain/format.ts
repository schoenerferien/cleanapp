// Anzeigeformate (de-DE, Europe/Berlin).

const eur = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
const num2 = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const euro = (cents: number) => eur.format(cents / 100);
export const decimal2 = (n: number) => num2.format(n);
export const hoursLabel = (minutes: number) => `${num2.format(minutes / 60)} Std`;

const num1 = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 });
export function bytesDe(bytes: number): string {
  if (bytes < 1024 ** 2) return `${num1.format(bytes / 1024)} KB`;
  if (bytes < 1024 ** 3) return `${num1.format(bytes / 1024 ** 2)} MB`;
  return `${num1.format(bytes / 1024 ** 3)} GB`;
}

export function dateDe(iso: string): string {
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
}

const weekday = new Intl.DateTimeFormat("de-DE", { weekday: "short", timeZone: "UTC" });
export function dateWithWeekday(iso: string): string {
  return `${weekday.format(new Date(`${iso}T12:00:00Z`))} ${dateDe(iso)}`;
}

const timeFmt = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" });
export const timeDe = (d: Date | null | undefined) => (d ? timeFmt.format(d) : "–");

const dateTimeFmt = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Berlin",
});
export const dateTimeDe = (d: Date | null | undefined) => (d ? dateTimeFmt.format(d) : "–");

/** "HH:MM" in Europe/Berlin für <input type="time"> */
export function timeInputValue(d: Date | null | undefined): string {
  return d ? timeFmt.format(d) : "";
}

/** Erzeugt aus Datum "YYYY-MM-DD" und Uhrzeit "HH:MM" (Europe/Berlin) einen Zeitpunkt. */
export function berlinDateTime(isoDate: string, hhmm: string): Date {
  // Offset von Europe/Berlin für diesen Tag bestimmen (Sommer-/Winterzeit).
  const probe = new Date(`${isoDate}T12:00:00Z`);
  const tzName = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Berlin", timeZoneName: "shortOffset" })
    .formatToParts(probe)
    .find((p) => p.type === "timeZoneName")?.value; // z. B. "GMT+2"
  const offsetH = Number(tzName?.replace("GMT", "") || 0);
  const sign = offsetH >= 0 ? "+" : "-";
  const off = `${sign}${String(Math.abs(offsetH)).padStart(2, "0")}:00`;
  return new Date(`${isoDate}T${hhmm}:00${off}`);
}

export const billingModelLabel: Record<string, string> = {
  hourly: "Nach Stunden",
  per_visit: "Festpreis je Einsatz",
  monthly_flat: "Monatspauschale",
};

export const employmentLabel: Record<string, string> = {
  minijob: "Minijob",
  teilzeit: "Teilzeit",
  vollzeit: "Vollzeit",
};

export const jobStatusLabel: Record<string, string> = {
  geplant: "Geplant",
  laufend: "Läuft",
  erledigt: "Zu prüfen",
  abgenommen: "Abgenommen",
  nacharbeit: "Nacharbeit",
};
