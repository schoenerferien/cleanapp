"use server";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/db";
import { addDays } from "@/domain/time";
import { audit } from "@/server/audit";
import { int, str } from "@/server/form";
import { requireOwner } from "@/server/session";

const { jobs, jobAssignments, sites, user } = schema;

export async function createJob(fd: FormData) {
  const me = await requireOwner();
  const siteId = str(fd, "siteId");
  const date = str(fd, "date");
  const repeatUntil = str(fd, "repeatUntil");
  const userIds = fd.getAll("userIds").map(String).filter(Boolean);
  if (!siteId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Objekt und Datum sind Pflicht.");
  if (repeatUntil && repeatUntil < date) throw new Error("„Wöchentlich bis“ liegt vor dem Startdatum.");

  // Nur Objekte und Personen des eigenen Mandanten
  const [site] = await db.select({ id: sites.id }).from(sites).where(and(eq(sites.id, siteId), eq(sites.tenantId, me.tenantId)));
  if (!site) throw new Error("Objekt nicht gefunden");
  const validUsers = userIds.length
    ? await db.select({ id: user.id }).from(user).where(and(inArray(user.id, userIds), eq(user.tenantId, me.tenantId)))
    : [];

  const dates: string[] = [];
  for (let d = date; d <= (repeatUntil || date) && dates.length < 60; d = addDays(d, 7)) dates.push(d);
  const seriesId = dates.length > 1 ? crypto.randomUUID() : null;

  await db.transaction(async (tx) => {
    const created = await tx
      .insert(jobs)
      .values(
        dates.map((d) => ({
          tenantId: me.tenantId,
          siteId,
          date: d,
          plannedStart: str(fd, "plannedStart") || "08:00",
          plannedMinutes: Math.round(Number((str(fd, "plannedHours") || "2").replace(",", ".")) * 60) || int(fd, "plannedMinutes", 120),
          title: str(fd, "title") || "Unterhaltsreinigung",
          seriesId,
        })),
      )
      .returning({ id: jobs.id });
    if (validUsers.length) {
      await tx
        .insert(jobAssignments)
        .values(created.flatMap((j) => validUsers.map((u) => ({ jobId: j.id, userId: u.id, tenantId: me.tenantId }))));
    }
    await audit(
      { tenantId: me.tenantId, actorId: me.id, action: "create", entity: "job", entityId: created[0]?.id, data: { count: created.length, seriesId } },
      tx,
    );
  });
  revalidatePath("/einsaetze");
  revalidatePath("/dashboard");
}

/** Nur geplante Einsätze dürfen gelöscht werden – erfasste Zeiten bleiben unangetastet. */
export async function deleteJob(id: string) {
  const me = await requireOwner();
  const deleted = await db
    .delete(jobs)
    .where(and(eq(jobs.id, id), eq(jobs.tenantId, me.tenantId), eq(jobs.status, "geplant")))
    .returning({ id: jobs.id });
  if (deleted.length) await audit({ tenantId: me.tenantId, actorId: me.id, action: "delete", entity: "job", entityId: id });
  revalidatePath("/einsaetze");
}
