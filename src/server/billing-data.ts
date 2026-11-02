import "server-only";
import { and, eq, gte, inArray, isNull, lte, ne } from "drizzle-orm";
import { db, schema, type Tx } from "@/db";
import { buildInvoiceLines, type BillingJob } from "@/domain/billing";
import { effectiveMinutes, monthRange } from "@/domain/time";

/** Lädt alles, was die reine Abrechnungsfunktion braucht, und berechnet die Positionen. */
export async function computeInvoice(tenantId: string, customerId: string, month: string, kleinunternehmer: boolean, tx: Tx | typeof db = db) {
  const { sites, jobs, timeEntries, invoiceLines, invoices } = schema;
  const { from, to } = monthRange(month);

  const customerSites = await tx
    .select({ id: sites.id, name: sites.name, billingModel: sites.billingModel, rateCents: sites.rateCents })
    .from(sites)
    .where(and(eq(sites.tenantId, tenantId), eq(sites.customerId, customerId), eq(sites.active, true)));
  const siteIds = customerSites.map((s) => s.id);
  if (siteIds.length === 0) return { ...buildInvoiceLines({ sites: [], jobs: [], month, flatBilledSiteIds: new Set(), kleinunternehmer }), sites: customerSites };

  const jobRows = await tx
    .select({ id: jobs.id, siteId: jobs.siteId, date: jobs.date, title: jobs.title, status: jobs.status, invoiceId: jobs.invoiceId })
    .from(jobs)
    .where(and(inArray(jobs.siteId, siteIds), gte(jobs.date, from), lte(jobs.date, to), eq(jobs.status, "abgenommen"), isNull(jobs.invoiceId)));

  const entries = jobRows.length
    ? await tx.select().from(timeEntries).where(inArray(timeEntries.jobId, jobRows.map((j) => j.id)))
    : [];
  const billingJobs: BillingJob[] = jobRows.map((j) => ({
    ...j,
    minutes: entries.filter((e) => e.jobId === j.id).reduce((s, e) => s + effectiveMinutes(e), 0),
  }));

  // Pauschalen, die für diesen Monat schon auf einer gültigen Rechnung oder einem Entwurf stehen (Storniertes zählt nicht)
  const flat = await tx
    .select({ siteId: invoiceLines.siteId })
    .from(invoiceLines)
    .innerJoin(invoices, eq(invoices.id, invoiceLines.invoiceId))
    .where(
      and(
        inArray(invoiceLines.siteId, siteIds),
        eq(invoiceLines.unit, "Monat"),
        eq(invoices.periodMonth, month),
        eq(invoices.tenantId, tenantId),
        eq(invoices.kind, "rechnung"),
        ne(invoices.status, "storniert"),
      ),
    );

  return {
    ...buildInvoiceLines({
      sites: customerSites,
      jobs: billingJobs,
      month,
      flatBilledSiteIds: new Set(flat.map((f) => f.siteId!).filter(Boolean)),
      kleinunternehmer,
    }),
    sites: customerSites,
  };
}
