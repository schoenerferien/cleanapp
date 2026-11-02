// Demo-Daten für das POC-Drehbuch. Achtung: leert vorher alle Tabellen.
import { hashPassword } from "better-auth/crypto";
import { ne, sql } from "drizzle-orm";
import { berlinDateTime } from "@/domain/format";
import { addDays, haversineMeters, todayBerlin } from "@/domain/time";
import { db, schema } from "./index";

// Reproduzierbarer Zufall
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(42);
const between = (min: number, max: number) => Math.round(min + rand() * (max - min));

const DEMO_TENANT = "Glanzwerk Reinigung (Demo)";

async function main() {
  // Schutz für den Betrieb: Gibt es eine echte Firma in der Datenbank, wird nichts gelöscht.
  const [real] = await db.select({ name: schema.tenants.name }).from(schema.tenants).where(ne(schema.tenants.name, DEMO_TENANT)).limit(1);
  if (real) throw new Error(`Abgebrochen: Die Datenbank enthält echte Daten („${real.name}“). Der Seed leert alle Tabellen.`);

  await db.execute(sql`TRUNCATE
    ai_invocations, audit_log, invoice_lines, invoices, photos, time_entries, job_assignments, jobs,
    sites, customers, session, account, two_factor, verification, "user", tenants CASCADE`);

  const [tenant] = await db
    .insert(schema.tenants)
    .values({
      name: DEMO_TENANT,
      ownerName: "Lena Hoffmann",
      street: "Mühlenkamp 31",
      zip: "22303",
      city: "Hamburg",
      email: "kontakt@glanzwerk.demo",
      phone: "040 1234567",
      taxNumber: "43/123/45678",
      iban: "DE02120300000000202051",
      bic: "BYLADEM1001",
      bankName: "Demo Bank",
      kleinunternehmer: true,
      invoicePrefix: "RE",
    })
    .returning();
  const tenantId = tenant.id;

  // ---------- Personen ----------
  async function createUser(u: {
    name: string;
    username: string;
    email: string;
    password: string;
    role: "owner" | "employee";
    hourlyWageCents?: number;
    employmentType?: "minijob" | "teilzeit" | "vollzeit";
    phone?: string;
  }) {
    const id = crypto.randomUUID();
    await db.insert(schema.user).values({
      id,
      name: u.name,
      email: u.email,
      emailVerified: true,
      username: u.username,
      displayUsername: u.username,
      tenantId,
      role: u.role,
      hourlyWageCents: u.hourlyWageCents,
      employmentType: u.employmentType,
      phone: u.phone,
    });
    await db.insert(schema.account).values({
      id: crypto.randomUUID(),
      accountId: id,
      providerId: "credential",
      userId: id,
      password: await hashPassword(u.password),
    });
    return id;
  }

  const lena = await createUser({
    name: "Lena Hoffmann",
    username: "lena",
    email: "gruenderin@glanzwerk.demo",
    password: "demo1234",
    role: "owner",
  });
  const anna = await createUser({
    name: "Anna Kowalski",
    username: "anna",
    email: "anna@ma.glanzwerk.demo",
    password: "111111",
    role: "employee",
    hourlyWageCents: 1500,
    employmentType: "minijob",
    phone: "0151 1111111",
  });
  const bogdan = await createUser({
    name: "Bogdan Ionescu",
    username: "bogdan",
    email: "bogdan@ma.glanzwerk.demo",
    password: "222222",
    role: "employee",
    hourlyWageCents: 1500,
    employmentType: "minijob",
    phone: "0151 2222222",
  });
  const celine = await createUser({
    name: "Celine Arslan",
    username: "celine",
    email: "celine@ma.glanzwerk.demo",
    password: "333333",
    role: "employee",
    hourlyWageCents: 1550,
    employmentType: "teilzeit",
    phone: "0151 3333333",
  });

  // ---------- Kunden & Objekte (Hamburg, Lübeck, Kiel) ----------
  const [praxis, hausverwaltung, foerde] = await db
    .insert(schema.customers)
    .values([
      { tenantId, name: "Praxis Dr. Meier", contactName: "Dr. Sabine Meier", email: "praxis@meier.demo", street: "Eppendorfer Landstraße 40", zip: "20249", city: "Hamburg" },
      { tenantId, name: "Hausverwaltung Nord GmbH", contactName: "Herr Petersen", email: "service@hv-nord.demo", street: "Breite Straße 10", zip: "23552", city: "Lübeck" },
      { tenantId, name: "Förde Consulting GmbH", contactName: "Frau Jensen", email: "office@foerde.demo", street: "Holstenbrücke 8", zip: "24103", city: "Kiel" },
    ])
    .returning();

  const praxisChecklist = ["Böden wischen", "Sanitär reinigen und desinfizieren", "Mülleimer leeren", "Türklinken desinfizieren", "Empfangstresen reinigen"];
  const treppenChecklist = ["Treppen fegen und wischen", "Handläufe abwischen", "Briefkastenanlage reinigen", "Eingangstür Glas reinigen"];
  const bueroChecklist = ["Schreibtische abwischen", "Teeküche reinigen", "Sanitär reinigen", "Böden saugen", "Papierkörbe leeren"];

  const [sPraxis, sLuebeck, sWandsbek, sKiel] = await db
    .insert(schema.sites)
    .values([
      {
        tenantId, customerId: praxis.id, name: "Praxis Dr. Meier", street: "Eppendorfer Landstraße 40", zip: "20249", city: "Hamburg",
        region: "Hamburg", lat: 53.5878, lng: 9.9846, billingModel: "hourly", rateCents: 3200, checklist: praxisChecklist,
        instructions: "Schlüssel im Schlüsselkasten (Code beim Büro). Behandlungsräume nur mit Flächendesinfektion, keine Patientenakten berühren.",
      },
      {
        tenantId, customerId: hausverwaltung.id, name: "Treppenhaus Holstenstraße 12", street: "Holstenstraße 12", zip: "23552", city: "Lübeck",
        region: "Lübeck", lat: 53.8662, lng: 10.6808, billingModel: "per_visit", rateCents: 8500, checklist: treppenChecklist,
        instructions: "4 Etagen, Reinigungsmittel im Kellerraum links. Haustür nicht offen stehen lassen.",
      },
      {
        tenantId, customerId: hausverwaltung.id, name: "Treppenhaus Wandsbeker Chaussee 80", street: "Wandsbeker Chaussee 80", zip: "22089", city: "Hamburg",
        region: "Hamburg", lat: 53.5701, lng: 10.0577, billingModel: "per_visit", rateCents: 7000, checklist: treppenChecklist,
        instructions: "3 Etagen. Wasseranschluss im Keller.",
      },
      {
        tenantId, customerId: foerde.id, name: "Büro Förde Consulting", street: "Holstenbrücke 8", zip: "24103", city: "Kiel",
        region: "Kiel", lat: 54.3227, lng: 10.1385, billingModel: "monthly_flat", rateCents: 45_000, checklist: bueroChecklist,
        instructions: "Zugang über Seiteneingang, Alarmanlage mit Code deaktivieren. 2. OG, ca. 280 m².",
      },
    ])
    .returning();

  // ---------- Einsätze: September bis +13 Tage ----------
  // Wochentag: 0 = So … 6 = Sa
  const plans = [
    { site: sPraxis, weekdays: [1, 3, 5], start: "18:00", minutes: 150, users: [anna] },
    { site: sLuebeck, weekdays: [2], start: "08:00", minutes: 90, users: [bogdan] },
    { site: sWandsbek, weekdays: [4], start: "09:00", minutes: 60, users: [anna] },
    { site: sKiel, weekdays: [1, 4], start: "07:00", minutes: 120, users: [celine] },
  ];

  const today = todayBerlin();
  const firstDay = "2026-09-01";
  const lastDay = addDays(today, 13);

  type NewJob = typeof schema.jobs.$inferInsert & { users: string[] };
  const jobRows: NewJob[] = [];
  for (const p of plans) {
    const seriesId = crypto.randomUUID();
    for (let d = firstDay; d <= lastDay; d = addDays(d, 1)) {
      const wd = new Date(`${d}T12:00:00Z`).getUTCDay();
      if (!p.weekdays.includes(wd)) continue;
      const status = d < "2026-10-01" ? "abgenommen" : d < today ? "erledigt" : "geplant";
      jobRows.push({
        tenantId, siteId: p.site.id, date: d, plannedStart: p.start, plannedMinutes: p.minutes, seriesId,
        status, checklistDone: status === "geplant" ? [] : (p.site.checklist as string[]),
        reviewedBy: status === "abgenommen" ? lena : null,
        reviewedAt: status === "abgenommen" ? berlinDateTime(addDays(d, 1), "09:00") : null,
        users: p.users,
      });
    }
  }
  // Heute (für das Drehbuch): Anna hat eine Sonderreinigung, Bogdan ist gerade eingestempelt.
  jobRows.push(
    { tenantId, siteId: sPraxis.id, date: today, plannedStart: "10:00", plannedMinutes: 120, title: "Sonderreinigung Wartezimmer", status: "geplant", users: [anna] },
    { tenantId, siteId: sLuebeck.id, date: today, plannedStart: "09:00", plannedMinutes: 90, title: "Zwischenreinigung Treppenhaus", status: "laufend", users: [bogdan] },
  );

  const siteById = new Map([sPraxis, sLuebeck, sWandsbek, sKiel].map((s) => [s.id, s]));
  let corrected = false;

  for (const row of jobRows) {
    const { users, ...values } = row;
    const [job] = await db.insert(schema.jobs).values(values).returning();
    await db.insert(schema.jobAssignments).values(users.map((userId) => ({ jobId: job.id, userId, tenantId })));
    if (job.status === "geplant") continue;

    const site = siteById.get(job.siteId)!;
    for (const userId of users) {
      const startAt = new Date(berlinDateTime(job.date, job.plannedStart).getTime() + between(-5, 10) * 60_000);
      const endAt =
        job.status === "laufend" ? null : new Date(startAt.getTime() + (job.plannedMinutes + between(-15, 15)) * 60_000);
      const jitter = () => (rand() - 0.5) * 0.0012; // ca. ±60 m
      const startPos = { lat: site.lat! + jitter(), lng: site.lng! + jitter() };
      const endPos = { lat: site.lat! + jitter(), lng: site.lng! + jitter() };
      const correction =
        !corrected && job.status === "abgenommen" && userId === anna && job.date >= "2026-09-14"
          ? {
              correctedEndAt: new Date(startAt.getTime() + job.plannedMinutes * 60_000),
              correctionReason: "Ausstempeln vergessen – laut Rücksprache um Planende gegangen",
              correctedBy: lena,
              correctedAt: berlinDateTime(addDays(job.date, 1), "09:15"),
            }
          : {};
      if ("correctedEndAt" in correction) corrected = true;
      await db.insert(schema.timeEntries).values({
        tenantId, jobId: job.id, userId,
        startAt: job.status === "laufend" ? new Date(Date.now() - 55 * 60_000) : startAt,
        endAt: "correctedEndAt" in correction ? new Date(startAt.getTime() + (job.plannedMinutes + 95) * 60_000) : endAt,
        startLat: startPos.lat, startLng: startPos.lng, startAccuracy: between(8, 25),
        startDistanceM: haversineMeters(startPos, { lat: site.lat!, lng: site.lng! }),
        endLat: endAt ? endPos.lat : null, endLng: endAt ? endPos.lng : null, endAccuracy: endAt ? between(8, 25) : null,
        endDistanceM: endAt ? haversineMeters(endPos, { lat: site.lat!, lng: site.lng! }) : null,
        ...correction,
      });
    }
  }

  console.log(`Seed fertig: ${jobRows.length} Einsätze von ${firstDay} bis ${lastDay}.`);
  console.log("Logins:  Gründerin  gruenderin@glanzwerk.demo / demo1234");
  console.log("         Mitarbeitende  anna / 111111 · bogdan / 222222 · celine / 333333");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
