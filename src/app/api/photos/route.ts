import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { PhotoKind } from "@/db/schema";
import { getCurrentUser } from "@/server/session";
import { imageExtension, sniffImageType } from "@/lib/image-type";
import { putFile } from "@/server/storage";

const MAX_BYTES = 5 * 1024 * 1024;
const KINDS: PhotoKind[] = ["vorher", "nachher", "mangel"];

// Foto-Upload aus der Mitarbeiter-App (Bild ist im Browser bereits verkleinert und ohne EXIF).
// Ohne Standort: GPS wird nur beim Ein- und Ausstempeln erfasst.
export async function POST(request: Request) {
  const me = await getCurrentUser();
  if (!me) return Response.json({ error: "Nicht angemeldet" }, { status: 401 });

  const form = await request.formData();
  const jobId = String(form.get("jobId") ?? "");
  const kind = String(form.get("kind") ?? "") as PhotoKind;
  const file = form.get("file");
  if (!KINDS.includes(kind) || !(file instanceof File)) return Response.json({ error: "Ungültige Anfrage" }, { status: 400 });
  if (file.size > MAX_BYTES) return Response.json({ error: "Nur Bilder bis 5 MB" }, { status: 400 });
  const bytes = new Uint8Array(await file.arrayBuffer());
  // Typ aus dem Dateiinhalt, nicht aus der Angabe des Browsers (verhindert z. B. SVG mit Skript)
  const mimeType = sniffImageType(bytes);
  if (!mimeType) return Response.json({ error: "Nur Fotos im Format JPEG, PNG oder WebP" }, { status: 400 });

  const { jobs, jobAssignments, photos } = schema;
  const [job] = await db
    .select({ id: jobs.id, status: jobs.status })
    .from(jobs)
    .innerJoin(jobAssignments, and(eq(jobAssignments.jobId, jobs.id), eq(jobAssignments.userId, me.id)))
    .where(and(eq(jobs.id, jobId), eq(jobs.tenantId, me.tenantId)));
  if (!job) return Response.json({ error: "Einsatz nicht gefunden" }, { status: 404 });
  if (job.status === "abgenommen") return Response.json({ error: "Einsatz ist bereits abgenommen" }, { status: 409 });

  const id = crypto.randomUUID();
  const key = `${me.tenantId}/${jobId}/${id}.${imageExtension(mimeType)}`;
  await putFile(key, bytes);
  await db.insert(photos).values({
    id,
    tenantId: me.tenantId,
    jobId,
    userId: me.id,
    kind,
    filePath: key,
    mimeType,
    bytes: bytes.byteLength,
    caption: String(form.get("caption") ?? "").slice(0, 500) || null,
  });
  return Response.json({ id });
}
