// Ersteinrichtung auf dem Server: legt die Firma und das Inhaber-Konto an – ohne Demo-Daten.
// Aufruf: npm run firma:anlegen -- "Firmenname" "Vorname Nachname" login@firma.de
// Adresse, Steuernummer, Bankverbindung usw. danach in der App unter „Einstellungen“ ergänzen.
import { randomBytes } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { count } from "drizzle-orm";
import { db, schema } from "./index";

async function main() {
  const [name, ownerName, email] = process.argv.slice(2).map((a) => a.trim());
  if (!name || !ownerName || !email?.includes("@")) {
    throw new Error('Aufruf: npm run firma:anlegen -- "Firmenname" "Vorname Nachname" login@firma.de');
  }
  // Eine Instanz je Firma: Gibt es schon eine, wird nichts angelegt
  const [{ n }] = await db.select({ n: count() }).from(schema.tenants);
  if (n > 0) throw new Error("Abgebrochen: In dieser Datenbank gibt es bereits eine Firma.");

  // Starkes Startpasswort statt eines selbst gewählten – wird nur einmal angezeigt
  const password = randomBytes(12).toString("base64url");
  const userId = crypto.randomUUID();

  await db.transaction(async (tx) => {
    const [tenant] = await tx.insert(schema.tenants).values({ name, ownerName, email, kleinunternehmer: true }).returning();
    await tx.insert(schema.user).values({
      id: userId,
      name: ownerName,
      email: email.toLowerCase(),
      emailVerified: true,
      tenantId: tenant.id,
      role: "owner",
    });
    await tx.insert(schema.account).values({
      id: crypto.randomUUID(),
      accountId: userId,
      providerId: "credential",
      userId,
      password: await hashPassword(password),
    });
  });

  console.log(`Firma „${name}“ angelegt.\nLogin: ${email.toLowerCase()}\nPasswort: ${password}\n(Wird nicht gespeichert – jetzt sicher weitergeben.)`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
