import "server-only";
import { createHash } from "node:crypto";
import { and, asc, count, desc, eq, getTableName, ne, sql } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import journal from "../../drizzle/meta/_journal.json";
import { db, schema } from "@/db";
import { dateTimeDe, timeDe } from "@/domain/format";
import { todayBerlin } from "@/domain/time";
import { frozenPdfKey, invoicePdf, invoicePdfFilename } from "@/server/invoice-pdf";
import { findFile } from "@/server/storage";
import type { ZipEntry } from "@/server/zip";

// Datensicherung: alle Daten einer Firma als ZIP – Datenbank (JSON je Tabelle), Fotos und Rechnungs-PDFs.
// Die Firma lädt sie selbst herunter. Passwörter und Sitzungen bleiben draußen, damit ein verlorenes Backup keine Logins verrät.

export const BACKUP_ENTITY = "datensicherung";

/** Im Audit-Log je heruntergeladenem Backup. */
export type BackupAuditData = { rows: number; files: number; missing: number; bytes: number };

const { tenants, user, customers, sites, jobs, jobAssignments, timeEntries, photos, invoices, invoiceLines, auditLog, aiInvocations } = schema;

// In Einspiel-Reihenfolge (Fremdschlüssel). Nicht dabei: session, account (Passwort-Hashes), two_factor (Schlüssel), verification.
const TABLES: { table: PgTable; tenantColumn: PgColumn }[] = [
  { table: tenants, tenantColumn: tenants.id },
  { table: user, tenantColumn: user.tenantId },
  { table: customers, tenantColumn: customers.tenantId },
  { table: sites, tenantColumn: sites.tenantId },
  { table: jobs, tenantColumn: jobs.tenantId },
  { table: jobAssignments, tenantColumn: jobAssignments.tenantId },
  { table: timeEntries, tenantColumn: timeEntries.tenantId },
  { table: photos, tenantColumn: photos.tenantId },
  { table: invoices, tenantColumn: invoices.tenantId },
  { table: invoiceLines, tenantColumn: invoiceLines.tenantId },
  { table: auditLog, tenantColumn: auditLog.tenantId },
  { table: aiInvocations, tenantColumn: aiInvocations.tenantId },
];

const encode = (s: string) => new TextEncoder().encode(s);
const sha256 = (d: Uint8Array) => createHash("sha256").update(d).digest("hex");
// Ein Datensatz je Zeile: lesbar und trotzdem kompakt
const jsonRows = (rows: unknown[]) => (rows.length ? `[\n${rows.map((r) => JSON.stringify(r)).join(",\n")}\n]\n` : "[]\n");

/** Was ein Backup jetzt enthalten würde (für die Übersicht). */
export async function backupStats(tenantId: string) {
  const [rowCounts, [photoStats], issuedInvoices] = await Promise.all([
    Promise.all(TABLES.map(({ table, tenantColumn }) => db.$count(table, eq(tenantColumn, tenantId)))),
    db
      .select({ n: count(), bytes: sql<number>`coalesce(sum(${photos.bytes}), 0)`.mapWith(Number) })
      .from(photos)
      .where(eq(photos.tenantId, tenantId)),
    db.$count(invoices, and(eq(invoices.tenantId, tenantId), ne(invoices.status, "entwurf"))),
  ]);
  return {
    tables: TABLES.length,
    rows: rowCounts.reduce((s, n) => s + n, 0),
    photos: photoStats.n,
    photoBytes: photoStats.bytes,
    invoices: issuedInvoices,
  };
}

export async function backupHistory(tenantId: string, limit = 10) {
  const rows = await db
    .select({ at: auditLog.at, data: auditLog.data, name: user.name })
    .from(auditLog)
    .leftJoin(user, eq(user.id, auditLog.actorId))
    .where(and(eq(auditLog.tenantId, tenantId), eq(auditLog.entity, BACKUP_ENTITY)))
    .orderBy(desc(auditLog.at))
    .limit(limit);
  return rows.map((r) => ({ ...r, data: r.data as BackupAuditData }));
}

/**
 * Liest die Datenbank sofort (ein konsistenter Stand) und liefert die Einträge des ZIP-Archivs.
 * Fotos und PDFs werden erst beim Durchlaufen gelesen, damit nie alles gleichzeitig im Speicher liegt.
 */
export async function buildBackup(tenantId: string) {
  const createdAt = new Date();
  const snapshot = await db.transaction(
    async (tx) => {
      const tables: { name: string; rows: unknown[] }[] = [];
      for (const { table, tenantColumn } of TABLES) {
        // Rohwerte aus Postgres (Spaltennamen wie in der Datenbank, Zeitpunkte mit Zeitzone, Mikrosekunden)
        const rows = await tx.execute(sql`select * from ${table} where ${tenantColumn} = ${tenantId} order by 1`);
        tables.push({ name: getTableName(table), rows: [...rows] });
      }
      const photoFiles = await tx.select({ filePath: photos.filePath }).from(photos).where(eq(photos.tenantId, tenantId)).orderBy(asc(photos.takenAt));
      const issued = await tx
        .select()
        .from(invoices)
        .where(and(eq(invoices.tenantId, tenantId), ne(invoices.status, "entwurf")))
        .orderBy(asc(invoices.number));
      return { tables, photoFiles, issued };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );

  const tenantName = String((snapshot.tables[0].rows[0] as { name?: string } | undefined)?.name ?? "");
  const schemaVersion = journal.entries.at(-1)?.tag ?? "unbekannt";
  const rows = snapshot.tables.reduce((s, t) => s + t.rows.length, 0);
  const files: { path: string; storageKey: string }[] = [];
  const missing: { storageKey: string; reason: string }[] = [];
  const checksums: string[] = [];

  const entry = (name: string, data: Uint8Array, store = false): ZipEntry => {
    checksums.push(`${sha256(data)}  ${name}`);
    return { name, data, store };
  };

  /** Eine fehlende oder unlesbare Datei bricht das Backup nicht ab, sondern wird darin vermerkt. */
  const read = async (storageKey: string, load: () => Promise<Uint8Array | null>) => {
    try {
      const data = await load();
      if (data) return data;
      missing.push({ storageKey, reason: "Datei nicht gefunden" });
    } catch (err) {
      console.error(`Datensicherung: ${storageKey} nicht lesbar`, err);
      missing.push({ storageKey, reason: err instanceof Error ? err.message : String(err) });
    }
    return null;
  };

  async function* entries(): AsyncGenerator<ZipEntry> {
    for (const t of snapshot.tables) yield entry(`datenbank/${t.name}.json`, encode(jsonRows(t.rows)));

    for (const { filePath } of snapshot.photoFiles) {
      const data = await read(filePath, () => findFile(filePath));
      if (!data) continue;
      const path = `fotos/${filePath.startsWith(`${tenantId}/`) ? filePath.slice(tenantId.length + 1) : filePath}`;
      files.push({ path, storageKey: filePath });
      yield entry(path, data, true);
    }

    // Finalisierte Rechnungen genau so, wie sie verschickt wurden (abgelegtes PDF)
    for (const inv of snapshot.issued) {
      const data = await read(frozenPdfKey(inv), () => invoicePdf(inv));
      if (!data) continue;
      const path = `rechnungen/${invoicePdfFilename(inv)}`;
      files.push({ path, storageKey: frozenPdfKey(inv) });
      yield entry(path, data, true);
    }

    const manifest = {
      format: "cleaninghub-datensicherung",
      version: 1,
      createdAt: createdAt.toISOString(),
      tenant: { id: tenantId, name: tenantName },
      schemaVersion,
      tables: snapshot.tables.map((t) => ({ name: t.name, file: `datenbank/${t.name}.json`, rows: t.rows.length })),
      files,
      missing,
    };
    yield entry("backup.json", encode(JSON.stringify(manifest, null, 2)));

    const photoCount = files.filter((f) => f.path.startsWith("fotos/")).length;
    const readme = [
      `Datensicherung ${tenantName}`,
      `Erstellt am ${dateTimeDe(createdAt)} mit CleaningHub`,
      "",
      "Inhalt:",
      `- datenbank/   alle Datensätze der Firma, eine JSON-Datei je Tabelle (${rows} Datensätze)`,
      `- fotos/       Fotos aus den Einsätzen (${photoCount} Dateien), Zuordnung über datenbank/photos.json`,
      `- rechnungen/  ausgestellte Rechnungen als PDF, unverändert wie verschickt (${files.length - photoCount} Dateien)`,
      "- backup.json  Übersicht für die Wiederherstellung (Tabellen, Dateien und ihr Speicherort)",
      "- PRUEFSUMMEN.sha256  SHA-256-Prüfsummen aller Dateien",
      ...(missing.length
        ? ["", `ACHTUNG: ${missing.length} Datei(en) fehlten auf dem Server und sind nicht enthalten – Liste in backup.json unter "missing".`]
        : []),
      "",
      "Nicht enthalten: Passwörter, PINs und Anmeldesitzungen (aus Sicherheitsgründen).",
      "Nach einer Wiederherstellung bekommen alle neue Zugangsdaten.",
      "",
      "Bitte sicher aufbewahren: Das Backup enthält personenbezogene Daten von Mitarbeitern und Kunden",
      "(Adressen, Löhne, Arbeitszeiten, Standorte beim Stempeln, Fotos). Am besten verschlüsselt und an zwei Orten.",
      "",
      "Prüfen, ob Dateien verändert wurden (macOS/Linux, im entpackten Ordner):",
      "  shasum -a 256 -c PRUEFSUMMEN.sha256",
      "",
      "Für die Technik – Wiederherstellung:",
      `1. Leere Datenbank anlegen und mit derselben App-Version die Migrationen einspielen (Stand: ${schemaVersion}).`,
      "2. Tabellen in der Reihenfolge aus backup.json laden, z. B. in psql:",
      "     \\set data `cat datenbank/customers.json`",
      "     INSERT INTO customers SELECT * FROM json_populate_recordset(NULL::customers, :'data');",
      "   Die Tabelle user in Anführungszeichen schreiben (\"user\"). Positionen finalisierter Rechnungen schützt",
      "   ein Trigger – für invoice_lines vorher ALTER TABLE invoice_lines DISABLE TRIGGER invoice_lines_guard; (danach ENABLE).",
      "3. Dateien laut backup.json (files: path → storageKey) unter STORAGE_DIR ablegen.",
    ].join("\r\n");
    yield entry("LIESMICH.txt", encode(readme));

    yield { name: "PRUEFSUMMEN.sha256", data: encode(`${checksums.join("\n")}\n`) };
  }

  const time = timeDe(createdAt).replace(":", "");
  return {
    filename: `datensicherung-${todayBerlin(createdAt)}-${time}.zip`,
    entries: entries(),
    /** Stand nach dem Durchlaufen der Einträge. */
    summary: () => ({ rows, files: files.length, missing: missing.length }),
  };
}
