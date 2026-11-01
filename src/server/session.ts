import "server-only";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { db, schema } from "@/db";
import { auth } from "@/lib/auth";

export type CurrentUser = typeof schema.user.$inferSelect & { tenantId: string };

/** Angemeldete Person inkl. Mandant und Rolle (aus der DB, nicht aus dem Session-Cookie). */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const s = await auth.api.getSession({ headers: await headers() });
  if (!s) return null;
  const [u] = await db.select().from(schema.user).where(eq(schema.user.id, s.user.id));
  if (!u || !u.active || !u.tenantId) return null;
  return { ...u, tenantId: u.tenantId };
});

export async function requireUser(): Promise<CurrentUser> {
  const u = await getCurrentUser();
  if (!u) redirect("/login");
  return u;
}

export async function requireOwner(): Promise<CurrentUser> {
  const u = await requireUser();
  if (u.role !== "owner") redirect("/ma");
  return u;
}
