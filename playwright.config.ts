import { defineConfig } from "@playwright/test";

// Drehbuch-Test gegen den laufenden Dev-Server (npm run db:start && npm run dev).
export default defineConfig({
  testDir: "./e2e",
  timeout: 180_000,
  workers: 1,
  reporter: "list",
  use: { baseURL: "http://localhost:3000", locale: "de-DE", timezoneId: "Europe/Berlin" },
  webServer: { command: "npm run dev", url: "http://localhost:3000/login", reuseExistingServer: true, timeout: 120_000 },
});
