import type { NextConfig } from "next";

// Sicherheits-Header für alle Antworten. HSTS setzt der Reverse-Proxy (deploy/Caddyfile), weil nur er HTTPS spricht.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  // Nur Direktiven, die Next.js-Skripte nicht betreffen: kein Einbetten, keine Plugins, Formulare nur an die App
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'" },
  // Standort nur für die App selbst (Stempeln); Kamera läuft über die Foto-Auswahl des Handys
  { key: "Permissions-Policy", value: "geolocation=(self), camera=(), microphone=(), payment=()" },
];

const nextConfig: NextConfig = {
  // Handy-Test über Cloudflare-Quick-Tunnel (gilt nur für next dev)
  allowedDevOrigins: ["*.trycloudflare.com"],
  serverExternalPackages: ["@react-pdf/renderer"],
  poweredByHeader: false,
  headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
