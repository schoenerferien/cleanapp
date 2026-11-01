import "server-only";
import { renderToBuffer } from "@react-pdf/renderer";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { hoursLabel, timeDe } from "@/domain/format";
import { addDays, effectiveEnd, effectiveMinutes, effectiveStart, monthRange, todayBerlin } from "@/domain/time";
import { InvoiceDocument, type InvoicePdfData } from "@/pdf/InvoiceDocument";
import { findFile, getFile, putFile } from "@/server/storage";

type Invoice = typeof schema.invoices.$inferSelect;

const MAX_PROOF_PHOTOS = 40;

export function invoicePdfFilename(inv: Pick<Invoice, "number">): string {
  return inv.number ? `Rechnung-${inv.number}.pdf` : "Rechnungsentwurf.pdf";
}

export const frozenPdfKey = (inv: Pick<Invoice, "id" | "tenantId">) => `${inv.tenantId}/rechnungen/${inv.id}.pdf`;

/**
 * PDF einer Rechnung. Entwürfe werden jedes Mal neu erzeugt. Finalisierte Rechnungen werden einmal erzeugt
 * und dann unverändert abgelegt – so bekommt man später genau das PDF, das verschickt wurde, auch wenn sich
 * Namen oder Fotos danach ändern.
 */
export async function invoicePdf(inv: Invoice): Promise<Uint8Array> {
  if (inv.status === "entwurf") return renderInvoicePdf(inv);
  const frozen = await findFile(frozenPdfKey(inv));
  if (frozen) return new Uint8Array(frozen);
  const pdf = await renderInvoicePdf(inv);
  await putFile(frozenPdfKey(inv), pdf);
  return pdf;
}

/** Legt das PDF direkt beim Finalisieren ab. */
export async function freezeInvoicePdf(invoiceId: string, tenantId: string): Promise<void> {
  const [inv] = await db
    .select()
    .from(schema.invoices)
    .where(and(eq(schema.invoices.id, invoiceId), eq(schema.invoices.tenantId, tenantId)));
  if (inv && inv.status !== "entwurf") await invoicePdf(inv);
}

async function renderInvoicePdf(inv: Invoice): Promise<Uint8Array> {
  const { invoiceLines, tenants, customers, jobs, sites, timeEntries, photos, user } = schema;
  const id = inv.id;

  // Entwürfe zeigen aktuelle Stammdaten, finalisierte Rechnungen den eingefrorenen Stand
  let tenantSnap = inv.tenantSnapshot;
  let customerSnap = inv.customerSnapshot;
  if (!tenantSnap || !customerSnap) {
    const [t] = await db.select().from(tenants).where(eq(tenants.id, inv.tenantId));
    const [c] = await db.select().from(customers).where(eq(customers.id, inv.customerId));
    tenantSnap = t;
    customerSnap = c;
  }

  const [lines, billedJobs] = await Promise.all([
    db.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, id)).orderBy(asc(invoiceLines.position)),
    db
      .select({ id: jobs.id, date: jobs.date, title: jobs.title, siteName: sites.name })
      .from(jobs)
      .innerJoin(sites, eq(sites.id, jobs.siteId))
      .where(eq(jobs.invoiceId, id))
      .orderBy(asc(jobs.date), asc(jobs.plannedStart)),
  ]);
  const jobIds = billedJobs.map((j) => j.id);
  const [entries, jobPhotos] = jobIds.length
    ? await Promise.all([
        db
          .select({ entry: timeEntries, name: user.name })
          .from(timeEntries)
          .innerJoin(user, eq(user.id, timeEntries.userId))
          .where(inArray(timeEntries.jobId, jobIds))
          .orderBy(asc(timeEntries.startAt)),
        db
          .select()
          .from(photos)
          .where(and(inArray(photos.jobId, jobIds), inArray(photos.kind, ["vorher", "nachher"])))
          .orderBy(asc(photos.takenAt)),
      ])
    : [[], []];

  let photoBudget = MAX_PROOF_PHOTOS;
  const proof: InvoicePdfData["proof"] = [];
  for (const j of billedJobs) {
    const es = entries.filter((e) => e.entry.jobId === j.id);
    // je Einsatz das erste Vorher- und das erste Nachher-Foto
    const picks = ["vorher", "nachher"]
      .map((k) => jobPhotos.find((p) => p.jobId === j.id && p.kind === k))
      .filter((p): p is NonNullable<typeof p> => Boolean(p))
      .slice(0, Math.max(0, photoBudget));
    photoBudget -= picks.length;
    proof.push({
      date: j.date,
      siteName: j.siteName,
      title: j.title,
      team: [...new Set(es.map((e) => e.name))].join(", ") || "–",
      times: es.map((e) => `${timeDe(effectiveStart(e.entry))}–${timeDe(effectiveEnd(e.entry))}`).join(", ") || "–",
      hours: hoursLabel(es.reduce((s, e) => s + effectiveMinutes(e.entry), 0)),
      photos: await Promise.all(picks.map(async (p) => ({ kind: p.kind, data: await getFile(p.filePath) }))),
    });
  }

  const invoiceDate = inv.invoiceDate ?? todayBerlin();
  const { from, to } = monthRange(inv.periodMonth);
  const data: InvoicePdfData = {
    draft: inv.status === "entwurf",
    number: inv.number,
    invoiceDate,
    dueDate: addDays(invoiceDate, 14),
    periodFrom: from,
    periodTo: to,
    periodMonth: inv.periodMonth,
    kleinunternehmer: inv.kleinunternehmer,
    tenant: tenantSnap,
    customer: customerSnap,
    lines,
    netCents: inv.netCents,
    vatCents: inv.vatCents,
    totalCents: inv.totalCents,
    proof,
  };

  return new Uint8Array(await renderToBuffer(<InvoiceDocument d={data} />));
}
