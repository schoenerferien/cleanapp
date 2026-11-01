import "server-only";
import { and, asc, eq, gte, lte } from "drizzle-orm";
import { db, schema } from "@/db";
import { dateDe, decimal2, timeDe } from "@/domain/format";
import { effectiveEnd, effectiveMinutes, effectiveStart, isCorrected, monthRange } from "@/domain/time";

/** Zeiteinträge eines Monats (nach Einsatzdatum) mit Person, Objekt und Kunde. */
export async function timeEntriesForMonth(tenantId: string, month: string, userId?: string) {
  const { from, to } = monthRange(month);
  const { timeEntries, jobs, sites, customers, user } = schema;
  return db
    .select({
      entry: timeEntries,
      date: jobs.date,
      jobId: jobs.id,
      siteName: sites.name,
      geofenceM: sites.geofenceM,
      customerName: customers.name,
      employeeName: user.name,
    })
    .from(timeEntries)
    .innerJoin(jobs, eq(jobs.id, timeEntries.jobId))
    .innerJoin(sites, eq(sites.id, jobs.siteId))
    .innerJoin(customers, eq(customers.id, sites.customerId))
    .innerJoin(user, eq(user.id, timeEntries.userId))
    .where(
      and(
        eq(timeEntries.tenantId, tenantId),
        gte(jobs.date, from),
        lte(jobs.date, to),
        userId ? eq(timeEntries.userId, userId) : undefined,
      ),
    )
    .orderBy(asc(user.name), asc(jobs.date), asc(timeEntries.startAt));
}

/** CSV für Steuerberater / Zollprüfung: Beginn, Ende, Dauer je Einsatz inkl. Korrekturen (Original bleibt sichtbar). */
export async function timeEntriesCsv(tenantId: string, month: string): Promise<string> {
  const rows = await timeEntriesForMonth(tenantId, month);
  const header = [
    "Mitarbeiter",
    "Datum",
    "Beginn",
    "Ende",
    "Dauer (Std)",
    "Objekt",
    "Kunde",
    "Korrigiert",
    "Korrekturgrund",
    "Original Beginn",
    "Original Ende",
    "Abstand Start (m)",
    "Abstand Ende (m)",
  ];
  const esc = (v: string | number | null | undefined) => {
    const s = v == null ? "" : String(v);
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = rows.map(({ entry, date, siteName, customerName, employeeName }) =>
    [
      employeeName,
      dateDe(date),
      timeDe(effectiveStart(entry)),
      entry.endAt || entry.correctedEndAt ? timeDe(effectiveEnd(entry)) : "",
      decimal2(effectiveMinutes(entry) / 60),
      siteName,
      customerName,
      isCorrected(entry) ? "ja" : "nein",
      entry.correctionReason,
      isCorrected(entry) ? timeDe(entry.startAt) : "",
      isCorrected(entry) ? timeDe(entry.endAt) : "",
      entry.startDistanceM,
      entry.endDistanceM,
    ]
      .map(esc)
      .join(";"),
  );
  // BOM, damit Excel Umlaute korrekt anzeigt
  return "﻿" + [header.join(";"), ...lines].join("\r\n");
}
