"use server";

import { hashPassword } from "better-auth/crypto";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import type { BillingModel, EmploymentType } from "@/db/schema";
import { audit } from "@/server/audit";
import { euroToCents, int, lines, optFloat, optStr, str } from "@/server/form";
import { geocode } from "@/server/geocode";
import { requireOwner } from "@/server/session";

const { tenants, customers, sites, user, account } = schema;

// ---------- Firma ----------

export async function updateTenant(fd: FormData) {
  const me = await requireOwner();
  await db
    .update(tenants)
    .set({
      name: str(fd, "name"),
      ownerName: optStr(fd, "ownerName"),
      street: optStr(fd, "street"),
      zip: optStr(fd, "zip"),
      city: optStr(fd, "city"),
      email: optStr(fd, "email"),
      phone: optStr(fd, "phone"),
      taxNumber: optStr(fd, "taxNumber"),
      vatId: optStr(fd, "vatId"),
      iban: optStr(fd, "iban")?.replace(/\s/g, "") ?? null,
      bic: optStr(fd, "bic"),
      bankName: optStr(fd, "bankName"),
      kleinunternehmer: fd.get("kleinunternehmer") === "on",
      invoicePrefix: str(fd, "invoicePrefix") || "RE",
    })
    .where(eq(tenants.id, me.tenantId));
  await audit({ tenantId: me.tenantId, actorId: me.id, action: "update", entity: "tenant", entityId: me.tenantId });
  revalidatePath("/", "layout");
}

// ---------- Kunden ----------

function customerValues(fd: FormData) {
  return {
    name: str(fd, "name"),
    contactName: optStr(fd, "contactName"),
    email: optStr(fd, "email"),
    phone: optStr(fd, "phone"),
    street: optStr(fd, "street"),
    zip: optStr(fd, "zip"),
    city: optStr(fd, "city"),
  };
}

export async function createCustomer(fd: FormData) {
  const me = await requireOwner();
  const values = customerValues(fd);
  if (!values.name) throw new Error("Name fehlt");
  const [c] = await db.insert(customers).values({ ...values, tenantId: me.tenantId }).returning();
  await audit({ tenantId: me.tenantId, actorId: me.id, action: "create", entity: "customer", entityId: c.id });
  redirect(`/kunden/${c.id}`);
}

export async function updateCustomer(id: string, fd: FormData) {
  const me = await requireOwner();
  await db
    .update(customers)
    .set(customerValues(fd))
    .where(and(eq(customers.id, id), eq(customers.tenantId, me.tenantId)));
  await audit({ tenantId: me.tenantId, actorId: me.id, action: "update", entity: "customer", entityId: id });
  revalidatePath(`/kunden/${id}`);
}

// ---------- Objekte ----------

async function siteValues(fd: FormData) {
  const values = {
    name: str(fd, "name"),
    street: optStr(fd, "street"),
    zip: optStr(fd, "zip"),
    city: optStr(fd, "city"),
    region: str(fd, "region") || str(fd, "city"),
    lat: optFloat(fd, "lat"),
    lng: optFloat(fd, "lng"),
    instructions: optStr(fd, "instructions"),
    checklist: lines(fd, "checklist"),
    billingModel: str(fd, "billingModel") as BillingModel,
    rateCents: euroToCents(str(fd, "rate") || "0"),
    geofenceM: int(fd, "geofenceM", 200),
  };
  if (!values.name) throw new Error("Objektname fehlt");
  if (!["hourly", "per_visit", "monthly_flat"].includes(values.billingModel)) throw new Error("Abrechnungsmodell fehlt");
  // Koordinaten automatisch ermitteln, wenn keine angegeben sind
  if ((values.lat == null || values.lng == null) && values.street && values.city) {
    const pos = await geocode(`${values.street}, ${values.zip ?? ""} ${values.city}`);
    if (pos) Object.assign(values, pos);
  }
  return values;
}

export async function createSite(customerId: string, fd: FormData) {
  const me = await requireOwner();
  const [c] = await db
    .select({ id: customers.id })
    .from(customers)
    .where(and(eq(customers.id, customerId), eq(customers.tenantId, me.tenantId)));
  if (!c) throw new Error("Kunde nicht gefunden");
  const [s] = await db
    .insert(sites)
    .values({ ...(await siteValues(fd)), customerId, tenantId: me.tenantId })
    .returning();
  await audit({ tenantId: me.tenantId, actorId: me.id, action: "create", entity: "site", entityId: s.id });
  revalidatePath(`/kunden/${customerId}`);
}

export async function updateSite(id: string, fd: FormData) {
  const me = await requireOwner();
  const [s] = await db
    .update(sites)
    .set(await siteValues(fd))
    .where(and(eq(sites.id, id), eq(sites.tenantId, me.tenantId)))
    .returning();
  await audit({ tenantId: me.tenantId, actorId: me.id, action: "update", entity: "site", entityId: id });
  redirect(`/kunden/${s.customerId}`);
}

// ---------- Mitarbeiter ----------

function validatePin(pin: string) {
  if (!/^\d{6}$/.test(pin)) throw new Error("Die PIN muss genau 6 Ziffern haben.");
}

export async function createEmployee(fd: FormData) {
  const me = await requireOwner();
  const name = str(fd, "name");
  const username = str(fd, "username").toLowerCase();
  const pin = str(fd, "pin");
  if (!name || !/^[a-z0-9._-]{2,}$/.test(username)) throw new Error("Name und Benutzername (a–z, 0–9) erforderlich.");
  validatePin(pin);

  const id = crypto.randomUUID();
  await db.transaction(async (tx) => {
    await tx.insert(user).values({
      id,
      name,
      email: `${username}.${me.tenantId.slice(0, 8)}@ma.cleaninghub.local`, // Mitarbeitende brauchen keine E-Mail
      emailVerified: true,
      username,
      displayUsername: username,
      tenantId: me.tenantId,
      role: "employee",
      hourlyWageCents: euroToCents(str(fd, "wage") || "0"),
      employmentType: (str(fd, "employmentType") || "minijob") as EmploymentType,
      phone: optStr(fd, "phone"),
    });
    await tx.insert(account).values({
      id: crypto.randomUUID(),
      accountId: id,
      providerId: "credential",
      userId: id,
      password: await hashPassword(pin),
    });
    await audit({ tenantId: me.tenantId, actorId: me.id, action: "create", entity: "employee", entityId: id }, tx);
  });
  revalidatePath("/mitarbeiter");
}

export async function updateEmployee(id: string, fd: FormData) {
  const me = await requireOwner();
  const pin = str(fd, "pin");
  if (pin) validatePin(pin);
  const passwordHash = pin ? await hashPassword(pin) : null;

  await db.transaction(async (tx) => {
    // Nur Mitarbeitende des eigenen Mandanten – sonst wird gar nichts geändert, auch keine PIN
    const [employee] = await tx
      .update(user)
      .set({
        name: str(fd, "name"),
        hourlyWageCents: euroToCents(str(fd, "wage") || "0"),
        employmentType: str(fd, "employmentType") as EmploymentType,
        phone: optStr(fd, "phone"),
        active: fd.get("active") === "on",
        updatedAt: new Date(),
      })
      .where(and(eq(user.id, id), eq(user.tenantId, me.tenantId), eq(user.role, "employee")))
      .returning({ id: user.id });
    if (!employee) throw new Error("Mitarbeiter nicht gefunden");

    if (passwordHash) {
      await tx
        .update(account)
        .set({ password: passwordHash, updatedAt: new Date() })
        .where(and(eq(account.userId, employee.id), eq(account.providerId, "credential")));
    }
    await audit(
      {
        tenantId: me.tenantId,
        actorId: me.id,
        action: "update",
        entity: "employee",
        entityId: id,
        data: { pinChanged: Boolean(pin) },
      },
      tx,
    );
  });
  redirect("/mitarbeiter");
}
