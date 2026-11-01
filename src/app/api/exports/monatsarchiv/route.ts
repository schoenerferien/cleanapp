import { monthOf, shiftMonth, todayBerlin } from "@/domain/time";
import { audit } from "@/server/audit";
import { ARCHIVE_ENTITY, buildMonthArchive } from "@/server/month-archive";
import { getCurrentUser } from "@/server/session";

// Monatsarchiv als ZIP: Arbeitszeiten (CSV) + im Monat ausgestellte Rechnungen (PDF, unverändert) + LIESMICH.
export async function GET(request: Request) {
  const me = await getCurrentUser();
  if (!me || me.role !== "owner") return new Response("Nicht erlaubt", { status: 403 });
  const m = new URL(request.url).searchParams.get("m");
  const month = m && /^\d{4}-\d{2}$/.test(m) ? m : shiftMonth(monthOf(todayBerlin()), -1);

  const zip = await buildMonthArchive(me.tenantId, month);
  // Für die Erinnerung im Dashboard: dieser Monat wurde heruntergeladen
  await audit({ tenantId: me.tenantId, actorId: me.id, action: "download", entity: ARCHIVE_ENTITY, entityId: month });
  return new Response(new Uint8Array(zip), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="monatsarchiv-${month}.zip"`,
      "Cache-Control": "no-store",
    },
  });
}
