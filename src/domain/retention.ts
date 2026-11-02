// Löschfristen – reine Funktionen, keine DB.
import { addDays } from "@/domain/time";

export type RetentionSettings = { timeMonths: number; gpsMonths: number; photoMonths: number };

/** Erlaubte Fristen in Monaten. Arbeitszeiten mindestens 2 Jahre (§ 17 Abs. 1 MiLoG). */
export const RETENTION_LIMITS: Record<keyof RetentionSettings, { label: string; min: number; max: number }> = {
  timeMonths: { label: "Arbeitszeiten und Einsatzplanung", min: 24, max: 120 },
  gpsMonths: { label: "GPS-Standorte beim Stempeln", min: 1, max: 24 },
  photoMonths: { label: "Fotos", min: 1, max: 120 },
};

/** Fehlermeldung, wenn eine Frist außerhalb des erlaubten Bereichs liegt. */
export function retentionError(s: RetentionSettings): string | null {
  for (const [key, { label, min, max }] of Object.entries(RETENTION_LIMITS)) {
    const v = s[key as keyof RetentionSettings];
    if (!Number.isInteger(v) || v < min || v > max) return `${label}: ${min} bis ${max} Monate`;
  }
  return null;
}

/** ISO-Datum um `months` Monate verschoben; fehlt der Tag im Zielmonat, gilt dessen letzter Tag (31.03. − 1 Monat = 28.02.). */
export function addMonths(isoDate: string, months: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

/** Erster Tag, an dem ein Datensatz vom Tag `date` seine Frist erreicht hat (Fristende wie § 188 BGB, danach fällig). */
export const dueFrom = (date: string, months: number) => addDays(addMonths(date, months), 1);

/** Stichtag: Datensätze von vor diesem Tag haben ihre Frist erreicht – passend zu dueFrom. */
export function retentionCutoff(today: string, months: number): string {
  let cutoff = addMonths(today, -months);
  // An Monatsenden landet der Rückwärtsschritt ein paar Tage zu früh (29.02. + 1 Monat ist am 30.03. fällig)
  while (dueFrom(cutoff, months) <= today) cutoff = addDays(cutoff, 1);
  return cutoff;
}

export function retentionCutoffs(today: string, s: RetentionSettings) {
  return {
    time: retentionCutoff(today, s.timeMonths),
    gps: retentionCutoff(today, s.gpsMonths),
    photo: retentionCutoff(today, s.photoMonths),
  };
}
