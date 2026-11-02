// Notfall auf dem Server: Büro-Konto ohne Passwort oder ohne Handy (Zwei-Faktor) wieder zugänglich machen.
// Aufruf: npm run zugang:zuruecksetzen -- login@firma.de
// Setzt ein neues Startpasswort, schaltet die Zwei-Faktor-Anmeldung ab (beim nächsten Login neu einrichten),
// hebt eine Kontosperre auf und meldet alle Geräte ab.
import { randomBytes } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { and, eq } from "drizzle-orm";
import { db, schema } from "./index";

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email?.includes("@")) throw new Error("Aufruf: npm run zugang:zuruecksetzen -- login@firma.de");
  const { user, account, session, twoFactor, auditLog } = schema;
  const [owner] = await db.select().from(user).where(and(eq(user.email, email), eq(user.role, "owner")));
  if (!owner?.tenantId) throw new Error(`Kein Büro-Konto mit ${email} gefunden.`);

  const password = randomBytes(12).toString("base64url");
  await db.transaction(async (tx) => {
    await tx.update(account).set({ password: await hashPassword(password), updatedAt: new Date() }).where(and(eq(account.userId, owner.id), eq(account.providerId, "credential")));
    await tx.delete(twoFactor).where(eq(twoFactor.userId, owner.id));
    await tx.delete(session).where(eq(session.userId, owner.id));
    await tx.update(user).set({ twoFactorEnabled: false, failedLogins: 0, lockedUntil: null, updatedAt: new Date() }).where(eq(user.id, owner.id));
    await tx.insert(auditLog).values({ tenantId: owner.tenantId!, actorId: null, action: "reset_access", entity: "user", entityId: owner.id });
  });

  console.log(`Zugang zurückgesetzt.\nLogin: ${email}\nPasswort: ${password}\n(Wird nicht gespeichert – jetzt sicher weitergeben. Beim Anmelden die Zwei-Faktor-Anmeldung neu einrichten.)`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
