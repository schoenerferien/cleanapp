import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { username } from "better-auth/plugins";
import { db, schema } from "@/db";

// Konten legt nur die Gründerin an (keine Selbstregistrierung).
// Mitarbeitende melden sich mit Benutzername + 6-stelliger PIN an.
export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: { user: schema.user, session: schema.session, account: schema.account, verification: schema.verification },
  }),
  emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: 6 },
  session: { expiresIn: 60 * 60 * 24 * 30 },
  // Die eigene Adresse (BETTER_AUTH_URL) ist immer vertrauenswürdig; mit https:// werden die Cookies als „Secure“ gesetzt.
  // Zusätzliche Ursprünge nur in der Entwicklung (Handy-Test über Cloudflare-Tunnel) – im Betrieb nicht.
  trustedOrigins: process.env.NODE_ENV === "production" ? [] : ["http://localhost:3000", "https://*.trycloudflare.com"],
  // Rate-Limit (Anmeldeversuche je IP) liest die Client-IP aus X-Forwarded-For. Das ist nur sicher, wenn die App
  // ausschließlich hinter dem Reverse-Proxy erreichbar ist (next start -H 127.0.0.1, siehe deploy/).
  plugins: [username({ minUsernameLength: 2 }), nextCookies()],
});
