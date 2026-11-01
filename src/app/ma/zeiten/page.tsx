import { and, desc, eq, gte, lte } from "drizzle-orm";
import { AmpelBar } from "@/components/bits";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { db, schema } from "@/db";
import { dateDe, euro, hoursLabel, timeDe } from "@/domain/format";
import { monthLabel } from "@/domain/billing";
import { effectiveEnd, effectiveMinutes, effectiveStart, isCorrected, monthOf, monthRange, todayBerlin } from "@/domain/time";
import { employeeMonthStats } from "@/server/queries";
import { requireUser } from "@/server/session";

export default async function MyHoursPage() {
  const me = await requireUser();
  const month = monthOf(todayBerlin());
  const { from, to } = monthRange(month);
  const { timeEntries, jobs, sites } = schema;
  const rows = await db
    .select({ entry: timeEntries, date: jobs.date, siteName: sites.name })
    .from(timeEntries)
    .innerJoin(jobs, eq(jobs.id, timeEntries.jobId))
    .innerJoin(sites, eq(sites.id, jobs.siteId))
    .where(and(eq(timeEntries.userId, me.id), gte(jobs.date, from), lte(jobs.date, to)))
    .orderBy(desc(jobs.date));
  const stats = (await employeeMonthStats(me.tenantId, month)).find((s) => s.employee.id === me.id);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{monthLabel(month)}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-3xl font-semibold tabular-nums">{hoursLabel(stats?.minutes ?? 0)}</p>
          <p className="text-sm text-muted-foreground">
            Verdienst bisher {euro(stats?.earnedCents ?? 0)} · geplant noch {hoursLabel(stats?.plannedMinutes ?? 0)}
          </p>
          {stats?.minijob && (
            <div className="space-y-1 pt-2">
              <AmpelBar level={stats.minijob.level} pct={stats.minijob.projectedPct} />
              <p className="text-xs text-muted-foreground">
                Minijob: voraussichtlich {euro(stats.minijob.projectedCents)} von {euro(stats.limitCents)}
              </p>
            </div>
          )}
        </CardContent>
      </Card>
      <div className="space-y-2">
        {rows.map(({ entry, date, siteName }) => (
          <div key={entry.id} className="flex items-center justify-between rounded-xl border bg-background p-3 text-sm">
            <div>
              <p className="font-medium">{siteName}</p>
              <p className="text-muted-foreground">
                {dateDe(date)} · {timeDe(effectiveStart(entry))}–{timeDe(effectiveEnd(entry))}
                {isCorrected(entry) && " · korrigiert"}
              </p>
            </div>
            <span className="font-medium tabular-nums">{entry.endAt || entry.correctedEndAt ? hoursLabel(effectiveMinutes(entry)) : "läuft"}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
