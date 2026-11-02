"use server";

import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db, schema, type Tx } from "@/db";
import type { CustomerSnapshot, InvoiceUnit } from "@/db/schema";
import { canCancel, formatInvoiceNumber, lineTotal, stornoLines, stornoTotals, totals, UST_SATZ } from "@/domain/billing";
import { todayBerlin } from "@/domain/time";
import { audit } from "@/server/audit";
import { computeInvoice } from "@/server/billing-data";
import { freezeInvoicePdf } from "@/server/invoice-pdf";
import { euroToCents, optFloat, str } from "@/server/form";
import { requireOwner } from "@/server/session";

const { invoices, invoiceLines, jobs, tenants, customers } = schema;

async function draftInvoice(invoiceId: string, tenantId: string, tx: Tx | typeof db = db) {
  const [inv] = await tx.select().from(invoices).where(and(eq(invoices.id, invoiceId), eq(invoices.tenantId, tenantId)));
  if (!inv) throw new Error("Rechnung nicht gefunden");
  if (inv.status !== "entwurf") throw new Error("Finalisierte Rechnungen können nicht geändert werden (GoBD). Korrektur nur per Stornorechnung.");
  return inv;
}

async function recalc(invoiceId: string, kleinunternehmer: boolean, tx: Tx | typeof db = db) {
  const lines = await tx.select({ totalCents: invoiceLines.totalCents }).from(invoiceLines).where(eq(invoiceLines.invoiceId, invoiceId));
  await tx.update(invoices).set(totals(lines, kleinunternehmer)).where(eq(invoices.id, invoiceId));
}

export async function createDraftInvoice(customerId: string, month: string) {
  const me = await requireOwner();
  const id = await db.transaction(async (tx) => {
    const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, me.tenantId));
    const [customer] = await tx.select().from(customers).where(and(eq(customers.id, customerId), eq(customers.tenantId, me.tenantId)));
    if (!customer) throw new Error("Kunde nicht gefunden");
    const result = await computeInvoice(me.tenantId, customerId, month, tenant.kleinunternehmer, tx);
    if (result.lines.length === 0) throw new Error("Für diesen Monat gibt es nichts abzurechnen.");

    const [inv] = await tx
      .insert(invoices)
      .values({
        tenantId: me.tenantId,
        customerId,
        periodMonth: month,
        kleinunternehmer: tenant.kleinunternehmer,
        netCents: result.netCents,
        vatCents: result.vatCents,
        totalCents: result.totalCents,
      })
      .returning({ id: invoices.id });
    await tx.insert(invoiceLines).values(result.lines.map((l, i) => ({ ...l, tenantId: me.tenantId, invoiceId: inv.id, position: i + 1 })));
    // Einsätze reservieren, damit sie nicht doppelt abgerechnet werden
    if (result.jobIds.length) {
      await tx.update(jobs).set({ invoiceId: inv.id }).where(and(inArray(jobs.id, result.jobIds), isNull(jobs.invoiceId)));
    }
    await audit({ tenantId: me.tenantId, actorId: me.id, action: "create_draft", entity: "invoice", entityId: inv.id, data: { month, jobs: result.jobIds.length } }, tx);
    return inv.id;
  });
  redirect(`/rechnungen/${id}`);
}

export async function updateDraftLine(lineId: string, fd: FormData) {
  const me = await requireOwner();
  await db.transaction(async (tx) => {
    const [line] = await tx.select().from(invoiceLines).where(and(eq(invoiceLines.id, lineId), eq(invoiceLines.tenantId, me.tenantId)));
    if (!line) throw new Error("Position nicht gefunden");
    const inv = await draftInvoice(line.invoiceId, me.tenantId, tx);
    const quantity = optFloat(fd, "quantity") ?? line.quantity;
    const unitPriceCents = euroToCents(str(fd, "unitPrice") || "0");
    await tx
      .update(invoiceLines)
      .set({ description: str(fd, "description") || line.description, quantity, unitPriceCents, totalCents: lineTotal(quantity, unitPriceCents) })
      .where(eq(invoiceLines.id, lineId));
    await recalc(inv.id, inv.kleinunternehmer, tx);
  });
  revalidatePath("/rechnungen", "layout");
}

export async function deleteDraftLine(lineId: string) {
  const me = await requireOwner();
  await db.transaction(async (tx) => {
    const [line] = await tx.select().from(invoiceLines).where(and(eq(invoiceLines.id, lineId), eq(invoiceLines.tenantId, me.tenantId)));
    if (!line) return;
    const inv = await draftInvoice(line.invoiceId, me.tenantId, tx);
    await tx.delete(invoiceLines).where(eq(invoiceLines.id, lineId));
    if (line.jobId) await tx.update(jobs).set({ invoiceId: null }).where(eq(jobs.id, line.jobId));
    await recalc(inv.id, inv.kleinunternehmer, tx);
  });
  revalidatePath("/rechnungen", "layout");
}

export async function addDraftLine(invoiceId: string, fd: FormData) {
  const me = await requireOwner();
  await db.transaction(async (tx) => {
    const inv = await draftInvoice(invoiceId, me.tenantId, tx);
    const [{ max }] = await tx
      .select({ max: sql<number>`coalesce(max(${invoiceLines.position}), 0)::int` })
      .from(invoiceLines)
      .where(eq(invoiceLines.invoiceId, invoiceId));
    const quantity = optFloat(fd, "quantity") ?? 1;
    const unitPriceCents = euroToCents(str(fd, "unitPrice") || "0");
    await tx.insert(invoiceLines).values({
      tenantId: me.tenantId,
      invoiceId,
      position: max + 1,
      description: str(fd, "description") || "Sonderleistung",
      quantity,
      unit: (str(fd, "unit") || "Pauschal") as InvoiceUnit,
      unitPriceCents,
      vatRate: inv.kleinunternehmer ? 0 : UST_SATZ,
      totalCents: lineTotal(quantity, unitPriceCents),
    });
    await recalc(invoiceId, inv.kleinunternehmer, tx);
  });
  revalidatePath(`/rechnungen/${invoiceId}`);
}

export async function deleteDraft(invoiceId: string) {
  const me = await requireOwner();
  await db.transaction(async (tx) => {
    await draftInvoice(invoiceId, me.tenantId, tx);
    await tx.update(jobs).set({ invoiceId: null }).where(eq(jobs.invoiceId, invoiceId));
    await tx.delete(invoices).where(eq(invoices.id, invoiceId));
    await audit({ tenantId: me.tenantId, actorId: me.id, action: "delete_draft", entity: "invoice", entityId: invoiceId }, tx);
  });
  redirect("/rechnungen");
}

/**
 * Vergibt die fortlaufende Nummer (Zähler mit Zeilensperre) und friert Rechnungsdaten ein.
 * Eine Stornorechnung übernimmt den Empfänger der stornierten Rechnung.
 */
async function issue(tx: Tx, invoiceId: string, tenantId: string, customerSnapshot?: CustomerSnapshot | null): Promise<string> {
  const [inv] = await tx.select().from(invoices).where(eq(invoices.id, invoiceId));
  const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, tenantId)).for("update");
  const [customer] = await tx.select().from(customers).where(eq(customers.id, inv.customerId));
  const invoiceDate = todayBerlin();
  const number = formatInvoiceNumber(tenant.invoicePrefix, Number(invoiceDate.slice(0, 4)), tenant.nextInvoiceNo);

  await tx.update(tenants).set({ nextInvoiceNo: tenant.nextInvoiceNo + 1 }).where(eq(tenants.id, tenant.id));
  await tx
    .update(invoices)
    .set({
      number,
      status: "final",
      invoiceDate,
      finalizedAt: new Date(),
      tenantSnapshot: {
        name: tenant.name,
        ownerName: tenant.ownerName,
        street: tenant.street,
        zip: tenant.zip,
        city: tenant.city,
        email: tenant.email,
        phone: tenant.phone,
        taxNumber: tenant.taxNumber,
        vatId: tenant.vatId,
        iban: tenant.iban,
        bic: tenant.bic,
        bankName: tenant.bankName,
      },
      customerSnapshot: customerSnapshot ?? { name: customer.name, contactName: customer.contactName, street: customer.street, zip: customer.zip, city: customer.city },
    })
    .where(eq(invoices.id, invoiceId));
  return number;
}

export async function finalizeInvoice(invoiceId: string) {
  const me = await requireOwner();
  await db.transaction(async (tx) => {
    await draftInvoice(invoiceId, me.tenantId, tx);
    const lines = await tx.select({ id: invoiceLines.id }).from(invoiceLines).where(eq(invoiceLines.invoiceId, invoiceId)).orderBy(asc(invoiceLines.position));
    if (lines.length === 0) throw new Error("Rechnung ohne Positionen kann nicht finalisiert werden.");
    const number = await issue(tx, invoiceId, me.tenantId);
    await audit({ tenantId: me.tenantId, actorId: me.id, action: "finalize", entity: "invoice", entityId: invoiceId, data: { number } }, tx);
  });
  // PDF sofort unverändert ablegen; schlägt das fehl, holt der erste Abruf es nach
  await freezeInvoicePdf(invoiceId, me.tenantId).catch((err) => console.error("Rechnungs-PDF konnte nicht abgelegt werden", err));
  revalidatePath("/rechnungen", "layout");
}

/**
 * Storniert eine ausgestellte Rechnung (GoBD): Die Rechnung bleibt unverändert erhalten und wird nur als storniert
 * markiert; dazu entsteht eine Stornorechnung mit eigener Nummer und negativen Beträgen. Die Einsätze werden frei –
 * auf Wunsch gleich für einen korrigierten Entwurf mit den bisherigen Positionen.
 */
export async function cancelInvoice(invoiceId: string, fd: FormData) {
  const me = await requireOwner();
  const reason = str(fd, "reason").slice(0, 500) || null;
  const correct = fd.get("correct") === "on";

  const { stornoId, draftId } = await db.transaction(async (tx) => {
    const [inv] = await tx.select().from(invoices).where(and(eq(invoices.id, invoiceId), eq(invoices.tenantId, me.tenantId))).for("update");
    if (!inv) throw new Error("Rechnung nicht gefunden");
    if (!canCancel(inv)) throw new Error("Nur ausgestellte, noch nicht stornierte Rechnungen können storniert werden.");
    const lines = await tx.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, inv.id)).orderBy(asc(invoiceLines.position));
    // Positionen ohne eigene ID in eine andere Rechnung übernehmen
    const copyLines = (target: string, from: typeof lines) =>
      from.map((l) => ({ ...l, id: undefined, tenantId: me.tenantId, invoiceId: target }));

    // Stornorechnung wie jede Rechnung: erst Entwurf mit Positionen, dann ausstellen
    const [storno] = await tx
      .insert(invoices)
      .values({
        tenantId: me.tenantId,
        customerId: inv.customerId,
        kind: "storno",
        cancelsInvoiceId: inv.id,
        periodMonth: inv.periodMonth,
        kleinunternehmer: inv.kleinunternehmer,
        ...stornoTotals(inv),
      })
      .returning({ id: invoices.id });
    await tx.insert(invoiceLines).values(copyLines(storno.id, stornoLines(lines)));
    const stornoNumber = await issue(tx, storno.id, me.tenantId, inv.customerSnapshot);
    // Erst jetzt erlaubt der GoBD-Trigger den Status "storniert"
    await tx.update(invoices).set({ status: "storniert" }).where(eq(invoices.id, inv.id));

    let draftId: string | null = null;
    if (correct) {
      // Korrektur mit der aktuellen Steuereinstellung (z. B. nach Überschreiten der Kleinunternehmergrenze)
      const [tenant] = await tx.select({ kleinunternehmer: tenants.kleinunternehmer }).from(tenants).where(eq(tenants.id, me.tenantId));
      const vatRate = tenant.kleinunternehmer ? 0 : UST_SATZ;
      const draftLines = lines.map((l) => ({ ...l, vatRate }));
      const [draft] = await tx
        .insert(invoices)
        .values({
          tenantId: me.tenantId,
          customerId: inv.customerId,
          periodMonth: inv.periodMonth,
          kleinunternehmer: tenant.kleinunternehmer,
          ...totals(draftLines, tenant.kleinunternehmer),
        })
        .returning({ id: invoices.id });
      await tx.insert(invoiceLines).values(copyLines(draft.id, draftLines));
      draftId = draft.id;
    }
    await tx.update(jobs).set({ invoiceId: draftId }).where(eq(jobs.invoiceId, inv.id));

    await audit(
      {
        tenantId: me.tenantId,
        actorId: me.id,
        action: "cancel",
        entity: "invoice",
        entityId: inv.id,
        data: { number: inv.number, stornoId: storno.id, stornoNumber, correctionDraftId: draftId, reason },
      },
      tx,
    );
    return { stornoId: storno.id, draftId };
  });

  await freezeInvoicePdf(stornoId, me.tenantId).catch((err) => console.error("Storno-PDF konnte nicht abgelegt werden", err));
  revalidatePath("/rechnungen", "layout");
  redirect(`/rechnungen/${draftId ?? stornoId}`);
}

export async function markPaid(invoiceId: string) {
  const me = await requireOwner();
  await db
    .update(invoices)
    .set({ status: "bezahlt", paidAt: new Date() })
    .where(and(eq(invoices.id, invoiceId), eq(invoices.tenantId, me.tenantId), eq(invoices.kind, "rechnung"), eq(invoices.status, "final")));
  await audit({ tenantId: me.tenantId, actorId: me.id, action: "paid", entity: "invoice", entityId: invoiceId });
  revalidatePath("/rechnungen", "layout");
}
