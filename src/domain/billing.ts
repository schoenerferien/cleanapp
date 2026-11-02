// Rechnungspositionen aus abgenommenen Einsätzen – reine Funktion, keine DB.
import type { BillingModel, InvoiceUnit } from "@/db/schema";

export type BillingSite = {
  id: string;
  name: string;
  billingModel: BillingModel;
  rateCents: number;
};

export type BillingJob = {
  id: string;
  siteId: string;
  date: string; // YYYY-MM-DD
  title: string;
  status: string;
  invoiceId: string | null;
  minutes: number; // effektive Summe aller Zeiteinträge
};

export type DraftLine = {
  siteId: string;
  jobId: string | null;
  description: string;
  quantity: number;
  unit: InvoiceUnit;
  unitPriceCents: number;
  vatRate: number;
  totalCents: number;
};

export const KU_HINWEIS = "Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.";
export const UST_SATZ = 19;

const MONATE = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];

export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${MONATE[m - 1]} ${y}`;
}

function shortDate(iso: string): string {
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}.`;
}

/** Stunden auf 2 Nachkommastellen; der Betrag wird aus der gerundeten Menge berechnet, damit Menge × Preis = Betrag gilt. */
export function hoursFromMinutes(minutes: number): number {
  return Math.round((minutes / 60) * 100) / 100;
}

export function lineTotal(quantity: number, unitPriceCents: number): number {
  return Math.round(Math.round(quantity * 100) * unitPriceCents / 100);
}

/** Einsätze, die in eine Rechnung für den Monat gehören (abgenommen, noch nicht berechnet). */
export function billableJobs(jobs: BillingJob[], siteIds: Set<string>, month: string): BillingJob[] {
  return jobs
    .filter((j) => siteIds.has(j.siteId) && j.status === "abgenommen" && !j.invoiceId && j.date.startsWith(month))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

export function buildInvoiceLines(input: {
  sites: BillingSite[];
  jobs: BillingJob[];
  month: string;
  flatBilledSiteIds: Set<string>; // Objekte, deren Pauschale für den Monat schon berechnet ist
  kleinunternehmer: boolean;
}): { lines: DraftLine[]; jobIds: string[]; netCents: number; vatCents: number; totalCents: number } {
  const { sites, month, flatBilledSiteIds, kleinunternehmer } = input;
  const vatRate = kleinunternehmer ? 0 : UST_SATZ;
  const siteById = new Map(sites.map((s) => [s.id, s]));
  const jobs = billableJobs(input.jobs, new Set(siteById.keys()), month);
  const lines: DraftLine[] = [];

  for (const site of sites) {
    const siteJobs = jobs.filter((j) => j.siteId === site.id);
    if (site.billingModel === "monthly_flat") {
      if (flatBilledSiteIds.has(site.id)) continue;
      lines.push({
        siteId: site.id,
        jobId: null,
        description: `${site.name} – Monatspauschale ${monthLabel(month)} (${siteJobs.length} Einsätze)`,
        quantity: 1,
        unit: "Monat",
        unitPriceCents: site.rateCents,
        vatRate,
        totalCents: site.rateCents,
      });
      continue;
    }
    for (const job of siteJobs) {
      if (site.billingModel === "hourly") {
        const hours = hoursFromMinutes(job.minutes);
        lines.push({
          siteId: site.id,
          jobId: job.id,
          description: `${shortDate(job.date)} ${site.name} – ${job.title}`,
          quantity: hours,
          unit: "Std",
          unitPriceCents: site.rateCents,
          vatRate,
          totalCents: lineTotal(hours, site.rateCents),
        });
      } else {
        lines.push({
          siteId: site.id,
          jobId: job.id,
          description: `${shortDate(job.date)} ${site.name} – ${job.title}`,
          quantity: 1,
          unit: "Einsatz",
          unitPriceCents: site.rateCents,
          vatRate,
          totalCents: site.rateCents,
        });
      }
    }
  }

  return { lines, jobIds: jobs.map((j) => j.id), ...totals(lines, kleinunternehmer) };
}

export function totals(lines: { totalCents: number }[], kleinunternehmer: boolean) {
  const netCents = lines.reduce((s, l) => s + l.totalCents, 0);
  const vatCents = kleinunternehmer ? 0 : Math.round((netCents * UST_SATZ) / 100);
  return { netCents, vatCents, totalCents: netCents + vatCents };
}

// ---------- Storno ----------

/** Was zum Einordnen einer Rechnung nötig ist. */
export type CountableInvoice = { status: string; kind: string };

/** Ausgestellte Belege (auch stornierte Rechnungen und Stornorechnungen) – zusammen ergeben sie den Umsatz. */
export const ISSUED_STATUSES = ["final", "bezahlt", "storniert"] as const;

/** Offen ist nur eine finalisierte, unbezahlte Rechnung – keine Stornorechnung. */
export const isOpen = (inv: CountableInvoice) => inv.kind === "rechnung" && inv.status === "final";

export const canCancel = (inv: CountableInvoice) => inv.kind === "rechnung" && (inv.status === "final" || inv.status === "bezahlt");

// 0 statt -0, damit gespiegelte Nullbeträge nicht als "-0,00 €" erscheinen
const neg = (n: number) => (n === 0 ? 0 : -n);

/** Stornorechnung: dieselben Positionen mit negativer Menge und negativem Betrag – spiegelt die Rechnung exakt. */
export function stornoLines<L extends { quantity: number; totalCents: number }>(lines: L[]): L[] {
  return lines.map((l) => ({ ...l, quantity: neg(l.quantity), totalCents: neg(l.totalCents) }));
}

export function stornoTotals(inv: { netCents: number; vatCents: number; totalCents: number }) {
  return { netCents: neg(inv.netCents), vatCents: neg(inv.vatCents), totalCents: neg(inv.totalCents) };
}

/** Rechnungsnummer z. B. RE-2026-0001 */
export function formatInvoiceNumber(prefix: string, year: number, seq: number): string {
  return `${prefix}-${year}-${String(seq).padStart(4, "0")}`;
}
