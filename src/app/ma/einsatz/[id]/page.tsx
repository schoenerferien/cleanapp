import { and, asc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db, schema } from "@/db";
import { requireUser } from "@/server/session";
import { JobRunner } from "./job-runner";

export default async function FieldJobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireUser();
  const { jobs, sites, jobAssignments, timeEntries, photos } = schema;

  const [job] = await db
    .select({
      id: jobs.id,
      date: jobs.date,
      plannedStart: jobs.plannedStart,
      plannedMinutes: jobs.plannedMinutes,
      title: jobs.title,
      status: jobs.status,
      notes: jobs.notes,
      checklistDone: jobs.checklistDone,
      reviewComment: jobs.reviewComment,
      siteName: sites.name,
      street: sites.street,
      zip: sites.zip,
      city: sites.city,
      lat: sites.lat,
      lng: sites.lng,
      instructions: sites.instructions,
      checklist: sites.checklist,
      geofenceM: sites.geofenceM,
    })
    .from(jobs)
    .innerJoin(sites, eq(sites.id, jobs.siteId))
    .innerJoin(jobAssignments, and(eq(jobAssignments.jobId, jobs.id), eq(jobAssignments.userId, me.id)))
    .where(and(eq(jobs.id, id), eq(jobs.tenantId, me.tenantId)));
  if (!job) notFound();

  const [entries, jobPhotos] = await Promise.all([
    db
      .select({ id: timeEntries.id, startAt: timeEntries.startAt, endAt: timeEntries.endAt, startDistanceM: timeEntries.startDistanceM })
      .from(timeEntries)
      .where(and(eq(timeEntries.jobId, id), eq(timeEntries.userId, me.id)))
      .orderBy(asc(timeEntries.startAt)),
    db
      .select({ id: photos.id, kind: photos.kind, caption: photos.caption, userId: photos.userId })
      .from(photos)
      .where(eq(photos.jobId, id))
      .orderBy(asc(photos.takenAt)),
  ]);

  const open = entries.find((e) => !e.endAt) ?? null;
  return (
    <JobRunner
      job={job}
      openEntry={open ? { startAt: open.startAt.toISOString(), distanceM: open.startDistanceM } : null}
      doneEntries={entries.filter((e) => e.endAt).map((e) => ({ startAt: e.startAt.toISOString(), endAt: e.endAt!.toISOString() }))}
      photos={jobPhotos.map((p) => ({ ...p, mine: p.userId === me.id }))}
    />
  );
}
