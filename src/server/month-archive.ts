import "server-only";
import { createHash } from "node:crypto";
import { and, asc, eq, gte, lte, ne } from "drizzle-orm";
import { db, schema } from "@/db";
import { monthLabel } from "@/domain/billing";
import { dateTimeDe } from "@/domain/format";
import { monthRange } from "@/domain/time";
import { invoicePdf, invoicePdfFilename } from "@/server/invoice-pdf";
import { timeEntriesCsv } from "@/server/time-report";
import { createZip, type ZipEntry } from "@/server/zip";

// Monatsarchiv: Die Firma lädt jeden Monat die rechtlich wichtigen Unterlagen herunter und bewahrt sie selbst auf.
// Damit hängt die Aufbewahrungspflicht nicht am Server der App.

export const ARCHIVE_ENTITY = "monatsarchiv";

const encode = (s: string) => new TextEncoder().encode(s);
const sha256 = (d: Uint8Array) => createHash("sha256").update(d).digest("hex");

export async function buildMonthArchive(tenantId: string, month: string): Promise<Uint8Array> {
  const { invoices, tenants } = schema;
  const { from, to } = monthRange(month);
  const [[tenant], issued, csv] = await Promise.all([
    db.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, tenantId)),
    // Rechnungen, die in diesem Monat ausgestellt wurden (ohne Entwürfe)
    db
      .select()
      .from(invoices)
      .where(and(eq(invoices.tenantId, tenantId), ne(invoices.status, "entwurf"), gte(invoices.invoiceDate, from), lte(invoices.invoiceDate, to)))
      .orderBy(asc(invoices.number)),
    timeEntriesCsv(tenantId, month),
  ]);

  const files: ZipEntry[] = [{ name: `arbeitszeiten-${month}.csv`, data: encode(csv) }];
  for (const inv of issued) {
    files.push({ name: `rechnungen/${invoicePdfFilename(inv)}`, data: await invoicePdf(inv) });
  }

  const readme = [
    `Monatsarchiv ${tenant?.name ?? ""} – ${monthLabel(month)}`,
    `Erstellt am ${dateTimeDe(new Date())} mit CleaningHub`,
    "",
    "Inhalt:",
    ...files.map((f) => `- ${f.name}\r\n  SHA-256: ${sha256(f.data)}`),
    ...(issued.length === 0 ? ["(In diesem Monat wurden keine Rechnungen ausgestellt.)"] : []),
    "",
    "Bitte dieses Archiv selbst aufbewahren – am besten an zwei Orten (z. B. eigener Rechner und USB-Stick oder Cloud).",
    "Die App ist kein Archiv.",
    "",
    "Aufbewahrungsfristen nach aktuellem Stand (im Zweifel Steuerberater fragen):",
    "- Arbeitszeitaufzeichnungen: mindestens 2 Jahre (§ 17 Abs. 1 MiLoG)",
    "- Ausgestellte Rechnungen: 8 Jahre (§ 14b UStG, § 147 AO)",
    "",
    "Mit den SHA-256-Prüfsummen lässt sich später nachprüfen, ob eine Datei verändert wurde.",
  ].join("\r\n");

  return createZip([{ name: "LIESMICH.txt", data: encode(readme) }, ...files]);
}

/** Monate ("YYYY-MM"), deren Archiv schon heruntergeladen wurde. */
export async function archivedMonths(tenantId: string): Promise<Set<string>> {
  const { auditLog } = schema;
  const rows = await db
    .selectDistinct({ month: auditLog.entityId })
    .from(auditLog)
    .where(and(eq(auditLog.tenantId, tenantId), eq(auditLog.entity, ARCHIVE_ENTITY)));
  return new Set(rows.map((r) => r.month).filter((m): m is string => Boolean(m)));
}
