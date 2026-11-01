"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { aiEnabled } from "@/ai/mistral";
import { runPhotoReview } from "@/ai/photoReview";
import { db, schema } from "@/db";
import { berlinDateTime } from "@/domain/format";
import { audit } from "@/server/audit";
import { str } from "@/server/form";
import { requireOwner } from "@/server/session";

const { jobs, timeEntries } = schema;

async function ownedJob(jobId: string, tenantId: string) {
  const [job] = await db.select().from(jobs).where(and(eq(jobs.id, jobId), eq(jobs.tenantId, tenantId)));
  if (!job) throw new Error("Einsatz nicht gefunden");
  if (job.invoiceId) throw new Error("Einsatz ist bereits abgerechnet und kann nicht mehr geändert werden.");
  return job;
}

export async function approveJob(jobId: string, fd: FormData) {
  const me = await requireOwner();
  const job = await ownedJob(jobId, me.tenantId);
  if (job.status !== "erledigt" && job.status !== "nacharbeit") throw new Error("Nur erledigte Einsätze können abgenommen werden.");
  await db
    .update(jobs)
    .set({ status: "abgenommen", reviewedBy: me.id, reviewedAt: new Date(), reviewComment: str(fd, "comment") || null })
    .where(eq(jobs.id, jobId));
  await audit({ tenantId: me.tenantId, actorId: me.id, action: "approve", entity: "job", entityId: jobId });
  revalidatePath(`/einsaetze/${jobId}`);
  revalidatePath("/dashboard");
}

export async function requestRework(jobId: string, fd: FormData) {
  const me = await requireOwner();
  await ownedJob(jobId, me.tenantId);
  const comment = str(fd, "comment");
  if (!comment) throw new Error("Bitte beschreiben, was nachgearbeitet werden soll.");
  await db
    .update(jobs)
    .set({ status: "nacharbeit", reviewedBy: me.id, reviewedAt: new Date(), reviewComment: comment })
    .where(eq(jobs.id, jobId));
  await audit({ tenantId: me.tenantId, actorId: me.id, action: "rework", entity: "job", entityId: jobId, data: { comment } });
  revalidatePath(`/einsaetze/${jobId}`);
  revalidatePath("/dashboard");
}

/** Korrektur mit Pflicht-Begründung. Die Originalzeiten bleiben unverändert gespeichert. */
export async function correctTimeEntry(entryId: string, fd: FormData) {
  const me = await requireOwner();
  const reason = str(fd, "reason");
  if (reason.length < 5) throw new Error("Bitte einen Grund für die Korrektur angeben.");
  const [entry] = await db
    .select({ entry: timeEntries, date: jobs.date, jobId: jobs.id })
    .from(timeEntries)
    .innerJoin(jobs, eq(jobs.id, timeEntries.jobId))
    .where(and(eq(timeEntries.id, entryId), eq(timeEntries.tenantId, me.tenantId)));
  if (!entry) throw new Error("Zeiteintrag nicht gefunden");
  await ownedJob(entry.jobId, me.tenantId);

  const start = berlinDateTime(entry.date, str(fd, "start"));
  let end = berlinDateTime(entry.date, str(fd, "end"));
  if (end <= start) end = new Date(end.getTime() + 24 * 60 * 60_000); // über Mitternacht
  await db
    .update(timeEntries)
    .set({ correctedStartAt: start, correctedEndAt: end, correctionReason: reason, correctedBy: me.id, correctedAt: new Date() })
    .where(eq(timeEntries.id, entryId));
  await audit({
    tenantId: me.tenantId,
    actorId: me.id,
    action: "correct_time",
    entity: "time_entry",
    entityId: entryId,
    data: {
      before: { start: entry.entry.correctedStartAt ?? entry.entry.startAt, end: entry.entry.correctedEndAt ?? entry.entry.endAt },
      after: { start, end },
      reason,
    },
  });
  revalidatePath(`/einsaetze/${entry.jobId}`);
}

export async function retryAiReview(jobId: string) {
  const me = await requireOwner();
  if (!aiEnabled()) throw new Error("Die KI-Fotoprüfung ist ausgeschaltet.");
  await db.update(jobs).set({ aiStatus: "pending", aiError: null }).where(and(eq(jobs.id, jobId), eq(jobs.tenantId, me.tenantId)));
  after(() => runPhotoReview(jobId, me.tenantId));
  revalidatePath(`/einsaetze/${jobId}`);
}
