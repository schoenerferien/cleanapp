// Grenzwerte: Minijob, Kleinunternehmer (§ 19 UStG), Branchenmindestlohn.
// Werte sind Daten mit Gültigkeitsdatum – im Zielsystem kommen sie aus versionierten Tabellen.

export type Ampel = "gruen" | "gelb" | "rot";

export const MINIJOB_GRENZE = [
  { validFrom: "2026-01-01", cents: 60_300 },
  { validFrom: "2027-01-01", cents: 63_300 },
];

export const KU_GRENZE_GRUENDUNGSJAHR_CENTS = 2_500_000;

// TV Mindestlohn Gebäudereinigung (Lohngruppe 1). Läuft am 31.12.2026 aus – Wert für 2027 offen.
export const BRANCHEN_MINDESTLOHN_LG1 = [{ validFrom: "2026-01-01", cents: 1_500 }];

function valueAt(table: { validFrom: string; cents: number }[], isoDate: string): number {
  const valid = table.filter((r) => r.validFrom <= isoDate).sort((a, b) => (a.validFrom < b.validFrom ? 1 : -1));
  return (valid[0] ?? table[0]).cents;
}

export function minijobLimitAt(isoDate: string): number {
  return valueAt(MINIJOB_GRENZE, isoDate);
}

export function minWageAt(isoDate: string): number {
  return valueAt(BRANCHEN_MINDESTLOHN_LG1, isoDate);
}

export function isBelowMinWage(hourlyWageCents: number | null | undefined, isoDate: string): boolean {
  return hourlyWageCents != null && hourlyWageCents < minWageAt(isoDate);
}

/**
 * Minijob-Ampel: bewertet den voraussichtlichen Monatsverdienst (bisher + geplant).
 * grün < 85 %, gelb 85–100 %, rot > 100 % der Grenze.
 */
export function minijobStatus(earnedCents: number, forecastCents: number, limitCents: number) {
  const projected = earnedCents + forecastCents;
  const ratio = projected / limitCents;
  const level: Ampel = ratio > 1 ? "rot" : ratio >= 0.85 ? "gelb" : "gruen";
  return {
    level,
    projectedCents: projected,
    earnedPct: Math.round((earnedCents / limitCents) * 100),
    projectedPct: Math.round(ratio * 100),
    remainingCents: Math.max(0, limitCents - projected),
  };
}

/** KU-Ampel: Jahresumsatz gegen die § 19-Grenze. gelb ab 80 %, rot ab 100 %. */
export function kuStatus(yearRevenueCents: number, limitCents: number) {
  const ratio = yearRevenueCents / limitCents;
  const level: Ampel = ratio >= 1 ? "rot" : ratio >= 0.8 ? "gelb" : "gruen";
  return { level, pct: Math.round(ratio * 100), remainingCents: Math.max(0, limitCents - yearRevenueCents) };
}
