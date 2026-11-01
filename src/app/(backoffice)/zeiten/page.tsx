import { Archive, ChevronLeft, ChevronRight, Download } from "lucide-react";
import Link from "next/link";
import { AmpelBadge, AmpelBar, EmptyState, PageHeader } from "@/components/bits";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { monthLabel } from "@/domain/billing";
import { dateDe, employmentLabel, euro, hoursLabel, timeDe } from "@/domain/format";
import { effectiveEnd, effectiveMinutes, effectiveStart, isCorrected, monthOf, shiftMonth, todayBerlin } from "@/domain/time";
import { employeeMonthStats } from "@/server/queries";
import { requireOwner } from "@/server/session";
import { timeEntriesForMonth } from "@/server/time-report";

export default async function HoursPage({ searchParams }: { searchParams: Promise<{ m?: string; ma?: string }> }) {
  const sp = await searchParams;
  const me = await requireOwner();
  const month = sp.m && /^\d{4}-\d{2}$/.test(sp.m) ? sp.m : monthOf(todayBerlin());
  const [stats, entries] = await Promise.all([employeeMonthStats(me.tenantId, month), timeEntriesForMonth(me.tenantId, month, sp.ma)]);
  const link = (patch: { m?: string; ma?: string | null }) => {
    const p = new URLSearchParams({ m: patch.m ?? month });
    const ma = patch.ma === null ? undefined : (patch.ma ?? sp.ma);
    if (ma) p.set("ma", ma);
    return `/zeiten?${p}`;
  };

  return (
    <>
      <PageHeader title="Arbeitszeiten" description="Beginn, Ende und Dauer je Einsatz – Aufzeichnung nach § 17 MiLoG, Korrekturen mit Begründung.">
        <Button variant="outline" size="icon" asChild>
          <Link href={link({ m: shiftMonth(month, -1) })} aria-label="Voriger Monat">
            <ChevronLeft />
          </Link>
        </Button>
        <span className="flex h-8 min-w-36 items-center justify-center rounded-lg border bg-background px-3 text-sm font-medium">{monthLabel(month)}</span>
        <Button variant="outline" size="icon" asChild>
          <Link href={link({ m: shiftMonth(month, 1) })} aria-label="Nächster Monat">
            <ChevronRight />
          </Link>
        </Button>
        <Button variant="outline" asChild>
          <a href={`/api/exports/zeiten?m=${month}`}>
            <Download /> CSV-Export
          </a>
        </Button>
        <Button asChild>
          <a href={`/api/exports/monatsarchiv?m=${month}`} title="Arbeitszeiten (CSV) und ausgestellte Rechnungen (PDF) des Monats zum Aufbewahren">
            <Archive /> Monatsarchiv
          </a>
        </Button>
      </PageHeader>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Übersicht {monthLabel(month)}</CardTitle>
          <CardDescription>Prognose = bisheriger Verdienst + noch geplante Einsätze im Monat</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Mitarbeiter</TableHead>
                <TableHead>Beschäftigung</TableHead>
                <TableHead className="text-right">Stunden</TableHead>
                <TableHead className="text-right">Verdienst</TableHead>
                <TableHead className="text-right">Geplant</TableHead>
                <TableHead className="w-56">Minijob-Grenze</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {stats.map((s) => (
                <TableRow key={s.employee.id} className={sp.ma === s.employee.id ? "bg-muted/50" : ""}>
                  <TableCell>
                    <Link href={link({ ma: sp.ma === s.employee.id ? null : s.employee.id })} className="font-medium hover:underline">
                      {s.employee.name}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{employmentLabel[s.employee.employmentType ?? ""] ?? "–"}</Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{hoursLabel(s.minutes)}</TableCell>
                  <TableCell className="text-right tabular-nums">{euro(s.earnedCents)}</TableCell>
                  <TableCell className="text-right tabular-nums">{hoursLabel(s.plannedMinutes)}</TableCell>
                  <TableCell>
                    {s.minijob ? (
                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span>
                            {euro(s.minijob.projectedCents)} / {euro(s.limitCents)}
                          </span>
                          <AmpelBadge level={s.minijob.level}>{s.minijob.projectedPct} %</AmpelBadge>
                        </div>
                        <AmpelBar level={s.minijob.level} pct={s.minijob.projectedPct} />
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">–</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Einzelnachweis {sp.ma ? `– ${stats.find((s) => s.employee.id === sp.ma)?.employee.name ?? ""}` : "– alle"}</CardTitle>
          <CardDescription>Name anklicken, um nach Person zu filtern.</CardDescription>
        </CardHeader>
        <CardContent>
          {entries.length === 0 ? (
            <EmptyState>Keine Zeiten in diesem Monat.</EmptyState>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Datum</TableHead>
                  <TableHead>Mitarbeiter</TableHead>
                  <TableHead>Objekt</TableHead>
                  <TableHead>Beginn</TableHead>
                  <TableHead>Ende</TableHead>
                  <TableHead className="text-right">Dauer</TableHead>
                  <TableHead>GPS</TableHead>
                  <TableHead>Korrektur</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map(({ entry, date, jobId, siteName, geofenceM, employeeName }) => {
                  const gpsOk = (entry.startDistanceM ?? 0) <= geofenceM && (entry.endDistanceM ?? 0) <= geofenceM;
                  return (
                    <TableRow key={entry.id}>
                      <TableCell>
                        <Link href={`/einsaetze/${jobId}`} className="hover:underline">
                          {dateDe(date)}
                        </Link>
                      </TableCell>
                      <TableCell>{employeeName}</TableCell>
                      <TableCell className="max-w-48 truncate">{siteName}</TableCell>
                      <TableCell className="tabular-nums">{timeDe(effectiveStart(entry))}</TableCell>
                      <TableCell className="tabular-nums">{entry.endAt || entry.correctedEndAt ? timeDe(effectiveEnd(entry)) : "läuft"}</TableCell>
                      <TableCell className="text-right tabular-nums">{hoursLabel(effectiveMinutes(entry))}</TableCell>
                      <TableCell className={gpsOk ? "text-emerald-700" : "text-amber-700"}>
                        {entry.startDistanceM == null ? "–" : gpsOk ? "✓" : `⚠ ${Math.max(entry.startDistanceM ?? 0, entry.endDistanceM ?? 0)} m`}
                      </TableCell>
                      <TableCell className="max-w-56 truncate text-xs" title={entry.correctionReason ?? ""}>
                        {isCorrected(entry) ? `✎ ${entry.correctionReason}` : ""}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}
