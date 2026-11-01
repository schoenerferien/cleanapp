import "server-only";
import { asc, eq, inArray, and } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import type { AiReview } from "@/db/schema";
import { getFile } from "@/server/storage";
import { mistralClient, VISION_MODEL } from "./mistral";

// KI-Hinweise zur Fotodokumentation eines Einsatzes.
// Leitplanke: Es wird nur der Einsatz betrachtet – keine Bewertung von Personen, kein Score pro Mitarbeiter.

const MAX_PHOTOS = 8;

const reviewSchema = z.object({
  photos: z.array(
    z.object({
      index: z.number().int(),
      kind: z.string(),
      sharp: z.boolean(),
      personVisible: z.boolean(),
      showsCleaningArea: z.boolean(),
      note: z.string(),
    }),
  ),
  comparison: z.object({
    improvementVisible: z.enum(["ja", "teilweise", "nein", "unklar"]),
    observations: z.array(z.string()),
  }),
  suggestedFollowUp: z.string().nullable(),
  overall: z.enum(["ok", "pruefen"]),
});

// Hand geschrieben, damit es exakt dem strikten JSON-Schema-Modus von Mistral entspricht.
const jsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["photos", "comparison", "suggestedFollowUp", "overall"],
  properties: {
    photos: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["index", "kind", "sharp", "personVisible", "showsCleaningArea", "note"],
        properties: {
          index: { type: "integer", description: "Fotonummer wie im Prompt (beginnend bei 1)" },
          kind: { type: "string", enum: ["vorher", "nachher"] },
          sharp: { type: "boolean", description: "scharf und hell genug, um den Zustand zu beurteilen" },
          personVisible: { type: "boolean", description: "Person oder Gesicht erkennbar (Datenschutz)" },
          showsCleaningArea: { type: "boolean", description: "zeigt einen zu reinigenden Bereich" },
          note: { type: "string", description: "kurze Beobachtung auf Deutsch, max. 15 Wörter" },
        },
      },
    },
    comparison: {
      type: "object",
      additionalProperties: false,
      required: ["improvementVisible", "observations"],
      properties: {
        improvementVisible: { type: "string", enum: ["ja", "teilweise", "nein", "unklar"] },
        observations: { type: "array", items: { type: "string" }, description: "1–4 konkrete Beobachtungen auf Deutsch" },
      },
    },
    suggestedFollowUp: { type: ["string", "null"], description: "konkreter Nacharbeitshinweis oder null" },
    overall: { type: "string", enum: ["ok", "pruefen"] },
  },
};

const SYSTEM_PROMPT = `Du unterstützt die Qualitätskontrolle einer Gebäudereinigung. Du erhältst die Fotos eines Reinigungseinsatzes (vorher und nachher).
Bewerte ausschließlich die Fotos und den Zustand der Flächen – niemals Personen oder deren Arbeitsleistung.
Für jedes Foto:
- sharp: Ist das Foto scharf und hell genug, um den Zustand zu beurteilen?
- personVisible: Ist eine Person oder ein Gesicht erkennbar? (Datenschutzhinweis)
- showsCleaningArea: Zeigt das Foto einen zu reinigenden Bereich (Boden, Sanitär, Oberflächen, Treppe …)?
- note: kurze Beobachtung auf Deutsch.
Vergleich: improvementVisible = "ja", "teilweise" oder "nein", ob nach der Reinigung eine Verbesserung erkennbar ist; "unklar", wenn vorher und nachher nicht denselben Bereich zeigen oder Fotos fehlen.
observations: 1–4 kurze, konkrete Beobachtungen (z. B. „Spiegel weiterhin mit Kalkflecken“).
suggestedFollowUp: konkreter Hinweis für Nacharbeit oder null.
overall = "pruefen", wenn ein Foto unscharf ist, eine Person erkennbar ist, ein Foto keinen Reinigungsbereich zeigt oder die Verbesserung "nein" oder "teilweise" ist – sonst "ok".
Antworte ausschließlich im vorgegebenen JSON-Format.`;

export async function runPhotoReview(jobId: string, tenantId: string): Promise<void> {
  const { jobs, sites, photos, aiInvocations } = schema;
  const client = mistralClient();
  if (!client) {
    await db.update(jobs).set({ aiStatus: "disabled", aiError: null }).where(eq(jobs.id, jobId));
    return;
  }

  const [job] = await db
    .select({ title: jobs.title, siteName: sites.name, checklist: sites.checklist, instructions: sites.instructions })
    .from(jobs)
    .innerJoin(sites, eq(sites.id, jobs.siteId))
    .where(and(eq(jobs.id, jobId), eq(jobs.tenantId, tenantId)));
  if (!job) return;

  const all = await db
    .select()
    .from(photos)
    .where(and(eq(photos.jobId, jobId), inArray(photos.kind, ["vorher", "nachher"])))
    .orderBy(asc(photos.takenAt));
  const selected = reviewPhotoOrder(all);
  if (selected.length === 0) {
    await db.update(jobs).set({ aiStatus: "none" }).where(eq(jobs.id, jobId));
    return;
  }

  await db.update(jobs).set({ aiStatus: "pending", aiError: null }).where(eq(jobs.id, jobId));
  const started = Date.now();

  try {
    const content: ({ type: "text"; text: string } | { type: "image_url"; imageUrl: string })[] = [
      {
        type: "text",
        text: `Objekt: ${job.siteName} – ${job.title}\nCheckliste: ${job.checklist.join("; ") || "–"}\nArbeitsanweisung: ${job.instructions ?? "–"}\nEs folgen ${selected.length} Fotos.`,
      },
    ];
    for (const [i, p] of selected.entries()) {
      const bytes = await getFile(p.filePath);
      content.push({ type: "text", text: `Foto ${i + 1} (${p.kind})` });
      content.push({ type: "image_url", imageUrl: `data:${p.mimeType};base64,${bytes.toString("base64")}` });
    }

    const res = await client.chat.complete({
      model: VISION_MODEL,
      temperature: 0.1,
      maxTokens: 1500,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content },
      ],
      responseFormat: { type: "json_schema", jsonSchema: { name: "einsatz_fotopruefung", schemaDefinition: jsonSchema, strict: true } },
    });

    const raw = res.choices?.[0]?.message?.content;
    const text = typeof raw === "string" ? raw : (raw ?? []).map((c) => ("text" in c ? c.text : "")).join("");
    const review: AiReview = { ...reviewSchema.parse(JSON.parse(text)), model: VISION_MODEL };

    await db.update(jobs).set({ aiStatus: "done", aiReview: review, aiError: null }).where(eq(jobs.id, jobId));
    await db.insert(aiInvocations).values({
      tenantId,
      purpose: "photo_review",
      model: VISION_MODEL,
      inputTokens: res.usage?.promptTokens ?? null,
      outputTokens: res.usage?.completionTokens ?? null,
      durationMs: Date.now() - started,
      ok: true,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message.slice(0, 500) : String(err);
    await db.update(jobs).set({ aiStatus: "failed", aiError: message }).where(eq(jobs.id, jobId));
    await db.insert(aiInvocations).values({
      tenantId,
      purpose: "photo_review",
      model: VISION_MODEL,
      durationMs: Date.now() - started,
      ok: false,
      error: message,
    });
  }
}

/**
 * Auswahl und Reihenfolge der Fotos, die an die KI gehen (bis zu 4 vorher + 4 nachher).
 * Die Prüfansicht nutzt dieselbe Funktion, um „Foto N“ aus der Antwort dem richtigen Bild zuzuordnen.
 */
export function reviewPhotoOrder<T extends { kind: string }>(photosByTime: T[]): T[] {
  return [
    ...photosByTime.filter((p) => p.kind === "vorher").slice(0, MAX_PHOTOS / 2),
    ...photosByTime.filter((p) => p.kind === "nachher").slice(0, MAX_PHOTOS / 2),
  ];
}
