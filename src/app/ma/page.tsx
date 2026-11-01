import { ChevronRight, MapPin } from "lucide-react";
import Link from "next/link";
import { EmptyState, StatusBadge } from "@/components/bits";
import { dateWithWeekday, hoursLabel } from "@/domain/format";
import { addDays, todayBerlin } from "@/domain/time";
import { listJobs } from "@/server/queries";
import { requireUser } from "@/server/session";

export default async function MyJobsPage() {
  const me = await requireUser();
  const today = todayBerlin();
  const rows = await listJobs(me.tenantId, { from: addDays(today, -1), to: addDays(today, 7), userId: me.id });
  // Gestern nur, wenn noch etwas offen ist
  const visible = rows.filter((r) => r.date >= today || r.status === "laufend" || r.status === "nacharbeit");
  const days = [...new Set(visible.map((r) => r.date))];

  return (
    <div className="space-y-6">
      {days.length === 0 && <EmptyState>Keine Einsätze in den nächsten 7 Tagen.</EmptyState>}
      {days.map((d) => (
        <section key={d}>
          <h2 className={`mb-2 text-sm font-semibold ${d === today ? "text-teal-700" : "text-muted-foreground"}`}>
            {d === today ? "Heute" : dateWithWeekday(d)}
          </h2>
          <div className="space-y-2">
            {visible
              .filter((r) => r.date === d)
              .map((r) => (
                <Link
                  key={r.id}
                  href={`/ma/einsatz/${r.id}`}
                  className={`flex items-center gap-3 rounded-2xl border p-4 active:bg-muted ${r.status === "laufend" ? "border-sky-400 bg-sky-50 dark:bg-sky-950/30" : "bg-background"}`}
                >
                  <div className="w-14 shrink-0 text-center">
                    <p className="text-lg font-semibold tabular-nums">{r.plannedStart}</p>
                    <p className="text-xs text-muted-foreground">{hoursLabel(r.plannedMinutes)}</p>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{r.siteName}</p>
                    <p className="flex items-center gap-1 truncate text-sm text-muted-foreground">
                      <MapPin className="size-3.5 shrink-0" /> {r.city} · {r.title}
                    </p>
                    <div className="mt-1.5">
                      <StatusBadge status={r.status} />
                    </div>
                  </div>
                  <ChevronRight className="size-5 text-muted-foreground" />
                </Link>
              ))}
          </div>
        </section>
      ))}
    </div>
  );
}
