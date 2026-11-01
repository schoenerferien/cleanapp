import { audit } from "@/server/audit";
import { BACKUP_ENTITY, buildBackup, type BackupAuditData } from "@/server/backup";
import { getCurrentUser } from "@/server/session";
import { zipStream } from "@/server/zip";

// Datensicherung als ZIP: Datenbank (JSON je Tabelle) + Fotos + Rechnungs-PDFs. Wird beim Herunterladen
// erzeugt und gestreamt – es bleibt keine Kopie auf dem Server liegen.
export async function GET() {
  const me = await getCurrentUser();
  if (!me || me.role !== "owner") return new Response("Nicht erlaubt", { status: 403 });

  const backup = await buildBackup(me.tenantId);
  let bytes = 0;
  const body = zipStream(backup.entries).pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        bytes += chunk.byteLength;
        controller.enqueue(chunk);
      },
      // Erst nach dem letzten Byte protokollieren – abgebrochene Downloads zählen nicht als Backup
      async flush() {
        const data: BackupAuditData = { ...backup.summary(), bytes };
        await audit({ tenantId: me.tenantId, actorId: me.id, action: "download", entity: BACKUP_ENTITY, data }).catch((err) =>
          console.error("Datensicherung: Protokoll fehlgeschlagen", err),
        );
      },
    }),
  );

  return new Response(body, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${backup.filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
