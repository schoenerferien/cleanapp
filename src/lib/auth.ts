import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware, isAPIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { twoFactor, username } from "better-auth/plugins";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { timeDe } from "@/domain/format";

// Konten legt nur die Gründerin an (keine Selbstregistrierung).
// Mitarbeitende melden sich mit Benutzername + 6-stelliger PIN an, das Büro mit Passwort (mind. 12 Zeichen) und
// zweitem Faktor (Authenticator-App). Die PINs setzt die App selbst; die Mindestlänge gilt nur beim Passwortwechsel.

/** Kontosperre nach so vielen Fehlversuchen in Folge – zählt je Konto, nicht je IP. */
export const MAX_FAILED_LOGINS = 10;
const LOCK_MINUTES = 15;
const LOGIN_PATHS = new Set(["/sign-in/email", "/sign-in/username"]);

/** Das Konto, an dem sich jemand anmelden will – per E-Mail (Büro) oder Benutzername (Team). Normalisiert wie better-auth. */
async function loginTarget(path: string, body: unknown) {
  const { email, username } = (body ?? {}) as { email?: unknown; username?: unknown };
  const { user } = schema;
  const where =
    path === "/sign-in/email" && typeof email === "string"
      ? eq(user.email, email.toLowerCase())
      : path === "/sign-in/username" && typeof username === "string"
        ? eq(user.username, username.toLowerCase())
        : null;
  if (!where) return null;
  const [target] = await db.select({ id: user.id, failedLogins: user.failedLogins, lockedUntil: user.lockedUntil }).from(user).where(where);
  return target ?? null;
}

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: { user: schema.user, session: schema.session, account: schema.account, verification: schema.verification, twoFactor: schema.twoFactor },
  }),
  emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: 12 },
  // Lange Sitzungen für die Handys im Team; Büro-Sitzungen begrenzt src/server/session.ts auf einen Arbeitstag
  session: { expiresIn: 60 * 60 * 24 * 30 },
  // Die eigene Adresse (BETTER_AUTH_URL) ist immer vertrauenswürdig; mit https:// werden die Cookies als „Secure“ gesetzt.
  // Zusätzliche Ursprünge nur in der Entwicklung (Handy-Test über Cloudflare-Tunnel) – im Betrieb nicht.
  trustedOrigins: process.env.NODE_ENV === "production" ? [] : ["http://localhost:3000", "https://*.trycloudflare.com"],
  // Rate-Limit (Anmeldeversuche je IP) liest die Client-IP aus X-Forwarded-For. Das ist nur sicher, wenn die App
  // ausschließlich hinter dem Reverse-Proxy erreichbar ist (next start -H 127.0.0.1, siehe deploy/). Die Kontosperre
  // unten wirkt unabhängig davon.
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (!LOGIN_PATHS.has(ctx.path)) return;
      const target = await loginTarget(ctx.path, ctx.body);
      if (target?.lockedUntil && target.lockedUntil > new Date()) {
        throw new APIError("TOO_MANY_REQUESTS", {
          code: "ACCOUNT_LOCKED",
          message: `Zu viele Fehlversuche. Anmeldung ab ${timeDe(target.lockedUntil)} Uhr wieder möglich.`,
        });
      }
    }),
    after: createAuthMiddleware(async (ctx) => {
      if (!LOGIN_PATHS.has(ctx.path)) return;
      const target = await loginTarget(ctx.path, ctx.body);
      if (!target) return;
      const { user } = schema;
      const returned = ctx.context.returned;
      if (isAPIError(returned)) {
        if (returned.statusCode !== 401) return; // nur falsches Passwort bzw. falsche PIN
        // In einem Schritt hochzählen und ggf. sperren – parallele Versuche zählen alle mit
        const reached = sql`${user.failedLogins} + 1 >= ${MAX_FAILED_LOGINS}`;
        await db
          .update(user)
          .set({
            failedLogins: sql`case when ${reached} then 0 else ${user.failedLogins} + 1 end`,
            lockedUntil: sql`case when ${reached} then now() + make_interval(mins => ${LOCK_MINUTES}) else ${user.lockedUntil} end`,
          })
          .where(eq(user.id, target.id));
      } else if (target.failedLogins > 0 || target.lockedUntil) {
        await db.update(user).set({ failedLogins: 0, lockedUntil: null }).where(eq(user.id, target.id));
      }
    }),
  },
  plugins: [
    username({ minUsernameLength: 2 }),
    // Kein „Gerät merken“: Das Büro bestätigt jede Anmeldung mit einem Code
    twoFactor({ issuer: "CleaningHub" }),
    nextCookies(),
  ],
});
