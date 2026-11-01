import { and, asc, eq } from "drizzle-orm";
import { ChevronLeft, ChevronRight, List, Map as MapIcon, Sparkles, Trash2 } from "lucide-react";
import Link from "next/link";
import { aiEnabled } from "@/ai/mistral";
import { EmptyState, Field, PageHeader, selectClass, StatusBadge } from "@/components/bits";
import { SubmitButton } from "@/components/client-bits";
import { SiteMapLazy } from "@/components/site-map-lazy";
import type { MapPoint } from "@/components/site-map";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { db, schema } from "@/db";
import { dateDe, dateWithWeekday, hoursLabel } from "@/domain/format";
import { addDays, startOfWeek, todayBerlin } from "@/domain/time";
import { createJob, deleteJob } from "@/server/actions/jobs";
import { listEmployees, listJobs, listRegions } from "@/server/queries";
import { requireOwner } from "@/server/session";

const statusColor: Record<string, string> = {
  geplant: "#64748b",
  laufend: "#0284c7",
  erledigt: "#d97706",
  abgenommen: "#059669",
  nacharbeit: "#dc2626",
};

export default async function JobsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const me = await requireOwner();
  const ai = aiEnabled();
  const today = todayBerlin();
  const weekStart = startOfWeek(sp.w && /^\d{4}-\d{2}-\d{2}$/.test(sp.w) ? sp.w : today);
  const weekEnd = addDays(weekStart, 6);
  const view = sp.ansicht === "karte" ? "karte" : "liste";

  const [rows, employees, regions, sites] = await Promise.all([
    listJobs(me.tenantId, { from: weekStart, to: weekEnd, region: sp.region || undefined, userId: sp.ma || undefined, status: sp.status || undefined }),
    listEmployees(me.tenantId),
    listRegions(me.tenantId),
    db
      .select({ id: schema.sites.id, name: schema.sites.name, region: schema.sites.region, customer: schema.customers.name })
      .from(schema.sites)
      .innerJoin(schema.customers, eq(schema.customers.id, schema.sites.customerId))
      .where(and(eq(schema.sites.tenantId, me.tenantId), eq(schema.sites.active, true)))
      .orderBy(asc(schema.sites.region), asc(schema.sites.name)),
  ]);

  const qs = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = { w: weekStart, region: sp.region, ma: sp.ma, status: sp.status, ansicht: view, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    return `/einsaetze?${p.toString()}`;
  };

  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const points: MapPoint[] = [];
  for (const r of rows) {
    if (r.lat == null || r.lng == null) continue;
    const existing = points.find((p) => p.id === r.siteId);
    const line = `${dateDe(r.date).slice(0, 6)} ${r.plannedStart} · ${r.assignees.map((a) => a.name.split(" ")[0]).join(", ") || "offen"}`;
    if (existing) existing.lines!.push(line);
    else
      points.push({
        id: r.siteId,
        lat: r.lat,
        lng: r.lng,
        title: r.siteName,
        subtitle: `${r.customerName} · ${r.region}`,
        lines: [line],
        color: statusColor[r.status],
      });
  }

  return (
    <>
      <PageHeader title="Einsätze" description={`Woche ${dateDe(weekStart)} – ${dateDe(weekEnd)} · ${rows.length} Einsätze`}>
        <Button variant="outline" size="icon" asChild>
          <Link href={qs({ w: addDays(weekStart, -7) })} aria-label="Vorige Woche">
            <ChevronLeft />
          </Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href={qs({ w: today })}>Heute</Link>
        </Button>
        <Button variant="outline" size="icon" asChild>
          <Link href={qs({ w: addDays(weekStart, 7) })} aria-label="Nächste Woche">
            <ChevronRight />
          </Link>
        </Button>
        <Button variant={view === "liste" ? "default" : "outline"} asChild>
          <Link href={qs({ ansicht: "liste" })}>
            <List /> Liste
          </Link>
        </Button>
        <Button variant={view === "karte" ? "default" : "outline"} asChild>
          <Link href={qs({ ansicht: "karte" })}>
            <MapIcon /> Karte
          </Link>
        </Button>
      </PageHeader>

      <form className="mb-4 grid gap-2 sm:grid-cols-4" action="/einsaetze">
        <input type="hidden" name="w" value={weekStart} />
        <input type="hidden" name="ansicht" value={view} />
        <select name="region" defaultValue={sp.region ?? ""} className={selectClass}>
          <option value="">Alle Regionen</option>
          {regions.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <select name="ma" defaultValue={sp.ma ?? ""} className={selectClass}>
          <option value="">Alle Mitarbeitenden</option>
          {employees.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
        <select name="status" defaultValue={sp.status ?? ""} className={selectClass}>
          <option value="">Alle Status</option>
          <option value="geplant">Geplant</option>
          <option value="laufend">Läuft</option>
          <option value="erledigt">Zu prüfen</option>
          <option value="abgenommen">Abgenommen</option>
          <option value="nacharbeit">Nacharbeit</option>
        </select>
        <Button type="submit" variant="secondary">
          Filtern
        </Button>
      </form>

      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <div>
          {view === "karte" ? (
            <SiteMapLazy points={points} />
          ) : (
            <div className="space-y-4">
              {days.map((d) => {
                const dayRows = rows.filter((r) => r.date === d);
                return (
                  <section key={d}>
                    <h2 className={`mb-2 text-sm font-semibold ${d === today ? "text-teal-700" : "text-muted-foreground"}`}>
                      {dateWithWeekday(d)} {d === today && "· heute"}
                    </h2>
                    {dayRows.length === 0 ? (
                      <p className="text-xs text-muted-foreground">–</p>
                    ) : (
                      <div className="space-y-2">
                        {dayRows.map((r) => (
                          <div key={r.id} className="flex flex-wrap items-center gap-3 rounded-xl border bg-background p-3">
                            <div className="w-24 shrink-0 text-sm tabular-nums">
                              <span className="font-medium">{r.plannedStart}</span>
                              <span className="block text-xs text-muted-foreground">{hoursLabel(r.plannedMinutes)}</span>
                            </div>
                            <Link href={`/einsaetze/${r.id}`} className="min-w-0 flex-1 hover:underline">
                              <p className="truncate font-medium">{r.siteName}</p>
                              <p className="truncate text-xs text-muted-foreground">
                                {r.title} · {r.customerName}
                              </p>
                            </Link>
                            <Badge variant="outline">{r.region}</Badge>
                            <span className="text-sm">{r.assignees.map((a) => a.name.split(" ")[0]).join(", ") || <em className="text-red-600">nicht besetzt</em>}</span>
                            {ai && r.aiOverall === "pruefen" && (
                              <Badge className="border-transparent bg-violet-100 text-violet-800">
                                <Sparkles /> KI-Hinweis
                              </Badge>
                            )}
                            <StatusBadge status={r.status} />
                            {r.status === "geplant" && (
                              <form action={deleteJob.bind(null, r.id)}>
                                <Button type="submit" variant="ghost" size="icon-sm" aria-label="Einsatz löschen">
                                  <Trash2 />
                                </Button>
                              </form>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </section>
                );
              })}
              {rows.length === 0 && <EmptyState>Keine Einsätze in dieser Woche für den Filter.</EmptyState>}
            </div>
          )}
        </div>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Neuer Einsatz</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={createJob} className="space-y-3">
              <Field label="Objekt">
                <select name="siteId" className={selectClass} required>
                  {sites.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.region} · {s.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Leistung">
                <Input name="title" defaultValue="Unterhaltsreinigung" />
              </Field>
              <div className="grid grid-cols-3 gap-2">
                <Field label="Datum" className="col-span-3 sm:col-span-1 xl:col-span-3">
                  <Input name="date" type="date" defaultValue={today} required />
                </Field>
                <Field label="Beginn" className="col-span-3 sm:col-span-1 xl:col-span-2">
                  <Input name="plannedStart" type="time" defaultValue="08:00" required />
                </Field>
                <Field label="Std" className="col-span-3 sm:col-span-1 xl:col-span-1">
                  <Input name="plannedHours" inputMode="decimal" defaultValue="2" required />
                </Field>
              </div>
              <Field label="Wöchentlich wiederholen bis" hint="Leer = einmaliger Einsatz">
                <Input name="repeatUntil" type="date" />
              </Field>
              <fieldset className="space-y-1.5">
                <legend className="text-sm font-medium">Mitarbeitende</legend>
                {employees
                  .filter((e) => e.active)
                  .map((e) => (
                    <label key={e.id} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" name="userIds" value={e.id} className="size-4" /> {e.name}
                    </label>
                  ))}
              </fieldset>
              <SubmitButton className="w-full">Einplanen</SubmitButton>
            </form>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
