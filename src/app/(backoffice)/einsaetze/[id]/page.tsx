import { and, asc, eq } from "drizzle-orm";
import { Check, Clock, MapPin, RefreshCw, Sparkles, TriangleAlert, X } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { reviewPhotoOrder } from "@/ai/photoReview";
import { aiEnabled } from "@/ai/mistral";
import { PageHeader, StatusBadge } from "@/components/bits";
import { AutoRefresh } from "@/components/auto-refresh";
import { SubmitButton } from "@/components/client-bits";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { db, schema } from "@/db";
import type { AiReview } from "@/db/schema";
import { dateTimeDe, dateWithWeekday, hoursLabel, timeDe, timeInputValue } from "@/domain/format";
import { effectiveEnd, effectiveMinutes, effectiveStart, isCorrected } from "@/domain/time";
import { approveJob, correctTimeEntry, requestRework, retryAiReview } from "@/server/actions/review";
import { assigneesFor } from "@/server/queries";
import { requireOwner } from "@/server/session";

type PhotoRow = typeof schema.photos.$inferSelect;
type PhotoHint = AiReview["photos"][number];

export default async function JobReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireOwner();
  const { jobs, sites, customers, timeEntries, photos, user } = schema;

  const [row] = await db
    .select({ job: jobs, site: sites, customerName: customers.name })
    .from(jobs)
    .innerJoin(sites, eq(sites.id, jobs.siteId))
    .innerJoin(customers, eq(customers.id, sites.customerId))
    .where(and(eq(jobs.id, id), eq(jobs.tenantId, me.tenantId)));
  if (!row) notFound();
  const { job, site } = row;

  const [entries, jobPhotos, assignees] = await Promise.all([
    db
      .select({ entry: timeEntries, name: user.name })
      .from(timeEntries)
      .innerJoin(user, eq(user.id, timeEntries.userId))
      .where(eq(timeEntries.jobId, id))
      .orderBy(asc(timeEntries.startAt)),
    db.select().from(photos).where(eq(photos.jobId, id)).orderBy(asc(photos.takenAt)),
    assigneesFor([id]).then((m) => m.get(id) ?? []),
  ]);

  // KI-Hinweise den Fotos zuordnen (gleiche Reihenfolge wie beim KI-Aufruf) – nur bei eingeschalteter KI
  const ai = aiEnabled();
  const review = ai ? job.aiReview : null;
  const hints = new Map<string, PhotoHint>();
  if (review) {
    reviewPhotoOrder(jobPhotos).forEach((p, i) => {
      const h = review.photos.find((x) => x.index === i + 1);
      if (h) hints.set(p.id, h);
    });
  }
  const totalMinutes = entries.reduce((s, e) => s + effectiveMinutes(e.entry), 0);
  const locked = Boolean(job.invoiceId);
  const canDecide = !locked && (job.status === "erledigt" || job.status === "nacharbeit");

  return (
    <>
      {((ai && job.aiStatus === "pending") || job.status === "laufend") && <AutoRefresh seconds={5} />}
      <PageHeader title={site.name} description={`${row.customerName} · ${dateWithWeekday(job.date)} · ${job.plannedStart} · ${job.title}`}>
        <StatusBadge status={job.status} />
        {locked && <Badge variant="secondary">abgerechnet</Badge>}
        <Button variant="outline" asChild>
          <Link href="/einsaetze">Zurück</Link>
        </Button>
      </PageHeader>

      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Fotos</CardTitle>
              <CardDescription>Vorher und nachher nebeneinander.{ai && " Hinweise der KI erscheinen am Foto."}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-2">
                <PhotoColumn title="Vorher" photos={jobPhotos.filter((p) => p.kind === "vorher")} hints={hints} />
                <PhotoColumn title="Nachher" photos={jobPhotos.filter((p) => p.kind === "nachher")} hints={hints} />
              </div>
              {jobPhotos.some((p) => p.kind === "mangel") && (
                <PhotoColumn title="Gemeldete Mängel" photos={jobPhotos.filter((p) => p.kind === "mangel")} hints={hints} grid />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Arbeitszeit</CardTitle>
              <CardDescription>
                Geplant {job.plannedStart} · {hoursLabel(job.plannedMinutes)} – erfasst gesamt {hoursLabel(totalMinutes)}. Korrekturen nur mit Begründung; das
                Original bleibt gespeichert.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {entries.length === 0 && <p className="text-sm text-muted-foreground">Noch keine Zeiten erfasst.</p>}
              {entries.map(({ entry, name }) => (
                <div key={entry.id} className="rounded-lg border p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{name}</span>
                    <span className="flex items-center gap-1 tabular-nums">
                      <Clock className="size-3.5" />
                      {timeDe(effectiveStart(entry))} – {entry.endAt || entry.correctedEndAt ? timeDe(effectiveEnd(entry)) : "läuft"} ·{" "}
                      {hoursLabel(effectiveMinutes(entry))}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-3 text-xs text-muted-foreground">
                    <GpsInfo label="Start" distance={entry.startDistanceM} geofence={site.geofenceM} />
                    <GpsInfo label="Ende" distance={entry.endDistanceM} geofence={site.geofenceM} />
                  </div>
                  {isCorrected(entry) && (
                    <p className="mt-2 rounded bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                      Korrigiert am {dateTimeDe(entry.correctedAt)}: „{entry.correctionReason}“ · Original {timeDe(entry.startAt)} – {timeDe(entry.endAt)}
                    </p>
                  )}
                  {!locked && entry.endAt && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs text-teal-700">Zeit korrigieren</summary>
                      <form action={correctTimeEntry.bind(null, entry.id)} className="mt-2 grid gap-2 sm:grid-cols-[110px_110px_1fr_auto]">
                        <Input name="start" type="time" defaultValue={timeInputValue(effectiveStart(entry))} required />
                        <Input name="end" type="time" defaultValue={timeInputValue(effectiveEnd(entry))} required />
                        <Input name="reason" placeholder="Grund (Pflicht)" minLength={5} required />
                        <SubmitButton variant="secondary">Korrigieren</SubmitButton>
                      </form>
                    </details>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          {ai && <AiCard job={job} />}

          <Card>
            <CardHeader>
              <CardTitle>Entscheidung</CardTitle>
              {job.reviewComment && <CardDescription>Letzter Kommentar: „{job.reviewComment}“</CardDescription>}
            </CardHeader>
            <CardContent className="space-y-3">
              {canDecide ? (
                <>
                  <form action={approveJob.bind(null, job.id)} className="space-y-2">
                    <Input name="comment" placeholder="Kommentar (optional)" />
                    <SubmitButton className="w-full bg-emerald-700 hover:bg-emerald-800">
                      <Check /> Abnehmen
                    </SubmitButton>
                  </form>
                  <form action={requestRework.bind(null, job.id)} className="space-y-2 border-t pt-3">
                    <Textarea name="comment" rows={2} placeholder="Was soll nachgearbeitet werden? (Pflicht)" required />
                    <SubmitButton variant="destructive" className="w-full">
                      <X /> Nacharbeit anfordern
                    </SubmitButton>
                  </form>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {locked
                    ? "Abgerechnet – keine Änderungen mehr möglich."
                    : job.status === "abgenommen"
                      ? "Abgenommen."
                      : "Entscheidung möglich, sobald der Einsatz erledigt ist."}
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Durchführung</CardTitle>
              <CardDescription>
                <MapPin className="mr-1 inline size-3.5" />
                {[site.street, site.city].filter(Boolean).join(", ")} · Team: {assignees.map((a) => a.name).join(", ") || "–"}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {site.checklist.length > 0 && (
                <ul className="space-y-1">
                  {site.checklist.map((item) => (
                    <li key={item} className="flex items-center gap-2">
                      {job.checklistDone.includes(item) ? <Check className="size-4 text-emerald-600" /> : <X className="size-4 text-red-500" />}
                      {item}
                    </li>
                  ))}
                </ul>
              )}
              {job.notes && <p className="rounded bg-muted p-2">Notiz: {job.notes}</p>}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}

function GpsInfo({ label, distance, geofence }: { label: string; distance: number | null; geofence: number }) {
  if (distance == null) return <span>{label}: ohne GPS</span>;
  const ok = distance <= geofence;
  return (
    <span className={ok ? "text-emerald-700" : "font-medium text-amber-700"}>
      {label}: {distance} m {ok ? "✓" : "⚠"}
    </span>
  );
}

function PhotoColumn({ title, photos, hints, grid }: { title: string; photos: PhotoRow[]; hints: Map<string, PhotoHint>; grid?: boolean }) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold">
        {title} ({photos.length})
      </h3>
      {photos.length === 0 ? (
        <p className="text-xs text-muted-foreground">Keine Fotos.</p>
      ) : (
        <div className={grid ? "grid grid-cols-2 gap-3 sm:grid-cols-4" : "space-y-3"}>
          {photos.map((p) => {
            const h = hints.get(p.id);
            return (
              <figure key={p.id} className="space-y-1">
                <a href={`/api/photos/${p.id}`} target="_blank" rel="noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/photos/${p.id}`} alt={p.caption ?? title} className="w-full rounded-lg border object-cover" />
                </a>
                <figcaption className="space-y-1 text-xs">
                  <span className="text-muted-foreground">{dateTimeDe(p.takenAt)}</span>
                  {p.caption && <p className="font-medium">{p.caption}</p>}
                  {h && (
                    <div className="flex flex-wrap gap-1">
                      {!h.sharp && <Badge className="border-transparent bg-amber-100 text-amber-800">unscharf</Badge>}
                      {h.personVisible && <Badge className="border-transparent bg-red-100 text-red-800">Person erkennbar</Badge>}
                      {!h.showsCleaningArea && <Badge className="border-transparent bg-amber-100 text-amber-800">kein Reinigungsbereich</Badge>}
                      {h.note && <span className="text-muted-foreground">{h.note}</span>}
                    </div>
                  )}
                </figcaption>
              </figure>
            );
          })}
        </div>
      )}
    </div>
  );
}

function AiCard({ job }: { job: typeof schema.jobs.$inferSelect }) {
  const r = job.aiReview;
  const improvementLabel = { ja: "ja", teilweise: "teilweise", nein: "nein", unklar: "unklar" };
  return (
    <Card className="border-violet-200 dark:border-violet-900">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="size-4 text-violet-600" /> KI-Hinweis
        </CardTitle>
        <CardDescription>Hinweis zu den Fotos dieses Einsatzes – keine Bewertung der Person. Die Entscheidung trifft das Büro.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {job.aiStatus === "pending" && <p className="flex items-center gap-2 text-muted-foreground"><RefreshCw className="size-4 animate-spin" /> KI prüft die Fotos …</p>}
        {job.aiStatus === "failed" && (
          <p className="flex items-start gap-2 text-red-700">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" /> Prüfung fehlgeschlagen: {job.aiError}
          </p>
        )}
        {job.aiStatus === "none" && job.status !== "erledigt" && <p className="text-muted-foreground">Die Prüfung startet, sobald der Einsatz beendet ist.</p>}
        {r && job.aiStatus === "done" && (
          <>
            <Badge className={r.overall === "ok" ? "border-transparent bg-emerald-100 text-emerald-800" : "border-transparent bg-amber-100 text-amber-800"}>
              {r.overall === "ok" ? "Unauffällig" : "Bitte genauer ansehen"}
            </Badge>
            <p>
              Verbesserung sichtbar: <strong>{improvementLabel[r.comparison.improvementVisible]}</strong>
            </p>
            {r.comparison.observations.length > 0 && (
              <ul className="list-disc space-y-1 pl-5">
                {r.comparison.observations.map((o) => (
                  <li key={o}>{o}</li>
                ))}
              </ul>
            )}
            {r.suggestedFollowUp && <p className="rounded bg-violet-50 p-2 dark:bg-violet-950/40">Vorschlag Nacharbeit: {r.suggestedFollowUp}</p>}
            <p className="text-xs text-muted-foreground">Modell: {r.model}</p>
          </>
        )}
        {job.status !== "geplant" && job.status !== "laufend" && job.aiStatus !== "pending" && (
          <form action={retryAiReview.bind(null, job.id)}>
            <SubmitButton variant="outline" size="sm" pendingText="Startet …">
              <RefreshCw /> {job.aiStatus === "done" ? "Erneut prüfen" : "KI-Prüfung starten"}
            </SubmitButton>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
