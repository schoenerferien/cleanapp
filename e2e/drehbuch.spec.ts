import { execSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { expect, test, devices, type Browser, type Page } from "@playwright/test";
import postgres from "postgres";

// Spielt das Demo-Drehbuch aus docs/poc-plan.md durch. Achtung: setzt die Datenbank per Seed zurück.
const SHOTS = "e2e/screenshots";
const PRAXIS = { latitude: 53.5881, longitude: 9.9849 }; // ca. 40 m neben der Praxis Dr. Meier

test.describe.configure({ mode: "serial" });

let jobUrl = "";

async function login(page: Page, user: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("E-Mail oder Benutzername").fill(user);
  await page.getByLabel("Passwort oder PIN").fill(password);
  await page.getByRole("button", { name: "Anmelden" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

/** Erzeugt ein Testfoto (JPEG) per Screenshot einer farbigen Fläche. */
async function fakePhoto(browser: Browser, html: string): Promise<Buffer> {
  const p = await browser.newPage({ viewport: { width: 800, height: 600 } });
  await p.setContent(`<body style="margin:0">${html}</body>`);
  const buf = await p.screenshot({ type: "jpeg", quality: 80 });
  await p.close();
  return buf;
}

test.beforeAll(() => {
  mkdirSync(SHOTS, { recursive: true });
  execSync("npm run db:seed", { stdio: "ignore" });
});

test("1. Gründerin: Dashboard, Planung mit Wiederholung, Karte", async ({ page }) => {
  await login(page, "gruenderin@glanzwerk.demo", "demo1234");
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByText("Jetzt eingestempelt").first()).toBeVisible();
  await expect(page.getByRole("link", { name: /Bogdan Ionescu seit/ })).toBeVisible();
  await expect(page.getByText(/Minijob-Grenze/)).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/01-dashboard.png`, fullPage: true });

  await page.goto("/einsaetze");
  await page.locator("select[name=siteId]").selectOption({ label: "Hamburg · Treppenhaus Wandsbeker Chaussee 80" });
  await page.locator("input[name=title]").fill("Glasreinigung Eingang");
  await page.locator("input[name=date]").fill("2026-10-12");
  await page.locator("input[name=repeatUntil]").fill("2026-10-26");
  await page.locator("fieldset").getByText("Celine Arslan").click();
  await Promise.all([
    page.waitForResponse((r) => r.request().method() === "POST" && r.url().includes("/einsaetze")),
    page.getByRole("button", { name: "Einplanen" }).click(),
  ]);
  await page.goto("/einsaetze?w=2026-10-19");
  await expect(page.getByText("Glasreinigung Eingang")).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/02-einsaetze.png`, fullPage: true });

  await page.goto("/einsaetze?ansicht=karte&w=2026-10-05");
  await expect(page.locator(".leaflet-container")).toBeVisible();
  await expect(page.locator("path.leaflet-interactive").first()).toBeVisible();
  await expect(page.locator("img.leaflet-tile-loaded").first()).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: `${SHOTS}/03-karte.png` });
});

test("2. Anna am Handy: Einstempeln, Checkliste, Fotos, Mangel, Beenden", async ({ browser }) => {
  const ctx = await browser.newContext({ ...devices["Pixel 7"], geolocation: PRAXIS, permissions: ["geolocation"], locale: "de-DE", timezoneId: "Europe/Berlin" });
  const page = await ctx.newPage();
  page.on("dialog", (d) => d.accept());
  await login(page, "anna", "111111");
  await expect(page).toHaveURL(/\/ma$/);
  await page.screenshot({ path: `${SHOTS}/04-ma-heute.png`, fullPage: true });

  await page.getByRole("link", { name: /Sonderreinigung Wartezimmer/ }).click();
  await page.getByRole("button", { name: "Einsatz starten" }).click();
  await expect(page.getByText(/Eingestempelt – \d+ m vom Objekt ✓/)).toBeVisible();
  jobUrl = page.url().replace(/.*\/ma\/einsatz\//, "/einsaetze/");

  await page.getByText("Böden wischen").click();
  await page.getByText("Sanitär reinigen und desinfizieren").click();

  const dirty = await fakePhoto(browser, `<div style="width:800px;height:600px;background:#8b7d6b"><div style="margin:120px;width:300px;height:200px;background:#5c4a32;border-radius:50%"></div></div>`);
  const clean = await fakePhoto(browser, `<div style="width:800px;height:600px;background:#f4f4f2"><div style="margin:120px;width:300px;height:200px;background:#e9e9e6"></div></div>`);
  const inputs = page.locator("input[type=file]");
  const upload = async (idx: number, name: string, buffer: Buffer, heading: RegExp) => {
    await inputs.nth(idx).setInputFiles({ name, mimeType: "image/jpeg", buffer });
    await expect(page.getByRole("heading", { name: heading })).toBeVisible({ timeout: 30_000 });
  };
  await upload(0, "vorher1.jpg", dirty, /Vorher \(1\)/);
  await upload(0, "vorher2.jpg", dirty, /Vorher \(2\)/);
  await upload(1, "nachher1.jpg", clean, /Nachher \(1\)/);
  await upload(1, "nachher2.jpg", clean, /Nachher \(2\)/);
  await page.getByPlaceholder(/Was ist der Mangel/).fill("Spiegel im WC hat Kalkflecken");
  await upload(2, "mangel.jpg", dirty, /Mängel melden \(optional\) \(1\)/);
  // Sicherheit: SVG (kann Skript enthalten) wird abgelehnt, auch wenn es sich als Bild ausgibt
  const svg = await page.request.post("/api/photos", {
    multipart: {
      jobId: jobUrl.split("/").pop()!,
      kind: "vorher",
      file: { name: "x.jpg", mimeType: "image/jpeg", buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>') },
    },
  });
  expect(svg.status()).toBe(400);
  await page.getByPlaceholder(/Reinigungsmittel fast leer/).fill("Desinfektionsmittel fast leer");
  await page.screenshot({ path: `${SHOTS}/05-ma-einsatz.png`, fullPage: true });

  await page.getByRole("button", { name: "Einsatz beenden" }).click();
  await expect(page.getByText(/Erledigt \d{2}:\d{2}–\d{2}:\d{2}/)).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/06-ma-erledigt.png`, fullPage: true });

  await page.goto("/ma/zeiten");
  await expect(page.getByText(/Minijob: voraussichtlich/)).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/07-ma-stunden.png`, fullPage: true });
  await ctx.close();
});

test("3. Gründerin: Kontrolle, Zeitkorrektur, Abnahme", async ({ page }) => {
  await login(page, "gruenderin@glanzwerk.demo", "demo1234");
  await page.goto("/dashboard");
  await expect(page.getByRole("link", { name: /Praxis Dr. Meier/ }).first()).toBeVisible();

  await page.goto(jobUrl);
  await expect(page.getByRole("heading", { name: "Vorher (2)" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Nachher (2)" })).toBeVisible();
  await expect(page.getByText("Spiegel im WC hat Kalkflecken")).toBeVisible();
  // KI-Fotoprüfung ist standardmäßig aus: keine KI-Elemente
  await expect(page.getByText("KI-Hinweis")).toHaveCount(0);
  await expect(page.getByText(/Start: \d+ m ✓/)).toBeVisible();

  await page.getByText("Zeit korrigieren").click();
  await page.locator("input[name=start]").fill("10:00");
  await page.locator("input[name=end]").fill("12:15");
  await page.locator("input[name=reason]").fill("Zu spät ausgestempelt – laut Rücksprache bis 12:15");
  await page.getByRole("button", { name: "Korrigieren" }).click();
  await expect(page.getByText(/Korrigiert am .*Zu spät ausgestempelt/)).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/08-pruefansicht.png`, fullPage: true });

  await page.getByRole("button", { name: "Abnehmen" }).click();
  await expect(page.getByText("Abgenommen.")).toBeVisible();
});

test("4. Arbeitszeiten: Minijob-Ampel und CSV nach MiLoG", async ({ page }) => {
  await login(page, "gruenderin@glanzwerk.demo", "demo1234");
  await page.goto("/zeiten");
  await expect(page.getByRole("link", { name: "Anna Kowalski" })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/09-zeiten.png`, fullPage: true });

  const res = await page.request.get("/api/exports/zeiten?m=2026-10");
  expect(res.headers()["content-type"]).toContain("text/csv");
  const csv = await res.text();
  expect(csv).toContain("Mitarbeiter;Datum;Beginn;Ende;Dauer (Std)");
  // Die Sonderreinigung aus Test 2 findet heute statt
  const today = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date());
  expect(csv).toContain(`Anna Kowalski;${today};10:00;12:15;2,25;Praxis Dr. Meier;Praxis Dr. Meier;ja;Zu spät ausgestempelt`);
});

test("5. Rechnungen: Entwurf, Finalisieren, PDF, GoBD-Sperre, KU-Ampel", async ({ page }) => {
  page.on("dialog", (d) => d.accept());
  await login(page, "gruenderin@glanzwerk.demo", "demo1234");

  // Oktober Praxis (nach Stunden): enthält die heutige Sonderreinigung mit korrigierter Zeit
  await page.goto("/rechnungen/neu");
  await page.locator("select[name=kunde]").selectOption({ label: "Praxis Dr. Meier" });
  await page.locator("input[name=m]").fill("2026-10");
  await page.getByRole("button", { name: "Vorschau" }).click();
  await expect(page.getByText(/Sonderreinigung Wartezimmer/)).toBeVisible();
  await expect(page.getByText("2,25 Std")).toBeVisible();
  await page.getByRole("button", { name: /Entwurf erstellen/ }).click();
  await expect(page.getByRole("heading", { name: "Rechnungsentwurf" })).toBeVisible();
  await page.getByRole("button", { name: "Finalisieren" }).click();
  await expect(page.getByRole("heading", { name: "Rechnung RE-2026-0001" })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/10-rechnung.png`, fullPage: true });
  const invoiceId = page.url().split("/").pop()!;

  const pdf = await page.request.get(`/api/invoices/${invoiceId}/pdf`);
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
  const body = await pdf.body();
  expect(body.subarray(0, 4).toString()).toBe("%PDF");
  // Leistungsnachweis enthält je ein Vorher- und Nachher-Foto
  expect(body.toString("latin1").match(/\/Subtype \/Image/g)?.length).toBe(2);
  // Finalisierte Rechnung: abgelegtes PDF, jeder Abruf liefert exakt dieselben Bytes
  expect((await (await page.request.get(`/api/invoices/${invoiceId}/pdf`)).body()).equals(body)).toBe(true);

  // Monatsarchiv: ZIP mit Arbeitszeiten und der eben finalisierten Rechnung
  const zip = await page.request.get(`/api/exports/monatsarchiv?m=${new Date().toISOString().slice(0, 7)}`);
  expect(zip.headers()["content-type"]).toBe("application/zip");
  const zipBody = await zip.body();
  expect(zipBody.subarray(0, 2).toString()).toBe("PK");
  expect(zipBody.toString("latin1")).toContain("rechnungen/Rechnung-RE-2026-0001.pdf");

  // September Hausverwaltung (Festpreis je Einsatz) → fortlaufende Nummer
  await page.goto("/rechnungen/neu");
  await page.locator("select[name=kunde]").selectOption({ label: "Hausverwaltung Nord GmbH" });
  await page.locator("input[name=m]").fill("2026-09");
  await page.getByRole("button", { name: "Vorschau" }).click();
  await page.getByRole("button", { name: /Entwurf erstellen \(9 Einsätze\)/ }).click();
  await page.getByRole("button", { name: "Finalisieren" }).click();
  await expect(page.getByRole("heading", { name: "Rechnung RE-2026-0002" })).toBeVisible();

  // GoBD: Datenbank verweigert Änderungen an finalisierten Rechnungen
  const sql = postgres("postgres://postgres:postgres@localhost:5433/cleaninghub", { max: 1 });
  await expect(sql`update invoice_lines set total_cents = 1 where invoice_id = ${invoiceId}`).rejects.toThrow(/unveränderbar/);
  await expect(sql`update invoices set total_cents = 1 where id = ${invoiceId}`).rejects.toThrow(/unveränderbar/);
  await sql.end();

  await page.goto("/rechnungen");
  await expect(page.getByText(/Umsatz 2026 und Kleinunternehmergrenze/)).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/11-rechnungen.png`, fullPage: true });
});
