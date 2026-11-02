import {
  type AnyPgColumn,
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// Alle Fachtabellen tragen tenant_id (Vorbereitung auf RLS im Zielsystem).
// Geld in Cent (integer), Zeitpunkte als timestamptz.

const ts = (name?: string) =>
  name ? timestamp(name, { withTimezone: true }) : timestamp({ withTimezone: true });
const createdAt = () => ts().notNull().defaultNow();

export const tenants = pgTable("tenants", {
  id: uuid().primaryKey().defaultRandom(),
  name: text().notNull(),
  ownerName: text(),
  street: text(),
  zip: text(),
  city: text(),
  email: text(),
  phone: text(),
  taxNumber: text(),
  vatId: text(),
  iban: text(),
  bic: text(),
  bankName: text(),
  kleinunternehmer: boolean().notNull().default(true),
  invoicePrefix: text().notNull().default("RE"),
  nextInvoiceNo: integer().notNull().default(1),
  kuLimitCents: integer().notNull().default(2_500_000),
  minijobLimitCents: integer().notNull().default(60_300),
  // Löschfristen in Monaten (Seite „Datenschutz“); Arbeitszeiten mindestens 24 (§ 17 MiLoG)
  retentionTimeMonths: integer().notNull().default(24),
  retentionGpsMonths: integer().notNull().default(3),
  retentionPhotoMonths: integer().notNull().default(24),
  createdAt: createdAt(),
});

// ---------- Better Auth (user, session, account, verification) ----------

export type Role = "owner" | "employee";
export type EmploymentType = "minijob" | "teilzeit" | "vollzeit";

export const user = pgTable("user", {
  id: text().primaryKey(),
  name: text().notNull(),
  email: text().notNull().unique(),
  emailVerified: boolean().notNull().default(false),
  image: text(),
  createdAt: ts().notNull().defaultNow(),
  updatedAt: ts().notNull().defaultNow(),
  // username-Plugin
  username: text().unique(),
  displayUsername: text(),
  // eigene Felder (werden nur über Drizzle gelesen/geschrieben)
  tenantId: uuid().references(() => tenants.id),
  role: text().$type<Role>().notNull().default("employee"),
  hourlyWageCents: integer(),
  employmentType: text().$type<EmploymentType>(),
  phone: text(),
  active: boolean().notNull().default(true),
  anonymizedAt: ts(),
  // two-factor-Plugin
  twoFactorEnabled: boolean().notNull().default(false),
  // Kontosperre nach zu vielen Fehlversuchen – unabhängig von der IP (src/lib/auth.ts)
  failedLogins: integer().notNull().default(0),
  lockedUntil: ts(),
});

export const session = pgTable("session", {
  id: text().primaryKey(),
  expiresAt: ts().notNull(),
  token: text().notNull().unique(),
  createdAt: ts().notNull().defaultNow(),
  updatedAt: ts().notNull().defaultNow(),
  ipAddress: text(),
  userAgent: text(),
  userId: text()
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

export const account = pgTable("account", {
  id: text().primaryKey(),
  accountId: text().notNull(),
  providerId: text().notNull(),
  userId: text()
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text(),
  refreshToken: text(),
  idToken: text(),
  accessTokenExpiresAt: ts(),
  refreshTokenExpiresAt: ts(),
  scope: text(),
  password: text(),
  createdAt: ts().notNull().defaultNow(),
  updatedAt: ts().notNull().defaultNow(),
});

// TOTP-Geheimnis und Backup-Codes (verschlüsselt mit BETTER_AUTH_SECRET)
export const twoFactor = pgTable(
  "two_factor",
  {
    id: text().primaryKey(),
    secret: text().notNull(),
    backupCodes: text().notNull(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    verified: boolean().notNull().default(true),
    failedVerificationCount: integer().notNull().default(0),
    lockedUntil: ts(),
  },
  (t) => [index().on(t.userId), index().on(t.secret)],
);

export const verification = pgTable("verification", {
  id: text().primaryKey(),
  identifier: text().notNull(),
  value: text().notNull(),
  expiresAt: ts().notNull(),
  createdAt: ts().notNull().defaultNow(),
  updatedAt: ts().notNull().defaultNow(),
});

// ---------- Stammdaten ----------

export const customers = pgTable("customers", {
  id: uuid().primaryKey().defaultRandom(),
  tenantId: uuid()
    .notNull()
    .references(() => tenants.id),
  name: text().notNull(),
  contactName: text(),
  email: text(),
  phone: text(),
  street: text(),
  zip: text(),
  city: text(),
  anonymizedAt: ts(),
  createdAt: createdAt(),
});

export type BillingModel = "hourly" | "per_visit" | "monthly_flat";

export const sites = pgTable(
  "sites",
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),
    customerId: uuid()
      .notNull()
      .references(() => customers.id),
    name: text().notNull(),
    street: text(),
    zip: text(),
    city: text(),
    region: text().notNull().default(""),
    lat: doublePrecision(),
    lng: doublePrecision(),
    instructions: text(),
    checklist: jsonb().$type<string[]>().notNull().default([]),
    billingModel: text().$type<BillingModel>().notNull().default("hourly"),
    rateCents: integer().notNull().default(0),
    geofenceM: integer().notNull().default(200),
    active: boolean().notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.tenantId, t.customerId)],
);

// ---------- Einsätze ----------

export type JobStatus = "geplant" | "laufend" | "erledigt" | "abgenommen" | "nacharbeit";
export type AiStatus = "none" | "pending" | "done" | "failed" | "disabled";

export type AiReview = {
  photos: {
    index: number;
    kind: string;
    sharp: boolean;
    personVisible: boolean;
    showsCleaningArea: boolean;
    note: string;
  }[];
  comparison: {
    improvementVisible: "ja" | "teilweise" | "nein" | "unklar";
    observations: string[];
  };
  suggestedFollowUp: string | null;
  overall: "ok" | "pruefen";
  model?: string;
};

export const jobs = pgTable(
  "jobs",
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),
    siteId: uuid()
      .notNull()
      .references(() => sites.id),
    date: date({ mode: "string" }).notNull(),
    plannedStart: text().notNull().default("08:00"),
    plannedMinutes: integer().notNull().default(120),
    title: text().notNull().default("Unterhaltsreinigung"),
    status: text().$type<JobStatus>().notNull().default("geplant"),
    seriesId: uuid(),
    notes: text(),
    checklistDone: jsonb().$type<string[]>().notNull().default([]),
    aiStatus: text().$type<AiStatus>().notNull().default("none"),
    aiReview: jsonb().$type<AiReview>(),
    aiError: text(),
    reviewedBy: text().references(() => user.id),
    reviewedAt: ts(),
    reviewComment: text(),
    invoiceId: uuid(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.tenantId, t.date), index().on(t.siteId)],
);

export const jobAssignments = pgTable(
  "job_assignments",
  {
    jobId: uuid()
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    userId: text()
      .notNull()
      .references(() => user.id),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),
  },
  (t) => [primaryKey({ columns: [t.jobId, t.userId] }), index().on(t.userId)],
);

// Originalzeiten bleiben unverändert; Korrekturen stehen in eigenen Feldern (MiLoG-nachvollziehbar).
export const timeEntries = pgTable(
  "time_entries",
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),
    jobId: uuid()
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    userId: text()
      .notNull()
      .references(() => user.id),
    startAt: ts().notNull(),
    endAt: ts(),
    startLat: doublePrecision(),
    startLng: doublePrecision(),
    startAccuracy: doublePrecision(),
    startDistanceM: integer(),
    endLat: doublePrecision(),
    endLng: doublePrecision(),
    endAccuracy: doublePrecision(),
    endDistanceM: integer(),
    correctedStartAt: ts(),
    correctedEndAt: ts(),
    correctionReason: text(),
    correctedBy: text().references(() => user.id),
    correctedAt: ts(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.jobId), index().on(t.userId, t.startAt)],
);

export type PhotoKind = "vorher" | "nachher" | "mangel";

export const photos = pgTable(
  "photos",
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),
    jobId: uuid()
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    userId: text()
      .notNull()
      .references(() => user.id),
    kind: text().$type<PhotoKind>().notNull(),
    filePath: text().notNull(),
    mimeType: text().notNull().default("image/jpeg"),
    bytes: integer().notNull().default(0),
    takenAt: ts().notNull().defaultNow(),
    lat: doublePrecision(),
    lng: doublePrecision(),
    caption: text(),
  },
  (t) => [index().on(t.jobId)],
);

// ---------- Rechnungen ----------

export type InvoiceStatus = "entwurf" | "final" | "bezahlt" | "storniert";
// Korrektur nur per Stornorechnung: eigene Nummer, alle Beträge negativ, verweist auf die stornierte Rechnung
export type InvoiceKind = "rechnung" | "storno";
export type InvoiceUnit = "Std" | "Einsatz" | "Monat" | "Pauschal";

export type TenantSnapshot = {
  name: string;
  ownerName: string | null;
  street: string | null;
  zip: string | null;
  city: string | null;
  email: string | null;
  phone: string | null;
  taxNumber: string | null;
  vatId: string | null;
  iban: string | null;
  bic: string | null;
  bankName: string | null;
};
export type CustomerSnapshot = {
  name: string;
  contactName: string | null;
  street: string | null;
  zip: string | null;
  city: string | null;
};

export const invoices = pgTable(
  "invoices",
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),
    customerId: uuid()
      .notNull()
      .references(() => customers.id),
    number: text(),
    kind: text().$type<InvoiceKind>().notNull().default("rechnung"),
    cancelsInvoiceId: uuid().references((): AnyPgColumn => invoices.id),
    status: text().$type<InvoiceStatus>().notNull().default("entwurf"),
    invoiceDate: date({ mode: "string" }),
    periodMonth: text().notNull(), // YYYY-MM
    netCents: integer().notNull().default(0),
    vatCents: integer().notNull().default(0),
    totalCents: integer().notNull().default(0),
    kleinunternehmer: boolean().notNull().default(true),
    tenantSnapshot: jsonb().$type<TenantSnapshot>(),
    customerSnapshot: jsonb().$type<CustomerSnapshot>(),
    finalizedAt: ts(),
    paidAt: ts(),
    createdAt: createdAt(),
  },
  // Eine Rechnung kann nur einmal storniert werden
  (t) => [uniqueIndex().on(t.tenantId, t.number), index().on(t.tenantId, t.periodMonth), uniqueIndex().on(t.cancelsInvoiceId)],
);

export const invoiceLines = pgTable(
  "invoice_lines",
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),
    invoiceId: uuid()
      .notNull()
      .references(() => invoices.id, { onDelete: "cascade" }),
    siteId: uuid().references(() => sites.id),
    jobId: uuid().references(() => jobs.id),
    position: integer().notNull(),
    description: text().notNull(),
    quantity: numeric({ precision: 10, scale: 2, mode: "number" }).notNull(),
    unit: text().$type<InvoiceUnit>().notNull(),
    unitPriceCents: integer().notNull(),
    vatRate: integer().notNull().default(0),
    totalCents: integer().notNull(),
  },
  (t) => [index().on(t.invoiceId)],
);

// ---------- Protokolle ----------

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),
    actorId: text(),
    action: text().notNull(),
    entity: text().notNull(),
    entityId: text(),
    data: jsonb(),
    at: ts().notNull().defaultNow(),
  },
  (t) => [index().on(t.tenantId, t.at)],
);

export const aiInvocations = pgTable("ai_invocations", {
  id: uuid().primaryKey().defaultRandom(),
  tenantId: uuid()
    .notNull()
    .references(() => tenants.id),
  purpose: text().notNull(),
  model: text().notNull(),
  inputTokens: integer(),
  outputTokens: integer(),
  durationMs: integer(),
  ok: boolean().notNull(),
  error: text(),
  at: ts().notNull().defaultNow(),
});
