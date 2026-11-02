import { describe, expect, it } from "vitest";
import {
  buildInvoiceLines,
  canCancel,
  formatInvoiceNumber,
  hoursFromMinutes,
  isOpen,
  lineTotal,
  stornoLines,
  stornoTotals,
  totals,
  type BillingJob,
  type BillingSite,
} from "./billing";

const sites: BillingSite[] = [
  { id: "praxis", name: "Praxis Dr. Meier", billingModel: "hourly", rateCents: 3200 },
  { id: "treppe", name: "Treppenhaus Holstenstr.", billingModel: "per_visit", rateCents: 8500 },
  { id: "buero", name: "Büro Förde", billingModel: "monthly_flat", rateCents: 45_000 },
];

const job = (p: Partial<BillingJob> & Pick<BillingJob, "id" | "siteId" | "date">): BillingJob => ({
  title: "Unterhaltsreinigung",
  status: "abgenommen",
  invoiceId: null,
  minutes: 120,
  ...p,
});

const jobs: BillingJob[] = [
  job({ id: "p1", siteId: "praxis", date: "2026-10-02", minutes: 150 }),
  job({ id: "p2", siteId: "praxis", date: "2026-10-09", minutes: 50 }),
  job({ id: "t1", siteId: "treppe", date: "2026-10-03" }),
  job({ id: "t2", siteId: "treppe", date: "2026-10-10" }),
  job({ id: "b1", siteId: "buero", date: "2026-10-04" }),
  job({ id: "offen", siteId: "praxis", date: "2026-10-11", status: "erledigt" }),
  job({ id: "schon", siteId: "treppe", date: "2026-10-12", invoiceId: "inv-x" }),
  job({ id: "sept", siteId: "treppe", date: "2026-09-30" }),
];

describe("buildInvoiceLines", () => {
  it("bildet alle drei Modelle ab und nimmt nur abgenommene, unberechnete Einsätze des Monats", () => {
    const r = buildInvoiceLines({ sites, jobs, month: "2026-10", flatBilledSiteIds: new Set(), kleinunternehmer: true });
    expect(r.jobIds.sort()).toEqual(["b1", "p1", "p2", "t1", "t2"]);
    expect(r.lines.map((l) => [l.unit, l.quantity, l.totalCents])).toEqual([
      ["Std", 2.5, 8000],
      ["Std", 0.83, 2656], // 50 min → 0,83 Std × 32 € = 26,56 € (Menge × Preis = Betrag)
      ["Einsatz", 1, 8500],
      ["Einsatz", 1, 8500],
      ["Monat", 1, 45_000],
    ]);
    expect(r.netCents).toBe(72_656);
    expect(r.vatCents).toBe(0);
    expect(r.totalCents).toBe(72_656);
  });

  it("berechnet keine Pauschale doppelt", () => {
    const r = buildInvoiceLines({
      sites,
      jobs,
      month: "2026-10",
      flatBilledSiteIds: new Set(["buero"]),
      kleinunternehmer: true,
    });
    expect(r.lines.some((l) => l.unit === "Monat")).toBe(false);
  });

  it("weist ohne Kleinunternehmerregelung 19 % USt aus", () => {
    const r = buildInvoiceLines({ sites, jobs, month: "2026-10", flatBilledSiteIds: new Set(), kleinunternehmer: false });
    expect(r.lines.every((l) => l.vatRate === 19)).toBe(true);
    expect(r.vatCents).toBe(Math.round(72_656 * 0.19));
    expect(r.totalCents).toBe(72_656 + Math.round(72_656 * 0.19));
  });

  it("liefert leere Rechnung, wenn nichts abrechenbar ist", () => {
    const r = buildInvoiceLines({
      sites: sites.slice(0, 2),
      jobs: [],
      month: "2026-11",
      flatBilledSiteIds: new Set(),
      kleinunternehmer: true,
    });
    expect(r.lines).toHaveLength(0);
    expect(r.totalCents).toBe(0);
  });
});

describe("Hilfsfunktionen", () => {
  it("hoursFromMinutes rundet auf 2 Stellen", () => {
    expect(hoursFromMinutes(50)).toBe(0.83);
    expect(hoursFromMinutes(90)).toBe(1.5);
  });
  it("lineTotal rechnet aus gerundeter Menge", () => {
    expect(lineTotal(0.83, 3200)).toBe(2656);
    expect(lineTotal(1, 8500)).toBe(8500);
  });
  it("Rechnungsnummer", () => {
    expect(formatInvoiceNumber("RE", 2026, 1)).toBe("RE-2026-0001");
  });
});

describe("Storno", () => {
  const original = buildInvoiceLines({ sites, jobs, month: "2026-10", flatBilledSiteIds: new Set(), kleinunternehmer: false });

  it("spiegelt alle Positionen und Beträge, sodass Rechnung + Storno 0 ergibt", () => {
    const lines = stornoLines(original.lines);
    expect(lines.map((l) => l.description)).toEqual(original.lines.map((l) => l.description));
    expect(lines.every((l, i) => l.quantity === -original.lines[i].quantity && l.totalCents === -original.lines[i].totalCents)).toBe(true);
    expect(lines.every((l, i) => l.unitPriceCents === original.lines[i].unitPriceCents)).toBe(true);

    const storno = stornoTotals(original);
    expect(storno).toEqual(totals(lines, false));
    expect(storno.totalCents + original.totalCents).toBe(0);
    expect(storno.vatCents + original.vatCents).toBe(0);
  });

  it("macht aus 0 keine -0", () => {
    const [line] = stornoLines([{ quantity: 0, totalCents: 0 }]);
    expect(Object.is(line.totalCents, 0) && Object.is(line.quantity, 0)).toBe(true);
    expect(Object.is(stornoTotals({ netCents: 0, vatCents: 0, totalCents: 0 }).vatCents, 0)).toBe(true);
  });

  it("storniert nur ausgestellte Rechnungen, nicht Entwürfe, Stornos oder bereits Storniertes", () => {
    expect(canCancel({ kind: "rechnung", status: "final" })).toBe(true);
    expect(canCancel({ kind: "rechnung", status: "bezahlt" })).toBe(true);
    expect(canCancel({ kind: "rechnung", status: "entwurf" })).toBe(false);
    expect(canCancel({ kind: "rechnung", status: "storniert" })).toBe(false);
    expect(canCancel({ kind: "storno", status: "final" })).toBe(false);
  });

  it("zählt Stornorechnungen nicht als offene Forderung", () => {
    expect(isOpen({ kind: "rechnung", status: "final" })).toBe(true);
    expect(isOpen({ kind: "storno", status: "final" })).toBe(false);
    expect(isOpen({ kind: "rechnung", status: "storniert" })).toBe(false);
  });
});
