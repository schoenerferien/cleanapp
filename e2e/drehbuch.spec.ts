import { execSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { expect, test, devices, type Browser, type Page } from "@playwright/test";
import postgres from "postgres";

// Spielt das Demo-Drehbuch aus docs/poc-plan.md durch. Achtung: setzt die Datenbank per Seed zurück.
const SHOTS = "e2e/screenshots";
const PRAXIS = { latitude: 53.5881, longitude: 9.9849 }; // ca. 40 m neben der Praxis Dr. Meier
// Monat der heutigen Sonderreinigung (Test 2) – Arbeitszeiten und Rechnung beziehen sich darauf
const THIS_MONTH = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(new Date()).slice(0, 7);

test.describe.configure({ mode: "serial" });

let jobUrl = "";

async function login(page: Page, user: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("E-Mail oder Benutzername").fill(user);
  await page.getByLabel("Passwort oder PIN").fill(password);
  await page.getByRole("button", { name: "Anmelden" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

const DB_URL = "postgres://postgres:postgres@localhost:5433/cleaninghub";
const ORIGIN = { Origin: "http://localhost:3000" };

/** TOTP-Code (RFC 6238: SHA-1, 30 s, 6 Stellen) – rechnet wie eine Authenticator-App. */
function totp(base32: string, at = Date.now()): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bits = [...base32.replace(/=+$/, "").toUpperCase()].map((c) => alphabet.indexOf(c).toString(2).padStart(5, "0")).join("");
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const hmac = createHmac("sha1", key).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  return String((hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
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

test("1. Gründerin: Dashboard, Planung mit Wiederholung", async ({ page }) => {
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

  // Kartenansicht vorerst abgeschaltet, siehe src/components/site-map.tsx
  // await page.goto("/einsaetze?ansicht=karte&w=2026-10-05");
  // await expect(page.locator(".leaflet-container")).toBeVisible();
  // await expect(page.locator("path.leaflet-interactive").first()).toBeVisible();
  // await expect(page.locator("img.leaflet-tile-loaded").first()).toBeVisible({ timeout: 15_000 });
  // await page.screenshot({ path: `${SHOTS}/03-karte.png` });
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

  const res = await page.request.get(`/api/exports/zeiten?m=${THIS_MONTH}`);
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

  // Praxis im laufenden Monat (nach Stunden): enthält die heutige Sonderreinigung mit korrigierter Zeit
  await page.goto("/rechnungen/neu");
  await page.locator("select[name=kunde]").selectOption({ label: "Praxis Dr. Meier" });
  await page.locator("input[name=m]").fill(THIS_MONTH);
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

test("6. Storno: Stornorechnung, Pauschale wieder frei, korrigierte Rechnung, GoBD", async ({ page }) => {
  page.on("dialog", (d) => d.accept());
  await login(page, "gruenderin@glanzwerk.demo", "demo1234");
  const sql = postgres(DB_URL, { max: 1 });

  // Förde (Monatspauschale) September abrechnen und ohne Korrektur stornieren
  await page.goto("/rechnungen/neu");
  await page.locator("select[name=kunde]").selectOption({ label: "Förde Consulting GmbH" });
  await page.locator("input[name=m]").fill("2026-09");
  await page.getByRole("button", { name: "Vorschau" }).click();
  await page.getByRole("button", { name: /Entwurf erstellen/ }).click();
  await page.getByRole("button", { name: "Finalisieren" }).click();
  await expect(page.getByRole("heading", { name: "Rechnung RE-2026-0003" })).toBeVisible();
  await page.getByLabel("Korrigierte Rechnung als Entwurf anlegen").uncheck();
  await page.getByRole("button", { name: "Rechnung stornieren" }).click();
  await expect(page.getByRole("heading", { name: "Stornorechnung RE-2026-0004" })).toBeVisible();
  await expect(page.getByText(/Storniert die Rechnung RE-2026-0003/)).toBeVisible();
  // Eine Stornorechnung kann man weder stornieren noch als bezahlt markieren
  await expect(page.getByRole("button", { name: "Rechnung stornieren" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Als bezahlt markieren" })).toHaveCount(0);

  const stornoPdf = await page.request.get(`/api/invoices/${page.url().split("/").pop()}/pdf`);
  expect(stornoPdf.headers()["content-disposition"]).toContain("Stornorechnung-RE-2026-0004.pdf");
  expect((await stornoPdf.body()).toString("latin1")).toContain("Stornorechnung RE-2026-0004");

  // Pauschale und Einsätze sind wieder abrechenbar
  await page.goto("/rechnungen/neu");
  await page.locator("select[name=kunde]").selectOption({ label: "Förde Consulting GmbH" });
  await page.locator("input[name=m]").fill("2026-09");
  await page.getByRole("button", { name: "Vorschau" }).click();
  await expect(page.getByText(/Monatspauschale September 2026/)).toBeVisible();
  await expect(page.getByRole("button", { name: /Entwurf erstellen \([1-9]\d* Einsätze\)/ })).toBeVisible();

  // Hausverwaltung RE-2026-0002 stornieren und gleich korrigiert neu ausstellen
  await page.goto("/rechnungen");
  await page.getByRole("link", { name: "RE-2026-0002" }).click();
  await expect(page.getByRole("heading", { name: "Rechnung RE-2026-0002" })).toBeVisible();
  const originalId = page.url().split("/").pop()!;
  await page.getByLabel("Grund (nur intern, fürs Protokoll)").fill("Falscher Einsatzpreis");
  await page.getByRole("button", { name: "Rechnung stornieren" }).click();
  await expect(page.getByRole("heading", { name: "Rechnungsentwurf" })).toBeVisible();
  await page.getByRole("button", { name: "Finalisieren" }).click();
  await expect(page.getByRole("heading", { name: "Rechnung RE-2026-0006" })).toBeVisible();
  const correctedId = page.url().split("/").pop()!;

  const rows = await sql<{ number: string; kind: string; status: string; total_cents: number; cancels: string | null }[]>`
    select i.number, i.kind, i.status, i.total_cents, c.number as cancels
    from invoices i left join invoices c on c.id = i.cancels_invoice_id order by i.number`;
  const byNumber = Object.fromEntries(rows.map((r) => [r.number, r]));
  expect(byNumber["RE-2026-0002"].status).toBe("storniert");
  expect(byNumber["RE-2026-0005"]).toMatchObject({ kind: "storno", status: "final", cancels: "RE-2026-0002", total_cents: -byNumber["RE-2026-0002"].total_cents });
  expect(byNumber["RE-2026-0006"]).toMatchObject({ kind: "rechnung", status: "final", total_cents: byNumber["RE-2026-0002"].total_cents });
  // Die Einsätze hängen jetzt an der korrigierten Rechnung
  const [{ old, moved }] = await sql`select count(*) filter (where invoice_id = ${originalId})::int as old,
    count(*) filter (where invoice_id = ${correctedId})::int as moved from jobs`;
  expect({ old, moved }).toEqual({ old: 0, moved: 9 });
  // Umsatz: Rechnung + Storno heben sich auf
  const [{ revenue }] = await sql`select sum(total_cents)::int as revenue from invoices where status in ('final', 'bezahlt', 'storniert')`;
  expect(revenue).toBe(byNumber["RE-2026-0001"].total_cents + byNumber["RE-2026-0006"].total_cents);

  // GoBD: Storniertes bleibt storniert, und ohne Stornorechnung gibt es keinen Status "storniert"
  await expect(sql`update invoices set status = 'final' where id = ${originalId}`).rejects.toThrow(/unveränderbar/);
  await expect(sql`update invoices set status = 'storniert' where number = 'RE-2026-0001'`).rejects.toThrow(/unveränderbar/);
  await expect(sql`update invoice_lines set total_cents = 1 where invoice_id = (select id from invoices where number = 'RE-2026-0005')`).rejects.toThrow(
    /unveränderbar/,
  );
  await sql.end();

  await page.goto("/rechnungen");
  await expect(page.getByRole("row", { name: /RE-2026-0002.*Storniert/ })).toBeVisible();
  await expect(page.getByRole("row", { name: /RE-2026-0005.*Storno/ })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/12-storno.png`, fullPage: true });
});

test("7. Datenschutz: Löschfristen, Kunden und Mitarbeiter anonymisieren", async ({ page }) => {
  page.on("dialog", (d) => d.accept());
  await login(page, "gruenderin@glanzwerk.demo", "demo1234");
  const sql = postgres(DB_URL, { max: 1 });

  // Daten künstlich altern lassen: eine Arbeitszeit vor über 2 Jahren, GPS vor 5 Monaten, ein Foto vor über 2 Jahren
  const [old] = await sql`update time_entries set start_at = '2024-01-10 08:00+01', end_at = '2024-01-10 10:00+01'
    where id = (select id from time_entries where end_at is not null order by start_at limit 1) returning id`;
  const [gps] = await sql`update time_entries set start_at = start_at - interval '5 months', end_at = end_at - interval '5 months'
    where id = (select id from time_entries where end_at is not null and start_lat is not null and id <> ${old.id} order by start_at limit 1) returning id`;
  const [photo] = await sql`update photos set taken_at = '2024-01-10 09:00+01'
    where id = (select id from photos order by taken_at limit 1) returning id, file_path`;
  expect(existsSync(`storage/${photo.file_path}`)).toBe(true);

  await page.goto("/dashboard");
  await expect(page.getByText(/Löschfristen erreicht: 3 Datensätze/)).toBeVisible();
  await page.goto("/datenschutz");
  await page.screenshot({ path: `${SHOTS}/13-datenschutz.png`, fullPage: true });
  await page.getByRole("button", { name: "Jetzt löschen" }).click();
  await expect(page.getByText("Nichts fällig.")).toBeVisible();

  expect(await sql`select 1 from time_entries where id = ${old.id}`).toHaveLength(0);
  const [kept] = await sql`select start_lat, end_lat, start_distance_m from time_entries where id = ${gps.id}`;
  expect(kept).toMatchObject({ start_lat: null, end_lat: null });
  expect(kept.start_distance_m).not.toBeNull();
  expect(await sql`select 1 from photos where id = ${photo.id}`).toHaveLength(0);
  expect(existsSync(`storage/${photo.file_path}`)).toBe(false);

  // Löschfristen: Arbeitszeiten unter 24 Monaten lässt der Server nicht zu
  await page.locator("input[name=timeMonths]").fill("12");
  await page.locator("input[name=timeMonths]").evaluate((el) => el.removeAttribute("min"));
  await page.getByRole("button", { name: "Speichern" }).click();
  const [{ retention_time_months }] = await sql`select retention_time_months from tenants`;
  expect(retention_time_months).toBe(24);

  // Kunde mit offenen Einsätzen: noch nicht anonymisierbar
  await page.goto("/kunden");
  await page.getByRole("link", { name: /Förde Consulting GmbH/ }).click();
  await expect(page.getByText(/Noch nicht möglich: .*Einsätze/)).toBeVisible();

  // Ehemaliger Kunde ohne offene Vorgänge
  await page.goto("/kunden");
  await page.getByLabel("Name / Firma").fill("Familie Beispiel");
  await page.getByLabel("Ansprechpartner").fill("Erika Beispiel");
  await page.getByRole("button", { name: "Kunde anlegen" }).click();
  await expect(page.getByRole("heading", { name: "Familie Beispiel" })).toBeVisible();
  await page.getByRole("button", { name: "Kunden anonymisieren" }).click();
  await expect(page).toHaveURL(/\/kunden$/);
  await expect(page.getByText("Familie Beispiel")).toHaveCount(0);
  const [customer] = await sql`select name, contact_name, anonymized_at from customers where anonymized_at is not null`;
  expect(customer).toMatchObject({ contact_name: null });
  expect(customer.name).toMatch(/^Ehemaliger Kunde /);

  // Ausgeschiedene Person ohne Arbeitszeiten: deaktivieren, dann anonymisieren
  await page.goto("/mitarbeiter");
  await page.getByLabel("Name", { exact: true }).fill("Dora Test");
  await page.getByLabel("Benutzername").fill("dora");
  await page.getByLabel("PIN (6 Ziffern)").fill("444444");
  await page.getByRole("button", { name: "Anlegen" }).click();
  await page.getByRole("link", { name: "Dora Test" }).click();
  await page.getByLabel(/Aktiv/).uncheck();
  await page.getByRole("button", { name: "Speichern" }).click();
  await page.getByRole("link", { name: "Dora Test" }).click();
  await page.getByRole("button", { name: "Anonymisieren" }).click();
  await expect(page).toHaveURL(/\/mitarbeiter$/);
  await expect(page.getByText("Dora Test")).toHaveCount(0);
  const [dora] = await sql`select u.name, u.username, u.phone, (select count(*)::int from account a where a.user_id = u.id) as accounts
    from "user" u where u.email like 'anonym-%'`;
  expect(dora).toMatchObject({ username: null, phone: null, accounts: 0 });

  // Person mit Arbeitszeiten in der Frist: nur deaktivieren, Anonymisieren erst nach Fristablauf
  await page.getByRole("link", { name: "Bogdan Ionescu" }).click();
  await page.getByLabel(/Aktiv/).uncheck();
  await page.getByRole("button", { name: "Speichern" }).click();
  await page.getByRole("link", { name: "Bogdan Ionescu" }).click();
  await expect(page.getByText(/Anonymisieren ist ab dem \d\d\.\d\d\.20\d\d möglich/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Anonymisieren" })).toHaveCount(0);
  await sql`update "user" set active = true where username = 'bogdan'`;
  await sql.end();
});

test("8. Zugang: Zwei-Faktor-Anmeldung, Notfall-Code, Kontosperre, Sitzungsdauer", async ({ page }) => {
  page.on("dialog", (d) => d.accept());
  const sql = postgres(DB_URL, { max: 1 });
  await login(page, "gruenderin@glanzwerk.demo", "demo1234");

  // Einrichten wie mit dem Handy: QR-Schlüssel lesen, Code berechnen, bestätigen
  await page.getByRole("link", { name: "Konto und Sicherheit" }).click();
  await page.getByLabel("Zur Bestätigung: Ihr Passwort").fill("demo1234");
  await page.getByRole("button", { name: "Einrichten" }).click();
  await expect(page.getByRole("img", { name: "QR-Code für die Authenticator-App" })).toBeVisible();
  const secret = (await page.locator("code").textContent())!.trim();
  const recoveryCode = (await page.locator("ul.font-mono li").first().textContent())!.trim();
  await page.screenshot({ path: `${SHOTS}/14-zwei-faktor.png`, fullPage: true });
  await page.getByLabel(/6-stelligen Code/).fill(totp(secret));
  await page.getByRole("button", { name: "Bestätigen und einschalten" }).click();
  await expect(page.getByText(/Eingeschaltet/)).toBeVisible();

  // Anmelden braucht jetzt den Code; ein falscher Code wird abgelehnt
  await page.getByRole("button", { name: "Abmelden", exact: true }).click();
  await page.waitForURL(/\/login/);
  await page.getByLabel("E-Mail oder Benutzername").fill("gruenderin@glanzwerk.demo");
  await page.getByLabel("Passwort oder PIN").fill("demo1234");
  await page.getByRole("button", { name: "Anmelden" }).click();
  const codeField = page.getByLabel("6-stelliger Code aus der Authenticator-App");
  await codeField.fill(totp(secret) === "000000" ? "111111" : "000000");
  await page.getByRole("button", { name: "Bestätigen" }).click();
  await expect(page.getByText(/Der Code stimmt nicht/)).toBeVisible();
  await codeField.fill(totp(secret));
  await page.getByRole("button", { name: "Bestätigen" }).click();
  await page.waitForURL(/\/dashboard/);

  // Notfall-Code statt Handy
  await page.getByRole("button", { name: "Abmelden", exact: true }).first().click();
  await page.waitForURL(/\/login/);
  await page.getByLabel("E-Mail oder Benutzername").fill("gruenderin@glanzwerk.demo");
  await page.getByLabel("Passwort oder PIN").fill("demo1234");
  await page.getByRole("button", { name: "Anmelden" }).click();
  await page.getByRole("button", { name: /Notfall-Code verwenden/ }).click();
  await page.getByLabel("Notfall-Code").fill(recoveryCode);
  await page.getByRole("button", { name: "Bestätigen" }).click();
  await page.waitForURL(/\/dashboard/);

  // Büro-Sitzungen enden nach 12 Stunden
  await sql`update session set created_at = now() - interval '13 hours'
    where user_id = (select id from "user" where email = 'gruenderin@glanzwerk.demo')`;
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);

  // Kontosperre nach 10 falschen PINs – unabhängig von der IP
  for (let i = 0; i < 10; i++) {
    const r = await page.request.post("/api/auth/sign-in/username", { headers: ORIGIN, data: { username: "bogdan", password: "999999" } });
    expect(r.status()).toBe(401);
  }
  const locked = await page.request.post("/api/auth/sign-in/username", { headers: ORIGIN, data: { username: "bogdan", password: "222222" } });
  expect(locked.status()).toBe(429);
  expect((await locked.json()).message).toMatch(/Zu viele Fehlversuche/);
  // Nach Ablauf der Sperre klappt es, und der Zähler steht wieder auf 0
  await sql`update "user" set locked_until = now() - interval '1 minute' where username = 'bogdan'`;
  const ok = await page.request.post("/api/auth/sign-in/username", { headers: ORIGIN, data: { username: "bogdan", password: "222222" } });
  expect(ok.status()).toBe(200);
  const [bogdan] = await sql`select failed_logins, locked_until from "user" where username = 'bogdan'`;
  expect(bogdan).toMatchObject({ failed_logins: 0, locked_until: null });
  await sql.end();
});
