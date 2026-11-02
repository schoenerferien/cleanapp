import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getCurrentUser, isOwner } from "@/server/session";
import { safeImageContentType } from "@/lib/image-type";
import { getFile } from "@/server/storage";

// Fotos nur für angemeldete Personen desselben Mandanten; Mitarbeitende nur für eigene Einsätze.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await getCurrentUser();
  if (!me) return new Response("Nicht angemeldet", { status: 401 });

  const { photos, jobAssignments } = schema;
  const [photo] = await db
    .select()
    .from(photos)
    .where(and(eq(photos.id, id), eq(photos.tenantId, me.tenantId)));
  if (!photo) return new Response("Nicht gefunden", { status: 404 });

  if (!isOwner(me)) {
    const [assigned] = await db
      .select({ jobId: jobAssignments.jobId })
      .from(jobAssignments)
      .where(and(eq(jobAssignments.jobId, photo.jobId), eq(jobAssignments.userId, me.id)));
    if (!assigned) return new Response("Nicht gefunden", { status: 404 });
  }

  const bytes = await getFile(photo.filePath);
  const type = safeImageContentType(photo.mimeType);
  return new Response(new Uint8Array(bytes), {
    headers: {
      // Unbekannte Typen (Altbestand) nur als Download, nie im Browser darstellen
      "Content-Type": type ?? "application/octet-stream",
      ...(type ? {} : { "Content-Disposition": "attachment" }),
      "X-Content-Type-Options": "nosniff",
      // Selbst wenn eine Datei Skript enthielte: Direktaufruf läuft in einer Sandbox ohne Rechte
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
      "Cache-Control": "private, max-age=86400",
    },
  });
}
