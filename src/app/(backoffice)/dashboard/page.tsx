import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { Archive, ChevronRight, Download, Sparkles } from "lucide-react";
import Link from "next/link";
import { aiEnabled } from "@/ai/mistral";
import { AmpelBadge, AmpelBar, EmptyState, PageHeader, StatusBadge } from "@/components/bits";
import { AutoRefresh } from "@/components/auto-refresh";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { db, schema } from "@/db";
import { monthLabel } from "@/domain/billing";
import { dateDe, euro, hoursLabel, timeDe } from "@/domain/format";
import { haversineMeters, monthOf, shiftMonth, todayBerlin } from "@/domain/time";
import { kuStatus } from "@/domain/limits";
import { archivedMonths } from "@/server/month-archive";
import { employeeMonthStats, listJobs, revenueInYear } from "@/server/queries";
import { requireOwner } from "@/server/session";

export default async function DashboardPage() {
  const me = await requireOwner();
  const today = todayBerlin();
  const month = monthOf(today);
  const { jobs, sites, timeEntries, user, tenants, invoices } = schema;

  const lastMonth = shiftMonth(month, -1);
  const [todayJobs, clockedIn, toReview, stats, revenue, [tenant], [openInvoices], archived] = await Promise.all([
    listJobs(me.tenantId, { from: today, to: today }),
    db
      .select({
        jobId: jobs.id,
        name: user.name,
        siteName: sites.name,
        region: sites.region,
        startAt: timeEntries.startAt,
        lat: timeEntries.startLat,
        lng: timeEntries.startLng,
        siteLat: sites.lat,
        siteLng: sites.lng,
        geofenceM: sites.geofenceM,
      })
      .from(timeEntries)
      .innerJoin(jobs, eq(jobs.id, timeEntries.jobId))
      .innerJoin(sites, eq(sites.id, jobs.siteId))
      .innerJoin(user, eq(user.id, timeEntries.userId))
      .where(and(eq(timeEntries.tenantId, me.tenantId), isNull(timeEntries.endAt))),
    db
      .select({
        id: jobs.id,
        date: jobs.date,
        title: jobs.title,
        status: jobs.status,
        aiStatus: jobs.aiStatus,
        aiOverall: sql<string | null>`${jobs.aiReview}->>'overall'`,
        siteName: sites.name,
        region: sites.region,
      })
      .from(jobs)
      .innerJoin(sites, eq(sites.id, jobs.siteId))
      .where(and(eq(jobs.tenantId, me.tenantId), eq(jobs.status, "erledigt")))
      .orderBy(desc(jobs.date))
      .limit(12),
    employeeMonthStats(me.tenantId, month),
    revenueInYear(me.tenantId, Number(today.slice(0, 4))),
    db.select().from(tenants).where(eq(tenants.id, me.tenantId)),
    db
      .select({ n: sql<number>`count(*)::int`, sum: sql<number>`coalesce(sum(${invoices.totalCents}), 0)::int` })
      .from(invoices)
      .where(and(eq(invoices.tenantId, me.tenantId), inArray(invoices.status, ["final"]))),
    archivedMonths(me.tenantId),
  ]);
  const ku = kuStatus(revenue, tenant.kuLimitCents);
  const ai = aiEnabled();

  return (
    <>
      <AutoRefresh seconds={30} />
      <PageHeader title="Dashboard" description={`Heute, ${dateDe(today)} – aktualisiert sich automatisch`} />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Einsätze heute" value={String(todayJobs.length)} hint={`${todayJobs.filter((j) => ["erledigt", "abgenommen"].includes(j.status)).length} erledigt`} />
        <Kpi label="Jetzt eingestempelt" value={String(clockedIn.length)} hint={clockedIn.map((c) => c.name.split(" ")[0]).join(", ") || "niemand"} />
        <Kpi
          label="Zu prüfen"
          value={String(toReview.length)}
          hint={ai ? `${toReview.filter((j) => j.aiOverall === "pruefen").length} mit KI-Hinweis` : "Fotos ansehen und abnehmen"}
        />
        <Kpi label="Offene Rechnungen" value={euro(openInvoices?.sum ?? 0)} hint={`${openInvoices?.n ?? 0} unbezahlt`} />
      </div>

      {!archived.has(lastMonth) && (
        <Card className="mb-6 border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40">
          <CardContent className="flex flex-wrap items-center gap-4">
            <Archive className="size-6 shrink-0 text-amber-700" />
            <div className="min-w-0 flex-1 text-sm">
              <p className="font-medium">Monatsarchiv {monthLabel(lastMonth)} herunterladen und aufbewahren</p>
              <p className="text-muted-foreground">
                Arbeitszeiten und Rechnungen des Monats als ZIP. Die Aufbewahrung (Arbeitszeiten 2 Jahre, Rechnungen 8 Jahre) liegt bei Ihnen – die App
                ist kein Archiv.
              </p>
            </div>
            <Button asChild>
              <a href={`/api/exports/monatsarchiv?m=${lastMonth}`}>
                <Download /> Herunterladen
              </a>
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 xl:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Jetzt eingestempelt</CardTitle>
            <CardDescription>Standort-Abgleich beim Einstempeln</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {clockedIn.length === 0 && <EmptyState>Niemand ist eingestempelt.</EmptyState>}
            {clockedIn.map((c) => {
              const d = c.lat != null && c.lng != null && c.siteLat != null && c.siteLng != null ? haversineMeters({ lat: c.lat, lng: c.lng }, { lat: c.siteLat, lng: c.siteLng }) : null;
              return (
                <Link key={c.jobId + c.name} href={`/einsaetze/${c.jobId}`} className="block rounded-lg border p-3 text-sm hover:bg-muted/50">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{c.name}</span>
                    <span className="text-muted-foreground">seit {timeDe(c.startAt)}</span>
                  </div>
                  <p className="text-muted-foreground">
                    {c.siteName} · {c.region}
                    {d != null && <span className={d <= c.geofenceM ? " text-emerald-700" : " text-amber-700"}> · {d} m {d <= c.geofenceM ? "✓" : "⚠"}</span>}
                  </p>
                </Link>
              );
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Zu prüfen</CardTitle>
            <CardDescription>Erledigte Einsätze – Fotos ansehen und abnehmen</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {toReview.length === 0 && <EmptyState>Alles geprüft.</EmptyState>}
            {toReview.map((j) => (
              <Link key={j.id} href={`/einsaetze/${j.id}`} className="flex items-center gap-2 rounded-lg border p-3 text-sm hover:bg-muted/50">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{j.siteName}</p>
                  <p className="text-muted-foreground">
                    {dateDe(j.date)} · {j.region}
                  </p>
                </div>
                {ai && j.aiStatus === "pending" && <Badge variant="outline">KI prüft …</Badge>}
                {ai && j.aiOverall === "pruefen" && (
                  <Badge className="border-transparent bg-violet-100 text-violet-800">
                    <Sparkles /> Hinweis
                  </Badge>
                )}
                {ai && j.aiOverall === "ok" && <Badge className="border-transparent bg-emerald-100 text-emerald-800">KI ok</Badge>}
                <ChevronRight className="size-4 text-muted-foreground" />
              </Link>
            ))}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Minijob-Grenze {monthLabel(month)}</CardTitle>
              <CardDescription>Bisheriger Verdienst + geplante Einsätze</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {stats
                .filter((s) => s.minijob)
                .map((s) => (
                  <div key={s.employee.id} className="space-y-1 text-sm">
                    <div className="flex items-center justify-between">
                      <span>{s.employee.name}</span>
                      <AmpelBadge level={s.minijob!.level}>{s.minijob!.projectedPct} %</AmpelBadge>
                    </div>
                    <AmpelBar level={s.minijob!.level} pct={s.minijob!.projectedPct} />
                    <p className="text-xs text-muted-foreground">
                      {euro(s.earnedCents)} bisher · voraussichtlich {euro(s.minijob!.projectedCents)} von {euro(s.limitCents)}
                    </p>
                  </div>
                ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Kleinunternehmergrenze {today.slice(0, 4)}</CardTitle>
              <CardDescription>{tenant.kleinunternehmer ? "§ 19 UStG aktiv" : "Regelbesteuerung (19 % USt)"}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <div className="flex items-center justify-between">
                <span>{euro(revenue)} Umsatz</span>
                <AmpelBadge level={ku.level}>{ku.pct} %</AmpelBadge>
              </div>
              <AmpelBar level={ku.level} pct={ku.pct} />
              <p className="text-xs text-muted-foreground">
                Grenze {euro(tenant.kuLimitCents)} · noch {euro(ku.remainingCents)}
                {ku.level !== "gruen" && " – bitte mit dem Steuerberater sprechen."}
              </p>
            </CardContent>
          </Card>
        </div>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Einsätze heute</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {todayJobs.length === 0 && <EmptyState>Heute keine Einsätze.</EmptyState>}
          {todayJobs.map((j) => (
            <Link key={j.id} href={`/einsaetze/${j.id}`} className="flex flex-wrap items-center gap-3 rounded-lg border p-3 text-sm hover:bg-muted/50">
              <span className="w-12 font-medium tabular-nums">{j.plannedStart}</span>
              <span className="min-w-0 flex-1 truncate">
                {j.siteName} <span className="text-muted-foreground">· {j.title}</span>
              </span>
              <Badge variant="outline">{j.region}</Badge>
              <span>{j.assignees.map((a) => a.name.split(" ")[0]).join(", ")}</span>
              <span className="text-muted-foreground">{hoursLabel(j.plannedMinutes)}</span>
              <StatusBadge status={j.status} />
            </Link>
          ))}
        </CardContent>
      </Card>
    </>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <Card>
      <CardContent>
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
        <p className="truncate text-xs text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  );
}
