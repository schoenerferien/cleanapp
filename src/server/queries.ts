import "server-only";
import { and, asc, eq, gte, inArray, lte, ne, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { minijobLimitAt, minijobStatus } from "@/domain/limits";
import { earningsCents, effectiveMinutes, monthRange, todayBerlin } from "@/domain/time";

const { jobs, sites, customers, jobAssignments, user, timeEntries, invoices } = schema;

export type JobRow = Awaited<ReturnType<typeof listJobs>>[number];

/** Einsätze im Zeitraum inkl. Objekt, Kunde und zugewiesenen Personen. */
export async function listJobs(
  tenantId: string,
  opts: { from: string; to: string; region?: string; userId?: string; status?: string },
) {
  const rows = await db
    .select({
      id: jobs.id,
      date: jobs.date,
      plannedStart: jobs.plannedStart,
      plannedMinutes: jobs.plannedMinutes,
      title: jobs.title,
      status: jobs.status,
      aiStatus: jobs.aiStatus,
      aiOverall: sql<string | null>`${jobs.aiReview}->>'overall'`,
      invoiceId: jobs.invoiceId,
      siteId: sites.id,
      siteName: sites.name,
      region: sites.region,
      city: sites.city,
      lat: sites.lat,
      lng: sites.lng,
      customerName: customers.name,
    })
    .from(jobs)
    .innerJoin(sites, eq(sites.id, jobs.siteId))
    .innerJoin(customers, eq(customers.id, sites.customerId))
    .where(
      and(
        eq(jobs.tenantId, tenantId),
        gte(jobs.date, opts.from),
        lte(jobs.date, opts.to),
        opts.region ? eq(sites.region, opts.region) : undefined,
        opts.status ? eq(jobs.status, opts.status as schema.JobStatus) : undefined,
        opts.userId
          ? inArray(
              jobs.id,
              db.select({ id: jobAssignments.jobId }).from(jobAssignments).where(eq(jobAssignments.userId, opts.userId)),
            )
          : undefined,
      ),
    )
    .orderBy(asc(jobs.date), asc(jobs.plannedStart));

  const assignees = await assigneesFor(rows.map((r) => r.id));
  return rows.map((r) => ({ ...r, assignees: assignees.get(r.id) ?? [] }));
}

export async function assigneesFor(jobIds: string[]) {
  const map = new Map<string, { id: string; name: string }[]>();
  if (jobIds.length === 0) return map;
  const rows = await db
    .select({ jobId: jobAssignments.jobId, id: user.id, name: user.name })
    .from(jobAssignments)
    .innerJoin(user, eq(user.id, jobAssignments.userId))
    .where(inArray(jobAssignments.jobId, jobIds));
  for (const r of rows) map.set(r.jobId, [...(map.get(r.jobId) ?? []), { id: r.id, name: r.name }]);
  return map;
}

export async function listEmployees(tenantId: string) {
  return db
    .select()
    .from(user)
    .where(and(eq(user.tenantId, tenantId), eq(user.role, "employee")))
    .orderBy(asc(user.name));
}

export async function listRegions(tenantId: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ region: sites.region })
    .from(sites)
    .where(and(eq(sites.tenantId, tenantId), ne(sites.region, "")))
    .orderBy(asc(sites.region));
  return rows.map((r) => r.region);
}

/** Monatswerte je Mitarbeiter: Ist-Minuten, Verdienst, Prognose aus geplanten Einsätzen, Minijob-Ampel. */
export async function employeeMonthStats(tenantId: string, month: string) {
  const { from, to } = monthRange(month);
  const today = todayBerlin();
  const employees = await listEmployees(tenantId);

  const entries = await db
    .select({
      userId: timeEntries.userId,
      startAt: timeEntries.startAt,
      endAt: timeEntries.endAt,
      correctedStartAt: timeEntries.correctedStartAt,
      correctedEndAt: timeEntries.correctedEndAt,
    })
    .from(timeEntries)
    .innerJoin(jobs, eq(jobs.id, timeEntries.jobId))
    .where(and(eq(timeEntries.tenantId, tenantId), gte(jobs.date, from), lte(jobs.date, to)));

  const planned = await db
    .select({ userId: jobAssignments.userId, minutes: jobs.plannedMinutes })
    .from(jobs)
    .innerJoin(jobAssignments, eq(jobAssignments.jobId, jobs.id))
    .where(and(eq(jobs.tenantId, tenantId), eq(jobs.status, "geplant"), gte(jobs.date, today > from ? today : from), lte(jobs.date, to)));

  const limit = minijobLimitAt(from);
  return employees.map((e) => {
    const minutes = entries.filter((x) => x.userId === e.id).reduce((s, x) => s + effectiveMinutes(x), 0);
    const plannedMinutes = planned.filter((p) => p.userId === e.id).reduce((s, p) => s + p.minutes, 0);
    const wage = e.hourlyWageCents ?? 0;
    const earnedCents = earningsCents(minutes, wage);
    const forecastCents = earningsCents(plannedMinutes, wage);
    return {
      employee: e,
      minutes,
      plannedMinutes,
      earnedCents,
      forecastCents,
      minijob: e.employmentType === "minijob" ? minijobStatus(earnedCents, forecastCents, limit) : null,
      limitCents: limit,
    };
  });
}

/** Umsatz (finalisierte Rechnungen) im Kalenderjahr – Basis der KU-Ampel. */
export async function revenueInYear(tenantId: string, year: number): Promise<number> {
  const [row] = await db
    .select({ sum: sql<string>`coalesce(sum(${invoices.totalCents}), 0)` })
    .from(invoices)
    .where(
      and(
        eq(invoices.tenantId, tenantId),
        inArray(invoices.status, ["final", "bezahlt"]),
        gte(invoices.invoiceDate, `${year}-01-01`),
        lte(invoices.invoiceDate, `${year}-12-31`),
      ),
    );
  return Number(row?.sum ?? 0);
}
