// Reine Zeit- und Ortsfunktionen ohne DB-Zugriff.

export type TimeEntryLike = {
  startAt: Date;
  endAt: Date | null;
  correctedStartAt?: Date | null;
  correctedEndAt?: Date | null;
};

/** Abstand zweier Koordinaten in Metern (Haversine). */
export function haversineMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

export function effectiveStart(e: TimeEntryLike): Date {
  return e.correctedStartAt ?? e.startAt;
}

export function effectiveEnd(e: TimeEntryLike): Date | null {
  return e.correctedEndAt ?? e.endAt;
}

/** Dauer in ganzen Minuten; offene Einträge zählen 0. Korrekturen haben Vorrang vor Originalwerten. */
export function effectiveMinutes(e: TimeEntryLike): number {
  const end = effectiveEnd(e);
  if (!end) return 0;
  return Math.max(0, Math.round((end.getTime() - effectiveStart(e).getTime()) / 60_000));
}

export function isCorrected(e: TimeEntryLike): boolean {
  return Boolean(e.correctedStartAt || e.correctedEndAt);
}

/** Verdienst in Cent für Minuten × Stundenlohn (kaufmännisch gerundet). */
export function earningsCents(minutes: number, hourlyWageCents: number): number {
  return Math.round((minutes * hourlyWageCents) / 60);
}

export function monthlySummary(entries: TimeEntryLike[], hourlyWageCents: number) {
  const minutes = entries.reduce((sum, e) => sum + effectiveMinutes(e), 0);
  return { minutes, earnedCents: earningsCents(minutes, hourlyWageCents) };
}

/** "YYYY-MM" eines ISO-Datums "YYYY-MM-DD". */
export function monthOf(isoDate: string): string {
  return isoDate.slice(0, 7);
}

/** Erster und letzter Tag eines Monats "YYYY-MM" als ISO-Datum. */
export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}

/** Monat "YYYY-MM" um delta Monate verschoben. */
export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7);
}

/** Heutiges Datum in Europe/Berlin als "YYYY-MM-DD". */
export function todayBerlin(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(now);
}

/** Montag der Woche eines ISO-Datums. */
export function startOfWeek(isoDate: string): string {
  const d = new Date(`${isoDate}T12:00:00Z`);
  const day = (d.getUTCDay() + 6) % 7; // Mo = 0
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}

export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
