import { monthOf, todayBerlin } from "@/domain/time";
import { getCurrentUser } from "@/server/session";
import { timeEntriesCsv } from "@/server/time-report";

// Arbeitszeiten eines Monats als CSV (Aufbau siehe timeEntriesCsv).
export async function GET(request: Request) {
  const me = await getCurrentUser();
  if (!me || me.role !== "owner") return new Response("Nicht erlaubt", { status: 403 });
  const m = new URL(request.url).searchParams.get("m");
  const month = m && /^\d{4}-\d{2}$/.test(m) ? m : monthOf(todayBerlin());

  const csv = await timeEntriesCsv(me.tenantId, month);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="arbeitszeiten-${month}.csv"`,
    },
  });
}
