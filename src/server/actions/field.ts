"use server";

// Aktionen der Mitarbeiter-App: Start, Checkliste, Notiz, Ende.
import { and, count, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { aiEnabled } from "@/ai/mistral";
import { runPhotoReview } from "@/ai/photoReview";
import { db, schema } from "@/db";
import { haversineMeters } from "@/domain/time";
import { audit } from "@/server/audit";
import { requireUser } from "@/server/session";

const { jobs, jobAssignments, sites, timeEntries, photos } = schema;

type Position = { lat: number; lng: number; accuracy: number } | null;
export type FieldResult = { ok: true; distanceM?: number | null; geofenceM?: number } | { ok: false; error: string };

/** Einsatz des eigenen Mandanten, dem die Person zugewiesen ist. */
async function assignedJob(jobId: string, userId: string, tenantId: string) {
  const [row] = await db
    .select({
      id: jobs.id,
      status: jobs.status,
      checklistDone: jobs.checklistDone,
      siteLat: sites.lat,
      siteLng: sites.lng,
      geofenceM: sites.geofenceM,
    })
    .from(jobs)
    .innerJoin(sites, eq(sites.id, jobs.siteId))
    .innerJoin(jobAssignments, and(eq(jobAssignments.jobId, jobs.id), eq(jobAssignments.userId, userId)))
    .where(and(eq(jobs.id, jobId), eq(jobs.tenantId, tenantId)));
  return row ?? null;
}

function distance(pos: Position, site: { siteLat: number | null; siteLng: number | null }) {
  if (!pos || site.siteLat == null || site.siteLng == null) return null;
  return haversineMeters(pos, { lat: site.siteLat, lng: site.siteLng });
}

export async function startJob(jobId: string, pos: Position): Promise<FieldResult> {
  const me = await requireUser();
  const job = await assignedJob(jobId, me.id, me.tenantId);
  if (!job) return { ok: false, error: "Einsatz nicht gefunden." };
  if (job.status === "abgenommen") return { ok: false, error: "Einsatz ist bereits abgenommen." };

  const [open] = await db
    .select({ id: timeEntries.id })
    .from(timeEntries)
    .where(and(eq(timeEntries.jobId, jobId), eq(timeEntries.userId, me.id), isNull(timeEntries.endAt)));
  if (open) return { ok: false, error: "Du bist für diesen Einsatz schon eingestempelt." };

  const distanceM = distance(pos, job);
  await db.insert(timeEntries).values({
    tenantId: me.tenantId,
    jobId,
    userId: me.id,
    startAt: new Date(), // Serverzeit – nicht die Uhr des Handys
    startLat: pos?.lat,
    startLng: pos?.lng,
    startAccuracy: pos?.accuracy,
    startDistanceM: distanceM,
  });
  await db.update(jobs).set({ status: "laufend" }).where(eq(jobs.id, jobId));
  await audit({ tenantId: me.tenantId, actorId: me.id, action: "clock_in", entity: "job", entityId: jobId, data: { distanceM } });
  revalidatePath(`/ma/einsatz/${jobId}`);
  return { ok: true, distanceM, geofenceM: job.geofenceM };
}

export async function toggleChecklistItem(jobId: string, item: string, done: boolean): Promise<FieldResult> {
  const me = await requireUser();
  const job = await assignedJob(jobId, me.id, me.tenantId);
  if (!job) return { ok: false, error: "Einsatz nicht gefunden." };
  const set = new Set(job.checklistDone);
  if (done) set.add(item);
  else set.delete(item);
  await db.update(jobs).set({ checklistDone: [...set] }).where(eq(jobs.id, jobId));
  return { ok: true };
}

export async function saveNote(jobId: string, note: string): Promise<FieldResult> {
  const me = await requireUser();
  const job = await assignedJob(jobId, me.id, me.tenantId);
  if (!job) return { ok: false, error: "Einsatz nicht gefunden." };
  await db.update(jobs).set({ notes: note.slice(0, 2000) || null }).where(eq(jobs.id, jobId));
  return { ok: true };
}

export async function finishJob(jobId: string, pos: Position): Promise<FieldResult> {
  const me = await requireUser();
  const job = await assignedJob(jobId, me.id, me.tenantId);
  if (!job) return { ok: false, error: "Einsatz nicht gefunden." };

  const photoCounts = await db
    .select({ kind: photos.kind, n: count() })
    .from(photos)
    .where(eq(photos.jobId, jobId))
    .groupBy(photos.kind);
  const n = (k: string) => photoCounts.find((c) => c.kind === k)?.n ?? 0;
  if (n("vorher") < 1 || n("nachher") < 1) {
    return { ok: false, error: "Bitte mindestens ein Vorher- und ein Nachher-Foto aufnehmen." };
  }

  const [open] = await db
    .select({ id: timeEntries.id })
    .from(timeEntries)
    .where(and(eq(timeEntries.jobId, jobId), eq(timeEntries.userId, me.id), isNull(timeEntries.endAt)));
  if (!open) return { ok: false, error: "Du bist für diesen Einsatz nicht eingestempelt." };

  const distanceM = distance(pos, job);
  await db
    .update(timeEntries)
    .set({ endAt: new Date(), endLat: pos?.lat, endLng: pos?.lng, endAccuracy: pos?.accuracy, endDistanceM: distanceM })
    .where(eq(timeEntries.id, open.id));

  // Erledigt, sobald niemand mehr eingestempelt ist
  const [stillOpen] = await db
    .select({ n: count() })
    .from(timeEntries)
    .where(and(eq(timeEntries.jobId, jobId), isNull(timeEntries.endAt)));
  if (stillOpen.n === 0) {
    if (aiEnabled()) {
      await db.update(jobs).set({ status: "erledigt", aiStatus: "pending" }).where(eq(jobs.id, jobId));
      after(() => runPhotoReview(jobId, me.tenantId));
    } else {
      await db.update(jobs).set({ status: "erledigt" }).where(eq(jobs.id, jobId));
    }
  }
  await audit({ tenantId: me.tenantId, actorId: me.id, action: "clock_out", entity: "job", entityId: jobId, data: { distanceM } });
  revalidatePath(`/ma/einsatz/${jobId}`);
  revalidatePath("/ma");
  return { ok: true, distanceM, geofenceM: job.geofenceM };
}

export async function deletePhoto(photoId: string): Promise<FieldResult> {
  const me = await requireUser();
  const [p] = await db
    .select({ id: photos.id, jobId: photos.jobId, status: jobs.status })
    .from(photos)
    .innerJoin(jobs, eq(jobs.id, photos.jobId))
    .where(and(eq(photos.id, photoId), eq(photos.userId, me.id), eq(photos.tenantId, me.tenantId)));
  if (!p) return { ok: false, error: "Foto nicht gefunden." };
  if (p.status !== "laufend" && p.status !== "geplant" && p.status !== "nacharbeit")
    return { ok: false, error: "Nach Abschluss können Fotos nicht mehr gelöscht werden." };
  await db.delete(photos).where(eq(photos.id, photoId));
  revalidatePath(`/ma/einsatz/${p.jobId}`);
  return { ok: true };
}
