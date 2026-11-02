"use client";

import { CalendarDays, Clock, DatabaseBackup, FileText, LayoutDashboard, Settings, ShieldCheck, Users, Building2 } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const items = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/einsaetze", label: "Einsätze", icon: CalendarDays },
  { href: "/kunden", label: "Kunden & Objekte", icon: Building2 },
  { href: "/mitarbeiter", label: "Mitarbeiter", icon: Users },
  { href: "/zeiten", label: "Arbeitszeiten", icon: Clock },
  { href: "/rechnungen", label: "Rechnungen", icon: FileText },
  { href: "/datensicherung", label: "Datensicherung", icon: DatabaseBackup },
  { href: "/datenschutz", label: "Datenschutz", icon: ShieldCheck },
  { href: "/einstellungen", label: "Einstellungen", icon: Settings },
];

export function AppNav() {
  const pathname = usePathname();
  return (
    <nav className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible">
      {items.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              active ? "bg-teal-700 text-white" : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <Icon className="size-4" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
