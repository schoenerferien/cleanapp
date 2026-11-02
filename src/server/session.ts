import "server-only";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { db, schema } from "@/db";
import { auth } from "@/lib/auth";

export type CurrentUser = typeof schema.user.$inferSelect & { tenantId: string };

/** Zwei-Faktor-Anmeldung ist für das Büro im Betrieb Pflicht; lokal (Demo, Drehbuch-Test) freiwillig. */
export const twoFactorRequired = process.env.NODE_ENV === "production";

/** Büro-Sitzungen enden nach einem Arbeitstag – das Büro sieht alle Daten und kann sie komplett herunterladen. */
const OWNER_SESSION_HOURS = 12;

/** Angemeldete Person inkl. Mandant und Rolle (aus der DB, nicht aus dem Session-Cookie). */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const s = await auth.api.getSession({ headers: await headers() });
  if (!s) return null;
  const [u] = await db.select().from(schema.user).where(eq(schema.user.id, s.user.id));
  if (!u || !u.active || !u.tenantId) return null;
  if (u.role === "owner" && Date.now() - s.session.createdAt.getTime() > OWNER_SESSION_HOURS * 3_600_000) {
    await db.delete(schema.session).where(eq(schema.session.id, s.session.id));
    return null;
  }
  return { ...u, tenantId: u.tenantId };
});

/** Büro-Konto mit vollständiger Anmeldung (im Betrieb mit zweitem Faktor). Für API-Routen und Rechte im Code. */
export function isOwner(u: CurrentUser | null): u is CurrentUser & { role: "owner" } {
  return u?.role === "owner" && (u.twoFactorEnabled || !twoFactorRequired);
}

export async function requireUser(): Promise<CurrentUser> {
  const u = await getCurrentUser();
  if (!u) redirect("/login");
  return u;
}

export async function requireOwner(): Promise<CurrentUser> {
  const u = await requireUser();
  if (u.role !== "owner") redirect("/ma");
  // Ohne zweiten Faktor geht es nur zur Einrichtung
  if (!isOwner(u)) redirect("/konto");
  return u;
}
