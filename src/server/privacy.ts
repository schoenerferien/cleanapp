import "server-only";
import { and, eq, gte, inArray, isNotNull, isNull, lt, max, or, sql, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import { berlinDateTime } from "@/domain/format";
import { dueFrom, retentionCutoffs, type RetentionSettings } from "@/domain/retention";
import { todayBerlin } from "@/domain/time";
import { audit } from "@/server/audit";
import { deleteFiles } from "@/server/storage";

// Datenschutz: Löschfristen anwenden und ehemalige Mitarbeiter bzw. Kunden anonymisieren.
// Nicht angetastet werden Rechnungen samt Empfängerdaten (Aufbewahrung 8 Jahre, § 147 AO) und das Protokoll (GoBD).

export const PRIVACY_ENTITY = "datenschutz";

const { tenants, user, session, account, twoFactor, customers, sites, jobs, jobAssignments, timeEntries, photos, invoices } = schema;

const NO_GPS = { startLat: null, startLng: null, startAccuracy: null, endLat: null, endLng: null, endAccuracy: null };

export async function retentionSettings(tenantId: string): Promise<RetentionSettings> {
  const [t] = await db
    .select({ timeMonths: tenants.retentionTimeMonths, gpsMonths: tenants.retentionGpsMonths, photoMonths: tenants.retentionPhotoMonths })
    .from(tenants)
    .where(eq(tenants.id, tenantId));
  return t;
}

/** Was jetzt fällig ist – dieselben Bedingungen für Vorschau und Löschen. */
async function due(tenantId: string, today: string) {
  const settings = await retentionSettings(tenantId);
  const dates = retentionCutoffs(today, settings);
  const time = berlinDateTime(dates.time, "00:00");
  const gps = berlinDateTime(dates.gps, "00:00");
  const where = {
    timeEntries: and(eq(timeEntries.tenantId, tenantId), lt(timeEntries.startAt, time)),
    assignments: and(
      eq(jobAssignments.tenantId, tenantId),
      inArray(jobAssignments.jobId, db.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.tenantId, tenantId), lt(jobs.date, dates.time)))),
    ),
    // Nur Einträge, die selbst noch aufbewahrt werden – ältere fallen ohnehin ganz weg
    gps: and(
      eq(timeEntries.tenantId, tenantId),
      lt(timeEntries.startAt, gps),
      gte(timeEntries.startAt, time),
      or(isNotNull(timeEntries.startLat), isNotNull(timeEntries.endLat)),
    ),
    photos: and(eq(photos.tenantId, tenantId), lt(photos.takenAt, berlinDateTime(dates.photo, "00:00"))),
    // Abgelaufene Anmeldungen enthalten noch IP-Adresse und Browser
    sessions: and(lt(session.expiresAt, new Date()), inArray(session.userId, db.select({ id: user.id }).from(user).where(eq(user.tenantId, tenantId)))),
  } satisfies Record<string, SQL | undefined>;
  return { settings, dates, where };
}

export async function retentionDue(tenantId: string, today = todayBerlin()) {
  const { settings, dates, where } = await due(tenantId, today);
  const [timeEntryCount, assignmentCount, gpsCount, photoCount, sessionCount] = await Promise.all([
    db.$count(timeEntries, where.timeEntries),
    db.$count(jobAssignments, where.assignments),
    db.$count(timeEntries, where.gps),
    db.$count(photos, where.photos),
    db.$count(session, where.sessions),
  ]);
  return {
    settings,
    cutoffs: dates,
    counts: { timeEntries: timeEntryCount, assignments: assignmentCount, gps: gpsCount, photos: photoCount, sessions: sessionCount },
    /** Für die Erinnerung – abgelaufene Sitzungen allein sind kein Grund dafür */
    total: timeEntryCount + assignmentCount + gpsCount + photoCount,
  };
}

export async function applyRetention(tenantId: string, actorId: string, today = todayBerlin()) {
  const { dates, where } = await due(tenantId, today);
  const { counts, files } = await db.transaction(async (tx) => {
    const deletedPhotos = await tx.delete(photos).where(where.photos).returning({ filePath: photos.filePath });
    const gps = await tx.update(timeEntries).set(NO_GPS).where(where.gps).returning({ id: timeEntries.id });
    const entries = await tx.delete(timeEntries).where(where.timeEntries).returning({ id: timeEntries.id });
    const assignments = await tx.delete(jobAssignments).where(where.assignments).returning({ jobId: jobAssignments.jobId });
    const sessions = await tx.delete(session).where(where.sessions).returning({ id: session.id });
    const counts = { timeEntries: entries.length, assignments: assignments.length, gps: gps.length, photos: deletedPhotos.length, sessions: sessions.length };
    await audit({ tenantId, actorId, action: "retention", entity: PRIVACY_ENTITY, data: { cutoffs: dates, ...counts } }, tx);
    return { counts, files: deletedPhotos.map((p) => p.filePath) };
  });
  await deleteFiles(files);
  return counts;
}

// ---------- Ehemalige Mitarbeiter ----------

/** Anonymisieren erst, wenn die Person deaktiviert ist und ihre Arbeitszeiten nicht mehr aufbewahrt werden müssen. */
export async function employeePrivacy(tenantId: string, employeeId: string, today = todayBerlin()) {
  const [[employee], [last], settings] = await Promise.all([
    db
      .select({ active: user.active, anonymizedAt: user.anonymizedAt })
      .from(user)
      .where(and(eq(user.id, employeeId), eq(user.tenantId, tenantId), eq(user.role, "employee"))),
    db.select({ at: max(timeEntries.startAt) }).from(timeEntries).where(eq(timeEntries.userId, employeeId)),
    retentionSettings(tenantId),
  ]);
  if (!employee) return null;
  const lastWorkDate = last?.at ? todayBerlin(last.at) : null;
  const anonymizableFrom = lastWorkDate ? dueFrom(lastWorkDate, settings.timeMonths) : null;
  return {
    ...employee,
    lastWorkDate,
    anonymizableFrom,
    canAnonymize: !employee.active && !employee.anonymizedAt && (!anonymizableFrom || today >= anonymizableFrom),
  };
}

export async function anonymizeEmployeeData(tenantId: string, actorId: string, employeeId: string) {
  const status = await employeePrivacy(tenantId, employeeId);
  if (!status?.canAnonymize) throw new Error("Anonymisieren ist erst nach Ablauf der Aufbewahrungsfrist und nur für deaktivierte Personen möglich.");
  await db.transaction(async (tx) => {
    // Alle Arbeitszeiten liegen vor dem Stichtag (sonst wäre canAnonymize falsch)
    await tx.delete(timeEntries).where(eq(timeEntries.userId, employeeId));
    await tx.delete(jobAssignments).where(eq(jobAssignments.userId, employeeId));
    await tx.delete(session).where(eq(session.userId, employeeId));
    await tx.delete(account).where(eq(account.userId, employeeId));
    await tx.delete(twoFactor).where(eq(twoFactor.userId, employeeId));
    // Die Zeile bleibt für Verweise (Fotos, Protokoll), enthält aber nichts Persönliches mehr
    await tx
      .update(user)
      .set({
        name: `Ehemalige Person ${employeeId.slice(0, 4).toUpperCase()}`,
        email: `anonym-${employeeId}@ma.cleaninghub.local`,
        username: null,
        displayUsername: null,
        image: null,
        phone: null,
        hourlyWageCents: null,
        employmentType: null,
        failedLogins: 0,
        lockedUntil: null,
        anonymizedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(user.id, employeeId), eq(user.tenantId, tenantId)));
    await audit({ tenantId, actorId, action: "anonymize", entity: "employee", entityId: employeeId }, tx);
  });
}

// ---------- Ehemalige Kunden ----------

export async function customerPrivacy(tenantId: string, customerId: string, today = todayBerlin()) {
  const [customer] = await db
    .select({ anonymizedAt: customers.anonymizedAt })
    .from(customers)
    .where(and(eq(customers.id, customerId), eq(customers.tenantId, tenantId)));
  if (!customer) return null;
  const siteIds = db.select({ id: sites.id }).from(sites).where(eq(sites.customerId, customerId));
  const [openInvoices, openJobs, unbilledJobs] = await Promise.all([
    db.$count(
      invoices,
      and(eq(invoices.customerId, customerId), or(eq(invoices.status, "entwurf"), and(eq(invoices.kind, "rechnung"), eq(invoices.status, "final")))),
    ),
    db.$count(jobs, and(inArray(jobs.siteId, siteIds), or(gte(jobs.date, today), inArray(jobs.status, ["geplant", "laufend", "erledigt", "nacharbeit"])))),
    db.$count(jobs, and(inArray(jobs.siteId, siteIds), eq(jobs.status, "abgenommen"), isNull(jobs.invoiceId))),
  ]);
  const blockers: string[] = [];
  if (openInvoices) blockers.push(`${openInvoices} offene Rechnung(en) oder Entwürfe`);
  if (openJobs) blockers.push(`${openJobs} geplante oder noch nicht abgeschlossene Einsätze`);
  return { ...customer, blockers, unbilledJobs, canAnonymize: !customer.anonymizedAt && blockers.length === 0 };
}

export async function anonymizeCustomerData(tenantId: string, actorId: string, customerId: string) {
  const status = await customerPrivacy(tenantId, customerId);
  if (!status?.canAnonymize) throw new Error(`Anonymisieren nicht möglich: ${status?.blockers.join(", ") || "Kunde nicht gefunden"}`);
  const files = await db.transaction(async (tx) => {
    const siteIds = tx.select({ id: sites.id }).from(sites).where(and(eq(sites.customerId, customerId), eq(sites.tenantId, tenantId)));
    const jobIds = tx.select({ id: jobs.id }).from(jobs).where(inArray(jobs.siteId, siteIds));

    const deletedPhotos = await tx.delete(photos).where(inArray(photos.jobId, jobIds)).returning({ filePath: photos.filePath });
    // Die Standorte beim Stempeln verraten die Adresse; die Arbeitszeiten selbst bleiben (MiLoG)
    await tx.update(timeEntries).set(NO_GPS).where(inArray(timeEntries.jobId, jobIds));
    await tx.update(jobs).set({ notes: null, reviewComment: null, aiReview: null, aiError: null }).where(inArray(jobs.id, jobIds));
    await tx
      .update(sites)
      .set({
        name: sql`'Objekt ' || upper(left(${sites.id}::text, 4))`,
        street: null,
        zip: null,
        city: null,
        lat: null,
        lng: null,
        instructions: null,
        checklist: [],
        active: false,
      })
      .where(inArray(sites.id, siteIds));
    await tx
      .update(customers)
      .set({
        name: `Ehemaliger Kunde ${customerId.slice(0, 4).toUpperCase()}`,
        contactName: null,
        email: null,
        phone: null,
        street: null,
        zip: null,
        city: null,
        anonymizedAt: new Date(),
      })
      .where(and(eq(customers.id, customerId), eq(customers.tenantId, tenantId)));
    await audit({ tenantId, actorId, action: "anonymize", entity: "customer", entityId: customerId, data: { photos: deletedPhotos.length } }, tx);
    return deletedPhotos.map((p) => p.filePath);
  });
  await deleteFiles(files);
}
