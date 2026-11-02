"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { retentionError } from "@/domain/retention";
import { audit } from "@/server/audit";
import { int } from "@/server/form";
import { anonymizeCustomerData, anonymizeEmployeeData, applyRetention, PRIVACY_ENTITY } from "@/server/privacy";
import { requireOwner } from "@/server/session";

export async function saveRetention(fd: FormData) {
  const me = await requireOwner();
  const settings = { timeMonths: int(fd, "timeMonths", -1), gpsMonths: int(fd, "gpsMonths", -1), photoMonths: int(fd, "photoMonths", -1) };
  const error = retentionError(settings);
  if (error) throw new Error(error);
  await db
    .update(schema.tenants)
    .set({ retentionTimeMonths: settings.timeMonths, retentionGpsMonths: settings.gpsMonths, retentionPhotoMonths: settings.photoMonths })
    .where(eq(schema.tenants.id, me.tenantId));
  await audit({ tenantId: me.tenantId, actorId: me.id, action: "update_retention", entity: PRIVACY_ENTITY, data: settings });
  revalidatePath("/", "layout");
}

export async function runRetention() {
  const me = await requireOwner();
  await applyRetention(me.tenantId, me.id);
  revalidatePath("/", "layout");
}

export async function anonymizeEmployee(employeeId: string) {
  const me = await requireOwner();
  await anonymizeEmployeeData(me.tenantId, me.id, employeeId);
  revalidatePath("/", "layout");
  redirect("/mitarbeiter");
}

export async function anonymizeCustomer(customerId: string) {
  const me = await requireOwner();
  await anonymizeCustomerData(me.tenantId, me.id, customerId);
  revalidatePath("/", "layout");
  redirect("/kunden");
}
