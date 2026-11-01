import { Badge } from "@/components/ui/badge";
import type { Ampel } from "@/domain/limits";
import { jobStatusLabel } from "@/domain/format";
import { cn } from "@/lib/utils";

// Natives <select> im Stil der Inputs – funktioniert ohne JS in Server-Action-Formularen.
export const selectClass =
  "h-8 w-full rounded-lg border border-input bg-background px-2 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm";

export function PageHeader({ title, description, children }: { title: string; description?: string; children?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {children && <div className="flex flex-wrap gap-2">{children}</div>}
    </div>
  );
}

export function Field({ label, children, hint, className }: { label: string; children: React.ReactNode; hint?: string; className?: string }) {
  return (
    <label className={cn("block space-y-1.5", className)}>
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}

const ampelStyle: Record<Ampel, string> = {
  gruen: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  gelb: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  rot: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
};

export function AmpelBadge({ level, children }: { level: Ampel; children: React.ReactNode }) {
  return <Badge className={cn("border-transparent", ampelStyle[level])}>{children}</Badge>;
}

export function AmpelBar({ level, pct }: { level: Ampel; pct: number }) {
  const color = level === "gruen" ? "bg-emerald-500" : level === "gelb" ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
      <div className={cn("h-full rounded-full", color)} style={{ width: `${Math.min(100, pct)}%` }} />
    </div>
  );
}

const statusStyle: Record<string, string> = {
  geplant: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
  laufend: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
  erledigt: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  abgenommen: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  nacharbeit: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
};

export function StatusBadge({ status }: { status: string }) {
  return <Badge className={cn("border-transparent", statusStyle[status])}>{jobStatusLabel[status] ?? status}</Badge>;
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">{children}</div>;
}
